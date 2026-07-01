# Obol Protocol — Frontend

A zero-knowledge dead man's switch for private crypto inheritance on **Stellar**.
Prove you're alive with a ZK proof; if you stop, your vault unlocks for your heir.
No wallet is ever linked to your identity on-chain.

Built with Next.js (App Router, TypeScript), Tailwind CSS, `@stellar/stellar-sdk`,
`@stellar/freighter-api`, Noir (`@noir-lang/noir_js`) and Barretenberg
(`@aztec/bb.js`, UltraHonk).

## Getting started

```bash
cp .env.local.example .env.local   # defaults already point at the live testnet deployment
npm install
npm run dev                        # http://localhost:3000
npm run build                      # production build (webpack, WASM enabled)
```

Requires the **Freighter** browser extension (https://freighter.app) set to
Stellar **Testnet**.

## Deployed contracts (Stellar testnet)

| Contract          | ID |
| ----------------- | -- |
| LivenessRegistry  | `CDSMMPU77EIIIIZ3PIJY3PETY3X2SWTBTB6O6YRWPP3RPH3MSCG2G4IH` |
| VaultController   | `CB4W6QDK32ZDZROBZLQ352DSAHJ5OB6XCSAS677XZQ3HWKKD2G2VTIT5` |
| ObolVerifier      | `CA7KNXIBWGKIMEZJGEH6H5TEVOHOZPZWIFOGFRZIRJ6XJHFVAM6KPKDT` |
| KeeperRegistry    | `CCEJ5772P5CTWFNGELCI3EINXTW245KEG3O6WWEFLEMLM552ZRFMX42V` |
| MockToken (SEP-41)| `CDDWLELHOB6HKM4CWYS4MYOQJJKMMXPW3I7ULLJF2QWL3FRCJWAEGYUO` |

RPC: `https://soroban-testnet.stellar.org` · Passphrase:
`Test SDF Network ; September 2015` · Explorer:
`https://stellar.expert/explorer/testnet`

## Flows

- **/setup** — owner connects Freighter, generates an identity (nullifier + secret,
  with downloadable backup), enters a beneficiary Stellar address, derives the vault
  commitment via `derive_commitment(recipient, salt)`, `register(...)`s and then
  `deposit(...)`s MockToken. You receive the `vault_commitment` + `salt` to hand to
  the heir.
- **/checkin** — owner generates a Noir/UltraHonk liveness proof in-browser and calls
  `checkin(public_inputs, proof_bytes)`.
- **/claim** — beneficiary connects Freighter, enters the salt (recipient auto-filled),
  the vault commitment is re-derived on-chain, and if `is_activated` they `claim(...)`.
- **/dashboard** — group root, member count, this identity's status (last check-in,
  missed / max, activated?), plus a keeper staking widget
  (`stake` / `unstake` / `get_stake` / `is_active_keeper`).

## Proof generation

`src/lib/prover.ts` replicates the verified recipe exactly:

1. Poseidon2 (BN254, via Barretenberg) — `identity_commitment = H(nullifier, secret)`.
2. Empty-tree Merkle witness, single member at index 0 (the on-chain registry
   recomputes the identical root for a single owner).
3. `nullifier_hash = H(nullifier, epoch)`, `epoch = floor(ledgerTime / interval)`.
4. Noir witness (`@noir-lang/noir_js`) executed against `public/circuits/liveness.json`.
5. UltraHonk proof with `{ keccak: true }` — exactly **14592** proof bytes.
6. `public_inputs` = 32-byte big-endian concat of `[root, identity_commitment,
   nullifier_hash, epoch]` = **128 bytes**.

Both byte arrays are submitted as Soroban `Bytes` to `checkin`.

The `{ nullifier, secret }` pair is the owner's **only** key. It is stored in
localStorage and offered as a JSON backup on setup — losing it means the vault will
eventually activate.

## Funding a demo account with MockToken

`MockToken.mint(to, amount)` is restricted to the contract deployer. To fund a test
account, run (with the deployer secret key configured in your Stellar CLI):

```bash
stellar contract invoke --network testnet \
  --id CDDWLELHOB6HKM4CWYS4MYOQJJKMMXPW3I7ULLJF2QWL3FRCJWAEGYUO \
  --source <deployer> -- mint --to <G...address> --amount 1000000000
```

No secrets are hardcoded in the app.

## Notes / caveats

- Wallet signing (Freighter) cannot be exercised headlessly; those paths are
  implemented per the contract interface and must be verified in-browser.
- `encrypted_beneficiary` is a demo placeholder (the beneficiary address bytes), not
  real encryption — see the comment in `VaultSetup.tsx`.
- Epoch uses the latest Horizon ledger close time, falling back to the local clock.
