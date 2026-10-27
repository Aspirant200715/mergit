use alloy_primitives::{B256, keccak256};

/// `plan_id = keccak256(utf8(plan_uuid))`.
pub fn plan_id(plan_uuid: &str) -> B256 {
    keccak256(plan_uuid.as_bytes())
}

/// `task_id = keccak256(abi.encodePacked(plan_id, uint32 index, uint32 attempt))`.
pub fn task_id(plan_id: B256, index: u32, attempt: u32) -> B256 {
    let mut packed = Vec::with_capacity(40);
    packed.extend_from_slice(plan_id.as_slice());
    packed.extend_from_slice(&index.to_be_bytes());
    packed.extend_from_slice(&attempt.to_be_bytes());
    keccak256(packed)
}
