use alloy::providers::Provider;
use alloy::signers::local::PrivateKeySigner;
use mergit_chain_client::provider;

// The Anvil tests are plain http, so they never exercise TLS. A hosted RPC (Alchemy, Infura) is https, and an
// alloy built without a TLS backend fails every request with "error sending request". Run on demand:
//   RPC_URL=https://sepolia.base.org cargo test -p mergit-chain-client --test https -- --ignored
#[tokio::test]
#[ignore = "needs the network and RPC_URL set to an https endpoint"]
async fn https_rpc_answers() {
    let url = std::env::var("RPC_URL").expect("set RPC_URL to an https endpoint");
    assert!(url.starts_with("https://"), "RPC_URL must be https");
    let p = provider(&url, PrivateKeySigner::random()).unwrap();
    assert!(p.get_chain_id().await.unwrap() > 0);
}
