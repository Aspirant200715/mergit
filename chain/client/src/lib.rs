//! Typed access to the Mergit contracts, generated from the ABIs in `chain/abi` (never hand-written), plus
//! the deployment file every service reads.

use alloy::network::EthereumWallet;
use alloy::primitives::Address;
use alloy::providers::{DynProvider, Provider, ProviderBuilder};
use alloy::signers::local::PrivateKeySigner;
use serde::Deserialize;

#[cfg(feature = "testkit")]
pub mod testkit;

#[allow(clippy::too_many_arguments)] // generated from the contract ABIs
pub mod abi {
    alloy::sol!(
        #[sol(rpc)]
        #[derive(Debug)]
        Identity,
        "../abi/Identity.json"
    );
    alloy::sol!(
        #[sol(rpc)]
        #[derive(Debug)]
        Escrow,
        "../abi/Escrow.json"
    );
    alloy::sol!(
        #[sol(rpc)]
        #[derive(Debug)]
        ReceiptRegistry,
        "../abi/ReceiptRegistry.json"
    );
    alloy::sol!(
        #[sol(rpc)]
        #[derive(Debug)]
        StakeVault,
        "../abi/StakeVault.json"
    );
    alloy::sol!(
        #[sol(rpc)]
        #[derive(Debug)]
        ChallengeManager,
        "../abi/ChallengeManager.json"
    );
    alloy::sol!(
        #[sol(rpc)]
        #[derive(Debug)]
        ReputationAnchor,
        "../abi/ReputationAnchor.json"
    );
    alloy::sol! {
        /// The parts of USDC the services use; `mint` exists only on the local mock.
        #[sol(rpc)]
        interface Usdc {
            function balanceOf(address owner) external view returns (uint256);
            function approve(address spender, uint256 amount) external returns (bool);
            function allowance(address owner, address spender) external view returns (uint256);
            function transfer(address to, uint256 amount) external returns (bool);
            function mint(address to, uint256 amount) external;
        }
    }
    alloy::sol! {
        /// Role checks, inherited from OpenZeppelin AccessControl by every contract.
        #[sol(rpc)]
        interface Roles {
            function hasRole(bytes32 role, address account) external view returns (bool);
            function GATEWAY_ROLE() external view returns (bytes32);
        }
    }
}

/// `deployments/<name>.json`, written by mergit-contracts' Deploy script.
#[derive(Debug, Clone, Deserialize)]
pub struct Deployment {
    pub chain_id: u64,
    pub deploy_block: u64,
    pub window_seconds: u64,
    pub usdc: Address,
    pub identity: Address,
    pub escrow: Address,
    pub receipt_registry: Address,
    pub stake_vault: Address,
    pub challenge_manager: Address,
    pub reputation_anchor: Address,
    pub roles: RoleAddresses,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RoleAddresses {
    pub gateway: Address,
    pub validator: Address,
    pub treasury: Address,
    pub adjudicator: Address,
}

impl Deployment {
    pub fn load(path: &str) -> anyhow::Result<Self> {
        Ok(serde_json::from_str(&std::fs::read_to_string(path)?)?)
    }

    /// From `DEPLOYMENT_JSON` (the file's contents, convenient on hosts) or else `DEPLOYMENT_FILE` (a path).
    pub fn from_env() -> anyhow::Result<Self> {
        if let Ok(json) = std::env::var("DEPLOYMENT_JSON") {
            return Ok(serde_json::from_str(&json)?);
        }
        match std::env::var("DEPLOYMENT_FILE") {
            Ok(path) => Self::load(&path),
            Err(_) => anyhow::bail!(
                "set DEPLOYMENT_JSON (the deployment file's contents) or DEPLOYMENT_FILE (its path)"
            ),
        }
    }
}

/// A provider that signs with `signer`.
pub fn provider(rpc_url: &str, signer: PrivateKeySigner) -> anyhow::Result<DynProvider> {
    Ok(ProviderBuilder::new()
        .wallet(EthereumWallet::from(signer))
        .connect_http(rpc_url.parse()?)
        .erased())
}

/// Every contract bound to one provider.
pub struct Contracts {
    pub provider: DynProvider,
    pub identity: abi::Identity::IdentityInstance<DynProvider>,
    pub escrow: EscrowWithRoles,
    pub registry: abi::ReceiptRegistry::ReceiptRegistryInstance<DynProvider>,
    pub usdc: abi::Usdc::UsdcInstance<DynProvider>,
    pub vault: abi::StakeVault::StakeVaultInstance<DynProvider>,
    pub challenges: abi::ChallengeManager::ChallengeManagerInstance<DynProvider>,
    pub anchor: abi::ReputationAnchor::ReputationAnchorInstance<DynProvider>,
}

/// Escrow's interface plus the role getters its implementation inherits.
pub struct EscrowWithRoles {
    pub inner: abi::Escrow::EscrowInstance<DynProvider>,
    pub roles: abi::Roles::RolesInstance<DynProvider>,
}

impl std::ops::Deref for EscrowWithRoles {
    type Target = abi::Escrow::EscrowInstance<DynProvider>;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl EscrowWithRoles {
    #[allow(non_snake_case)]
    pub fn GATEWAY_ROLE(
        &self,
    ) -> alloy::contract::SolCallBuilder<&DynProvider, abi::Roles::GATEWAY_ROLECall> {
        self.roles.GATEWAY_ROLE()
    }
    #[allow(non_snake_case)]
    pub fn hasRole(
        &self,
        role: alloy::primitives::B256,
        who: Address,
    ) -> alloy::contract::SolCallBuilder<&DynProvider, abi::Roles::hasRoleCall> {
        self.roles.hasRole(role, who)
    }
}

impl Contracts {
    pub fn new(d: &Deployment, provider: DynProvider) -> Self {
        Self {
            identity: abi::Identity::new(d.identity, provider.clone()),
            escrow: EscrowWithRoles {
                inner: abi::Escrow::new(d.escrow, provider.clone()),
                roles: abi::Roles::new(d.escrow, provider.clone()),
            },
            registry: abi::ReceiptRegistry::new(d.receipt_registry, provider.clone()),
            usdc: abi::Usdc::new(d.usdc, provider.clone()),
            vault: abi::StakeVault::new(d.stake_vault, provider.clone()),
            challenges: abi::ChallengeManager::new(d.challenge_manager, provider.clone()),
            anchor: abi::ReputationAnchor::new(d.reputation_anchor, provider.clone()),
            provider,
        }
    }
}
