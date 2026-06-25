# Obol Protocol — Architecture

This document is the deep dive behind the [README](../README.md). It covers the
three-way Poseidon2 alignment that makes off-chain proofs bind to on-chain state, the
full proof lifecycle, the storage model, cross-contract authorization for activation,
the epoch/nullifier anti-replay design, and an honest threat and privacy model.

---

## 1. The three-way Poseidon2 alignment

Obol's whole security argument rests on one fact: **the same hash function is used in
three places, byte-for-byte.** If the hashes diverged by a single bit, an off-chain
proof would compute a different Merkle root than the chain, and no valid check-in could
ever match `stored_root`.

The three places:

| Where                                    | What it hashes                                       | Implementation                                   |
|------------------------------------------|------------------------------------------------------|--------------------------------------------------|
| **Circuit** (`circuits/liveness/src/main.nr`) | leaf commitment, Merkle path, epoch nullifier    | noir-lang `poseidon` lib, `Poseidon2::hash([a,b], 2)` over BN254 |
| **On-chain tree** (`liveness_registry`)  | the incremental (frontier) Merkle tree + root        | `soroban-poseidon` `poseidon2_hash::<4, BnScalar>` (native host) |
| **Off-chain input generator** (`tools/input_gen`) | the Merkle witness + public inputs written to `Prover.toml` | `soroban-poseidon` (same crate as on-chain) |

All three implement the **same 2-to-1 BN254 Poseidon2 compression**. The registry and
the input generator literally call the same `soroban-poseidon` primitive; the circuit
uses the noir-lang Poseidon2, which is specified to produce identical field outputs.
Inputs are reduced `mod` the BN254 scalar field modulus before hashing in both Rust
paths, matching the circuit's field arithmetic.

**Why it matters, and how it's proven.** The integration test in
`contracts/liveness_registry/src/test.rs` registers the circuit's `identity_commitment`
into the on-chain tree and then asserts:

```rust
assert_eq!(w.registry.get_root().unwrap(), root, "on-chain root != circuit root");
```

where `root` is read straight out of the circuit's `public_inputs`. If the two Poseidon2
implementations disagreed, this assertion would fail. Because it passes, an off-chain
proof generated against a locally-computed root is guaranteed to verify against the live
on-chain root.

### Merkle construction details

- **Depth 20**, so up to `2^20` (~1,048,576) members.
- **Incremental frontier tree.** Rather than storing the whole tree, the registry keeps
  one "frontier" node per level (`DataKey::Frontier(level)`) plus precomputed zero-subtree
  hashes: `zero[0] = 0`, `zero[i+1] = H(zero[i], zero[i])`. Inserting a leaf walks from
  level 0 to the root: at each level the leaf's index bit decides whether the current node
  is a left child (store it, pair with the level's zero hash) or a right child (combine
  with the saved left sibling). The new root is written to `DataKey::Root`.
- The circuit mirrors this exactly in `compute_root`: `path_bits[i] == 0` means the
  current node is the left child (`hash2(cur, sib)`), `1` means right (`hash2(sib, cur)`).
  Each bit is constrained boolean.

---

## 2. Proof lifecycle, end to end

```
OWNER DEVICE                          OFF-CHAIN                         ON-CHAIN
────────────                          ─────────                        ────────
nullifier, secret  (kept secret)
        │
        ├─ id_commitment = P2(nullifier, secret)  ──── register() ───►  insert leaf,
        │                                                               Root updated
        │
   each interval:
        ├─ epoch = floor(now / interval)
        ├─ nullifier_hash = P2(nullifier, epoch)
        ├─ build Merkle witness (input_gen → Prover.toml)
        ├─ nargo execute  → witness
        ├─ bb prove       → proof (14,592 bytes) + public_inputs
        │
        └───────────────── checkin(public_inputs, proof) ───────────►  LivenessRegistry
                                                                          │
                                                          checks (in order):
                                                          1. proof length == PROOF_BYTES
                                                          2. parse 128-byte public inputs
                                                          3. identity is Registered
                                                          4. root == stored Root
                                                          5. epoch == now / interval
                                                          6. nullifier_hash unused
                                                          7. verify_proof() ──► ObolVerifier
                                                                          │        (UltraHonk)
                                                          effects:        ◄────────┘
                                                          - mark nullifier used
                                                          - last_checkin = now
                                                          - missed = 0
```

**Public input byte layout (128 bytes).** The registry parses `public_inputs` as four
32-byte big-endian field elements, in exactly this order:

```
[ root (32) | identity_commitment (32) | nullifier_hash (32) | epoch (32) ]
```

This is the same order the circuit declares its `pub` inputs (`root`,
`identity_commitment`, `nullifier_hash`, `epoch`) and the same order `bb` serializes
them. The `epoch` field element is interpreted as a `u64` from its low 8 bytes.

**Verification.** `LivenessRegistry.checkin` does not verify the SNARK itself; it
cross-calls `ObolVerifier.verify_proof(public_inputs, proof_bytes)` via
`try_invoke_contract`, mapping any failure to `Error::VerificationFailed`. The
ObolVerifier is a thin wrapper over the vendored `ultrahonk_soroban_verifier` crate: it
loads the immutable VK stored at deploy time and calls `verifier.verify(...)`. The proof
is UltraHonk (Barretenberg 0.87.0, `oracle_hash=keccak`), 14,592 bytes.

**Ordering matters for safety.** The registry runs all cheap checks (registration, root,
epoch, nullifier) *before* the expensive proof verification, and applies effects
(consuming the nullifier, resetting the timer) only *after* verification succeeds —
checks-effects-interactions.

---

## 3. Storage model

All contracts use **instance storage** with periodic TTL bumps
(`extend_ttl(100_000, 1_000_000)`) to keep demo state alive.

### LivenessRegistry (`DataKey`)

| Key                          | Type       | Purpose                                            |
|------------------------------|------------|----------------------------------------------------|
| `Verifier`                   | Address    | ObolVerifier contract (set at construct).          |
| `Vault`                      | Address    | VaultController (wired once, post-deploy).          |
| `Owner`                      | Address    | Admin: may wire vault, tune `max_missed`.          |
| `Root`                       | BytesN<32> | Current Merkle root.                                |
| `NextIndex`                  | u32        | Next free leaf index (also the member count).       |
| `MaxMissed`                  | u32        | Activation threshold (default 3).                   |
| `Frontier(level)`            | BytesN<32> | Frontier node per Merkle level (incremental tree).  |
| `Committed(id)` / `Registered(id)` | bool | Membership / registration flags per identity.       |
| `Nullifier(hash)`            | bool       | Spent epoch nullifiers (anti-replay).               |
| `VaultOf(id)`                | BytesN<32> | The vault commitment linked to an identity.         |
| `Interval(id)`               | u64        | Check-in cadence (seconds) per identity.            |
| `LastCheckin(id)`            | u64        | Timestamp of last successful check-in.              |
| `Missed(id)`                 | u32        | Consecutive missed intervals reported.              |

### VaultController (`DataKey`)

| Key                    | Type       | Purpose                                          |
|------------------------|------------|--------------------------------------------------|
| `Owner`                | Address    | Admin (wires the registry).                      |
| `Registry`             | Address    | The only caller allowed to `activate`.           |
| `FeeBps` / `FeeCollector` | u32 / Address | Optional deposit fee (0 in demos).           |
| `Token(vc)`            | Address    | SEP-41 token escrowed for a vault.               |
| `Amount(vc)`           | i128       | Net escrowed amount (zeroed on claim).           |
| `Exists/Activated/Claimed(vc)` | bool | Vault state machine flags.                       |
| `Beneficiary(vc)`      | Bytes      | Opaque encrypted blob (never interpreted on-chain). |

Vaults are keyed entirely by `vault_commitment` — the contract stores no plaintext
beneficiary address until a claim reveals it.

### KeeperRegistry

Tracks `Token`, `MinStake`, `TotalStaked`, and per-keeper `Stake(address)`.
`is_active_keeper` returns true only when a keeper's stake meets a positive minimum.

---

## 4. Cross-contract authorization for activation

The activation path is the one place two contracts must trust each other. The design
avoids any shared secret and instead uses Soroban's authorization framework.

```
report_missed(reporter, id)          [LivenessRegistry]
  reporter.require_auth()             ← the keeper authorizes the report
  ...
  if missed >= max_missed:
      activate_vault(vault, vc)
        env.invoke_contract(vault, "activate", [vc])   ← registry calls the vault
                                                          AS ITSELF

activate(vc)                          [VaultController]
  registry.require_auth()             ← requires the *registry contract's* auth
```

- The keeper's authority only lets them *report* a missed interval; it does not let them
  touch funds.
- `VaultController.activate` calls `registry.require_auth()`, where `registry` is the
  address wired via `set_registry`. Because the registry invokes the vault as itself
  (`env.invoke_contract` from within the registry), the contract-to-contract auth is
  satisfied automatically and *only* when the call genuinely originates from the wired
  registry. No other caller can activate a vault.
- The two contracts are wired to each other post-deploy (`set_vault_controller` on the
  registry, `set_registry` on the vault), each guarded to be owner-only and one-time.
  This breaks the circular deploy dependency (each needs the other's address).

**Claim authorization** is independent of activation: `claim` requires
`recipient.require_auth()` *and* that `SHA-256(recipient_xdr || salt) == vault_commitment`.
Even after activation, only the address baked into the commitment can withdraw.

---

## 5. Epoch / nullifier anti-replay

Liveness must be *fresh*: an owner should not be able to bank one proof and replay it
forever, and should not be able to spam multiple resets in a single window. Obol enforces
this at two layers.

**In the circuit:** `nullifier_hash == Poseidon2(nullifier, epoch)`. The nullifier hash
is deterministically bound to both the owner's secret nullifier and the epoch. For a
given identity, each epoch yields exactly one valid `nullifier_hash`, and the owner cannot
forge one for an epoch without knowing the nullifier.

**On-chain:** the registry independently enforces two things `checkin`:

1. **Epoch currency** — `epoch_to_u64(epoch) == now / interval`. A proof for a past or
   future window is rejected, so an old proof cannot be replayed in a later window.
2. **One-shot nullifier** — `DataKey::Nullifier(nullifier_hash)` is checked before
   verification and set after. A second check-in with the same `nullifier_hash` (i.e. the
   same identity in the same epoch) fails with `NullifierUsed`.

Together these guarantee: **one liveness token per identity per time window, no replay.**
The integration test confirms it — the same proof submitted twice is rejected on the
second attempt.

### `report_missed` windowing

`report_missed` requires `now >= last_checkin + interval + GRACE_PERIOD`. On each report
it advances `last_checkin` by exactly one `interval`, so one prolonged silence is counted
once per interval rather than all at once. When `missed` reaches `max_missed`, activation
fires. This makes the switch's timing predictable and prevents a keeper from racking up
the whole missed count in a single call.

---

## 6. Threat & privacy model

Being honest about what Obol does and does not protect.

### What IS hidden

- **Owner wallet unlinkability.** A check-in is a ZK proof submitted from *any* address
  (or a relayer). It carries no signature from the owner's real wallet and reveals only
  the pseudonymous `identity_commitment`. On-chain, nothing links the owner's funding
  wallet to their Obol arrangement. The anonymity set is every registered member of the
  depth-20 tree.
- **Sealed beneficiary.** Until the moment of claim, the heir's address exists on-chain
  only inside `vault_commitment = SHA-256(recipient_xdr || salt)`. Given a strong random
  salt, the commitment is a hiding commitment — observers cannot determine the heir.
- **Front-run resistance.** Because the recipient is bound into the commitment *and*
  re-checked via `require_auth`, an attacker who observes the `salt` at claim time still
  cannot redirect the funds — the commitment would not match their address.

### What is NOT hidden (honest limitations)

- **Per-identity check-ins are linkable to a pseudonym.** The `identity_commitment` is
  public and is repeated in every check-in event for that identity. So an observer can
  see *"pseudonym X checked in at these times"* and build a liveness timeline for X. They
  cannot tie X to a real wallet, but the check-ins of a single identity are linkable to
  each other. Obol provides *wallet unlinkability*, not *unlinkable check-ins*.
- **Metadata.** Vault existence, deposit amounts, activation, and claims are all public
  Soroban events/state (the amounts and token are visible; only the parties are
  pseudonymous/sealed). Timing analysis of registration, deposits, and the eventual claim
  could correlate participants for a determined observer.
- **Anonymity-set size.** Privacy of membership is only as strong as the number of
  members in the tree. In an empty or tiny tree, membership is not meaningfully hiding.

### Key-management risks

- The owner's `nullifier` and `secret` are the sole liveness credential. **Lose them →**
  the switch eventually trips and funds pass to the heir (arguably the intended failure
  mode, but irreversible). **Leak them →** an attacker can keep the switch alive
  indefinitely, indefinitely delaying inheritance. Treat them like a seed phrase.
- The heir needs the `salt` (and to know they are a beneficiary). Obol stores an opaque
  `encrypted_beneficiary` blob to help deliver this off-band, but delivery itself is out
  of scope — a lost salt with a lost owner means unclaimable funds.

### Trust assumptions

- **ObolVerifier is immutable and adminless.** The VK is fixed at deploy; anyone can read
  `vk_bytes` to confirm it matches the Obol circuit. There is no upgrade path and no
  privileged prover.
- **Vendored verifier correctness.** On-chain verification is only as sound as the
  vendored `ultrahonk_soroban_verifier`. Its provenance and byte-level alignment to
  Barretenberg are documented in
  [`contracts/vendor/ultrahonk-soroban-verifier/VERIFIER_PROVENANCE.md`](../contracts/vendor/ultrahonk-soroban-verifier/VERIFIER_PROVENANCE.md).
  Obol is unaudited overall.
- **Registry owner.** The registry `Owner` can tune `max_missed` and performs one-time
  wiring. It cannot forge check-ins, move funds, or claim on the heir's behalf.
- **Keepers are permissionless.** Anyone may call `report_missed`; the KeeperRegistry's
  staking is an incentive/spam-deterrence layer (`is_active_keeper`), not a hard gate on
  who may report. Liveness of the switch relies on *someone* eventually reporting — a
  standard "someone will poke it" assumption, aided by staked keepers.

---

## 7. Component reference

| Contract          | Responsibility                                                        |
|-------------------|-----------------------------------------------------------------------|
| `liveness_registry` | Anonymity-set Merkle tree, register/checkin/report_missed, epoch nullifiers, activation trigger. |
| `obol_verifier`   | Immutable-VK UltraHonk proof verification (wraps the vendored crate). |
| `vault_controller`| Escrow, sealed beneficiary, activation gate, recipient-bound claim.   |
| `keeper_registry` | Keeper staking and active-keeper gating.                              |
| `mock_token`      | Mint-able SEP-41 token for self-contained demos/tests.                |
| `tools/input_gen` | Off-chain witness + public-input generator (soroban-poseidon).        |
| `circuits/liveness` | The Noir proof-of-life circuit.                                     |

For build, test, and deployment specifics, see the [README](../README.md).
