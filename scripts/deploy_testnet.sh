#!/usr/bin/env bash
#
# deploy_testnet.sh — deploy the full Obol stack to a Stellar network and record
# the resulting contract IDs in deployments/$NETWORK.json.
#
# Contracts deployed (in dependency order):
#   mock_token        -- mint-able SEP-41 test token (keeper stake + vault deposits)
#   obol_verifier     -- on-chain UltraHonk verifier, initialized with the circuit VK
#   vault_controller  -- holds sealed vaults, activates on dead-man's-switch trip
#   liveness_registry -- Merkle group + ZK check-in + missed-interval reporting
#   keeper_registry   -- staking registry for keepers who report missed intervals
# Then wires registry <-> vault together.
#
# Prerequisites (run these first):
#   ./scripts/build_circuit.sh    (produces circuits/liveness/target/vk)
#   ./scripts/build_contracts.sh  (produces the .wasm files)
#
# Toolchain: Stellar CLI, plus `xxd` for hex-encoding the VK.
#
# Config via env vars (with defaults):
#   IDENTITY   Stellar CLI key name to deploy from   (default: obol-deployer)
#   NETWORK    target network                        (default: testnet)
#
# NOTE: the script REGENERATES the $IDENTITY key (`stellar keys generate
# --overwrite`) and funds it via friendbot each run — every deploy is a fresh
# stack from a fresh deployer, and any previous key under that name is replaced.
#
# Usage:  ./scripts/deploy_testnet.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

IDENTITY="${IDENTITY:-obol-deployer}"
NETWORK="${NETWORK:-testnet}"

W="$REPO_ROOT/contracts/target/wasm32v1-none/release"
VK_FILE="$REPO_ROOT/circuits/liveness/target/vk"

echo "==> Obol :: deploy_testnet"
echo "    repo root : $REPO_ROOT"
echo "    identity  : $IDENTITY"
echo "    network   : $NETWORK"

# Sanity: required artifacts must exist.
[ -f "$VK_FILE" ] || { echo "!!! Missing $VK_FILE — run build_circuit.sh first." >&2; exit 1; }
for wasm in mock_token obol_verifier vault_controller liveness_registry keeper_registry; do
  [ -f "$W/$wasm.wasm" ] || { echo "!!! Missing $W/$wasm.wasm — run build_contracts.sh first." >&2; exit 1; }
done

# Deploy helper: runs `stellar contract deploy ...` and echoes ONLY the contract
# id, which the Stellar CLI emits as the last line of stdout. Diagnostic chatter
# from the CLI goes to stderr and is left untouched for the operator to see.
deploy() {
  stellar contract deploy "$@" --source "$IDENTITY" --network "$NETWORK" 2>/dev/null | tail -n 1
}

# --- 0. Fund / create the deployer identity via friendbot --------------------
echo "==> Generating + funding identity '$IDENTITY' (friendbot)"
stellar keys generate "$IDENTITY" --network "$NETWORK" --fund --overwrite
ADDR="$(stellar keys address "$IDENTITY")"
echo "    deployer address : $ADDR"

# Friendbot funding can take a few seconds to propagate to the RPC. Wait until
# the account is visible before the first deploy, otherwise it fails "account
# not found". Poll Horizon for up to ~30s.
echo "==> Waiting for funding to propagate"
for _ in $(seq 1 15); do
  if curl -sf "https://horizon-testnet.stellar.org/accounts/$ADDR" >/dev/null 2>&1; then
    echo "    account is live"
    break
  fi
  sleep 2
done

# --- 1. MockToken ------------------------------------------------------------
echo "==> Deploying MockToken"
TOKEN="$(deploy --wasm "$W/mock_token.wasm" -- \
  --admin "$ADDR" --decimal 7 --name "Mock USD" --symbol mUSD)"
echo "    mock_token = $TOKEN"

# --- 2. ObolVerifier (initialized with the circuit VK) -----------------------
echo "==> Encoding verification key + deploying ObolVerifier"
VK="$(xxd -p "$VK_FILE" | tr -d '\n')"
VERIFIER="$(deploy --wasm "$W/obol_verifier.wasm" -- --vk_bytes "$VK")"
echo "    obol_verifier = $VERIFIER"

# --- 3. VaultController ------------------------------------------------------
echo "==> Deploying VaultController (fee_bps=10 => 0.10%)"
VAULT="$(deploy --wasm "$W/vault_controller.wasm" -- \
  --owner "$ADDR" --fee_collector "$ADDR" --fee_bps 10)"
echo "    vault_controller = $VAULT"

# --- 4. LivenessRegistry -----------------------------------------------------
echo "==> Deploying LivenessRegistry"
REGISTRY="$(deploy --wasm "$W/liveness_registry.wasm" -- \
  --verifier "$VERIFIER" --owner "$ADDR")"
echo "    liveness_registry = $REGISTRY"

# --- 5. KeeperRegistry -------------------------------------------------------
echo "==> Deploying KeeperRegistry (min_stake=1000000000)"
KEEPER="$(deploy --wasm "$W/keeper_registry.wasm" -- \
  --stake_token "$TOKEN" --min_stake 1000000000)"
echo "    keeper_registry = $KEEPER"

# --- 6. Wire registry <-> vault ---------------------------------------------
echo "==> Wiring LivenessRegistry.set_vault_controller -> VaultController"
stellar contract invoke --id "$REGISTRY" --source "$IDENTITY" --network "$NETWORK" -- \
  set_vault_controller --vault "$VAULT"

echo "==> Wiring VaultController.set_registry -> LivenessRegistry"
stellar contract invoke --id "$VAULT" --source "$IDENTITY" --network "$NETWORK" -- \
  set_registry --registry "$REGISTRY"

# --- 7. Persist deployment record -------------------------------------------
# Keep the exact schema of the existing deployments/testnet.json.
DEPLOY_DIR="$REPO_ROOT/deployments"
mkdir -p "$DEPLOY_DIR"
OUT="$DEPLOY_DIR/$NETWORK.json"

case "$NETWORK" in
  testnet)
    RPC_URL="https://soroban-testnet.stellar.org"
    PASSPHRASE="Test SDF Network ; September 2015"
    EXPLORER="https://stellar.expert/explorer/testnet"
    ;;
  *)
    # Reasonable defaults for other networks; adjust as needed.
    RPC_URL="https://soroban-testnet.stellar.org"
    PASSPHRASE="Test SDF Network ; September 2015"
    EXPLORER="https://stellar.expert/explorer/$NETWORK"
    ;;
esac

cat > "$OUT" <<JSON
{
  "network": "$NETWORK",
  "rpcUrl": "$RPC_URL",
  "networkPassphrase": "$PASSPHRASE",
  "explorer": "$EXPLORER",
  "deployer": "$ADDR",
  "contracts": {
    "obol_verifier": "$VERIFIER",
    "liveness_registry": "$REGISTRY",
    "vault_controller": "$VAULT",
    "keeper_registry": "$KEEPER",
    "mock_token": "$TOKEN"
  },
  "circuit": {
    "name": "obol_liveness",
    "proofSystem": "UltraHonk (Barretenberg 0.87.0, oracle_hash=keccak)",
    "proofBytes": 14592,
    "publicInputs": ["root", "identity_commitment", "nullifier_hash", "epoch"],
    "treeDepth": 20
  }
}
JSON

echo "==> Wrote $OUT"
echo "==> Deployment complete:"
echo "    deployer          = $ADDR"
echo "    mock_token        = $TOKEN"
echo "    obol_verifier     = $VERIFIER"
echo "    vault_controller  = $VAULT"
echo "    liveness_registry = $REGISTRY"
echo "    keeper_registry   = $KEEPER"
echo "==> Done."
