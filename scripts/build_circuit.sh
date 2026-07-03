#!/usr/bin/env bash
#
# build_circuit.sh — regenerate proof inputs, compile, execute and prove the
# Obol "liveness" circuit (a ZK proof-of-life for the dead-man's-switch).
#
# Pipeline:
#   1. Host-side input generator (contracts/tools/input_gen) computes the Merkle
#      witness + public inputs with soroban-poseidon (BN254 Poseidon2), which is
#      byte-for-byte identical to the Noir circuit and the on-chain Merkle tree,
#      and writes circuits/liveness/Prover.toml.
#   2. `nargo compile` -> ACIR bytecode; `nargo execute` -> witness.
#   3. Barretenberg `bb prove` -> UltraHonk proof (+ public inputs) as raw bytes.
#   4. `bb write_vk` -> verification key (raw bytes) for the on-chain verifier.
#
# Toolchain (pin these exact versions):
#   * Noir          1.0.0-beta.9   (noirup -v 1.0.0-beta.9)
#   * Barretenberg  bb 0.87.0      (bbup   -v 0.87.0)
#   * Rust + wasm32v1-none target (for the contracts, not strictly this script)
#
# Optional env vars forwarded to the input generator (decimal integers):
#   OBOL_NULLIFIER, OBOL_SECRET, OBOL_EPOCH
#
# Usage:  ./scripts/build_circuit.sh
set -euo pipefail

# Repo root is the parent of the directory holding this script.
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# nargo installs to ~/.nargo/bin and bb installs to ~/.bb — make sure both are
# on PATH regardless of the caller's shell profile.
export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

echo "==> Obol :: build_circuit"
echo "    repo root : $REPO_ROOT"
echo "    nargo     : $(command -v nargo || echo 'NOT FOUND')"
echo "    bb        : $(command -v bb || echo 'NOT FOUND')"
echo "    OBOL_EPOCH=${OBOL_EPOCH:-<default>}  OBOL_NULLIFIER=${OBOL_NULLIFIER:-<default>}  OBOL_SECRET=${OBOL_SECRET:-<default>}"

# --- 1. Generate Prover.toml (Merkle witness + public inputs) ---------------
echo "==> [1/4] Generating proof inputs (soroban-poseidon)"
(
  cd "$REPO_ROOT/contracts/tools/input_gen"
  cargo run --release
)

# --- 2. Compile + execute the Noir circuit ----------------------------------
CIRCUIT_DIR="$REPO_ROOT/circuits/liveness"
cd "$CIRCUIT_DIR"

echo "==> [2/4] nargo compile"
nargo compile

echo "==> [3/4] nargo execute"
nargo execute

# --- 3. Prove with Barretenberg (UltraHonk, keccak oracle) ------------------
echo "==> [4/4] bb prove + write_vk (UltraHonk / oracle_hash=keccak)"
bb prove \
  --scheme ultra_honk \
  --oracle_hash keccak \
  --bytecode_path target/obol_liveness.json \
  --witness_path target/obol_liveness.gz \
  --output_path target \
  --output_format bytes_and_fields

bb write_vk \
  --scheme ultra_honk \
  --oracle_hash keccak \
  --bytecode_path target/obol_liveness.json \
  --output_path target \
  --output_format bytes_and_fields

# --- 4. Report artifact sizes ------------------------------------------------
size() { [ -f "$1" ] && wc -c < "$1" | tr -d ' ' || echo "MISSING"; }

echo "==> Artifacts written to $CIRCUIT_DIR/target :"
echo "    proof          = $(size target/proof) bytes   (expected 14592)"
echo "    public_inputs  = $(size target/public_inputs) bytes   (expected 128)"
echo "    vk             = $(size target/vk) bytes   (expected 1760)"
echo "==> Done."
