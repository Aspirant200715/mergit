//! Same checks inside a JS engine: wasm-pack test --node verifier/wasm
#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::*;

const VALID: &str = include_str!("../../../spec/vectors/valid_minimal.json");
const ROOT_MISMATCH: &str = include_str!("../../../spec/vectors/root_mismatch.json");
const REGISTRY: &str = "0x0000000000000000000000000000000000000001";

fn bundle(v: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(v).unwrap();
    v["bundle"].to_string()
}

#[wasm_bindgen_test]
fn valid_minimal_is_unattested_valid() {
    let out =
        mergit_verifier_wasm::verify_bundle(&bundle(VALID), 84532, REGISTRY, None, None).unwrap();
    assert!(out.contains("\"unattested_valid\""));
}

#[wasm_bindgen_test]
fn root_mismatch_is_invalid() {
    let out =
        mergit_verifier_wasm::verify_bundle(&bundle(ROOT_MISMATCH), 84532, REGISTRY, None, None)
            .unwrap();
    assert!(out.contains("\"invalid\"") && out.contains("ROOT_MISMATCH"));
}
