//! mergit-validator. Env: RPC_URL, DEPLOYMENT_JSON or DEPLOYMENT_FILE, VALIDATOR_KEY, STORE_URL, AUDIT_P (default 1.0),
//! VALIDATOR_DATA_DIR (default ./validator-data), VALIDATOR_ADDR (default 0.0.0.0:8083), AUDIT_TOKEN (required: the
//! gateway's shared secret for /v0/audit).

use mergit_chain_client::{Contracts, Deployment, provider};
use mergit_validator::{AppState, app, catch_up};
use std::time::Duration;

fn env(k: &str) -> anyhow::Result<String> {
    std::env::var(k).map_err(|_| anyhow::anyhow!("{k} is not set"))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let deployment = Deployment::from_env()?;
    let contracts = Contracts::new(
        &deployment,
        provider(&env("RPC_URL")?, env("VALIDATOR_KEY")?.parse()?)?,
    );
    let audit_p: f64 = std::env::var("AUDIT_P")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1.0);
    let dir = std::env::var("VALIDATOR_DATA_DIR").unwrap_or_else(|_| "./validator-data".into());
    let state = AppState::new(
        contracts,
        deployment,
        env("STORE_URL")?,
        audit_p,
        dir.into(),
    )
    .with_token(&env("AUDIT_TOKEN")?);
    tracing::info!(
        audit_p,
        "audit probability (a configured parameter, not the paper's derived rate)"
    );

    let s = state.clone();
    tokio::spawn(async move {
        loop {
            match catch_up(&s).await {
                Ok(n) if n > 0 => tracing::info!(n, "caught up on unaudited receipts"),
                Ok(_) => {}
                Err(e) => tracing::warn!(error = %e, "catch-up failed"),
            }
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    });

    let addr = std::env::var("VALIDATOR_ADDR").unwrap_or_else(|_| "0.0.0.0:8083".into());
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(%addr, "mergit-validator listening");
    axum::serve(listener, app(state)).await?;
    Ok(())
}
