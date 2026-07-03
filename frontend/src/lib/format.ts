/**
 * Small formatting / byte helpers shared across the app.
 *
 * The byte helpers encode values as 32-byte big-endian arrays — the exact
 * layout Soroban `BytesN<32>` args and the circuit's BN254 field elements use —
 * so hex/bigint round-trips stay aligned with what the contracts hash and parse.
 * Token amount helpers assume Stellar's 7-decimal convention by default.
 */

/** Shorten a Stellar address for display: GABC…WXYZ */
export function shortenAddress(addr: string, chars = 4): string {
  if (!addr) return "";
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars + 1)}…${addr.slice(-chars)}`;
}

/** Basic Stellar public-key (G...) validity check. */
export function isValidStellarAddress(addr: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(addr.trim());
}

/** Uint8Array (or Buffer-like) -> 0x hex string. */
export function bytesToHex(bytes: Uint8Array | number[] | null | undefined): string {
  if (!bytes) return "";
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  let hex = "0x";
  for (const b of arr) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** bigint -> 32-byte big-endian Uint8Array. */
export function bigintToBytes32(n: bigint): Uint8Array {
  const hex = n.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** 0x hex or bytes -> 32-byte Uint8Array (zero-padded / left-truncated to 32). */
export function hexToBytes32(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/, "").padStart(64, "0").slice(-64);
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Human-readable remaining time until a unix (seconds) deadline. */
export function formatTimeRemaining(deadlineSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  let diff = deadlineSeconds - now;
  if (diff <= 0) return "Overdue";
  const days = Math.floor(diff / 86400);
  diff -= days * 86400;
  const hours = Math.floor(diff / 3600);
  diff -= hours * 3600;
  const mins = Math.floor(diff / 60);
  const secs = diff - mins * 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

/** Format a raw i128 token amount (7 decimals, Stellar convention) to a string. */
export function formatTokenAmount(raw: bigint, decimals = 7): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  const s = fracStr ? `${whole}.${fracStr}` : `${whole}`;
  return neg ? `-${s}` : s;
}

/** Parse a decimal token string into a raw i128 bigint (7 decimals). */
export function parseTokenAmount(value: string, decimals = 7): bigint {
  const [whole, frac = ""] = value.trim().split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const base = 10n ** BigInt(decimals);
  return BigInt(whole || "0") * base + BigInt(fracPadded || "0");
}
