/**
 * Zero-knowledge liveness proof generation for Obol Protocol (browser).
 *
 * This replicates the VERIFIED proof recipe exactly — the same hashing and proof
 * approach that produced the on-chain-verified check-in transaction. Do not
 * change the hashing / tree / oracle-hash details: they must match the deployed
 * ObolVerifier + LivenessRegistry.
 *
 *   - Poseidon2 over BN254 (via Barretenberg) for all hashes.
 *   - identity_commitment = Poseidon2(nullifier, secret)
 *   - empty-tree Merkle witness, single member at index 0 (the on-chain registry
 *     recomputes the identical root for a single owner). For a multi-owner tree
 *     you would track the frontier; this demo uses the index-0 witness.
 *   - nullifier_hash = Poseidon2(nullifier, epoch)
 *   - UltraHonk proof with keccak oracle hash -> exactly 14592 proof bytes.
 *   - public_inputs = 32-byte big-endian concat of [root, identity_commitment,
 *     nullifier_hash, epoch] = 128 bytes.
 */

import type { Barretenberg, Fr } from "@aztec/bb.js";
import type { Identity } from "./identity";

// bb.js and noir_js are imported DYNAMICALLY (browser-only, on demand). A static
// top-level `import ... from "@aztec/bb.js"` runs its browser bundle at module
// evaluation and crashes under the Next.js bundler ("Object.defineProperty called
// on non-object"). Deferring to the first hash/proof call fixes it and keeps the
// multi-MB WASM out of the initial page load.
let _bbMod: typeof import("@aztec/bb.js") | null = null;
async function bbMod(): Promise<typeof import("@aztec/bb.js")> {
  if (!_bbMod) _bbMod = await import("@aztec/bb.js");
  return _bbMod;
}

// BN254 scalar field prime.
export const BN254_PRIME =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const TREE_DEPTH = 20;

// ---------------------------------------------------------------------------
// Byte / field helpers
// ---------------------------------------------------------------------------

/** bigint -> 32-byte big-endian Uint8Array. */
function toBytes(n: bigint): Uint8Array {
  const h = n.toString(16).padStart(64, "0");
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return b;
}

/** 32-byte big-endian Uint8Array -> bigint. */
function bytesToBig(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

const frToBig = (f: Fr) => bytesToBig(f.toBuffer());
const hex = (n: bigint) => "0x" + n.toString(16).padStart(64, "0");

// ---------------------------------------------------------------------------
// Barretenberg singleton (multi-MB WASM — load once)
// ---------------------------------------------------------------------------

let _bb: Barretenberg | null = null;
async function getBb(): Promise<Barretenberg> {
  if (!_bb) {
    const { Barretenberg } = await bbMod();
    // threads: 1 avoids the SharedArrayBuffer / COOP-COEP requirement.
    _bb = await Barretenberg.new({ threads: 1 });
  }
  return _bb;
}

/** Poseidon2(a, b) over BN254. */
async function h2(a: bigint, b: bigint): Promise<bigint> {
  const bb = await getBb();
  const { Fr } = await bbMod();
  return frToBig(await bb.poseidon2Hash([new Fr(toBytes(a)), new Fr(toBytes(b))]));
}

// ---------------------------------------------------------------------------
// Identity + commitment
// ---------------------------------------------------------------------------

/** Random 248-bit field element reduced mod the BN254 prime. */
export function randomFieldElement(): bigint {
  const bytes = new Uint8Array(31); // 248 bits, always < BN254 prime
  crypto.getRandomValues(bytes);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v % BN254_PRIME;
}

/** Generate a fresh {nullifier, secret} owner key. This is the owner's ONLY key. */
export function generateSecrets(): { nullifier: bigint; secret: bigint } {
  return { nullifier: randomFieldElement(), secret: randomFieldElement() };
}

/** identity_commitment = Poseidon2(nullifier, secret). */
export async function computeIdentityCommitment(
  nullifier: bigint,
  secret: bigint
): Promise<bigint> {
  return h2(nullifier, secret);
}

// ---------------------------------------------------------------------------
// Circuit loading + proof
// ---------------------------------------------------------------------------

// Minimal shape for the compiled Noir circuit JSON.
type CompiledCircuit = { bytecode: string; abi: unknown };

let _circuit: CompiledCircuit | null = null;
async function loadCircuit(): Promise<CompiledCircuit> {
  if (_circuit) return _circuit;
  const resp = await fetch("/circuits/liveness.json");
  if (!resp.ok) {
    throw new Error(
      `Failed to load circuit: ${resp.status} ${resp.statusText}. ` +
        "Expected public/circuits/liveness.json"
    );
  }
  _circuit = (await resp.json()) as CompiledCircuit;
  return _circuit;
}

export interface LivenessProof {
  /** Raw UltraHonk proof bytes (exactly 14592). */
  proof: Uint8Array;
  /** 128 bytes: BE concat of [root, identity_commitment, nullifier_hash, epoch]. */
  publicInputs: Uint8Array;
  /** Public field values, hex, for display / debugging. */
  root: string;
  identityCommitment: string;
  nullifierHash: string;
  epoch: string;
}

export type ProofProgress =
  | "computing_witness"
  | "generating_proof"
  | "done";

/**
 * Generate a liveness proof for the given owner secrets and epoch.
 * `onProgress` is called as the (potentially multi-second) work advances.
 */
export async function generateLivenessProof(
  identity: Identity,
  epoch: bigint,
  onProgress?: (step: ProofProgress) => void
): Promise<LivenessProof> {
  const nullifier = identity.nullifier;
  const secret = identity.secret;

  // identity commitment
  const identity_commitment = await h2(nullifier, secret);

  // empty-tree Merkle witness (single member at index 0 — matches how the
  // on-chain registry computes the root for a single owner).
  const zeroes: bigint[] = [0n];
  for (let i = 0; i < TREE_DEPTH; i++) zeroes.push(await h2(zeroes[i], zeroes[i]));
  let cur = identity_commitment;
  for (let i = 0; i < TREE_DEPTH; i++) cur = await h2(cur, zeroes[i]);
  const root = cur;

  const nullifier_hash = await h2(nullifier, epoch);

  const inputs = {
    root: hex(root),
    identity_commitment: hex(identity_commitment),
    nullifier_hash: hex(nullifier_hash),
    epoch: hex(epoch),
    nullifier: hex(nullifier),
    secret: hex(secret),
    path_siblings: zeroes.slice(0, TREE_DEPTH).map(hex),
    path_bits: Array(TREE_DEPTH).fill("0x0"),
  };

  const circuit = await loadCircuit();
  const { Noir } = await import("@noir-lang/noir_js");
  const noir = new Noir(circuit as never);

  onProgress?.("computing_witness");
  const { witness } = await noir.execute(inputs);

  onProgress?.("generating_proof");
  const { UltraHonkBackend } = await bbMod();
  const backend = new UltraHonkBackend(circuit.bytecode, { threads: 1 });
  // keccak: true -> keccak oracle hash (required by ObolVerifier); proof is exactly 14592 bytes.
  const { proof } = await backend.generateProof(witness, { keccak: true });

  // public_inputs bytes = concat of 32-byte big-endian field elements.
  const publicInputs = new Uint8Array(128);
  publicInputs.set(toBytes(root), 0);
  publicInputs.set(toBytes(identity_commitment), 32);
  publicInputs.set(toBytes(nullifier_hash), 64);
  publicInputs.set(toBytes(epoch), 96);

  onProgress?.("done");

  return {
    proof,
    publicInputs,
    root: hex(root),
    identityCommitment: hex(identity_commitment),
    nullifierHash: hex(nullifier_hash),
    epoch: hex(epoch),
  };
}
