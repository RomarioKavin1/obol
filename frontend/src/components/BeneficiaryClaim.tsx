"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Inbox, Search, CheckCircle, XCircle, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@/lib/wallet";
import {
  deriveVaultCommitment,
  vaultExists,
  isActivated,
  isClaimed,
  getVaultAmount,
  claimVault,
} from "@/lib/stellar";
import { loadVault } from "@/lib/identity";
import { bytesToHex, formatTokenAmount, isValidStellarAddress } from "@/lib/format";
import { txUrl } from "@/lib/config";

type ClaimState =
  | "search"
  | "checking"
  | "not_found"
  | "not_activated"
  | "activated"
  | "claiming"
  | "claimed"
  | "already_claimed";

function saltToBytes(salt: string): Uint8Array {
  const clean = salt.trim().replace(/^0x/, "");
  if (clean.length !== 64) throw new Error("Salt must be 32 bytes (64 hex chars).");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function BeneficiaryClaim() {
  const { address } = useWallet();

  const [state, setState] = useState<ClaimState>("search");
  const [salt, setSalt] = useState("");
  const [recipient, setRecipient] = useState("");
  const [vaultCommitment, setVaultCommitment] = useState<Uint8Array | null>(null);
  const [amount, setAmount] = useState<bigint>(0n);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Recipient auto-fills from the connected wallet.
  useEffect(() => {
    if (address) setRecipient(address);
  }, [address]);

  // Demo convenience: if this browser created a vault, pre-fill the salt.
  useEffect(() => {
    const v = loadVault();
    if (v?.salt && !salt) setSalt(v.salt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLookup = async () => {
    if (!isValidStellarAddress(recipient)) {
      toast.error("Connect a wallet; a valid recipient address is required.");
      return;
    }
    let saltBytes: Uint8Array;
    try {
      saltBytes = saltToBytes(salt);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid salt.");
      return;
    }

    setState("checking");
    try {
      const commitment = await deriveVaultCommitment(recipient, saltBytes);
      setVaultCommitment(commitment);

      const exists = await vaultExists(commitment);
      if (!exists) {
        setState("not_found");
        return;
      }
      const [claimed, activated, amt] = await Promise.all([
        isClaimed(commitment),
        isActivated(commitment),
        getVaultAmount(commitment).catch(() => 0n),
      ]);
      setAmount(amt);
      if (claimed) setState("already_claimed");
      else if (activated) setState("activated");
      else setState("not_activated");
    } catch (err) {
      console.error(err);
      setState("not_found");
      toast.error("Lookup failed. Check the salt and that your wallet matches the heir.");
    }
  };

  const handleClaim = async () => {
    if (!address || !vaultCommitment) return;
    let saltBytes: Uint8Array;
    try {
      saltBytes = saltToBytes(salt);
    } catch {
      return;
    }
    setState("claiming");
    try {
      const res = await claimVault(address, vaultCommitment, saltBytes, recipient);
      setTxHash(res.hash);
      setState("claimed");
      toast.success("Vault claimed successfully!");
    } catch (err: unknown) {
      setState("activated");
      const msg = err instanceof Error ? err.message : "Transaction failed";
      toast.error(`Claim failed: ${msg}`);
      console.error(err);
    }
  };

  const reset = () => {
    setState("search");
    setVaultCommitment(null);
    setTxHash(null);
  };

  return (
    <div className="max-w-lg mx-auto">
      <div
        className="p-8 rounded-none"
        style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
      >
        <div className="flex items-center gap-3 mb-6">
          <Inbox className="w-8 h-8" style={{ color: "var(--secondary)" }} />
          <div>
            <h2 className="text-xl font-bold">Claim Vault</h2>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              Claim an activated vault as the beneficiary
            </p>
          </div>
        </div>

        {(state === "search" || state === "not_found") && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="mb-4">
              <label className="text-sm font-medium mb-2 block">Recipient (your wallet)</label>
              <input
                type="text"
                readOnly
                value={recipient}
                placeholder="Connect a wallet"
                className="w-full px-4 py-3 rounded-none text-sm font-mono opacity-80"
                style={{
                  background: "var(--background)",
                  border: "1px solid var(--card-border)",
                  color: "var(--foreground)",
                  outline: "none",
                }}
              />
            </div>

            <div className="mb-4">
              <label className="text-sm font-medium mb-2 block">Claim Salt (0x, 32 bytes)</label>
              <input
                type="text"
                placeholder="0x… secret salt shared by the vault creator"
                value={salt}
                onChange={(e) => setSalt(e.target.value)}
                className="w-full px-4 py-3 rounded-none text-sm font-mono"
                style={{
                  background: "var(--background)",
                  border: `1px solid ${state === "not_found" ? "var(--destructive)" : "var(--card-border)"}`,
                  color: "var(--foreground)",
                  outline: "none",
                }}
              />
              <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
                The vault commitment is derived on-chain from (your address, salt).
              </p>
            </div>

            {state === "not_found" && (
              <div
                className="flex items-center gap-2 p-3 rounded-none mb-4"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}
              >
                <XCircle className="w-4 h-4 flex-shrink-0" style={{ color: "var(--destructive)" }} />
                <p className="text-sm" style={{ color: "var(--destructive)" }}>
                  No vault found for this address + salt.
                </p>
              </div>
            )}

            <button
              onClick={handleLookup}
              disabled={!address}
              className="w-full py-3 rounded-none font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-40"
              style={{ background: "var(--secondary)", color: "var(--background)" }}
            >
              <Search className="w-4 h-4" />
              {address ? "Look Up Vault" : "Connect a Wallet First"}
            </button>
          </motion.div>
        )}

        {state === "checking" && (
          <div className="flex flex-col items-center py-10 gap-4">
            <Loader2 className="w-10 h-10 animate-spin" style={{ color: "var(--secondary)" }} />
            <p style={{ color: "var(--muted-foreground)" }}>Checking vault status...</p>
          </div>
        )}

        {state === "not_activated" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div
              className="flex items-start gap-3 p-4 rounded-none mb-6"
              style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)" }}
            >
              <XCircle className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: "var(--accent)" }} />
              <div>
                <p className="font-semibold" style={{ color: "var(--accent)" }}>
                  Vault Not Yet Activated
                </p>
                <p className="text-sm mt-1" style={{ color: "var(--muted-foreground)" }}>
                  The owner is still checking in. The vault activates after the maximum
                  number of consecutive missed check-ins.
                </p>
              </div>
            </div>
            <button
              onClick={reset}
              className="w-full py-3 rounded-none font-medium transition-all hover:opacity-80"
              style={{ background: "var(--card-border)" }}
            >
              Search Again
            </button>
          </motion.div>
        )}

        {state === "already_claimed" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div
              className="flex items-start gap-3 p-4 rounded-none mb-6"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--card-border)" }}
            >
              <CheckCircle className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: "var(--muted-foreground)" }} />
              <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                This vault has already been claimed.
              </p>
            </div>
            <button
              onClick={reset}
              className="w-full py-3 rounded-none font-medium transition-all hover:opacity-80"
              style={{ background: "var(--card-border)" }}
            >
              Search Again
            </button>
          </motion.div>
        )}

        {state === "activated" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div
              className="flex items-start gap-3 p-4 rounded-none mb-6"
              style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)" }}
            >
              <CheckCircle className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: "var(--success)" }} />
              <div>
                <p className="font-semibold" style={{ color: "var(--success)" }}>
                  Vault Activated. Ready to Claim
                </p>
                <p className="text-sm mt-1" style={{ color: "var(--muted-foreground)" }}>
                  The owner missed their check-in threshold. Claim the funds to your
                  connected address.
                </p>
              </div>
            </div>

            <div
              className="p-4 rounded-none mb-6"
              style={{ background: "var(--background)", border: "1px solid var(--card-border)" }}
            >
              <p className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>
                Vault Amount
              </p>
              <p className="text-2xl font-black">{formatTokenAmount(amount)} MockToken</p>
              {vaultCommitment && (
                <p className="text-xs font-mono break-all mt-2 opacity-60">
                  {bytesToHex(vaultCommitment)}
                </p>
              )}
            </div>

            <button
              onClick={handleClaim}
              disabled={!address}
              className="w-full py-4 rounded-none font-bold text-background flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-40"
              style={{ background: "var(--success)" }}
            >
              Claim Vault Funds
              <ArrowRight className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {state === "claiming" && (
          <div className="flex flex-col items-center py-10 gap-4">
            <Loader2 className="w-10 h-10 animate-spin" style={{ color: "var(--success)" }} />
            <p style={{ color: "var(--muted-foreground)" }}>Submitting claim to Stellar...</p>
          </div>
        )}

        {state === "claimed" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-8"
          >
            <CheckCircle className="w-16 h-16 mx-auto mb-4" style={{ color: "var(--success)" }} />
            <h3 className="text-2xl font-bold mb-2">Claim Successful!</h3>
            <p className="mb-6" style={{ color: "var(--muted-foreground)" }}>
              The vault funds have been transferred to {recipient.slice(0, 6)}…
              {recipient.slice(-4)}.
            </p>
            {txHash && (
              <a
                href={txUrl(txHash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-none font-medium transition-all hover:opacity-80"
                style={{ background: "var(--card-border)", color: "var(--foreground)" }}
              >
                View Transaction
                <ArrowRight className="w-4 h-4" />
              </a>
            )}
          </motion.div>
        )}
      </div>

      {(state === "search" || state === "not_found") && (
        <div
          className="mt-6 p-6 rounded-none"
          style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
        >
          <h3 className="font-semibold mb-3">What you need to claim</h3>
          <ul className="space-y-2 text-sm" style={{ color: "var(--muted-foreground)" }}>
            <li className="flex gap-2">
              <span style={{ color: "var(--secondary)" }}>1.</span>
              The <strong>claim salt</strong> (0x…) shared by the vault creator.
            </li>
            <li className="flex gap-2">
              <span style={{ color: "var(--secondary)" }}>2.</span>
              The <strong>wallet</strong> whose address was set as the beneficiary.
            </li>
            <li className="flex gap-2">
              <span style={{ color: "var(--secondary)" }}>3.</span>
              The vault must be <strong>activated</strong> (owner missed the threshold).
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
