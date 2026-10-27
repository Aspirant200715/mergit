//! Event payloads from `spec/events-v0.md`. Parsing is strict: unknown fields, numbers where decimal
//! strings belong, and malformed hashes are all rejected, which is the schema check for incoming events.

use alloy::primitives::{Address, B256, Bytes, U256};
use serde::{Deserialize, Deserializer};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub event_id: Uuid,
    #[serde(rename = "type")]
    pub ty: String,
    pub at: String,
    pub payload: Value,
}

/// A decimal string, as amounts and ids travel in the spec.
fn decimal<'de, D: Deserializer<'de>>(d: D) -> Result<U256, D::Error> {
    let s = String::deserialize(d)?;
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) || (s.len() > 1 && s.starts_with('0'))
    {
        return Err(serde::de::Error::custom("expected a decimal string"));
    }
    U256::from_str_radix(&s, 10).map_err(serde::de::Error::custom)
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Funding {
    Wallet,
    Credits,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanApproved {
    pub plan_id: B256,
    pub plan_uuid: Uuid,
    pub requester: Address,
    #[serde(deserialize_with = "decimal")]
    pub total_budget_usdc_units: U256,
    pub funding: Funding,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DispatchRequested {
    pub task_id: B256,
    pub plan_id: B256,
    pub index: u32,
    pub attempt: u32,
    #[serde(deserialize_with = "decimal")]
    pub agent_id: U256,
    #[serde(deserialize_with = "decimal")]
    pub amount_usdc_units: U256,
    pub category: String,
    pub phi_hash: B256,
    pub deadline_unix: u64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReceiptSealed {
    pub task_id: B256,
    #[serde(deserialize_with = "decimal")]
    pub agent_id: U256,
    pub root: B256,
    pub terminal_hash: B256,
    pub body_hash: B256,
    pub cost_micros: u64,
    pub signature: Bytes,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanClosed {
    pub plan_id: B256,
}

/// Every incoming event the gateway understands.
#[derive(Debug)]
pub enum Incoming {
    PlanApproved(PlanApproved),
    DispatchRequested(DispatchRequested),
    ReceiptSealed(ReceiptSealed),
    PlanClosed(PlanClosed),
}

impl Incoming {
    pub fn parse(ty: &str, payload: Value) -> Result<Self, String> {
        let e = |err: serde_json::Error| format!("{ty}: {err}");
        Ok(match ty {
            "plan.approved" => Self::PlanApproved(serde_json::from_value(payload).map_err(e)?),
            "task.dispatch_requested" => {
                let d: DispatchRequested = serde_json::from_value(payload).map_err(e)?;
                if d.attempt == 0 {
                    return Err("task.dispatch_requested: attempt starts at 1".into());
                }
                if d.task_id != mergit_spec::task_id(d.plan_id, d.index, d.attempt) {
                    return Err(
                        "task.dispatch_requested: task_id is not keccak(plan_id, index, attempt)"
                            .into(),
                    );
                }
                Self::DispatchRequested(d)
            }
            "receipt.sealed" => Self::ReceiptSealed(serde_json::from_value(payload).map_err(e)?),
            "plan.closed" => Self::PlanClosed(serde_json::from_value(payload).map_err(e)?),
            other => return Err(format!("unknown event type {other:?}")),
        })
    }
}
