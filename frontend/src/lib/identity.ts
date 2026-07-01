/**
 * Owner identity storage for Obol Protocol.
 *
 * An Obol identity is the owner's ONLY key:
 *   - nullifier: random 248-bit field element (mod BN254 prime)
 *   - secret:    random 248-bit field element (mod BN254 prime)
 *   - commitment = Poseidon2(nullifier, secret)  (identity_commitment)
 *
 * The {nullifier, secret} pair is the only thing that lets the owner prove
 * liveness. It is stored in localStorage AND offered as a downloadable JSON
 * backup. If it is lost, the owner can no longer check in and the vault will
 * activate. This module only handles persistence — hashing lives in prover.ts.
 */

export interface Identity {
  nullifier: bigint;
  secret: bigint;
  commitment: bigint;
}

interface StoredIdentity {
  nullifier: string; // 0x hex
  secret: string; // 0x hex
  commitment: string; // 0x hex
  createdAt: number;
}

const STORAGE_KEY = "obol_identity";
const VAULT_KEY = "obol_vault";

function toHex(n: bigint): string {
  return "0x" + n.toString(16).padStart(64, "0");
}

function serialize(id: Identity): StoredIdentity {
  return {
    nullifier: toHex(id.nullifier),
    secret: toHex(id.secret),
    commitment: toHex(id.commitment),
    createdAt: Date.now(),
  };
}

function deserialize(s: StoredIdentity): Identity {
  return {
    nullifier: BigInt(s.nullifier),
    secret: BigInt(s.secret),
    commitment: BigInt(s.commitment),
  };
}

export function storeIdentity(id: Identity): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize(id)));
}

export function loadIdentity(): Identity | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return deserialize(JSON.parse(raw) as StoredIdentity);
  } catch {
    return null;
  }
}

export function clearIdentity(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/** Trigger a download of the identity backup JSON — the owner's only key. */
export function exportIdentityBackup(id: Identity): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([JSON.stringify(serialize(id), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `obol-identity-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importIdentityBackup(json: string): Identity {
  const s = JSON.parse(json) as StoredIdentity;
  if (!s.nullifier || !s.secret || !s.commitment) {
    throw new Error("Invalid identity backup: missing fields");
  }
  return deserialize(s);
}

// ---------------------------------------------------------------------------
// Vault info (owner side) — vault_commitment + salt shared with the beneficiary.
// ---------------------------------------------------------------------------

export interface StoredVault {
  vaultCommitment: string; // 0x hex
  salt: string; // 0x hex
  beneficiary: string; // G... address
  intervalSeconds: number;
  createdAt: number;
}

export function storeVault(v: StoredVault): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(VAULT_KEY, JSON.stringify(v));
}

export function loadVault(): StoredVault | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(VAULT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredVault;
  } catch {
    return null;
  }
}
