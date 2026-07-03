#![no_std]
//! Obol LivenessRegistry
//!
//! The heart of the dead-man's-switch. Vault owners register an anonymous
//! identity commitment as a leaf in an on-chain Poseidon2 Merkle tree (the
//! anonymity set). To stay alive they periodically submit a zero-knowledge
//! "proof of life" that proves, without a wallet signature, that they control a
//! registered identity during the current epoch. If an owner stops checking in
//! for `max_missed` consecutive intervals (plus a grace period), any keeper can
//! `report_missed`, and once the threshold is crossed the linked vault is
//! activated for the beneficiary to claim.
//!
//! Privacy: the owner's real wallet is never linked on-chain. Check-ins are made
//! via a ZK proof from any address (or a relayer). The identity commitment is a
//! random pseudonym; it is bound into the proof only so a proof cannot reset a
//! different owner's timer.
//!
//! The on-chain incremental Merkle tree uses the native `soroban-poseidon`
//! (BN254 Poseidon2) host hashing, byte-identical to the Noir circuit, so an
//! off-chain proof binds to the on-chain root.

extern crate alloc;

use alloc::vec::Vec as RustVec;
use soroban_poseidon::{poseidon2_hash, Field};
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, crypto::BnScalar,
    Address, Bytes, BytesN, Env, IntoVal, InvokeError, Symbol, Val, Vec as SorobanVec, U256,
};
use ultrahonk_soroban_verifier::PROOF_BYTES;

// ---------------------------------------------------------------------------
// Protocol parameters
// ---------------------------------------------------------------------------
const TREE_DEPTH: u32 = 20;
const MAX_LEAVES: u32 = 1u32 << TREE_DEPTH;

// Demo-friendly cadence (seconds). Real deployments would use days/weeks; these
// keep a live testnet demo of activation feasible in minutes.
const MIN_INTERVAL: u64 = 60;
const GRACE_PERIOD: u64 = 60;
const DEFAULT_MAX_MISSED: u32 = 3;

// TTL bump for instance storage (~ ledgers; keeps demo state alive).
const TTL_THRESHOLD: u32 = 100_000;
const TTL_EXTEND: u32 = 1_000_000;

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    AlreadyRegistered = 1,
    NotRegistered = 2,
    InvalidInterval = 3,
    TreeFull = 4,
    RootNotSet = 5,
    RootMismatch = 6,
    NullifierUsed = 7,
    VerificationFailed = 8,
    InvalidPublicInputs = 9,
    EpochMismatch = 10,
    IntervalNotElapsed = 11,
    NotAuthorized = 12,
    AlreadyInitialized = 13,
    VaultNotSet = 14,
    CommitmentExists = 15,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Verifier,
    Vault,
    Owner,
    Root,
    NextIndex,
    MaxMissed,
    Frontier(u32),
    Leaf(u32),
    KnownRoot(BytesN<32>),
    Committed(BytesN<32>),
    Nullifier(BytesN<32>),
    Registered(BytesN<32>),
    VaultOf(BytesN<32>),
    Interval(BytesN<32>),
    LastCheckin(BytesN<32>),
    Missed(BytesN<32>),
}

#[contractevent(topics = ["registered"], data_format = "map")]
pub struct Registered {
    #[topic]
    pub identity_commitment: BytesN<32>,
    pub vault_commitment: BytesN<32>,
    pub interval_seconds: u64,
    pub leaf_index: u32,
}

#[contractevent(topics = ["checkin"], data_format = "map")]
pub struct CheckedIn {
    #[topic]
    pub identity_commitment: BytesN<32>,
    pub nullifier_hash: BytesN<32>,
    pub timestamp: u64,
}

#[contractevent(topics = ["missed"], data_format = "map")]
pub struct MissedReported {
    #[topic]
    pub identity_commitment: BytesN<32>,
    pub missed_count: u32,
    pub reporter: Address,
    pub timestamp: u64,
}

#[contractevent(topics = ["activated"], data_format = "map")]
pub struct Activated {
    #[topic]
    pub identity_commitment: BytesN<32>,
    pub vault_commitment: BytesN<32>,
    pub timestamp: u64,
}

#[contract]
pub struct LivenessRegistry;

#[contractimpl]
impl LivenessRegistry {
    /// Deploy-time init. `verifier` is the ObolVerifier contract; `owner` may set
    /// the vault controller (once) and tune `max_missed`.
    pub fn __constructor(env: Env, verifier: Address, owner: Address) -> Result<(), Error> {
        let s = env.storage().instance();
        if s.has(&DataKey::Owner) {
            return Err(Error::AlreadyInitialized);
        }
        s.set(&DataKey::Verifier, &verifier);
        s.set(&DataKey::Owner, &owner);
        s.set(&DataKey::MaxMissed, &DEFAULT_MAX_MISSED);
        s.set(&DataKey::NextIndex, &0u32);
        Ok(())
    }

    /// One-time wiring of the VaultController (breaks the circular deploy
    /// dependency). Owner-only, and only while unset.
    pub fn set_vault_controller(env: Env, vault: Address) -> Result<(), Error> {
        let owner: Address = env
            .storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(Error::AlreadyInitialized)?;
        owner.require_auth();
        if env.storage().instance().has(&DataKey::Vault) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Vault, &vault);
        bump(&env);
        Ok(())
    }

    /// Owner may adjust the missed-interval threshold before/while running.
    pub fn set_max_missed(env: Env, max_missed: u32) -> Result<(), Error> {
        let owner: Address = env
            .storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(Error::AlreadyInitialized)?;
        owner.require_auth();
        env.storage().instance().set(&DataKey::MaxMissed, &max_missed);
        bump(&env);
        Ok(())
    }

    /// Register an anonymous identity commitment into the Merkle group and link
    /// it to a vault with a chosen check-in interval. Permissionless: the caller
    /// simply inserts a leaf (funds are handled separately by the VaultController).
    pub fn register(
        env: Env,
        identity_commitment: BytesN<32>,
        vault_commitment: BytesN<32>,
        interval_seconds: u64,
    ) -> Result<u32, Error> {
        let s = env.storage().instance();
        if s.has(&DataKey::Registered(identity_commitment.clone())) {
            return Err(Error::AlreadyRegistered);
        }
        if s.has(&DataKey::Committed(identity_commitment.clone())) {
            return Err(Error::CommitmentExists);
        }
        if interval_seconds < MIN_INTERVAL {
            return Err(Error::InvalidInterval);
        }

        let leaf_index = insert_leaf(&env, &identity_commitment)?;

        let now = env.ledger().timestamp();
        s.set(&DataKey::Committed(identity_commitment.clone()), &true);
        s.set(&DataKey::Registered(identity_commitment.clone()), &true);
        s.set(&DataKey::VaultOf(identity_commitment.clone()), &vault_commitment);
        s.set(&DataKey::Interval(identity_commitment.clone()), &interval_seconds);
        s.set(&DataKey::LastCheckin(identity_commitment.clone()), &now);
        s.set(&DataKey::Missed(identity_commitment.clone()), &0u32);
        bump(&env);

        Registered {
            identity_commitment,
            vault_commitment,
            interval_seconds,
            leaf_index,
        }
        .publish(&env);
        Ok(leaf_index)
    }

    /// Submit a ZK proof of life. `public_inputs` is the 128-byte concatenation
    /// `[root | identity_commitment | nullifier_hash | epoch]` produced by the
    /// circuit; `proof_bytes` is the 14,592-byte UltraHonk proof. On success the
    /// owner's missed counter resets.
    pub fn checkin(env: Env, public_inputs: Bytes, proof_bytes: Bytes) -> Result<(), Error> {
        if proof_bytes.len() as usize != PROOF_BYTES {
            return Err(Error::VerificationFailed);
        }
        let (root, identity_commitment, nullifier_hash, epoch) = parse_public_inputs(&env, &public_inputs)?;

        // Must be a known owner.
        let s = env.storage().instance();
        if !s.has(&DataKey::Registered(identity_commitment.clone())) {
            return Err(Error::NotRegistered);
        }

        // Proof must bind to a known group root. We accept any historical root
        // (not just the latest) so that an owner's proof stays valid even after
        // newer members join the anonymity set. Anti-replay is still enforced by
        // the epoch nullifier below.
        if !s.has(&DataKey::Root) {
            return Err(Error::RootNotSet);
        }
        if !s.has(&DataKey::KnownRoot(root.clone())) {
            return Err(Error::RootMismatch);
        }

        // Epoch must be the current time window for this owner's interval.
        let interval: u64 = s
            .get(&DataKey::Interval(identity_commitment.clone()))
            .ok_or(Error::NotRegistered)?;
        let now = env.ledger().timestamp();
        let current_epoch = now / interval;
        if epoch_to_u64(&epoch) != current_epoch {
            return Err(Error::EpochMismatch);
        }

        // Anti-replay: each epoch nullifier can be used once.
        if s.has(&DataKey::Nullifier(nullifier_hash.clone())) {
            return Err(Error::NullifierUsed);
        }

        // Verify the proof on the external verifier contract.
        let verifier: Address = s.get(&DataKey::Verifier).ok_or(Error::AlreadyInitialized)?;
        verify_proof(&env, &verifier, public_inputs, proof_bytes)?;

        // Effects: consume nullifier, reset the liveness timer.
        s.set(&DataKey::Nullifier(nullifier_hash.clone()), &true);
        s.set(&DataKey::LastCheckin(identity_commitment.clone()), &now);
        s.set(&DataKey::Missed(identity_commitment.clone()), &0u32);
        bump(&env);

        CheckedIn {
            identity_commitment,
            nullifier_hash,
            timestamp: now,
        }
        .publish(&env);
        Ok(())
    }

    /// Anyone (typically a staked keeper) can report a missed interval once the
    /// interval + grace period has elapsed without a check-in. When the missed
    /// count reaches `max_missed`, the linked vault is activated.
    pub fn report_missed(env: Env, reporter: Address, identity_commitment: BytesN<32>) -> Result<u32, Error> {
        reporter.require_auth();
        let s = env.storage().instance();
        if !s.has(&DataKey::Registered(identity_commitment.clone())) {
            return Err(Error::NotRegistered);
        }
        let last: u64 = s
            .get(&DataKey::LastCheckin(identity_commitment.clone()))
            .ok_or(Error::NotRegistered)?;
        let interval: u64 = s
            .get(&DataKey::Interval(identity_commitment.clone()))
            .ok_or(Error::NotRegistered)?;
        let now = env.ledger().timestamp();
        if now < last + interval + GRACE_PERIOD {
            return Err(Error::IntervalNotElapsed);
        }

        let mut missed: u32 = s.get(&DataKey::Missed(identity_commitment.clone())).unwrap_or(0);
        missed += 1;
        s.set(&DataKey::Missed(identity_commitment.clone()), &missed);
        // Advance the window so a single lapse is counted once per interval.
        s.set(&DataKey::LastCheckin(identity_commitment.clone()), &(last + interval));
        bump(&env);

        MissedReported {
            identity_commitment: identity_commitment.clone(),
            missed_count: missed,
            reporter,
            timestamp: now,
        }
        .publish(&env);

        let max_missed: u32 = s.get(&DataKey::MaxMissed).unwrap_or(DEFAULT_MAX_MISSED);
        if missed >= max_missed {
            let vault_commitment: BytesN<32> = s
                .get(&DataKey::VaultOf(identity_commitment.clone()))
                .ok_or(Error::NotRegistered)?;
            let vault: Address = s.get(&DataKey::Vault).ok_or(Error::VaultNotSet)?;
            activate_vault(&env, &vault, &vault_commitment);
            Activated {
                identity_commitment,
                vault_commitment,
                timestamp: now,
            }
            .publish(&env);
        }
        Ok(missed)
    }

    // ------------------------- views -------------------------
    pub fn get_root(env: Env) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::Root)
    }
    pub fn get_member_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::NextIndex).unwrap_or(0)
    }
    pub fn is_registered(env: Env, identity_commitment: BytesN<32>) -> bool {
        env.storage().instance().has(&DataKey::Registered(identity_commitment))
    }
    pub fn get_last_checkin(env: Env, identity_commitment: BytesN<32>) -> u64 {
        env.storage().instance().get(&DataKey::LastCheckin(identity_commitment)).unwrap_or(0)
    }
    pub fn get_missed_count(env: Env, identity_commitment: BytesN<32>) -> u32 {
        env.storage().instance().get(&DataKey::Missed(identity_commitment)).unwrap_or(0)
    }
    pub fn get_vault_commitment(env: Env, identity_commitment: BytesN<32>) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::VaultOf(identity_commitment))
    }
    pub fn get_interval(env: Env, identity_commitment: BytesN<32>) -> u64 {
        env.storage().instance().get(&DataKey::Interval(identity_commitment)).unwrap_or(0)
    }
    pub fn get_max_missed(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::MaxMissed).unwrap_or(DEFAULT_MAX_MISSED)
    }
    pub fn is_nullifier_used(env: Env, nullifier_hash: BytesN<32>) -> bool {
        env.storage().instance().has(&DataKey::Nullifier(nullifier_hash))
    }
    pub fn get_leaf(env: Env, index: u32) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::Leaf(index))
    }
    /// Leaves `[start, end)`, clamped to the member count. Provers fetch these to
    /// rebuild the tree client-side and derive a Merkle witness for any member.
    pub fn get_leaves(env: Env, start: u32, end: u32) -> soroban_sdk::Vec<BytesN<32>> {
        let s = env.storage().instance();
        let count: u32 = s.get(&DataKey::NextIndex).unwrap_or(0);
        let hi = end.min(count);
        let mut out = soroban_sdk::Vec::new(&env);
        let mut i = start;
        while i < hi {
            if let Some(leaf) = s.get(&DataKey::Leaf(i)) {
                out.push_back(leaf);
            }
            i += 1;
        }
        out
    }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

fn bump(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
}

/// 2-to-1 BN254 Poseidon2 compression (native host hashing), matching the Noir
/// circuit's `Poseidon2::hash([a,b], 2)`.
fn poseidon2_hash2(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
    let modulus = <BnScalar as Field>::modulus(env);
    let a_bytes = Bytes::from_array(env, &a.to_array());
    let b_bytes = Bytes::from_array(env, &b.to_array());
    let mut inputs = SorobanVec::new(env);
    inputs.push_back(U256::from_be_bytes(env, &a_bytes).rem_euclid(&modulus));
    inputs.push_back(U256::from_be_bytes(env, &b_bytes).rem_euclid(&modulus));
    let out = poseidon2_hash::<4, BnScalar>(env, &inputs);
    let out_bytes = out.to_be_bytes();
    let mut out_arr = [0u8; 32];
    out_bytes.copy_into_slice(&mut out_arr);
    BytesN::from_array(env, &out_arr)
}

/// Precompute the zero-subtree hashes: zero[0] = 0; zero[i+1] = H(zero[i], zero[i]).
fn zeroes(env: &Env) -> RustVec<BytesN<32>> {
    let mut zs = RustVec::with_capacity(TREE_DEPTH as usize + 1);
    let mut cur = BytesN::from_array(env, &[0u8; 32]);
    zs.push(cur.clone());
    for _ in 0..TREE_DEPTH {
        cur = poseidon2_hash2(env, &cur, &cur);
        zs.push(cur.clone());
    }
    zs
}

/// Insert a leaf into the incremental (frontier) Merkle tree and update the root.
fn insert_leaf(env: &Env, leaf: &BytesN<32>) -> Result<u32, Error> {
    let s = env.storage().instance();
    let mut next_index: u32 = s.get(&DataKey::NextIndex).unwrap_or(0);
    if next_index >= MAX_LEAVES {
        return Err(Error::TreeFull);
    }
    let idx = next_index;
    s.set(&DataKey::Leaf(idx), leaf);
    let zs = zeroes(env);
    let mut cur = leaf.clone();
    let mut i: u32 = 0;
    while i < TREE_DEPTH {
        let bit = (idx >> i) & 1;
        if bit == 0 {
            // Current node is a left child: remember it, pair with a zero sibling.
            s.set(&DataKey::Frontier(i), &cur);
            cur = poseidon2_hash2(env, &cur, &zs[i as usize]);
        } else {
            // Current node is a right child: combine with the saved left sibling.
            let left: BytesN<32> = s
                .get(&DataKey::Frontier(i))
                .unwrap_or_else(|| zs[i as usize].clone());
            cur = poseidon2_hash2(env, &left, &cur);
        }
        i += 1;
    }
    s.set(&DataKey::Root, &cur);
    s.set(&DataKey::KnownRoot(cur.clone()), &true);
    next_index = next_index.saturating_add(1);
    s.set(&DataKey::NextIndex, &next_index);
    Ok(idx)
}

/// Parse `[root | identity_commitment | nullifier_hash | epoch]` (128 bytes).
fn parse_public_inputs(
    env: &Env,
    bytes: &Bytes,
) -> Result<(BytesN<32>, BytesN<32>, BytesN<32>, BytesN<32>), Error> {
    if bytes.len() != 128 {
        return Err(Error::InvalidPublicInputs);
    }
    let mut buf = [0u8; 128];
    bytes.copy_into_slice(&mut buf);
    let chunk = |start: usize| -> BytesN<32> {
        let mut a = [0u8; 32];
        a.copy_from_slice(&buf[start..start + 32]);
        BytesN::from_array(env, &a)
    };
    Ok((chunk(0), chunk(32), chunk(64), chunk(96)))
}

/// Interpret a 32-byte big-endian field element as a u64 epoch (low 8 bytes).
fn epoch_to_u64(epoch: &BytesN<32>) -> u64 {
    let a = epoch.to_array();
    let mut v: u64 = 0;
    for b in &a[24..32] {
        v = (v << 8) | (*b as u64);
    }
    v
}

/// Call `ObolVerifier.verify_proof(public_inputs, proof)`.
fn verify_proof(
    env: &Env,
    verifier: &Address,
    public_inputs: Bytes,
    proof_bytes: Bytes,
) -> Result<(), Error> {
    let mut args: SorobanVec<Val> = SorobanVec::new(env);
    args.push_back(public_inputs.into_val(env));
    args.push_back(proof_bytes.into_val(env));
    env.try_invoke_contract::<(), InvokeError>(verifier, &Symbol::new(env, "verify_proof"), args)
        .map_err(|_| Error::VerificationFailed)?
        .map_err(|_| Error::VerificationFailed)
}

/// Call `VaultController.activate(vault_commitment)`; the registry authorizes as
/// itself, which the vault requires.
fn activate_vault(env: &Env, vault: &Address, vault_commitment: &BytesN<32>) {
    let mut args: SorobanVec<Val> = SorobanVec::new(env);
    args.push_back(vault_commitment.into_val(env));
    env.invoke_contract::<()>(vault, &Symbol::new(env, "activate"), args);
}

#[cfg(test)]
mod test;
