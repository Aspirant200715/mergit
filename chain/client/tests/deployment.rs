use mergit_chain_client::Deployment;

const JSON: &str = r#"{"chain_id":84532,"deploy_block":7,"window_seconds":600,
 "usdc":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","identity":"0x00000000000000000000000000000000000000d1",
 "escrow":"0x00000000000000000000000000000000000000e5","receipt_registry":"0x00000000000000000000000000000000000000a1",
 "stake_vault":"0x0000000000000000000000000000000000000000","challenge_manager":"0x0000000000000000000000000000000000000000",
 "reputation_anchor":"0x0000000000000000000000000000000000000000",
 "roles":{"gateway":"0x0000000000000000000000000000000000000001","validator":"0x0000000000000000000000000000000000000002",
 "treasury":"0x0000000000000000000000000000000000000003","adjudicator":"0x0000000000000000000000000000000000000004"}}"#;

// One test, because it sets process environment variables.
#[test]
fn from_env_prefers_inline_json_then_file_then_errors() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("d.json");
    std::fs::write(
        &file,
        JSON.replace("\"deploy_block\":7", "\"deploy_block\":9"),
    )
    .unwrap();
    unsafe {
        std::env::set_var("DEPLOYMENT_JSON", JSON);
        std::env::set_var("DEPLOYMENT_FILE", &file);
    }
    assert_eq!(
        Deployment::from_env().unwrap().deploy_block,
        7,
        "inline JSON wins"
    );
    unsafe { std::env::remove_var("DEPLOYMENT_JSON") };
    assert_eq!(
        Deployment::from_env().unwrap().deploy_block,
        9,
        "then the file"
    );
    unsafe { std::env::remove_var("DEPLOYMENT_FILE") };
    let err = Deployment::from_env().unwrap_err().to_string();
    assert!(
        err.contains("DEPLOYMENT_JSON") && err.contains("DEPLOYMENT_FILE"),
        "{err}"
    );
}
