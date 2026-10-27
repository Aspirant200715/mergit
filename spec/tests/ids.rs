use alloy_primitives::{B256, hex, keccak256};
use mergit_spec::{plan_id, task_id};

#[test]
fn plan_id_is_keccak_of_utf8_uuid() {
    assert_eq!(
        plan_id("3f1c2b8e-9d4a-4e6f-8a1b-2c3d4e5f6a7b"),
        keccak256(b"3f1c2b8e-9d4a-4e6f-8a1b-2c3d4e5f6a7b")
    );
}

#[test]
fn task_id_packs_plan_id_then_big_endian_uint32s() {
    let p = B256::repeat_byte(0xab);
    let packed = [p.as_slice(), &hex!("00000002"), &hex!("00000001")].concat();
    assert_eq!(task_id(p, 2, 1), keccak256(packed));
    assert_ne!(
        task_id(p, 2, 1),
        task_id(p, 2, 2),
        "a retry must get a new task id"
    );
}
