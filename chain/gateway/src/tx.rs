//! Sending transactions, and telling a revert (the node refused it: report and move on) from a transport
//! failure (try again later).

use alloy::contract::Error as ContractError;
use alloy::transports::RpcError;

#[derive(Debug)]
pub enum TxError {
    /// The node rejected the call or the transaction reverted. Retrying will not help.
    Reverted(String),
    /// The node could not be reached or did not answer. The sender should retry.
    Transient(String),
}

impl std::fmt::Display for TxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TxError::Reverted(m) => write!(f, "reverted: {m}"),
            TxError::Transient(m) => write!(f, "transient: {m}"),
        }
    }
}

pub fn classify(e: ContractError) -> TxError {
    match e {
        ContractError::TransportError(RpcError::ErrorResp(p)) => TxError::Reverted(p.to_string()),
        ContractError::TransportError(other) => TxError::Transient(other.to_string()),
        other => TxError::Reverted(other.to_string()),
    }
}

/// Sends a prepared call and waits for its receipt. A mined but failed transaction counts as reverted.
#[macro_export]
macro_rules! send_tx {
    ($call:expr) => {{
        match $call.send().await {
            Err(e) => Err($crate::tx::classify(e)),
            Ok(pending) => match pending.get_receipt().await {
                Ok(r) if r.status() => Ok(r.transaction_hash),
                Ok(r) => Err($crate::tx::TxError::Reverted(format!(
                    "transaction {} failed",
                    r.transaction_hash
                ))),
                Err(e) => Err($crate::tx::TxError::Transient(e.to_string())),
            },
        }
    }};
}
