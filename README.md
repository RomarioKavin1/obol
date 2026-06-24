# Obol Protocol

**A zero-knowledge dead-man's-switch for private crypto inheritance on Stellar.**

Obol lets you leave crypto to an heir without a will, a lawyer, or a custodian — and
without ever linking your wallet to the arrangement on-chain. You periodically submit a
zero-knowledge *proof of life*. If you go silent for long enough, anyone can trip the
switch, and your sealed beneficiary claims the funds. Your identity stays private the
whole way through, and the heir's identity stays sealed until the moment they claim.

> Named after the *obol*, the coin placed with the dead to pay Charon for passage across
> the Styx. Obol is that coin, made programmable and private.

---

## What it is

Obol is a trustless, privacy-preserving inheritance mechanism built on Stellar
(Soroban smart contracts). The flow:

1. **Setup** — An owner registers an anonymous identity into an on-chain anonymity set
   and links it to a funded, sealed vault.
2. **Proof of life** — On each interval, the owner submits a ZK proof that they still
   control a registered identity. No wallet signature, no wallet linkage.
3. **The switch** — If the owner misses `max_missed` consecutive intervals (plus a grace
   period), any keeper can `report_missed`. Once the threshold is crossed, the linked
   vault activates automatically.
4. **Inheritance** — The sealed beneficiary reveals their salt, authorizes as the bound
   recipient, and the escrowed funds are released to them.

The owner's real wallet is **never** linked on-chain. The beneficiary is **sealed** until
the moment of claim, and the claim is bound to their address so it cannot be front-run.

---

## Why ZK on Stellar

The zero-knowledge is **load-bearing** — it is not a decoration bolted onto a normal
escrow. It is *how the system stays private while remaining verifiable*. Three ZK
primitives do the work:

1. **Anonymous membership.** Owners are leaves in an on-chain Poseidon2 Merkle tree
   (depth 20 — up to ~1M members). A check-in proves *"I am one of the registered
   owners"* without revealing which one and without a wallet signature.

2. **Epoch-bound nullifiers.** `nullifier_hash = Poseidon2(nullifier, epoch)` produces
   exactly one unrepeatable liveness token per time window. Replaying an old proof or
   double-checking-in within a window is rejected *inside the circuit* and again on-chain.

3. **Sealed beneficiary.** `vault_commitment = SHA-256(recipient_xdr || salt)` hides the
   heir's identity until they reveal the salt and claim. Because the recipient's address
   is bound into the commitment (and re-checked with `require_auth`), claims are
   front-run-proof: only the intended heir can ever claim.

This is affordable on Stellar specifically because of **Protocol 25/26 native host
functions** — BN254 curve operations and Poseidon2 hashing run as host primitives rather
than as expensive in-contract arithmetic. That is what makes on-chain UltraHonk proof
verification, and an on-chain incremental Poseidon2 Merkle tree, practical inside a
Soroban contract.

---

## Architecture

```
                         OWNER (private device)
                                │
                 ┌──────────────┴───────────────┐
                 │  generate UltraHonk proof     │
                 │  public: root, id_commitment, │
                 │          nullifier_hash, epoch│
                 └──────────────┬────────────────┘
                                │ checkin(public_inputs, proof)
                                ▼
                   ┌────────────────────────┐        verify_proof()      ┌──────────────┐
                   │   LivenessRegistry      │ ─────────────────────────► │ ObolVerifier │
                   │  • Poseidon2 Merkle     │ ◄───────────────────────── │  (UltraHonk) │
                   │    (incremental, d=20)  │           ok / err         └──────────────┘
                   │  • epoch nullifiers     │
                   │  • last_checkin, missed │
                   └────────────┬────────────┘
                                │ report_missed() by any keeper
                                │ (missed >= max_missed)
                                │ activate(vault_commitment)
                                ▼
                   ┌────────────────────────┐
                   │   VaultController       │        claim(salt, recipient)
                   │  • escrowed funds       │ ─────────────────────────► BENEFICIARY
                   │  • sealed beneficiary   │        (funds released)
                   │  • activate / claim     │
                   └────────────────────────┘

        ┌────────────────┐   stake / is_active_keeper
        │ KeeperRegistry │◄─── keepers bond tokens so they are trusted to watch
        └────────────────┘        the switch and call report_missed
```

- **LivenessRegistry** — the heart of the switch. Holds the on-chain incremental
  Poseidon2 Merkle tree, tracks per-identity intervals / last check-in / missed count,
  enforces epoch nullifiers, and cross-calls the verifier on every check-in.
- **ObolVerifier** — a thin Soroban wrapper over a vendored UltraHonk verifier crate.
  Stores the circuit's verification key immutably and checks proofs.
- **VaultController** — escrow. Holds funds against a sealed `vault_commitment`,
  is activated only by the registry, and releases funds only to the bound recipient.
- **KeeperRegistry** — staking for keepers (the actors who watch and report missed
  intervals), to align incentives and deter spam.
- **MockToken** — a mint-able SEP-41 token used so demos/tests are self-contained.

---

## How it works

### 1. Owner setup

- Off-chain, the owner picks two random field elements — `nullifier` and `secret` —
  that together form their identity. These **never leave the owner's device**.
- `identity_commitment = Poseidon2(nullifier, secret)` becomes the owner's public
  pseudonym and their Merkle leaf.
- The owner picks a beneficiary and a random `salt`, and computes
  `vault_commitment = SHA-256(recipient_xdr || salt)`.
- `register(identity_commitment, vault_commitment, interval_seconds)` inserts the leaf
  into the on-chain tree and links it to the vault and a check-in cadence.
- `deposit(...)` on the VaultController escrows the inheritance funds against that
  `vault_commitment` (optionally with an opaque encrypted blob to help deliver the salt
  to the heir off-band).

### 2. Check-in (proof of life)

- Each interval, the owner computes the current `epoch = floor(ledger_timestamp / interval)`,
  builds the Merkle witness for their leaf, and generates an UltraHonk proof.
- `checkin(public_inputs, proof)` submits it. The registry checks: the identity is
  registered, the proof's `root` matches the current tree root, the `epoch` is the
  current window, the `nullifier_hash` has not been used, and finally the proof verifies
  on the ObolVerifier. On success, the missed counter resets to zero.
- The submitting address can be anyone (or a relayer) — the check-in carries no wallet
  signature from the owner, so it never links the owner's real wallet.

### 3. Dead-man's-switch activation

- If an owner goes silent, then after `interval + grace period` elapses with no check-in,
  any keeper can call `report_missed(reporter, identity_commitment)`.
- Each report increments the missed counter and advances the window by one interval, so a
  single lapse is counted at most once per interval.
- When `missed >= max_missed` (default 3), the registry cross-calls
  `VaultController.activate(vault_commitment)`, authorizing as itself. The vault is now
  claimable.

### 4. Beneficiary claim

- The heir calls `claim(vault_commitment, salt, recipient)`, authorizing as `recipient`.
- The contract recomputes `SHA-256(recipient_xdr || salt)` and requires it to equal the
  stored `vault_commitment`. Because the recipient is baked into the commitment and also
  checked via `require_auth`, only the intended heir can claim — a bystander who learns
  the salt still cannot steal the funds.
- Funds transfer to the recipient; the vault is marked claimed.

---

## The ZK circuit

Circuit source: [`circuits/liveness/src/main.nr`](circuits/liveness/src/main.nr) — written
in **Noir**, compiled with **Noir 1.0.0-beta.9**.

**Public inputs** (order matters — this is the byte layout the registry parses,
`[root(32) | identity_commitment(32) | nullifier_hash(32) | epoch(32)]`):

| Input                 | Meaning                                                             |
|-----------------------|---------------------------------------------------------------------|
| `root`                | Current Merkle root of the anonymity set (must match on-chain).     |
| `identity_commitment` | The owner's public pseudonym / Merkle leaf. Binds the reset to one owner. |
| `nullifier_hash`      | `Poseidon2(nullifier, epoch)` — one-time-per-window liveness token. |
| `epoch`               | `floor(ledger_timestamp / interval)` — the current time window.     |

**Private inputs** (never leave the owner's device): `nullifier`, `secret`,
`path_siblings[20]`, `path_bits[20]`.

**Constraints enforced in-circuit:**

1. `identity_commitment == Poseidon2(nullifier, secret)` — the leaf is the owner's
   commitment, so a proof can only reset *that* owner's timer.
2. The leaf is a Merkle member of the tree with the given `root` (depth-20 membership,
   `path_bits` constrained boolean).
3. `nullifier_hash == Poseidon2(nullifier, epoch)` — epoch-bound anti-replay.

All hashing uses the noir-lang `poseidon` library (BN254 Poseidon2), which is
**byte-for-byte identical** to the on-chain `soroban-poseidon` hashing used to build the
Merkle tree. That alignment is precisely why an off-chain proof binds to the on-chain
root. (See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the three-way Poseidon2
alignment story.)

**Proof system:** UltraHonk via **Barretenberg (bb) 0.87.0**, generated with
`--oracle_hash keccak`. Proof size is **14,592 bytes**.

---

## Deployed contracts (Stellar testnet)

Everything below is **live on Stellar testnet** and deployed from
[`deployments/testnet.json`](deployments/testnet.json).

- **Network:** `testnet` — `Test SDF Network ; September 2015`
- **RPC:** `https://soroban-testnet.stellar.org`
- **Deployer (G-address):** `GCF2TS44FELZGSFXG57OY6LPMOJOUL34SCKCY6OC52X7U5G2YAZZU5F6`

| Contract          | Address (C-ID)                                             | Explorer |
|-------------------|-----------------------------------------------------------|----------|
| LivenessRegistry  | `CDQKTII66Z2BOMXOUU3WHGACAEM4XIUPLFORG5MZEKCVQSB6FMTSXGME` | [view](https://stellar.expert/explorer/testnet/contract/CDQKTII66Z2BOMXOUU3WHGACAEM4XIUPLFORG5MZEKCVQSB6FMTSXGME) |
| VaultController   | `CDQL4QEZN7QWMC3YTPNGI52IAVSXGNWAMCJD7UGHNFOOKONAI6T5WKOS` | [view](https://stellar.expert/explorer/testnet/contract/CDQL4QEZN7QWMC3YTPNGI52IAVSXGNWAMCJD7UGHNFOOKONAI6T5WKOS) |
| ObolVerifier      | `CBE4ACZCQTXTPGJVNDAEKSYZLUVJMUMUVMZCMDXSIE3EB67RTSRSKFQ6` | [view](https://stellar.expert/explorer/testnet/contract/CBE4ACZCQTXTPGJVNDAEKSYZLUVJMUMUVMZCMDXSIE3EB67RTSRSKFQ6) |
| KeeperRegistry    | `CCKEYJKGNNC475ELXZ56BT2A6WXWT3G32YG2KFDP2BLELHQ437F2LXMA` | [view](https://stellar.expert/explorer/testnet/contract/CCKEYJKGNNC475ELXZ56BT2A6WXWT3G32YG2KFDP2BLELHQ437F2LXMA) |
| MockToken (SEP-41)| `CDEARWWPX4653XD27ZVDQ7UBNNSH36RSUGVNOR3GVYTMXUD5GWCOKCCQ` | [view](https://stellar.expert/explorer/testnet/contract/CDEARWWPX4653XD27ZVDQ7UBNNSH36RSUGVNOR3GVYTMXUD5GWCOKCCQ) |

### Live proof of life, verified on-chain

A **real UltraHonk proof of life was verified on live testnet** in transaction:

**`2f4083e8b52c05fb3b6d6e278fbdabe47749d7fa16952a40b27cc7612668ae72`**

→ [view on stellar.expert](https://stellar.expert/explorer/testnet/tx/2f4083e8b52c05fb3b6d6e278fbdabe47749d7fa16952a40b27cc7612668ae72)

Both a **bb-CLI-generated proof** and a **bb.js browser-generated proof** verify against
the deployed ObolVerifier — meaning a proof produced entirely in the browser is accepted
on-chain.

---

## Repository layout

```
obol/
├── circuits/
│   └── liveness/            Noir liveness circuit (proof of life)
│       ├── src/main.nr      the circuit
│       ├── Nargo.toml       Noir package (poseidon dep)
│       └── Prover.toml      generated witness inputs
├── contracts/               Soroban workspace (Rust, soroban-sdk 26.0.1)
│   ├── obol_verifier/       on-chain UltraHonk verifier wrapper
│   ├── liveness_registry/   Merkle tree + register/checkin/report_missed (+ e2e test)
│   ├── vault_controller/    escrow + sealed beneficiary + claim
│   ├── keeper_registry/     keeper staking
│   ├── mock_token/          mint-able SEP-41 token for demos
│   ├── tools/input_gen/     off-chain Prover.toml generator (soroban-poseidon)
│   └── vendor/              vendored ultrahonk_soroban_verifier crate (MIT)
├── deployments/
│   └── testnet.json         live testnet addresses + proof tx
├── frontend/                Next.js + Freighter UI (WIP — see below)
└── scripts/                 deploy / prove helpers (WIP — see below)
```

---

## Prerequisites

- **Rust** with the `wasm32v1-none` target
  (`rustup target add wasm32v1-none`).
- **Stellar CLI** (`stellar`) for building and deploying Soroban contracts.
- **Noir 1.0.0-beta.9** via [`noirup`](https://github.com/noir-lang/noirup)
  (`noirup --version 1.0.0-beta.9`).
- **Barretenberg (bb) 0.87.0** via [`bbup`](https://github.com/AztecProtocol/aztec-packages)
  (`bbup --version 0.87.0`).
- **Node.js** (for the frontend and bb.js browser proving).

---

## Build & test

### 1. Build the circuit and generate a proof

```bash
# Generate the circuit's Prover.toml (Merkle witness + public inputs) using
# soroban-poseidon so the inputs are byte-identical to the on-chain tree.
cargo run --manifest-path contracts/tools/input_gen/Cargo.toml

cd circuits/liveness

# Compile and execute the circuit to produce the witness.
nargo compile
nargo execute

# Prove and export the verification key (keccak oracle, byte + field output).
bb prove \
  --scheme ultra_honk \
  --oracle_hash keccak \
  --output_format bytes_and_fields \
  -b ./target/obol_liveness.json \
  -w ./target/obol_liveness.gz \
  -o ./target

bb write_vk \
  --scheme ultra_honk \
  --oracle_hash keccak \
  --output_format bytes_and_fields \
  -b ./target/obol_liveness.json \
  -o ./target
```

This produces `target/proof`, `target/public_inputs`, and `target/vk`, which the
integration test embeds.

### 2. Build the contracts

```bash
cd contracts
stellar contract build      # compiles all contracts to target/wasm32v1-none
```

### 3. Run the tests

```bash
cargo test -p liveness_registry --release
```

The integration test in
[`contracts/liveness_registry/src/test.rs`](contracts/liveness_registry/src/test.rs)
verifies a **real UltraHonk proof** on-chain (in the test host) and — critically —
asserts that the **on-chain Poseidon2 Merkle root equals the root the circuit proved
against**. That single assertion is the proof that the off-chain circuit hashing and the
on-chain tree hashing are byte-identical. The test then drives the full lifecycle:
register → check-in → replay rejection → three missed reports → activation → claim, and
checks that a wrong recipient cannot claim.

---

## Frontend

A **Next.js + Freighter** frontend is planned to give owners a UI for registering,
generating browser-side proofs of life (via bb.js), and monitoring their switch.

```bash
cd frontend
npm install
npm run dev
```

> **Honest status:** the `frontend/` directory is currently a placeholder — the browser
> proving path itself is proven (a bb.js browser proof verifies on-chain, see the live
> tx above), but the UI is not yet committed to this repo. Treat the commands above as
> the intended entry point rather than a finished app.

---

## Security notes

- **Unaudited.** This is hackathon-stage software. Do not put real funds at risk.
- **Identity backup is critical.** The owner's `nullifier` and `secret` are the only way
  to prove life. If they are lost, the switch will eventually trip and the funds pass to
  the beneficiary; if they are stolen, an attacker can keep the switch alive
  indefinitely. Back them up the way you would a seed phrase.
- **Demo intervals are short.** The deployed configuration uses a 60-second minimum
  interval and a 60-second grace period so that activation can be demonstrated on live
  testnet in minutes. **Real deployments should use days or weeks.**
- **Mock token.** Demos use a mint-able mock SEP-41 token, not a real asset.
- **Verifier trust.** The ObolVerifier has no admin and no upgrade path; the VK is set
  once at deploy. Anyone can read `vk_bytes` to confirm the stored VK matches the Obol
  circuit before trusting proofs.

---

## What's mocked / work-in-progress

In the spirit of honest hackathon work, here is exactly what is real and what isn't:

**Real and working:**
- All five Soroban contracts, deployed and live on testnet.
- A real UltraHonk proof of life verified on-chain (both CLI- and browser-generated).
- The full register → check-in → activate → claim lifecycle, exercised end-to-end in the
  integration test with a real proof and an assertion that the on-chain Merkle root
  equals the circuit root.
- Epoch-nullifier anti-replay, and recipient-bound (front-run-proof) claims.

**Mocked / simplified / WIP:**
- **MockToken** stands in for a real stablecoin (mint-able, SEP-41, demo only).
- **Demo timing** (60s interval / 60s grace) is unrealistically short by design.
- **`input_gen` produces the empty-tree witness** for a single member at leaf index 0
  (the demo case) — a production prover would build the witness for the member's actual
  leaf index in a populated tree.
- **The `frontend/` and `scripts/` directories are placeholders** in this repo; the
  commands documented for them describe the intended workflow.
- **Keeper watching is manual/permissionless** — anyone can call `report_missed`; the
  KeeperRegistry provides staking and an `is_active_keeper` gate, but an automated keeper
  bot is not included.

---

## Privacy: what is and isn't hidden

- **Hidden:** the link between the owner's real wallet and their Obol arrangement
  (check-ins carry no owner signature); the beneficiary's identity (sealed until claim).
- **Not fully hidden:** an identity's check-ins are linkable *to each other* under its
  pseudonymous `identity_commitment` (the commitment is public and repeated across
  check-ins). This is an intentional, honest limitation — see
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#threat--privacy-model) for the full
  threat and privacy model.

---

## Credits

- **`ultrahonk_soroban_verifier`** — the on-chain UltraHonk verifier is vendored (MIT)
  from [rs-soroban-ultrahonk](https://github.com/yugocabrio/rs-soroban-ultrahonk). See
  [`contracts/vendor/ultrahonk-soroban-verifier/VERIFIER_PROVENANCE.md`](contracts/vendor/ultrahonk-soroban-verifier/VERIFIER_PROVENANCE.md)
  for its provenance and Barretenberg alignment.
- **Noir** — the ZK circuit language and toolchain (noir-lang).
- **Stellar / Soroban** — smart-contract platform, `soroban-sdk`, `soroban-poseidon`,
  and the Protocol 25/26 native BN254 + Poseidon2 host functions that make on-chain
  verification affordable.

---

## License

MIT.
