//! Runs the WASM entry point's logic natively against the shared vectors. `wasm-pack test --node` runs the
//! same checks inside a JS engine (see tests/web.rs).

use mergit_verifier_wasm::verify_bundle_json;
use serde_json::Value;

const REGISTRY: &str = "0x0000000000000000000000000000000000000001";

fn vector(name: &str) -> Value {
    let p = format!(
        "{}/../../spec/vectors/{name}.json",
        env!("CARGO_MANIFEST_DIR")
    );
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn run(name: &str, commitment: Option<String>) -> Value {
    let v = vector(name);
    let signer = Some(v["signer"].as_str().unwrap().to_string());
    let out = verify_bundle_json(
        &v["bundle"].to_string(),
        84532,
        REGISTRY,
        signer,
        commitment,
    )
    .unwrap();
    serde_json::from_str(&out).unwrap()
}

#[test]
fn valid_minimal_is_unattested_valid() {
    assert_eq!(run("valid_minimal", None)["status"], "unattested_valid");
}

#[test]
fn root_mismatch_is_invalid_with_reason() {
    let r = run("root_mismatch", None);
    assert_eq!(r["status"], "invalid");
    assert!(
        r["reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x == "ROOT_MISMATCH")
    );
}

#[test]
fn garbage_input_is_an_error_not_a_panic() {
    assert!(verify_bundle_json("{not json", 84532, REGISTRY, None, None).is_err());
    assert!(verify_bundle_json("{}", 84532, "not-an-address", None, None).is_err());
    let v = vector("valid_minimal");
    assert!(
        verify_bundle_json(
            &v["bundle"].to_string(),
            84532,
            REGISTRY,
            None,
            Some("{}".into())
        )
        .is_err()
    );
}

#[test]
fn a_bundle_that_differs_from_the_chain_commitment_is_invalid() {
    let v = vector("valid_three_steps");
    let r = &v["bundle"]["receipt"];
    let commitment = serde_json::json!({
        "root": format!("0x{}", "ab".repeat(32)), "terminal_hash": r["terminal_hash"], "body_hash": r["body_hash"],
        "cost_micros": r["meter"]["usd_micros"].to_string()
    });
    let out = run("valid_three_steps", Some(commitment.to_string()));
    assert_eq!(out["status"], "invalid");
    assert!(
        out["reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x == "COMMITMENT_MISMATCH"),
        "{out}"
    );
}

#[test]
fn a_bundle_matching_the_chain_commitment_is_unattested_valid() {
    let v = vector("valid_three_steps");
    let r = &v["bundle"]["receipt"];
    let commitment = serde_json::json!({
        "root": r["root"], "terminal_hash": r["terminal_hash"], "body_hash": r["body_hash"],
        "cost_micros": r["meter"]["usd_micros"].to_string()
    });
    assert_eq!(
        run("valid_three_steps", Some(commitment.to_string()))["status"],
        "unattested_valid"
    );
}
