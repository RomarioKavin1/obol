#![no_std]
//! Obol on-chain UltraHonk proof verifier.
//!
//! A thin Soroban wrapper around the `ultrahonk_soroban_verifier` crate. The
//! verification key (VK) for the Obol liveness circuit is supplied once at
//! deployment and is immutable thereafter. `verify_proof` checks that a proof
//! is valid for the given public inputs under that VK. In the protocol the
//! LivenessRegistry cross-calls `verify_proof` on every `checkin`; verification
//! is stateless and permissionless, so anyone may also call it directly.
//!
//! Trust model: no admin, no upgrade path. Callers should independently confirm
//! the stored VK (via `vk_bytes`) matches the audited Obol circuit before
//! trusting proofs verified here.

use soroban_sdk::{contract, contracterror, contractimpl, symbol_short, Bytes, Env, Symbol};
use ultrahonk_soroban_verifier::{UltraHonkVerifier, VkLoadError, PROOF_BYTES};

#[contract]
pub struct ObolVerifier;

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    VkInvalidLength = 1,
    VkInvalidParameters = 2,
    ProofParseError = 3,
    VerificationFailed = 4,
    VkNotSet = 5,
    AlreadyInitialized = 6,
}

#[contractimpl]
impl ObolVerifier {
    fn key_vk() -> Symbol {
        symbol_short!("vk")
    }

    /// Store the immutable VK once, at deploy time. Rejects malformed VKs by
    /// parsing them before persisting.
    pub fn __constructor(env: Env, vk_bytes: Bytes) -> Result<(), Error> {
        if env.storage().instance().has(&Self::key_vk()) {
            return Err(Error::AlreadyInitialized);
        }
        UltraHonkVerifier::new(&env, &vk_bytes).map_err(map_vk_err)?;
        env.storage().instance().set(&Self::key_vk(), &vk_bytes);
        Ok(())
    }

    /// Return the stored VK bytes for auditability.
    pub fn vk_bytes(env: Env) -> Result<Bytes, Error> {
        env.storage()
            .instance()
            .get(&Self::key_vk())
            .ok_or(Error::VkNotSet)
    }

    /// Verify an UltraHonk proof for `public_inputs` under the stored VK.
    /// Returns `Ok(())` iff the proof is valid; otherwise a typed error.
    pub fn verify_proof(env: Env, public_inputs: Bytes, proof_bytes: Bytes) -> Result<(), Error> {
        if proof_bytes.len() as usize != PROOF_BYTES {
            return Err(Error::ProofParseError);
        }
        let vk_bytes: Bytes = env
            .storage()
            .instance()
            .get(&Self::key_vk())
            .ok_or(Error::VkNotSet)?;
        let verifier = UltraHonkVerifier::new(&env, &vk_bytes).map_err(map_vk_err)?;
        verifier
            .verify(&env, &proof_bytes, &public_inputs)
            .map_err(|_| Error::VerificationFailed)?;
        Ok(())
    }
}

fn map_vk_err(e: VkLoadError) -> Error {
    match e {
        VkLoadError::WrongLength => Error::VkInvalidLength,
        VkLoadError::InvalidParameters => Error::VkInvalidParameters,
    }
}
