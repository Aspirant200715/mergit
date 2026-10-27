//! Local chain for tests: spawns Anvil on a free port and deploys with mergit-contracts' Deploy script, so tests
//! run against the real contracts. Needs `anvil` and `forge` on PATH and the contracts repository at
//! MERGIT_CONTRACTS_DIR (default: next to this repository).

use crate::{Contracts, Deployment, provider};
use alloy::primitives::{Address, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::signers::local::PrivateKeySigner;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

/// Anvil's well-known test key 0, the deployer. Public; never use it anywhere real. Every other role gets a
/// fresh key funded through `anvil_setBalance`, so nothing depends on remembering more of Anvil's keys.
const DEPLOYER_KEY: &str = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

static FORGE: Mutex<()> = Mutex::new(());

#[derive(Clone)]
pub struct Keys {
    pub deployer: PrivateKeySigner,
    pub gateway: PrivateKeySigner,
    pub validator: PrivateKeySigner,
    pub treasury: PrivateKeySigner,
    pub adjudicator: PrivateKeySigner,
}

pub struct Agent {
    pub agent_id: U256,
    pub operator: PrivateKeySigner,
    pub runtime: PrivateKeySigner,
}

pub struct Chain {
    pub rpc: String,
    pub deployment: Deployment,
    pub keys: Keys,
    anvil: Child,
}

impl Drop for Chain {
    fn drop(&mut self) {
        let _ = self.anvil.kill();
        let _ = self.anvil.wait();
    }
}

fn contracts_dir() -> String {
    std::env::var("MERGIT_CONTRACTS_DIR")
        .unwrap_or_else(|_| format!("{}/../../../mergit-contracts", env!("CARGO_MANIFEST_DIR")))
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

impl Chain {
    pub async fn start() -> Chain {
        let port = free_port();
        let anvil = Command::new("anvil")
            .args(["--port", &port.to_string(), "--silent"])
            .stdout(Stdio::null())
            .spawn()
            .expect("anvil must be on PATH");
        let rpc = format!("http://127.0.0.1:{port}");
        let probe = ProviderBuilder::new().connect_http(rpc.parse().unwrap());
        for _ in 0..100 {
            if probe.get_block_number().await.is_ok() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        let keys = Keys {
            deployer: DEPLOYER_KEY.parse().unwrap(),
            gateway: PrivateKeySigner::random(),
            validator: PrivateKeySigner::random(),
            treasury: PrivateKeySigner::random(),
            adjudicator: PrivateKeySigner::random(),
        };
        let name = format!("test-{port}");
        let dir = contracts_dir();
        {
            let _g = FORGE.lock().unwrap_or_else(|e| e.into_inner());
            let out = Command::new("forge")
                .current_dir(&dir)
                .args([
                    "script",
                    "script/Deploy.s.sol",
                    "--rpc-url",
                    &rpc,
                    "--broadcast",
                    "--private-key",
                    DEPLOYER_KEY,
                ])
                .env("GATEWAY_ADDR", keys.gateway.address().to_string())
                .env("VALIDATOR_ADDR", keys.validator.address().to_string())
                .env("TREASURY_ADDR", keys.treasury.address().to_string())
                .env("ADJUDICATOR_ADDR", keys.adjudicator.address().to_string())
                .env("DEPLOYMENT_NAME", &name)
                .env_remove("USDC")
                .output()
                .expect("forge must be on PATH");
            assert!(
                out.status.success(),
                "deploy failed: {}",
                String::from_utf8_lossy(&out.stderr)
            );
        }
        let file = format!("{dir}/deployments/{name}.json");
        let deployment = Deployment::load(&file).expect("deployment file");
        let _ = std::fs::remove_file(&file);
        let chain = Chain {
            rpc,
            deployment,
            keys,
            anvil,
        };
        for k in [
            &chain.keys.gateway,
            &chain.keys.validator,
            &chain.keys.treasury,
            &chain.keys.adjudicator,
        ] {
            chain.fund_eth(k.address()).await;
        }
        chain
    }

    pub fn contracts(&self, signer: PrivateKeySigner) -> Contracts {
        Contracts::new(&self.deployment, provider(&self.rpc, signer).unwrap())
    }

    /// Gives `who` 100 test ETH.
    pub async fn fund_eth(&self, who: Address) {
        let p = ProviderBuilder::new().connect_http(self.rpc.parse().unwrap());
        let _: () = p
            .raw_request(
                "anvil_setBalance".into(),
                (who, U256::from(100u128 * 10u128.pow(18))),
            )
            .await
            .unwrap();
    }

    /// Mints mock USDC to `who`.
    pub async fn mint_usdc(&self, who: Address, amount: u64) {
        let c = self.contracts(self.keys.deployer.clone());
        c.usdc
            .mint(who, U256::from(amount))
            .send()
            .await
            .unwrap()
            .get_receipt()
            .await
            .unwrap();
    }

    /// Moves chain time forward and mines a block.
    pub async fn increase_time(&self, secs: u64) {
        let p = ProviderBuilder::new().connect_http(self.rpc.parse().unwrap());
        let _: serde_json::Value = p
            .raw_request("evm_increaseTime".into(), (secs,))
            .await
            .unwrap();
        let _: serde_json::Value = p.raw_request("evm_mine".into(), ()).await.unwrap();
    }

    /// Registers a fresh agent with a fresh operator and runtime key.
    pub async fn register_agent(&self) -> Agent {
        let operator = PrivateKeySigner::random();
        let runtime = PrivateKeySigner::random();
        self.fund_eth(operator.address()).await;
        let c = self.contracts(operator.clone());
        let id = c
            .identity
            .registerAgent(runtime.address(), String::new())
            .call()
            .await
            .unwrap();
        c.identity
            .registerAgent(runtime.address(), String::new())
            .send()
            .await
            .unwrap()
            .get_receipt()
            .await
            .unwrap();
        // Every task encumbers stake, so a fresh agent posts 100 USDC of it.
        let stake = U256::from(100_000_000u64);
        self.mint_usdc(operator.address(), 100_000_000).await;
        let approve = c.usdc.approve(self.deployment.stake_vault, stake);
        approve.send().await.unwrap().get_receipt().await.unwrap();
        c.vault
            .deposit(stake)
            .send()
            .await
            .unwrap()
            .get_receipt()
            .await
            .unwrap();
        Agent {
            agent_id: id,
            operator,
            runtime,
        }
    }
}
