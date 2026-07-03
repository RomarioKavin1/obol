#!/usr/bin/env bash
#
# verify_proof_testnet.sh — sanity-check the DEPLOYED ObolVerifier by asking it
# to verify the locally generated UltraHonk proof on-chain.
#
# It reads the verifier contract id from deployments/testnet.json, hex-encodes
# the circuit's public_inputs (128 bytes) and proof (14592 bytes), and calls
# `verify_proof`. The contract returns unit `()` on success, which the Stellar
# CLI prints as `null` — so a `null` result here means the proof verified
# on-chain. Any error (non-null / revert) means verification failed.
#
# This is the strongest smoke test: it exercises real UltraHonk verification on
# the actual deployed contract, not a local simulation.
#
# Prerequisites:
#   ./scripts/build_circuit.sh    (produces proof + public_inputs)
#   ./scripts/deploy_testnet.sh   (produces deployments/testnet.json)
#
# Config via env vars:
#   IDENTITY   Stellar CLI key to invoke from   (default: obol-deployer)
#
# Usage:  ./scripts/verify_proof_testnet.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

IDENTITY="${IDENTITY:-obol-deployer}"
DEPLOY_JSON="$REPO_ROOT/deployments/testnet.json"
PUB_FILE="$REPO_ROOT/circuits/liveness/target/public_inputs"
PROOF_FILE="$REPO_ROOT/circuits/liveness/target/proof"

echo "==> Obol :: verify_proof_testnet"
echo "    repo root : $REPO_ROOT"

[ -f "$DEPLOY_JSON" ] || { echo "!!! Missing $DEPLOY_JSON — run deploy_testnet.sh first." >&2; exit 1; }
[ -f "$PUB_FILE" ]    || { echo "!!! Missing $PUB_FILE — run build_circuit.sh first." >&2; exit 1; }
[ -f "$PROOF_FILE" ]  || { echo "!!! Missing $PROOF_FILE — run build_circuit.sh first." >&2; exit 1; }

# Read the verifier id: prefer jq, fall back to grep/sed if jq is unavailable.
if command -v jq >/dev/null 2>&1; then
  VERIFIER="$(jq -r '.contracts.obol_verifier' "$DEPLOY_JSON")"
else
  VERIFIER="$(grep -o '"obol_verifier"[[:space:]]*:[[:space:]]*"[^"]*"' "$DEPLOY_JSON" \
    | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')"
fi
[ -n "$VERIFIER" ] && [ "$VERIFIER" != "null" ] || { echo "!!! Could not read obol_verifier id." >&2; exit 1; }
echo "    verifier  : $VERIFIER"

# Hex-encode the raw artifacts for the CLI (Bytes args take hex).
PUB="$(xxd -p "$PUB_FILE" | tr -d '\n')"
PROOF="$(xxd -p "$PROOF_FILE" | tr -d '\n')"

echo "==> Invoking ObolVerifier.verify_proof on-chain (a 'null' result == success)"
stellar contract invoke --id "$VERIFIER" --source "$IDENTITY" --network testnet -- \
  verify_proof --public_inputs "$PUB" --proof_bytes "$PROOF"

echo "==> If the line above printed 'null', on-chain UltraHonk verification PASSED."
echo "==> Done."
