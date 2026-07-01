/**
 * Central config for Obol Protocol frontend.
 *
 * All values are read from NEXT_PUBLIC_* env vars (see .env.local.example) with
 * fallbacks to the live Stellar testnet deployment so the app runs out of the box.
 */

export const RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";

export const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
  "Test SDF Network ; September 2015";

export const NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "TESTNET";

export const EXPLORER =
  process.env.NEXT_PUBLIC_STELLAR_EXPLORER ??
  "https://stellar.expert/explorer/testnet";

export const HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ??
  "https://horizon-testnet.stellar.org";

/**
 * A funded account used purely as the source for read-only simulations.
 * Simulation of view calls does not touch this account's balance or sequence.
 */
export const READ_SOURCE =
  process.env.NEXT_PUBLIC_STELLAR_READ_SOURCE ??
  "GCF2TS44FELZGSFXG57OY6LPMOJOUL34SCKCY6OC52X7U5G2YAZZU5F6";

export const CONTRACTS = {
  livenessRegistry:
    process.env.NEXT_PUBLIC_LIVENESS_REGISTRY_ID ??
    "CDQKTII66Z2BOMXOUU3WHGACAEM4XIUPLFORG5MZEKCVQSB6FMTSXGME",
  vaultController:
    process.env.NEXT_PUBLIC_VAULT_CONTROLLER_ID ??
    "CDQL4QEZN7QWMC3YTPNGI52IAVSXGNWAMCJD7UGHNFOOKONAI6T5WKOS",
  obolVerifier:
    process.env.NEXT_PUBLIC_OBOL_VERIFIER_ID ??
    "CBE4ACZCQTXTPGJVNDAEKSYZLUVJMUMUVMZCMDXSIE3EB67RTSRSKFQ6",
  keeperRegistry:
    process.env.NEXT_PUBLIC_KEEPER_REGISTRY_ID ??
    "CCKEYJKGNNC475ELXZ56BT2A6WXWT3G32YG2KFDP2BLELHQ437F2LXMA",
  mockToken:
    process.env.NEXT_PUBLIC_MOCK_TOKEN_ID ??
    "CDEARWWPX4653XD27ZVDQ7UBNNSH36RSUGVNOR3GVYTMXUD5GWCOKCCQ",
} as const;

/** Explorer URL for a transaction hash. */
export function txUrl(hash: string): string {
  return `${EXPLORER}/tx/${hash}`;
}

/** Explorer URL for a contract id. */
export function contractUrl(id: string): string {
  return `${EXPLORER}/contract/${id}`;
}
