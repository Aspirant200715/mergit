//! `mergit_receipt`: the Python face of the Rust receipt builder and verifier. Thin wrappers only; every
//! hash, id and signature is computed by the Rust crates.

use alloy_primitives::{Address, B256, keccak256};
use alloy_signer_local::PrivateKeySigner;
use chrono::Utc;
use mergit_spec::{Cost, Header, PhiResult, Predicate, StepType, jcs_hash, receipt_domain};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use receipt_core::{ReceiptBuilder as Builder, StepInput};

fn bad<E: std::fmt::Display>(e: E) -> PyErr {
    PyValueError::new_err(e.to_string())
}

fn parse<T: serde::de::DeserializeOwned>(what: &str, json: &str) -> PyResult<T> {
    serde_json::from_str(json).map_err(|e| PyValueError::new_err(format!("{what}: {e}")))
}

fn step_type(s: &str) -> PyResult<StepType> {
    serde_json::from_value(serde_json::Value::String(s.into()))
        .map_err(|_| PyValueError::new_err(format!("unknown step type {s:?}")))
}

/// keccak256 of the UTF-8 plan UUID, as 0x-hex.
#[pyfunction]
fn plan_id(plan_uuid: &str) -> String {
    mergit_spec::plan_id(plan_uuid).to_string()
}

/// keccak256(abi.encodePacked(plan_id, uint32 index, uint32 attempt)), as 0x-hex.
#[pyfunction]
fn task_id(plan_id: &str, index: u32, attempt: u32) -> PyResult<String> {
    let p: B256 = plan_id.parse().map_err(bad)?;
    Ok(mergit_spec::task_id(p, index, attempt).to_string())
}

/// keccak256(JCS(predicate)), as 0x-hex.
#[pyfunction]
fn phi_hash(predicate_json: &str) -> PyResult<String> {
    let p: Predicate = parse("predicate", predicate_json)?;
    Ok(jcs_hash(&p).to_string())
}

/// Whether Φ holds for a result, recomputed (the result's own `holds` field is ignored).
#[pyfunction]
fn phi_holds(predicate_json: &str, phi_result_json: &str) -> PyResult<bool> {
    let p: Predicate = parse("predicate", predicate_json)?;
    let r: PhiResult = parse("phi result", phi_result_json)?;
    Ok(mergit_spec::phi_holds(&p, &r))
}

/// keccak256 of raw bytes, as 0x-hex. For artifact hashes.
#[pyfunction]
fn keccak_hex(data: &[u8]) -> String {
    keccak256(data).to_string()
}

/// Verifies a bundle; returns the report as JSON.
#[pyfunction]
#[pyo3(signature = (bundle_json, chain_id, registry, signer=None))]
fn verify(
    bundle_json: &str,
    chain_id: u64,
    registry: &str,
    signer: Option<&str>,
) -> PyResult<String> {
    let bundle = parse("bundle", bundle_json)?;
    let registry: Address = registry.parse().map_err(bad)?;
    let signer: Option<Address> = signer.map(str::parse).transpose().map_err(bad)?;
    let report =
        mergit_verifier::verify(&bundle, &receipt_domain(chain_id, registry), signer, None);
    serde_json::to_string(&report).map_err(bad)
}

/// A sealed receipt, ready to upload (`bundle_json`) and to announce (`receipt.sealed`).
#[pyclass(get_all, frozen)]
struct SealedBundle {
    bundle_json: String,
    task_id: String,
    agent_id: String,
    root: String,
    terminal_hash: String,
    body_hash: String,
    cost_micros: u64,
    signature: String,
    /// Every step's raw bytes as `{digest: base64}`. Keep it: a bonded challenge can compel the full trajectory.
    trajectory_blobs_json: String,
}

/// Append-only receipt under construction. `phi_eval` can only be added by `seal_with_phi`.
#[pyclass]
struct ReceiptBuilder {
    inner: Option<Builder>,
}

impl ReceiptBuilder {
    fn open(&mut self) -> PyResult<&mut Builder> {
        self.inner
            .as_mut()
            .ok_or_else(|| PyValueError::new_err("this receipt is already sealed"))
    }
}

#[pymethods]
impl ReceiptBuilder {
    #[new]
    fn new(header_json: &str) -> PyResult<Self> {
        let header: Header = parse("header", header_json)?;
        Ok(Self {
            inner: Some(Builder::new(header).map_err(bad)?),
        })
    }

    #[pyo3(signature = (step_type, input, output, exit_status, cost_json))]
    fn add_step(
        &mut self,
        step_type: &str,
        input: &[u8],
        output: &[u8],
        exit_status: Option<i32>,
        cost_json: &str,
    ) -> PyResult<u32> {
        let step = StepInput {
            step_type: self::step_type(step_type)?,
            input: input.to_vec(),
            output: output.to_vec(),
            exit_status,
            cost: parse::<Cost>("cost", cost_json)?,
            at: Utc::now(),
        };
        self.open()?.add_step(step).map_err(bad)
    }

    fn mark_evidence(&mut self, seq: u32) -> PyResult<()> {
        self.open()?.mark_evidence(seq).map_err(bad)
    }

    fn seal_with_phi(
        &mut self,
        phi_result_json: &str,
        cost_json: &str,
        signer_key_hex: &str,
        chain_id: u64,
        registry: &str,
    ) -> PyResult<SealedBundle> {
        let result: PhiResult = parse("phi result", phi_result_json)?;
        let cost: Cost = parse("cost", cost_json)?;
        let signer: PrivateKeySigner = signer_key_hex.parse().map_err(|_| {
            PyValueError::new_err("signer key is not a valid secp256k1 private key")
        })?;
        let registry: Address = registry.parse().map_err(bad)?;
        self.open()?;
        let builder = self.inner.take().expect("checked open");
        let (bundle, trajectory) = match builder.seal_with_phi_full(
            result,
            cost,
            Utc::now(),
            &signer,
            &receipt_domain(chain_id, registry),
        ) {
            Ok(sealed) => sealed,
            Err(e) => return Err(bad(e)),
        };
        let r = &bundle.receipt;
        Ok(SealedBundle {
            task_id: r.header.task_id.to_string(),
            agent_id: r.header.agent_id.clone(),
            root: r.root.to_string(),
            terminal_hash: r.terminal_hash.to_string(),
            body_hash: r.body_hash.to_string(),
            cost_micros: r.meter.usd_micros,
            signature: r.signature.to_string(),
            bundle_json: serde_json::to_string(&bundle).map_err(bad)?,
            trajectory_blobs_json: {
                use base64::Engine;
                let map: std::collections::BTreeMap<String, String> = trajectory
                    .iter()
                    .map(|(k, v)| {
                        (
                            k.to_string(),
                            base64::engine::general_purpose::STANDARD.encode(v),
                        )
                    })
                    .collect();
                serde_json::to_string(&map).map_err(bad)?
            },
        })
    }
}

#[pymodule]
fn mergit_receipt(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(plan_id, m)?)?;
    m.add_function(wrap_pyfunction!(task_id, m)?)?;
    m.add_function(wrap_pyfunction!(phi_hash, m)?)?;
    m.add_function(wrap_pyfunction!(phi_holds, m)?)?;
    m.add_function(wrap_pyfunction!(keccak_hex, m)?)?;
    m.add_function(wrap_pyfunction!(verify, m)?)?;
    m.add_class::<ReceiptBuilder>()?;
    m.add_class::<SealedBundle>()?;
    Ok(())
}
