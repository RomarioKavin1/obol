#!/usr/bin/env bash
#
# demo.sh — end-to-end Obol dead-man's-switch walkthrough on Stellar testnet.
#
# Honest, real happy-path up to and including the ZK check-in, then a clearly
# marked live-timing wait before the dead-man's-switch can trip:
#
#   1. Generate a FRESH liveness proof for the CURRENT epoch.
#   2. register()  an identity + link a sealed vault + set a 60s liveness interval.
#   3. mint + deposit() funds into the vault (sealed to a beneficiary commitment).
#   4. checkin()   with the fresh ZK proof-of-life (resets the liveness timer).
#   5. -- WAIT interval+grace (~real wall-clock seconds) --
#   6. report_missed()  trips the switch and activates the vault.
#   7. claim()     the beneficiary reveals their salt and withdraws.
#
# WHY THE EPOCH MATTERS (read this):
#   The on-chain checkin() recomputes  current_epoch = ledger_timestamp / interval
#   and REQUIRES the proof's `epoch` public input to equal it. So the proof must
#   be generated with OBOL_EPOCH = floor(now / interval). We derive that from the
#   local clock; if you run this within a second or two of a 60s epoch boundary
#   the ledger may have advanced into the next epoch and checkin() will return
#   EpochMismatch — just re-run.
#
# ASSUMPTION — FRESH REGISTRY:
#   checkin() requires the proof's Merkle `root` to equal the registry's current
#   root. The input generator produces the empty-tree witness for the single
#   member at leaf index 0, so this identity MUST be the FIRST member registered
#   on this LivenessRegistry. Run ./scripts/deploy_testnet.sh for a clean stack
#   before this demo.
#
# Prerequisites:
#   ./scripts/build_circuit.sh, ./scripts/build_contracts.sh,
#   ./scripts/deploy_testnet.sh   (deployments/testnet.json must exist)
#
# Config via env vars:
#   IDENTITY        Stellar CLI key (also the demo user)   (default: obol-deployer)
#   INTERVAL        liveness interval in seconds           (default: 60 = MIN_INTERVAL)
#   DEMO_RUN_WAIT   1 = actually sleep + run report/claim; 0 = print them only (default: 1)
#
# Usage:  ./scripts/demo.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

IDENTITY="${IDENTITY:-obol-deployer}"
NETWORK="testnet"
INTERVAL="${INTERVAL:-60}"          # MIN_INTERVAL in the registry is 60s.
GRACE=60                            # GRACE_PERIOD constant in the registry.
DEMO_RUN_WAIT="${DEMO_RUN_WAIT:-1}"

DEPLOY_JSON="$REPO_ROOT/deployments/$NETWORK.json"
CIRCUIT_DIR="$REPO_ROOT/circuits/liveness"

echo "==> Obol :: demo (end-to-end dead-man's-switch on $NETWORK)"
echo "    repo root : $REPO_ROOT"
[ -f "$DEPLOY_JSON" ] || { echo "!!! Missing $DEPLOY_JSON — run deploy_testnet.sh first." >&2; exit 1; }

# ---- read contract ids (jq preferred, grep/sed fallback) --------------------
read_id() { # $1 = json key under .contracts
  if command -v jq >/dev/null 2>&1; then
    jq -r ".contracts.$1" "$DEPLOY_JSON"
  else
    grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$DEPLOY_JSON" \
      | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/'
  fi
}
REGISTRY="$(read_id liveness_registry)"
VAULT="$(read_id vault_controller)"
TOKEN="$(read_id mock_token)"
ADDR="$(stellar keys address "$IDENTITY")"

echo "    identity  : $IDENTITY ($ADDR)"
echo "    registry  : $REGISTRY"
echo "    vault     : $VAULT"
echo "    token     : $TOKEN"

# small helpers for randomness
rand_dec() { od -An -tu4 -N4 /dev/urandom | tr -d ' \n'; }   # random uint32 (decimal)
rand_hex32() { xxd -l 32 -p /dev/urandom | tr -d '\n'; }     # random 32 bytes (hex)

# ---- 1. Generate a FRESH proof for the CURRENT epoch ------------------------
# epoch = floor(now / interval), matching checkin()'s on-chain check.
NOW="$(date +%s)"
EPOCH=$(( NOW / INTERVAL ))
OBOL_NULLIFIER="$(rand_dec)"        # fresh nullifier => fresh nullifier_hash (anti-replay)
OBOL_SECRET="$(rand_dec)"
export OBOL_NULLIFIER OBOL_SECRET
export OBOL_EPOCH="$EPOCH"

echo "==> [1/7] Generating proof inputs for epoch=$EPOCH (now=$NOW, interval=${INTERVAL}s)"
# input_gen prints one JSON line to stdout: {commitment, root, nullifier_hash, epoch}.
INPUT_JSON="$(cd "$REPO_ROOT/contracts/tools/input_gen" && cargo run --release 2>/dev/null)"
echo "    input_gen => $INPUT_JSON"

parse_json() { # $1 = key ; expects hex "0x..." values
  if command -v jq >/dev/null 2>&1; then
    echo "$INPUT_JSON" | jq -r ".$1"
  else
    echo "$INPUT_JSON" | grep -o "\"$1\":\"[^\"]*\"" | sed -E 's/.*:"([^"]*)"/\1/'
  fi
}
# identity_commitment is the circuit leaf H(nullifier, secret); strip 0x for the CLI.
IDENTITY_COMMIT="$(parse_json commitment | sed 's/^0x//')"
echo "    identity_commitment = $IDENTITY_COMMIT"

echo "==> Compiling + proving the liveness circuit (UltraHonk / keccak)"
(
  cd "$CIRCUIT_DIR"
  nargo compile
  nargo execute
  bb prove \
    --scheme ultra_honk --oracle_hash keccak \
    --bytecode_path target/obol_liveness.json \
    --witness_path target/obol_liveness.gz \
    --output_path target --output_format bytes_and_fields
)
PUB="$(xxd -p "$CIRCUIT_DIR/target/public_inputs" | tr -d '\n')"
PROOF="$(xxd -p "$CIRCUIT_DIR/target/proof" | tr -d '\n')"

# ---- 2. Derive the sealed vault commitment + register -----------------------
# The vault is sealed to a beneficiary via SHA-256(recipient_xdr || salt). For
# the demo the beneficiary is the same account; keep SALT to claim later.
SALT="$(rand_hex32)"
echo "==> [2/7] Deriving vault commitment (beneficiary=$ADDR)"
VAULT_COMMIT_RAW="$(stellar contract invoke --id "$VAULT" --source "$IDENTITY" --network "$NETWORK" -- \
  derive_commitment --recipient "$ADDR" --salt "$SALT")"
# CLI returns the BytesN<32> as a quoted hex string; strip quotes/0x.
VAULT_COMMIT="$(echo "$VAULT_COMMIT_RAW" | tr -d '"' | sed 's/^0x//')"
echo "    vault_commitment = $VAULT_COMMIT"

echo "==> Registering identity (interval=${INTERVAL}s)"
stellar contract invoke --id "$REGISTRY" --source "$IDENTITY" --network "$NETWORK" -- \
  register \
  --identity_commitment "$IDENTITY_COMMIT" \
  --vault_commitment "$VAULT_COMMIT" \
  --interval_seconds "$INTERVAL"

# For a snappy demo, trip the switch on the FIRST missed interval (owner-only).
echo "==> Setting max_missed = 1 (owner) so a single missed report activates"
stellar contract invoke --id "$REGISTRY" --source "$IDENTITY" --network "$NETWORK" -- \
  set_max_missed --max_missed 1

# ---- 3. Mint + deposit funds into the vault ---------------------------------
DEPOSIT_AMOUNT=1000000000            # 100.0 mUSD at 7 decimals
echo "==> [3/7] Minting $DEPOSIT_AMOUNT mUSD to $ADDR"
stellar contract invoke --id "$TOKEN" --source "$IDENTITY" --network "$NETWORK" -- \
  mint --to "$ADDR" --amount "$DEPOSIT_AMOUNT"

# encrypted_beneficiary is opaque ciphertext on-chain; placeholder bytes here.
ENC_BENEFICIARY="deadbeef"
echo "==> Depositing $DEPOSIT_AMOUNT mUSD into the sealed vault"
stellar contract invoke --id "$VAULT" --source "$IDENTITY" --network "$NETWORK" -- \
  deposit \
  --from "$ADDR" \
  --vault_commitment "$VAULT_COMMIT" \
  --encrypted_beneficiary "$ENC_BENEFICIARY" \
  --token_addr "$TOKEN" \
  --amount "$DEPOSIT_AMOUNT"

# ---- 4. ZK check-in (proof of life) ----------------------------------------
echo "==> [4/7] Submitting ZK check-in (real UltraHonk proof, epoch=$EPOCH)"
echo "    (if this returns EpochMismatch you crossed a 60s boundary — just re-run)"
stellar contract invoke --id "$REGISTRY" --source "$IDENTITY" --network "$NETWORK" -- \
  checkin --public_inputs "$PUB" --proof_bytes "$PROOF"
echo "    check-in accepted — liveness timer reset."

# ---- 5/6/7. Trip the switch (LIVE TIMING WAIT) ------------------------------
# report_missed() reverts with IntervalNotElapsed until:
#     ledger_now >= last_checkin + INTERVAL + GRACE_PERIOD
# i.e. we must wait at least INTERVAL + GRACE seconds of REAL wall-clock time.
WAIT_SECS=$(( INTERVAL + GRACE + 10 ))   # +10s buffer for ledger close lag
echo "==> [5/7] Dead-man's-switch cannot trip yet."
echo "    report_missed requires ~$(( INTERVAL + GRACE ))s (interval+grace) to elapse without a check-in."

if [ "$DEMO_RUN_WAIT" = "1" ]; then
  echo "    Sleeping ${WAIT_SECS}s of real time before reporting... (set DEMO_RUN_WAIT=0 to skip)"
  sleep "$WAIT_SECS"

  echo "==> [6/7] Reporting missed interval (trips the switch; activates vault)"
  stellar contract invoke --id "$REGISTRY" --source "$IDENTITY" --network "$NETWORK" -- \
    report_missed --reporter "$ADDR" --identity_commitment "$IDENTITY_COMMIT"

  echo "==> [7/7] Beneficiary claims the vault (reveals salt + authorizes)"
  stellar contract invoke --id "$VAULT" --source "$IDENTITY" --network "$NETWORK" -- \
    claim --vault_commitment "$VAULT_COMMIT" --salt "$SALT" --recipient "$ADDR"
  echo "==> Vault claimed. End-to-end demo complete."
else
  # Illustrative: print the exact commands the operator would run after waiting.
  echo "    DEMO_RUN_WAIT=0 — skipping the live wait. After ~$(( INTERVAL + GRACE ))s, run:"
  echo ""
  echo "    stellar contract invoke --id $REGISTRY --source $IDENTITY --network $NETWORK -- \\"
  echo "      report_missed --reporter $ADDR --identity_commitment $IDENTITY_COMMIT"
  echo ""
  echo "    stellar contract invoke --id $VAULT --source $IDENTITY --network $NETWORK -- \\"
  echo "      claim --vault_commitment $VAULT_COMMIT --salt $SALT --recipient $ADDR"
  echo ""
  echo "==> Registration, deposit and ZK check-in completed; activation/claim left for you to run."
fi

echo "==> Done."
