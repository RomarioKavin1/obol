# Obol Protocol — Frontend

The web app for Obol: a zero-knowledge dead man's switch for private crypto inheritance
on **Stellar**. Prove you're alive with a ZK proof generated in your browser; if you
stop, your vault unlocks for your sealed heir. No wallet is ever linked to your identity
on-chain.

**Live:** https://obol-two.vercel.app

Built with Next.js (App Router, TypeScript, Turbopack), Tailwind CSS,
`@stellar/stellar-sdk`, **Stellar Wallets Kit** (`@creit.tech/stellar-wallets-kit` —
Freighter, xBull, Albedo, Rabet, Hana), Noir (`@noir-lang/noir_js`) and Barretenberg
(`@aztec/bb.js`, UltraHonk).

## Getting started

```bash
npm install
npm run dev                        # http://localhost:3000
npm run build                      # production build (Turbopack)
```

No env file is required — `src/lib/config.ts` defaults to the live testnet deployment.
Every value can be overridden with `NEXT_PUBLIC_*` env vars (RPC URL, network
passphrase, contract IDs, explorer).

Use any supported wallet extension set to Stellar **Testnet** (Freighter is the easiest:
https://freighter.app). Albedo works without an extension.

## How the pieces fit

| Path | What it does |
| ---- | ------------ |
| `src/lib/prover.ts` | Browser-side proving: fetches the on-chain Merkle leaves, rebuilds the tree (Poseidon2 via bb.js), derives the witness for the local identity, and generates the 14,592-byte UltraHonk proof. |
| `src/lib/stellar.ts` | All contract reads (simulation) and writes (build → simulate → sign → send → poll) against the deployed Soroban contracts. |
| `src/lib/identity.ts` | The owner's `{nullifier, secret}` identity and vault metadata — generated locally, stored in `localStorage`, downloadable as a backup. |
| `src/lib/wallet.tsx` | Stellar Wallets Kit integration behind a small `useWallet()` context. |
| `src/lib/config.ts` | Network + contract configuration (env-overridable, testnet defaults). |
| `src/app/setup` | 4-step wizard: generate identity → pick interval → seal beneficiary → deposit. |
| `src/app/dashboard` | Vault status, check-in countdown, missed counter, keeper reporting. |
| `src/app/checkin` | Generate + submit the ZK proof of life. |
| `src/app/claim` | The heir reveals the salt and claims an activated vault. |
| `scripts/e2e-checkin.mjs` | Headless end-to-end: registers two identities on live testnet and verifies a proof for the second leaf on-chain. |

## Deployed contracts (Stellar testnet)

Defaults live in `src/lib/config.ts`; the canonical record is
[`../deployments/testnet.json`](../deployments/testnet.json).

| Contract          | ID |
| ----------------- | -- |
| LivenessRegistry  | `CD2NYC2U3OKZ5Z355H3UXE3MVUWCROWRFEH4UQ6NGIPCYYGDS3VDWSLC` |
| VaultController   | `CAZST5N37ZYKNXYCUIQ4AKV553TSXTQWPURDRTAX3OFRQMNBEP3PI4IE` |
| ObolVerifier      | `CBE4ACZCQTXTPGJVNDAEKSYZLUVJMUMUVMZCMDXSIE3EB67RTSRSKFQ6` |
| KeeperRegistry    | `CCKEYJKGNNC475ELXZ56BT2A6WXWT3G32YG2KFDP2BLELHQ437F2LXMA` |
| MockToken         | `CDEARWWPX4653XD27ZVDQ7UBNNSH36RSUGVNOR3GVYTMXUD5GWCOKCCQ` |

## Bundler notes (important)

`@aztec/bb.js` must be imported **dynamically** (see `prover.ts`) — a static top-level
import evaluates its browser bundle at module load and crashes under the bundler. The
project uses **Turbopack** (`next.config.ts` sets `turbopack: {}` and
`serverExternalPackages` for `@aztec/bb.js` / `@noir-lang/noir_js`); webpack cannot
bundle bb.js 0.87. The compiled circuit ACIR is served from
`public/circuits/liveness.json`.
