# Obol Protocol — Scripts

Obol is a **ZK dead-man's-switch** on **Stellar / Soroban**. An owner periodically
submits a zero-knowledge *proof of life* (a Noir circuit proving membership in a
Merkle group without revealing which member). If they stop checking in, anyone
(typically a staked keeper) can report the missed interval; once the miss
threshold is reached the linked, sealed vault is activated and the beneficiary
can claim it.

These scripts build the circuit, build the contracts, run the test suite, deploy
to a Stellar network, verify a proof on-chain, and run an end-to-end demo.

All scripts are `bash` with `set -euo pipefail`, compute the repo root relative
to their own location, and prepend the toolchain dirs to `PATH`:

```bash
export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"
```

## Prerequisites

| Tool          | Version        | Install                       |
| ------------- | -------------- | ----------------------------- |
| Noir (nargo)  | `1.0.0-beta.9` | `noirup -v 1.0.0-beta.9`      |
| Barretenberg  | `bb 0.87.0`    | `bbup -v 0.87.0`              |
| Rust          | stable         | `rustup` + `rustup target add wasm32v1-none` |
| Stellar CLI   | recent         | `cargo install --locked stellar-cli` (or your package manager) |
| Node          | recent LTS     | for the frontend (not required by these scripts) |

`nargo` installs under `~/.nargo/bin` and `bb` under `~/.bb`; the scripts add
both to `PATH` automatically. `xxd` is required for hex-encoding artifacts;
`jq` is used when available (with a `grep`/`sed` fallback) for reading the
deployment JSON.

Install the exact prover toolchain:

```bash
# Noir version manager, then pin the compiler:
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup -v 1.0.0-beta.9

# Barretenberg version manager, then pin the prover:
curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash
bbup -v 0.87.0

# Rust wasm target for the Soroban contracts:
rustup target add wasm32v1-none
```

## Recommended order

```text
build_circuit.sh  ->  build_contracts.sh  ->  test.sh  ->  deploy_testnet.sh  ->  verify_proof_testnet.sh  ->  demo.sh
```

## Scripts

### `build_circuit.sh`
Regenerates proof inputs, compiles, executes and proves the liveness circuit.

1. Runs the host-side input generator (`contracts/tools/input_gen`, using
   `soroban-poseidon`) which computes the Merkle witness + public inputs and
   writes `circuits/liveness/Prover.toml`. Optional env vars (decimal):
   `OBOL_NULLIFIER`, `OBOL_SECRET`, `OBOL_EPOCH`.
2. `nargo compile` then `nargo execute` in `circuits/liveness`.
3. `bb prove` (UltraHonk, `--oracle_hash keccak`) → `target/proof` +
   `target/public_inputs`.
4. `bb write_vk` → `target/vk`.

Echoes artifact sizes; expected `proof=14592`, `public_inputs=128`, `vk=1760` bytes.

### `build_contracts.sh`
Runs `stellar contract build` in `contracts/`, then lists the produced
`target/wasm32v1-none/release/*.wasm` files.

### `test.sh`
Runs `cargo test -p liveness_registry --release`. This test verifies a **real
UltraHonk proof** and asserts the on-chain Merkle root equals the circuit's
root — so run `build_circuit.sh` first so the artifacts exist.

### `deploy_testnet.sh`
Deploys the whole stack and records IDs to `deployments/$NETWORK.json`.

Env vars: `IDENTITY` (default `obol-deployer`), `NETWORK` (default `testnet`).

Steps: **regenerate** the `IDENTITY` key (`stellar keys generate --overwrite`,
replacing any existing key of that name) and fund it via friendbot; deploy
`mock_token`, `obol_verifier`
(initialized with the hex-encoded circuit VK), `vault_controller`,
`liveness_registry`, `keeper_registry`; wire the registry and vault together;
write the deployment JSON (preserving the existing schema); echo all IDs.
Each contract id is captured as the **last stdout line** of its deploy command.

### `verify_proof_testnet.sh`
Reads the `obol_verifier` id from `deployments/testnet.json`, hex-encodes the
local `public_inputs` and `proof`, and calls `verify_proof` on-chain. A `null`
result means success — i.e. **on-chain UltraHonk verification passed**.

Env var: `IDENTITY` (default `obol-deployer`).

### `demo.sh`
End-to-end testnet walkthrough, honest about timing.

- Generates a **fresh** proof for the **current epoch** (`OBOL_EPOCH =
  floor(now / interval)`), because `checkin()` requires the proof's `epoch`
  public input to equal `ledger_timestamp / interval`.
- `register` → `mint` → `deposit` → `checkin` are the real, correct happy path.
- The dead-man's-switch cannot trip until `interval + grace` (~real wall-clock
  seconds) have elapsed without a check-in; this **wait is clearly marked**.
  With `DEMO_RUN_WAIT=1` (default) the script sleeps and then runs
  `report_missed` + `claim`; with `DEMO_RUN_WAIT=0` it prints those commands
  for you to run after waiting.

Assumes a **freshly deployed registry** (this identity must be member index 0,
so its empty-tree Merkle root matches the on-chain root). Env vars: `IDENTITY`,
`INTERVAL` (default 60 = the registry's `MIN_INTERVAL`), `DEMO_RUN_WAIT`.
