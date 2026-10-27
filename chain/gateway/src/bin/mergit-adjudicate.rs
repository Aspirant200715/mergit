//! mergit-adjudicate resolve <challenge_id> --upheld | --rejected
//!
//! Rules on a challenge with the adjudicator key. In v0 the platform adjudicates: that is open decision D9,
//! and every ruling says so. Env: RPC_URL, DEPLOYMENT_JSON or DEPLOYMENT_FILE, ADJUDICATOR_KEY.

use alloy::primitives::U256;
use mergit_chain_client::{Contracts, Deployment, provider};

const USAGE: &str = "usage: mergit-adjudicate resolve <challenge_id> --upheld | --rejected";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (id, upheld) = match args.as_slice() {
        [cmd, id, flag] if cmd == "resolve" && (flag == "--upheld" || flag == "--rejected") => (
            id.parse::<U256>().map_err(|_| anyhow::anyhow!("{USAGE}"))?,
            flag == "--upheld",
        ),
        _ => anyhow::bail!("{USAGE}"),
    };
    let deployment = Deployment::from_env()?;
    let key = std::env::var("ADJUDICATOR_KEY")
        .map_err(|_| anyhow::anyhow!("ADJUDICATOR_KEY is not set"))?;
    let rpc = std::env::var("RPC_URL").map_err(|_| anyhow::anyhow!("RPC_URL is not set"))?;
    let c = Contracts::new(&deployment, provider(&rpc, key.parse()?)?);

    println!(
        "Adjudicated by the platform (open decision D9): challenge {id} is {}.",
        if upheld { "upheld" } else { "rejected" }
    );
    let receipt = c
        .challenges
        .resolve(id, upheld)
        .send()
        .await?
        .get_receipt()
        .await?;
    anyhow::ensure!(
        receipt.status(),
        "the ruling transaction failed: {}",
        receipt.transaction_hash
    );
    println!("recorded in {}", receipt.transaction_hash);
    Ok(())
}
