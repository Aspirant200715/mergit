use alloy_primitives::{B256, keccak256};
use mergit_spec::{merkle_proof, merkle_root, verify_proof};

fn leaves(n: u8) -> Vec<B256> {
    (1..=n).map(|i| keccak256([i])).collect()
}

#[test]
fn merkle_root_one_leaf_is_leaf() {
    let l = leaves(1);
    assert_eq!(merkle_root(&l), l[0]);
}

#[test]
fn merkle_root_two_leaves_hashes_sorted_pair() {
    let l = leaves(2);
    let (lo, hi) = if l[0] <= l[1] {
        (l[0], l[1])
    } else {
        (l[1], l[0])
    };
    assert_eq!(
        merkle_root(&l),
        keccak256([lo.as_slice(), hi.as_slice()].concat())
    );
}

#[test]
fn merkle_proof_verifies_with_sorted_pairs_for_every_index_of_7_leaves() {
    let l = leaves(7);
    let root = merkle_root(&l);
    for (i, leaf) in l.iter().enumerate() {
        let proof = merkle_proof(&l, i);
        assert!(verify_proof(&proof, root, *leaf), "index {i}");
        assert!(
            !verify_proof(&proof, root, keccak256([99u8])),
            "wrong leaf accepted at {i}"
        );
    }
}
