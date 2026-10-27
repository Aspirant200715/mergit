//! Verifies Mergit receipts (format v0) without trusting, or depending on, the runtime that built them.
//!
//! Every check runs and every failing reason is reported. Version 0 has no attested outcome: a receipt
//! that passes every check is `unattested_valid`, never `valid`.

use alloy_primitives::{Address, B256, Signature, U256, keccak256};
use alloy_sol_types::{Eip712Domain, SolStruct};
use base64::{Engine, engine::general_purpose::STANDARD};
use mergit_spec::*;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

/// What the chain holds for a task, for comparison with the receipt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Commitment {
    pub root: B256,
    pub terminal_hash: B256,
    pub body_hash: B256,
    pub cost_micros: U256,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    UnattestedValid,
    Invalid,
}

/// Reason codes from `spec/receipt-v0.md`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Reason {
    SeqGap,
    SeqOrder,
    ChainMismatch,
    RootMismatch,
    BodyHashMismatch,
    BadSignature,
    PhiHashMismatch,
    NoPhiEval,
    PhiEvalNotLast,
    PhiEvalNotEvidence,
    MeterMismatch,
    BlobMissing,
    BlobDigestMismatch,
    PhiResultContradicted,
    CommitmentMismatch,
    AttestationUnsupported,
    Unattested,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Report {
    pub status: Status,
    pub reasons: Vec<Reason>,
    /// Whether Φ holds, recomputed from the recorded result; `None` when the result could not be read.
    pub phi_holds: Option<bool>,
}

/// Checks a bundle. `expected_signer` is the agent's registered runtime key when known; the signature must
/// also recover to the header's `dev_key`. `commitment` is what the chain holds, when known.
pub fn verify(
    bundle: &Bundle,
    domain: &Eip712Domain,
    expected_signer: Option<Address>,
    commitment: Option<&Commitment>,
) -> Report {
    let r = &bundle.receipt;
    let mut reasons = BTreeSet::new();
    let blobs = decode_blobs(&bundle.blobs, &mut reasons);

    check_structure(r, &mut reasons);
    check_evidence_blobs(r, &bundle.blobs, &mut reasons);

    if r.header.attestation.kind != UNATTESTED {
        reasons.insert(Reason::AttestationUnsupported);
    } else {
        reasons.insert(Reason::Unattested);
    }

    let phi_step = r.steps.last().filter(|s| s.step_type == StepType::PhiEval);
    if r.header.phi_hash != jcs_hash(&r.header.phi)
        || phi_step.is_some_and(|s| s.input_digest != jcs_hash(&r.header.phi))
    {
        reasons.insert(Reason::PhiHashMismatch);
    }

    let leaves: Vec<B256> = r.steps.iter().map(leaf).collect();
    if chain(jcs_hash(&r.header), &leaves) != r.terminal_hash {
        reasons.insert(Reason::ChainMismatch);
    }
    if merkle_root(&leaves) != r.root {
        reasons.insert(Reason::RootMismatch);
    }
    if Meter::sum(&r.steps) != r.meter {
        reasons.insert(Reason::MeterMismatch);
    }
    if body_hash(r) != r.body_hash {
        reasons.insert(Reason::BodyHashMismatch);
    }
    if !signature_ok(r, domain, expected_signer) {
        reasons.insert(Reason::BadSignature);
    }
    if let Some(c) = commitment
        && (c.root != r.root
            || c.terminal_hash != r.terminal_hash
            || c.body_hash != r.body_hash
            || c.cost_micros != U256::from(r.meter.usd_micros))
    {
        reasons.insert(Reason::CommitmentMismatch);
    }

    let phi_holds = phi_step
        .and_then(|s| blobs.get(&s.output_digest))
        .and_then(|bytes| serde_json::from_slice::<PhiResult>(bytes).ok())
        .map(|result| {
            let holds = mergit_spec::phi_holds(&r.header.phi, &result);
            if holds != result.holds {
                reasons.insert(Reason::PhiResultContradicted);
            }
            holds
        });

    let status = if reasons.iter().any(|r| *r != Reason::Unattested) {
        Status::Invalid
    } else {
        Status::UnattestedValid
    };
    Report {
        status,
        reasons: reasons.into_iter().collect(),
        phi_holds,
    }
}

fn decode_blobs(
    raw: &BTreeMap<B256, String>,
    reasons: &mut BTreeSet<Reason>,
) -> BTreeMap<B256, Vec<u8>> {
    let mut out = BTreeMap::new();
    for (digest, b64) in raw {
        match STANDARD.decode(b64) {
            Ok(bytes) if keccak256(&bytes) == *digest => {
                out.insert(*digest, bytes);
            }
            _ => {
                reasons.insert(Reason::BlobDigestMismatch);
            }
        }
    }
    out
}

fn check_structure(r: &SealedReceipt, reasons: &mut BTreeSet<Reason>) {
    let seqs: Vec<u32> = r.steps.iter().map(|s| s.seq).collect();
    if !seqs.windows(2).all(|w| w[0] < w[1]) {
        reasons.insert(Reason::SeqOrder);
    } else if seqs.iter().enumerate().any(|(i, s)| *s as usize != i + 1) {
        reasons.insert(Reason::SeqGap);
    }
    if r.evidence.iter().any(|e| !seqs.contains(e)) {
        reasons.insert(Reason::SeqGap);
    }

    let phi_positions: Vec<usize> = r
        .steps
        .iter()
        .enumerate()
        .filter(|(_, s)| s.step_type == StepType::PhiEval)
        .map(|(i, _)| i)
        .collect();
    match phi_positions.as_slice() {
        [] => {
            reasons.insert(Reason::NoPhiEval);
        }
        [i] if *i == r.steps.len() - 1 => {
            if !r.evidence.contains(&r.steps[*i].seq) {
                reasons.insert(Reason::PhiEvalNotEvidence);
            }
        }
        _ => {
            reasons.insert(Reason::PhiEvalNotLast);
        }
    }
}

fn check_evidence_blobs(
    r: &SealedReceipt,
    raw: &BTreeMap<B256, String>,
    reasons: &mut BTreeSet<Reason>,
) {
    // Absence only: a blob that is present but corrupt is BLOB_DIGEST_MISMATCH, reported while decoding.
    let missing = |d: &B256| !raw.contains_key(d);
    if r.steps
        .iter()
        .filter(|s| r.evidence.contains(&s.seq))
        .any(|s| missing(&s.input_digest) || missing(&s.output_digest))
    {
        reasons.insert(Reason::BlobMissing);
    }
}

fn signature_ok(r: &SealedReceipt, domain: &Eip712Domain, expected: Option<Address>) -> bool {
    let Ok(sig) = Signature::try_from(r.signature.as_ref()) else {
        return false;
    };
    let msg = Receipt {
        taskId: r.header.task_id,
        root: r.root,
        terminalHash: r.terminal_hash,
        bodyHash: r.body_hash,
        costMicros: U256::from(r.meter.usd_micros),
    };
    match sig.recover_address_from_prehash(&msg.eip712_signing_hash(domain)) {
        Ok(addr) => addr == r.header.attestation.dev_key && expected.is_none_or(|e| e == addr),
        Err(_) => false,
    }
}
