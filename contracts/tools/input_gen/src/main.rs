//! Obol — liveness proof input generator.
//!
//! Computes the Merkle witness and public inputs for the liveness circuit using
//! `soroban-poseidon` (BN254 Poseidon2) — byte-for-byte identical to the Noir
//! `dep::poseidon` hash in the circuit and the on-chain frontier Merkle in the
//! LivenessRegistry contract. This three-way alignment is what lets an
//! off-chain proof bind to the on-chain root.
//!
//! Produces the empty-tree witness for a single member inserted at index 0
//! (the demo case): all path bits are 0 and each sibling is the "zero hash" for
//! that level.
//!
//! Env vars (all optional, decimal):
//!   OBOL_NULLIFIER, OBOL_SECRET, OBOL_EPOCH   -- identity + current epoch
//!
//! Outputs:
//!   - writes ../../../circuits/liveness/Prover.toml
//!   - prints a JSON line: {"commitment","root","nullifier_hash","epoch"} (hex)

use num_bigint::BigUint;
use soroban_poseidon::{poseidon2_hash, Field};
use soroban_sdk::{crypto::BnScalar, Bytes, Env, Vec as SorobanVec, U256};
use std::{env, fs, path::Path};

const TREE_DEPTH: usize = 20;

fn be32_from_biguint(x: &BigUint) -> [u8; 32] {
    let mut be = x.to_bytes_be();
    if be.len() > 32 {
        be = be[be.len() - 32..].to_vec();
    }
    let mut out = [0u8; 32];
    let start = 32 - be.len();
    out[start..].copy_from_slice(&be);
    out
}

/// 2-to-1 Poseidon2 compression over BN254, matching circuit + on-chain tree.
fn field_hash2(env: &Env, a: &BigUint, b: &BigUint) -> BigUint {
    let aa = be32_from_biguint(a);
    let bb = be32_from_biguint(b);
    let a_bytes = Bytes::from_array(env, &aa);
    let b_bytes = Bytes::from_array(env, &bb);
    let modulus = <BnScalar as Field>::modulus(env);
    let mut inputs = SorobanVec::new(env);
    inputs.push_back(U256::from_be_bytes(env, &a_bytes).rem_euclid(&modulus));
    inputs.push_back(U256::from_be_bytes(env, &b_bytes).rem_euclid(&modulus));
    let out = poseidon2_hash::<4, BnScalar>(env, &inputs);
    let out_bytes = out.to_be_bytes();
    let mut out_arr = [0u8; 32];
    out_bytes.copy_into_slice(&mut out_arr);
    BigUint::from_bytes_be(&out_arr)
}

/// Zero hash for a given tree level: zero[0] = 0; zero[i+1] = H(zero[i], zero[i]).
fn zero_at(env: &Env, level: u32) -> BigUint {
    let mut z = BigUint::from(0u32);
    for _ in 0..level {
        let zz = z.clone();
        z = field_hash2(env, &zz, &zz);
    }
    z
}

fn compute_root(env: &Env, leaf: &BigUint, siblings: &[BigUint], bits: &[u8]) -> BigUint {
    let mut cur = leaf.clone();
    for (i, sib) in siblings.iter().enumerate() {
        if bits[i] == 0 {
            cur = field_hash2(env, &cur, sib);
        } else {
            cur = field_hash2(env, sib, &cur);
        }
    }
    cur
}

fn var_biguint(name: &str, default: u64) -> BigUint {
    match env::var(name) {
        Ok(v) if !v.trim().is_empty() => {
            BigUint::parse_bytes(v.trim().as_bytes(), 10).expect("invalid decimal env var")
        }
        _ => BigUint::from(default),
    }
}

fn format_list(label: &str, values: &[String]) -> String {
    let mut out = String::new();
    out.push_str(label);
    out.push_str(" = [\n");
    for (i, v) in values.iter().enumerate() {
        out.push_str("  \"");
        out.push_str(v);
        out.push('"');
        if i + 1 != values.len() {
            out.push(',');
        }
        if (i + 1) % 5 == 0 || i + 1 == values.len() {
            out.push('\n');
        } else {
            out.push(' ');
        }
    }
    out.push_str("]\n");
    out
}

fn main() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();

    let nullifier = var_biguint("OBOL_NULLIFIER", 111111111111u64);
    let secret = var_biguint("OBOL_SECRET", 222222222222u64);
    let epoch = var_biguint("OBOL_EPOCH", 1u64);

    // Empty-tree witness: single member at index 0.
    let siblings: Vec<BigUint> = (0..TREE_DEPTH).map(|i| zero_at(&env, i as u32)).collect();
    let bits: Vec<u8> = vec![0u8; TREE_DEPTH];

    let leaf = field_hash2(&env, &nullifier, &secret);
    let nullifier_hash = field_hash2(&env, &nullifier, &epoch);
    let root = compute_root(&env, &leaf, &siblings, &bits);

    // Write Prover.toml for the liveness circuit.
    let sib_strings: Vec<String> = siblings.iter().map(|v| v.to_string()).collect();
    let bit_strings: Vec<String> = bits.iter().map(|v| v.to_string()).collect();
    let mut toml = String::new();
    toml.push_str(&format!("root = \"{}\"\n", root));
    toml.push_str(&format!("identity_commitment = \"{}\"\n", leaf));
    toml.push_str(&format!("nullifier_hash = \"{}\"\n", nullifier_hash));
    toml.push_str(&format!("epoch = \"{}\"\n", epoch));
    toml.push_str(&format!("nullifier = \"{}\"\n", nullifier));
    toml.push_str(&format!("secret = \"{}\"\n", secret));
    toml.push_str(&format_list("path_siblings", &sib_strings));
    toml.push_str(&format_list("path_bits", &bit_strings));

    let prover_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../circuits/liveness/Prover.toml");
    fs::write(&prover_path, toml).expect("write Prover.toml");

    let to_hex = |x: &BigUint| format!("0x{}", hex::encode(be32_from_biguint(x)));
    println!(
        "{{\"commitment\":\"{}\",\"root\":\"{}\",\"nullifier_hash\":\"{}\",\"epoch\":\"{}\"}}",
        to_hex(&leaf),
        to_hex(&root),
        to_hex(&nullifier_hash),
        to_hex(&epoch)
    );
    eprintln!("Wrote {}", prover_path.display());
}

// Minimal local hex encoder to avoid an extra dependency.
mod hex {
    pub fn encode(bytes: [u8; 32]) -> String {
        let mut s = String::with_capacity(64);
        for b in bytes.iter() {
            s.push_str(&format!("{:02x}", b));
        }
        s
    }
}
