#![no_std]
//! Obol VaultController
//!
//! Holds the inheritance assets in escrow. Each vault is keyed by a
//! `vault_commitment = SHA-256(recipient_xdr || salt)` chosen by the owner. The
//! beneficiary's identity stays sealed until they claim: on-chain there is only
//! the commitment (and an optional opaque encrypted blob for off-band delivery).
//!
//! Lifecycle:
//!   deposit  -> owner funds a vault and seals the beneficiary commitment
//!   activate -> only the LivenessRegistry, after the dead-man's-switch trips
//!   claim    -> the beneficiary reveals `salt` and authorizes as `recipient`;
//!               the contract checks the preimage and releases the funds.
//!
//! Binding the recipient into the commitment plus `recipient.require_auth()`
//! makes claims front-run-proof: only the intended recipient can ever claim.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, xdr::ToXdr, Address,
    Bytes, BytesN, Env,
};

const TTL_THRESHOLD: u32 = 100_000;
const TTL_EXTEND: u32 = 1_000_000;

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    AlreadyInitialized = 1,
    NotAuthorized = 2,
    VaultExists = 3,
    VaultNotFound = 4,
    InvalidAmount = 5,
    AlreadyActivated = 6,
    NotActivated = 7,
    AlreadyClaimed = 8,
    InvalidClaim = 9,
    RegistryNotSet = 10,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Owner,
    Registry,
    FeeBps,
    FeeCollector,
    Token(BytesN<32>),
    Amount(BytesN<32>),
    Activated(BytesN<32>),
    Claimed(BytesN<32>),
    Exists(BytesN<32>),
    Beneficiary(BytesN<32>),
}

#[contractevent(topics = ["deposit"], data_format = "map")]
pub struct Deposited {
    #[topic]
    pub vault_commitment: BytesN<32>,
    pub token: Address,
    pub amount: i128,
    pub timestamp: u64,
}

#[contractevent(topics = ["activated"], data_format = "map")]
pub struct Activated {
    #[topic]
    pub vault_commitment: BytesN<32>,
    pub timestamp: u64,
}

#[contractevent(topics = ["claimed"], data_format = "map")]
pub struct Claimed {
    #[topic]
    pub vault_commitment: BytesN<32>,
    pub recipient: Address,
    pub amount: i128,
    pub timestamp: u64,
}

#[contract]
pub struct VaultController;

#[contractimpl]
impl VaultController {
    /// Deploy-time init. `fee_bps` is charged on deposit (e.g. 10 = 0.1%).
    pub fn __constructor(
        env: Env,
        owner: Address,
        fee_collector: Address,
        fee_bps: u32,
    ) -> Result<(), Error> {
        let s = env.storage().instance();
        if s.has(&DataKey::Owner) {
            return Err(Error::AlreadyInitialized);
        }
        s.set(&DataKey::Owner, &owner);
        s.set(&DataKey::FeeCollector, &fee_collector);
        s.set(&DataKey::FeeBps, &fee_bps);
        Ok(())
    }

    /// One-time wiring of the LivenessRegistry (breaks the circular deploy
    /// dependency). Owner-only, only while unset.
    pub fn set_registry(env: Env, registry: Address) -> Result<(), Error> {
        let owner: Address = env
            .storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(Error::AlreadyInitialized)?;
        owner.require_auth();
        if env.storage().instance().has(&DataKey::Registry) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Registry, &registry);
        bump(&env);
        Ok(())
    }

    /// Fund a new vault. `from` authorizes the token transfer; `encrypted_beneficiary`
    /// is an opaque blob (e.g. a claim key encrypted to the beneficiary) that the
    /// contract stores but never interprets.
    pub fn deposit(
        env: Env,
        from: Address,
        vault_commitment: BytesN<32>,
        encrypted_beneficiary: Bytes,
        token_addr: Address,
        amount: i128,
    ) -> Result<(), Error> {
        from.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let s = env.storage().instance();
        if s.has(&DataKey::Exists(vault_commitment.clone())) {
            return Err(Error::VaultExists);
        }

        let fee_bps: u32 = s.get(&DataKey::FeeBps).unwrap_or(0);
        let fee: i128 = amount * (fee_bps as i128) / 10_000;
        let net: i128 = amount - fee;

        let client = token::Client::new(&env, &token_addr);
        let contract = env.current_contract_address();
        client.transfer(&from, &contract, &amount);
        if fee > 0 {
            let fee_collector: Address = s
                .get(&DataKey::FeeCollector)
                .ok_or(Error::AlreadyInitialized)?;
            client.transfer(&contract, &fee_collector, &fee);
        }

        s.set(&DataKey::Token(vault_commitment.clone()), &token_addr);
        s.set(&DataKey::Amount(vault_commitment.clone()), &net);
        s.set(&DataKey::Exists(vault_commitment.clone()), &true);
        s.set(&DataKey::Activated(vault_commitment.clone()), &false);
        s.set(&DataKey::Claimed(vault_commitment.clone()), &false);
        s.set(&DataKey::Beneficiary(vault_commitment.clone()), &encrypted_beneficiary);
        bump(&env);

        Deposited {
            vault_commitment,
            token: token_addr,
            amount: net,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);
        Ok(())
    }

    /// Activate a vault. Only the wired LivenessRegistry may call this (it does
    /// so when the dead-man's-switch threshold is reached).
    pub fn activate(env: Env, vault_commitment: BytesN<32>) -> Result<(), Error> {
        let registry: Address = env
            .storage()
            .instance()
            .get(&DataKey::Registry)
            .ok_or(Error::RegistryNotSet)?;
        registry.require_auth();

        let s = env.storage().instance();
        if !s.has(&DataKey::Exists(vault_commitment.clone())) {
            return Err(Error::VaultNotFound);
        }
        let activated: bool = s.get(&DataKey::Activated(vault_commitment.clone())).unwrap_or(false);
        if activated {
            return Err(Error::AlreadyActivated);
        }
        s.set(&DataKey::Activated(vault_commitment.clone()), &true);
        bump(&env);
        Activated {
            vault_commitment,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);
        Ok(())
    }

    /// Claim an activated vault. The caller proves they are the sealed
    /// beneficiary by revealing `salt` such that
    /// `SHA-256(recipient_xdr || salt) == vault_commitment`, and by authorizing
    /// as `recipient`.
    pub fn claim(
        env: Env,
        vault_commitment: BytesN<32>,
        salt: BytesN<32>,
        recipient: Address,
    ) -> Result<(), Error> {
        recipient.require_auth();
        let s = env.storage().instance();
        if !s.has(&DataKey::Exists(vault_commitment.clone())) {
            return Err(Error::VaultNotFound);
        }
        if !s.get(&DataKey::Activated(vault_commitment.clone())).unwrap_or(false) {
            return Err(Error::NotActivated);
        }
        if s.get(&DataKey::Claimed(vault_commitment.clone())).unwrap_or(false) {
            return Err(Error::AlreadyClaimed);
        }

        // Recompute the commitment: SHA-256(recipient_xdr || salt).
        let expected = compute_commitment(&env, &recipient, &salt);
        if expected != vault_commitment {
            return Err(Error::InvalidClaim);
        }

        let token_addr: Address = s.get(&DataKey::Token(vault_commitment.clone())).ok_or(Error::VaultNotFound)?;
        let amount: i128 = s.get(&DataKey::Amount(vault_commitment.clone())).unwrap_or(0);

        // Checks-effects-interactions.
        s.set(&DataKey::Claimed(vault_commitment.clone()), &true);
        s.set(&DataKey::Amount(vault_commitment.clone()), &0i128);
        bump(&env);

        let client = token::Client::new(&env, &token_addr);
        let contract = env.current_contract_address();
        client.transfer(&contract, &recipient, &amount);

        Claimed {
            vault_commitment,
            recipient,
            amount,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);
        Ok(())
    }

    // ------------------------- views -------------------------
    pub fn is_activated(env: Env, vault_commitment: BytesN<32>) -> bool {
        env.storage().instance().get(&DataKey::Activated(vault_commitment)).unwrap_or(false)
    }
    pub fn is_claimed(env: Env, vault_commitment: BytesN<32>) -> bool {
        env.storage().instance().get(&DataKey::Claimed(vault_commitment)).unwrap_or(false)
    }
    pub fn vault_exists(env: Env, vault_commitment: BytesN<32>) -> bool {
        env.storage().instance().has(&DataKey::Exists(vault_commitment))
    }
    pub fn get_amount(env: Env, vault_commitment: BytesN<32>) -> i128 {
        env.storage().instance().get(&DataKey::Amount(vault_commitment)).unwrap_or(0)
    }
    pub fn get_encrypted_beneficiary(env: Env, vault_commitment: BytesN<32>) -> Option<Bytes> {
        env.storage().instance().get(&DataKey::Beneficiary(vault_commitment))
    }
    pub fn get_registry(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Registry)
    }

    /// Helper so clients can derive a vault commitment identically to the
    /// contract: `SHA-256(recipient_xdr || salt)`.
    pub fn derive_commitment(env: Env, recipient: Address, salt: BytesN<32>) -> BytesN<32> {
        compute_commitment(&env, &recipient, &salt)
    }
}

fn bump(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND);
}

fn compute_commitment(env: &Env, recipient: &Address, salt: &BytesN<32>) -> BytesN<32> {
    let mut preimage: Bytes = recipient.clone().to_xdr(env);
    preimage.append(&Bytes::from_array(env, &salt.to_array()));
    env.crypto().sha256(&preimage).into()
}
