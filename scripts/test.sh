#!/usr/bin/env bash
#
# test.sh — run the Obol contract test suite.
#
# The headline test lives in the `liveness_registry` crate and does the real
# thing end to end: it loads the circuit artifacts (proof / public_inputs / vk),
# verifies a REAL UltraHonk proof through the on-chain verifier logic, and
# asserts that the Merkle root computed on-chain equals the root the circuit
# proved against. That three-way alignment (host input_gen <-> Noir circuit <->
# on-chain tree) is the core correctness guarantee of the protocol.
#
# IMPORTANT: run ./scripts/build_circuit.sh first so the proof / vk artifacts in
#            circuits/liveness/target exist — this test consumes them.
#
# Usage:  ./scripts/test.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

echo "==> Obol :: test"
echo "    repo root : $REPO_ROOT"

# Warn early if the circuit artifacts are missing (the test needs them).
for f in proof public_inputs vk; do
  if [ ! -f "$REPO_ROOT/circuits/liveness/target/$f" ]; then
    echo "!!! Missing circuits/liveness/target/$f — run ./scripts/build_circuit.sh first." >&2
  fi
done

cd "$REPO_ROOT/contracts"

echo "==> cargo test -p liveness_registry --release"
cargo test -p liveness_registry --release

echo "==> Done."
