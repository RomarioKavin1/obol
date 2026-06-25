// Obol Protocol - Liveness ("proof of life") circuit
//
// A vault owner proves, in zero knowledge, that they are still alive during the
// current time window (epoch) without revealing which vault they own.
//
// Private inputs (never leave the owner's device):
//   nullifier      - random secret component of the owner's identity
//   secret         - random secret component of the owner's identity
//   path_siblings  - sibling hashes along the Merkle path (tree depth 20)
//   path_bits      - 0 = current node is the left child, 1 = right child
//
// Public inputs (submitted on-chain, order matters - this is the byte order the
// LivenessRegistry contract parses:
//   [root(32) | identity_commitment(32) | nullifier_hash(32) | epoch(32)]):
//   root                - current Merkle root of the anonymity set (on-chain)
//   identity_commitment - the owner's public pseudonym / Merkle leaf; the timer
//                         reset is bound to this so a proof cannot reset another
//                         owner's vault. Never linked to any wallet.
//   nullifier_hash      - Poseidon2(nullifier, epoch): unique per epoch
//   epoch               - current time window = floor(ledger_timestamp / interval)
//
// Constraints:
//   1. identity_commitment == Poseidon2(nullifier, secret)  (leaf = commitment)
//   2. leaf is a member of the tree with the given root (Merkle membership)
//   3. nullifier_hash == Poseidon2(nullifier, epoch)  -> epoch-bound anti-replay
//
// Hashing uses the noir-lang `poseidon` library (Poseidon2 over BN254), which is
// byte-for-byte identical to the on-chain `soroban-poseidon` hash used to build
// the Merkle tree in the LivenessRegistry contract. This alignment is what lets
// an off-chain proof bind to an on-chain root.

use dep::poseidon::poseidon2::Poseidon2;

// 2-to-1 Poseidon2 compression, matching the on-chain frontier Merkle hash.
fn hash2(a: Field, b: Field) -> Field {
    Poseidon2::hash([a, b], 2)
}

// Enforce that `bit` is boolean (0 or 1).
fn constrain_bit(bit: Field) {
    assert(bit * (1 - bit) == 0);
}

// Walk from the leaf up to the root using the provided Merkle authentication path.
fn compute_root(leaf: Field, path_siblings: [Field; 20], path_bits: [Field; 20]) -> Field {
    let mut cur = leaf;
    for i in 0..20 {
        let sib = path_siblings[i];
        let bit = path_bits[i];
        constrain_bit(bit);
        // bit == 0 -> current node is the left child; bit == 1 -> right child
        if bit == 0 {
            cur = hash2(cur, sib);
        } else {
            cur = hash2(sib, cur);
        }
    }
    cur
}

pub fn main(
    root: pub Field,
    identity_commitment: pub Field,
    nullifier_hash: pub Field,
    epoch: pub Field,
    nullifier: Field,
    secret: Field,
    path_siblings: [Field; 20],
    path_bits: [Field; 20],
) {
    // (1) Reconstruct the owner's identity commitment (the Merkle leaf) and bind
    //     it to the public identity_commitment. This ties the proof to exactly
    //     one owner, so it can only reset that owner's liveness timer.
    let leaf = hash2(nullifier, secret);
    assert(leaf == identity_commitment);

    // (3) Bind this proof to exactly one epoch: prevents replaying an old
    //     proof-of-life and prevents double check-ins within a window.
    let computed_nullifier = hash2(nullifier, epoch);
    assert(computed_nullifier == nullifier_hash);

    // (2) Prove the leaf is a member of the anonymity set committed by root.
    let computed_root = compute_root(leaf, path_siblings, path_bits);
    assert(computed_root == root);
}
