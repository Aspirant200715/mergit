//! Merkle tree with sorted-pair hashing, compatible with OpenZeppelin `MerkleProof.verify`.
//! An odd last node moves up unchanged; one leaf is its own root; no leaves give the zero hash.

use alloy_primitives::{B256, keccak256};

fn pair(a: B256, b: B256) -> B256 {
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    keccak256([lo.as_slice(), hi.as_slice()].concat())
}

fn next_layer(layer: &[B256]) -> Vec<B256> {
    layer
        .chunks(2)
        .map(|c| if c.len() == 2 { pair(c[0], c[1]) } else { c[0] })
        .collect()
}

pub fn merkle_root(leaves: &[B256]) -> B256 {
    if leaves.is_empty() {
        return B256::ZERO;
    }
    let mut layer = leaves.to_vec();
    while layer.len() > 1 {
        layer = next_layer(&layer);
    }
    layer[0]
}

/// Sibling hashes from the leaf at `index` up to the root. Panics if `index` is out of range.
pub fn merkle_proof(leaves: &[B256], index: usize) -> Vec<B256> {
    assert!(index < leaves.len(), "leaf index out of range");
    let (mut layer, mut i, mut proof) = (leaves.to_vec(), index, Vec::new());
    while layer.len() > 1 {
        let sibling = i ^ 1;
        if sibling < layer.len() {
            proof.push(layer[sibling]);
        }
        layer = next_layer(&layer);
        i /= 2;
    }
    proof
}

pub fn verify_proof(proof: &[B256], root: B256, leaf: B256) -> bool {
    proof.iter().fold(leaf, |h, p| pair(h, *p)) == root
}
