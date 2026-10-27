//! Forged receipts for guard tests and test vectors. Behind the `forgery-fixture` feature, which no
//! service, binding or image enables: production code cannot produce a receipt this way.

use crate::builder::sign;
use alloy_signer_local::PrivateKeySigner;
use alloy_sol_types::Eip712Domain;
use mergit_spec::{Bundle, body_hash};

/// Applies `edit`, then recomputes the body hash and re-signs with `signer`, so only the edit is wrong.
pub fn forge(
    mut b: Bundle,
    edit: impl FnOnce(&mut Bundle),
    signer: &PrivateKeySigner,
    domain: &Eip712Domain,
) -> Bundle {
    edit(&mut b);
    b.receipt.body_hash = body_hash(&b.receipt);
    b.receipt.signature = sign(&b.receipt, signer, domain).expect("local signing does not fail");
    b
}

/// Applies `edit` and nothing else.
pub fn forge_raw(mut b: Bundle, edit: impl FnOnce(&mut Bundle)) -> Bundle {
    edit(&mut b);
    b
}

/// Re-signs without touching anything else.
pub fn resign(mut b: Bundle, signer: &PrivateKeySigner, domain: &Eip712Domain) -> Bundle {
    b.receipt.signature = sign(&b.receipt, signer, domain).expect("local signing does not fail");
    b
}
