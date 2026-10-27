//! The receipt verifier for the browser. Same Rust code as `mergit-verify`, so a requester can check a
//! receipt without trusting Mergit's servers.

use alloy_primitives::{Address, B256, U256};
use mergit_spec::{Bundle, receipt_domain};
use mergit_verifier::Commitment;
use wasm_bindgen::prelude::*;

/// Verifies a bundle and returns the report as JSON. `commitment_json` is what the chain holds for the task
/// (`{root, terminal_hash, body_hash, cost_micros}`); without it the bundle is only checked against itself.
/// Errors (not a verdict) for unreadable input.
#[wasm_bindgen]
pub fn verify_bundle(
    bundle_json: &str,
    chain_id: u64,
    registry: &str,
    signer: Option<String>,
    commitment_json: Option<String>,
) -> Result<String, JsError> {
    verify_bundle_json(bundle_json, chain_id, registry, signer, commitment_json)
        .map_err(|e| JsError::new(&e))
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ChainCommitment {
    root: B256,
    terminal_hash: B256,
    body_hash: B256,
    cost_micros: String,
}

/// The logic behind `verify_bundle`, callable natively for tests.
pub fn verify_bundle_json(
    bundle_json: &str,
    chain_id: u64,
    registry: &str,
    signer: Option<String>,
    commitment_json: Option<String>,
) -> Result<String, String> {
    let bundle: Bundle = serde_json::from_str(bundle_json).map_err(|e| format!("bundle: {e}"))?;
    let registry: Address = registry
        .parse()
        .map_err(|_| format!("registry {registry:?} is not an address"))?;
    let signer = signer
        .map(|s| {
            s.parse::<Address>()
                .map_err(|_| format!("signer {s:?} is not an address"))
        })
        .transpose()?;
    let commitment = commitment_json
        .map(|c| -> Result<Commitment, String> {
            let c: ChainCommitment =
                serde_json::from_str(&c).map_err(|e| format!("commitment: {e}"))?;
            let cost_micros = U256::from_str_radix(&c.cost_micros, 10)
                .map_err(|e| format!("commitment cost: {e}"))?;
            Ok(Commitment {
                root: c.root,
                terminal_hash: c.terminal_hash,
                body_hash: c.body_hash,
                cost_micros,
            })
        })
        .transpose()?;
    let report = mergit_verifier::verify(
        &bundle,
        &receipt_domain(chain_id, registry),
        signer,
        commitment.as_ref(),
    );
    serde_json::to_string(&report).map_err(|e| e.to_string())
}
