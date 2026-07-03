"use client";

/**
 * Proof-of-life check-in — the recurring owner action that keeps the vault
 * locked.
 *
 * Loads the identity from localStorage (lib/identity.ts), computes the current
 * epoch from LEDGER time (getCurrentEpoch — wall clocks can disagree with the
 * chain and cause EpochMismatch), generates the UltraHonk proof in-browser via
 * prover.ts, then submits it with LivenessRegistry.checkin(public_inputs,
 * proof). The connected wallet only signs/pays the transaction; the proof
 * itself never reveals which identity commitment belongs to which wallet.
 *
 * Status cards (last check-in, missed/max, next deadline) come from registry
 * view reads; the deadline mirrors the contract's rule (last_checkin +
 * interval, with a 60s grace before keepers may report) and the on-chain
 * per-identity interval overrides the locally stored one when present. Contract error #10 (EpochMismatch) is special-cased: on the
 * 60s demo interval the epoch can roll over between proof generation and
 * wallet approval, so the proof's epoch no longer matches the ledger's.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Shield, Zap, CheckCircle, Clock, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@/lib/wallet";
import { loadIdentity, loadVault, type Identity } from "@/lib/identity";
import {
  generateLivenessProof,
  type ProofProgress,
} from "@/lib/prover";
import {
  submitCheckin,
  getLastCheckin,
  getMissedCount,
  getMaxMissed,
  getInterval,
  getCurrentEpoch,
} from "@/lib/stellar";
import { bigintToBytes32, formatTimeRemaining } from "@/lib/format";
import { txUrl } from "@/lib/config";

const DEFAULT_INTERVAL = 60;

type ProofStep = "idle" | ProofProgress | "submitting" | "done" | "error";

const STEP_LABELS: Record<ProofStep, string> = {
  idle: "Ready",
  computing_witness: "Computing witness...",
  generating_proof: "Generating UltraHonk proof (a few seconds)...",
  submitting: "Submitting to Stellar...",
  done: "Check-in complete!",
  error: "Error",
};

export function CheckIn() {
  const { address } = useWallet();

  const [identity, setIdentity] = useState<Identity | null>(null);
  const [proofStep, setProofStep] = useState<ProofStep>("idle");
  const [interval, setIntervalSeconds] = useState(DEFAULT_INTERVAL);
  const [lastCheckin, setLastCheckin] = useState<number | null>(null);
  const [missedCount, setMissedCount] = useState(0);
  const [maxMissed, setMaxMissed] = useState(3);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    setIdentity(loadIdentity());
    const v = loadVault();
    if (v?.intervalSeconds) setIntervalSeconds(v.intervalSeconds);
  }, []);

  // Live countdown re-render
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    const id = loadIdentity();
    if (!id) return;
    const commitment = bigintToBytes32(id.commitment);
    try {
      const [last, missed, max, chainInterval] = await Promise.all([
        getLastCheckin(commitment).catch(() => 0),
        getMissedCount(commitment).catch(() => 0),
        getMaxMissed().catch(() => 3),
        getInterval(commitment).catch(() => 0),
      ]);
      setLastCheckin(last);
      setMissedCount(missed);
      setMaxMissed(max || 3);
      const useInterval = chainInterval > 0 ? chainInterval : interval;
      if (chainInterval > 0) setIntervalSeconds(chainInterval);
      // Mirrors the contract's report_missed rule: the owner must check in
      // before last_checkin + interval (keepers can report 60s of grace later).
      setDeadline(last > 0 ? last + useInterval : null);
    } catch (err) {
      console.error(err);
    }
  }, [interval]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  const handleCheckin = async () => {
    const id = loadIdentity();
    if (!id) {
      toast.error("No identity found. Set up your vault first.");
      return;
    }
    if (!address) {
      toast.error("Connect a wallet first.");
      return;
    }

    try {
      // Use the ledger's notion of time so epoch matches the on-chain check.
      const epoch = await getCurrentEpoch(interval);

      const proof = await generateLivenessProof(id, epoch, (step) =>
        setProofStep(step)
      );

      setProofStep("submitting");
      const res = await submitCheckin(address, proof.publicInputs, proof.proof);
      setTxHash(res.hash);
      setProofStep("done");
      toast.success("Check-in successful. You're alive.");
      refresh();
    } catch (err: unknown) {
      setProofStep("error");
      const raw = err instanceof Error ? err.message : "Unknown error";
      // Contract error #10 = EpochMismatch: the epoch rolled over between proof
      // generation and submission (easy to hit on the 60s demo interval).
      const msg = /#10\b|epochmismatch|epoch/i.test(raw)
        ? "The check-in window rolled over before the proof was submitted. Approve the wallet prompt quickly, or use a longer interval, then try again."
        : raw;
      toast.error(`Check-in failed: ${msg}`);
      console.error(err);
    }
  };

  const isProving = ["computing_witness", "generating_proof", "submitting"].includes(
    proofStep
  );

  const deadlineMs = deadline ? deadline * 1000 : null;
  const remainingMs = deadlineMs ? deadlineMs - Date.now() : null;
  const isOverdueNow = remainingMs !== null && remainingMs < 0;
  // Urgent = inside the last quarter of the check-in window.
  const isUrgent =
    remainingMs !== null && (isOverdueNow || remainingMs < (interval * 1000) / 4);

  if (!identity) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <Shield className="w-16 h-16 mx-auto mb-6" style={{ color: "var(--muted)" }} />
        <h2 className="text-2xl font-bold mb-4">No Identity Found</h2>
        <p className="mb-8" style={{ color: "var(--muted-foreground)" }}>
          Set up a vault (or import your backup) on this device before checking in.
        </p>
        <Link
          href="/setup"
          className="inline-flex items-center gap-2 px-8 py-4 rounded-none font-semibold text-background"
          style={{ background: "var(--primary)" }}
        >
          Setup Your Vault
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <div
        className="p-8 rounded-none mb-6"
        style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
      >
        <div className="flex items-center gap-3 mb-6">
          <Shield className="w-8 h-8" style={{ color: "var(--primary)" }} />
          <div>
            <h2 className="text-xl font-bold">Liveness Check-in</h2>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              Generate a ZK proof to prove you&apos;re alive
            </p>
          </div>
        </div>

        {deadline && (
          <div
            className="p-4 rounded-none mb-6"
            style={{
              background: isUrgent ? "rgba(239,68,68,0.1)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${isUrgent ? "rgba(239,68,68,0.3)" : "var(--card-border)"}`,
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              {isUrgent ? (
                <AlertTriangle className="w-4 h-4" style={{ color: "var(--destructive)" }} />
              ) : (
                <Clock className="w-4 h-4" style={{ color: "var(--primary)" }} />
              )}
              <span className="text-sm font-semibold">
                {isOverdueNow
                  ? "Check-in Overdue!"
                  : isUrgent
                    ? "Check-in Urgent!"
                    : "Next Check-in Due In"}
              </span>
            </div>
            <p
              className="text-2xl font-bold"
              style={{ color: isUrgent ? "var(--destructive)" : "var(--foreground)" }}
            >
              {formatTimeRemaining(deadline)}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 mb-8">
          <div
            className="p-4 rounded-none"
            style={{ background: "var(--background)", border: "1px solid var(--card-border)" }}
          >
            <p className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>
              Last Check-in
            </p>
            <p className="font-semibold">
              {lastCheckin
                ? new Date(lastCheckin * 1000).toLocaleString()
                : "Never"}
            </p>
          </div>
          <div
            className="p-4 rounded-none"
            style={{
              background: "var(--background)",
              border: `1px solid ${missedCount > 0 ? "rgba(239,68,68,0.4)" : "var(--card-border)"}`,
            }}
          >
            <p className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>
              Missed Check-ins
            </p>
            <p
              className="font-semibold text-xl"
              style={{ color: missedCount > 0 ? "var(--destructive)" : "var(--foreground)" }}
            >
              {missedCount} / {maxMissed}
            </p>
          </div>
        </div>

        {isProving && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 rounded-none"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--card-border)" }}
          >
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--primary)" }} />
              <div>
                <p className="text-sm font-medium">{STEP_LABELS[proofStep]}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                  All proving happens locally in your browser.
                </p>
              </div>
            </div>
            <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--background)" }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: "var(--primary)" }}
                animate={{
                  width:
                    proofStep === "computing_witness"
                      ? "40%"
                      : proofStep === "generating_proof"
                        ? "80%"
                        : "95%",
                }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </motion.div>
        )}

        {proofStep === "done" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-6 p-4 rounded-none flex items-center gap-3"
            style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)" }}
          >
            <CheckCircle className="w-6 h-6 flex-shrink-0" style={{ color: "var(--success)" }} />
            <div>
              <p className="font-semibold" style={{ color: "var(--success)" }}>
                Check-in Successful
              </p>
              {txHash && (
                <a
                  href={txUrl(txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  View on Stellar Expert
                </a>
              )}
            </div>
          </motion.div>
        )}

        <button
          onClick={handleCheckin}
          disabled={isProving || !address}
          className="w-full py-4 rounded-none font-bold text-background flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50"
          style={{ background: "var(--primary)" }}
        >
          {isProving ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Proving...
            </>
          ) : !address ? (
            "Connect a Wallet First"
          ) : (
            <>
              <Zap className="w-5 h-5" />
              Generate Proof &amp; Check In
            </>
          )}
        </button>
      </div>

      <div
        className="p-6 rounded-none"
        style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
      >
        <h3 className="font-semibold mb-3">How this works</h3>
        <ol className="space-y-2 text-sm" style={{ color: "var(--muted-foreground)" }}>
          <li className="flex gap-2">
            <span className="font-bold" style={{ color: "var(--primary)" }}>1.</span>
            Your local identity generates a Noir ZK proof in your browser (UltraHonk).
          </li>
          <li className="flex gap-2">
            <span className="font-bold" style={{ color: "var(--primary)" }}>2.</span>
            The proof shows you know the secret behind your commitment, without revealing it.
          </li>
          <li className="flex gap-2">
            <span className="font-bold" style={{ color: "var(--primary)" }}>3.</span>
            It is submitted to the LivenessRegistry on Stellar and verified on-chain.
          </li>
          <li className="flex gap-2">
            <span className="font-bold" style={{ color: "var(--primary)" }}>4.</span>
            Your missed-check-in counter resets. The vault stays locked.
          </li>
        </ol>
      </div>
    </div>
  );
}
