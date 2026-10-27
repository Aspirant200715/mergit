//! mergit-store. Env: STORE_DATA_DIR (default ./data), STORE_ADDR (default 0.0.0.0:8081), STORE_WRITE_TOKEN
//! (required: the workers' shared secret for uploads).

#[tokio::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let dir = std::env::var("STORE_DATA_DIR").unwrap_or_else(|_| "./data".into());
    let addr = std::env::var("STORE_ADDR").unwrap_or_else(|_| "0.0.0.0:8081".into());
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(%addr, %dir, "mergit-store listening");
    let token = std::env::var("STORE_WRITE_TOKEN")
        .map_err(|_| std::io::Error::other("STORE_WRITE_TOKEN is not set"))?;
    axum::serve(
        listener,
        mergit_store::router_with_token(dir.into(), Some(token)),
    )
    .await
}
