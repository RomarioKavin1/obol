"use client";

/**
 * Owner dashboard: the vault-status view of the dead man's switch.
 *
 * Loads the identity from localStorage (lib/identity.ts) — no identity means no
 * vault on this device, so it renders a redirect card to /setup. Otherwise it
 * reads LivenessRegistry views (root, member count, last_checkin, missed count,
 * max_missed, per-identity interval) plus VaultController.is_activated for the
 * locally-stored vault commitment, all as fee-less simulations.
 *
 * The epoch deadline is (current_epoch + 1) * interval using ledger time
 * (getCurrentEpoch), re-rendered every second via a tick counter. When the
 * deadline passes, an overdue banner exposes the keeper path: report_missed on
 * the LivenessRegistry against this identity's commitment — the same call any
 * third-party keeper would make; after max_missed reports the vault activates.
 * Also hosts FaucetButton and KeeperWidget for the demo keeper economy.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Shield,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Zap,
  ArrowRight,
  RefreshCw,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { loadIdentity, loadVault, type Identity } from "@/lib/identity";
import { useWallet } from "@/lib/wallet";
import {
  getRoot,
  getMemberCount,
  getLastCheckin,
  getMissedCount,
  getMaxMissed,
  getInterval,
  isActivated,
  getCurrentEpoch,
  reportMissed,
} from "@/lib/stellar";
import { KeeperWidget } from "@/components/KeeperWidget";
import { FaucetButton } from "@/components/FaucetButton";
import { bigintToBytes32, hexToBytes32, formatTimeRemaining, shortenAddress } from "@/lib/format";

interface Status {
  root: string | null;
  memberCount: number;
  lastCheckin: number;
  missedCount: number;
  maxMissed: number;
  activated: boolean;
  interval: number;
  deadline: number;
}

export default function DashboardPage() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [, setTick] = useState(0);
  const { address } = useWallet();
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    setIdentity(loadIdentity());
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const fetchStatus = useCallback(async () => {
    const id = loadIdentity();
    if (!id) return;
    setLoading(true);
    const commitment = bigintToBytes32(id.commitment);
    const vault = loadVault();
    try {
      const [root, memberCount, last, missed, max, chainInterval] = await Promise.all([
        getRoot().catch(() => null),
        getMemberCount().catch(() => 0),
        getLastCheckin(commitment).catch(() => 0),
        getMissedCount(commitment).catch(() => 0),
        getMaxMissed().catch(() => 3),
        getInterval(commitment).catch(() => 0),
      ]);

      let activated = false;
      if (vault?.vaultCommitment) {
        activated = await isActivated(hexToBytes32(vault.vaultCommitment)).catch(() => false);
      }

      const interval = chainInterval > 0 ? chainInterval : vault?.intervalSeconds ?? 60;
      const epoch = await getCurrentEpoch(interval);

      setStatus({
        root,
        memberCount,
        lastCheckin: last,
        missedCount: missed,
        maxMissed: max || 3,
        activated,
        interval,
        deadline: (Number(epoch) + 1) * interval,
      });
      setLastRefresh(new Date());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (identity) fetchStatus();
  }, [identity, fetchStatus]);

  const handleReportMissed = async () => {
    if (!address) {
      toast.error("Connect a wallet first.");
      return;
    }
    if (!identity) return;
    setReporting(true);
    const id = toast.loading("Reporting missed interval (keeper)...");
    try {
      await reportMissed(address, address, bigintToBytes32(identity.commitment));
      toast.success("Missed interval reported. Vault may now be activated.", { id });
      fetchStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Report failed", { id });
    } finally {
      setReporting(false);
    }
  };

  const deadlineMs = status ? status.deadline * 1000 : null;
  const isOverdue = deadlineMs ? deadlineMs - Date.now() < 0 : false;
  const isUrgent = deadlineMs
    ? deadlineMs - Date.now() < status!.interval * 1000
    : false;

  if (!identity) {
    return (
      <div className="min-h-screen pt-24" style={{ background: "var(--background)" }}>
        <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
          <Shield className="w-16 h-16 mb-6" style={{ color: "var(--muted)" }} />
          <h2 className="text-2xl font-bold mb-4">No Vault Found</h2>
          <p className="mb-8" style={{ color: "var(--muted-foreground)" }}>
            You haven&apos;t set up a vault on this device yet.
          </p>
          <Link
            href="/setup"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-none font-semibold text-background"
            style={{ background: "var(--primary)" }}
          >
            Setup Your Vault
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--background)" }}>
      <main className="max-w-4xl mx-auto px-6 pt-32 pb-16">
        <div className="mb-10 border-b border-card-border pb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="kicker block mb-4">// Vault status</span>
              <h1 className="text-5xl md:text-6xl font-extrabold tracking-tighter uppercase leading-[0.95]">
                Dashboard
              </h1>
            </div>
            <button
              onClick={fetchStatus}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 text-xs font-mono uppercase tracking-widest transition-colors hover:border-foreground disabled:opacity-50"
              style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
          <p className="mt-5 max-w-xl leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
            Monitor your dead man&apos;s switch on Stellar. Check in before each
            deadline, or your vault passes to your heir.
          </p>
        </div>

        {status?.activated && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 p-5 rounded-none mb-8"
            style={{ background: "rgba(239,68,68,0.1)", border: "2px solid var(--destructive)" }}
          >
            <XCircle className="w-6 h-6 mt-0.5 flex-shrink-0" style={{ color: "var(--destructive)" }} />
            <div>
              <p className="font-bold text-lg" style={{ color: "var(--destructive)" }}>
                VAULT ACTIVATED
              </p>
              <p className="text-sm mt-1" style={{ color: "var(--muted-foreground)" }}>
                Your vault has activated. If unintentional, contact your beneficiary
                immediately.
              </p>
            </div>
          </motion.div>
        )}

        {isOverdue && !status?.activated && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 p-5 rounded-none mb-8"
            style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.5)" }}
          >
            <AlertTriangle className="w-6 h-6 mt-0.5 flex-shrink-0" style={{ color: "var(--destructive)" }} />
            <div>
              <p className="font-bold" style={{ color: "var(--destructive)" }}>
                Check-in Overdue!
              </p>
              <p className="text-sm mt-1 mb-3" style={{ color: "var(--muted-foreground)" }}>
                The current epoch has ended. Check in to reset your missed counter,
                or a keeper can report the miss below.
              </p>
              <button
                onClick={handleReportMissed}
                disabled={reporting || !address}
                className="px-4 py-2 text-xs font-mono uppercase tracking-widest transition-colors hover:border-foreground disabled:opacity-40"
                style={{ border: "1px solid var(--card-border)", color: "var(--foreground)" }}
              >
                {reporting ? "Reporting..." : "Report missed (keeper)"}
              </button>
            </div>
          </motion.div>
        )}

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="md:col-span-2 p-6 rounded-none"
            style={{
              background: "var(--card)",
              border: `1px solid ${
                isOverdue ? "var(--destructive)" : isUrgent ? "rgba(245,158,11,0.5)" : "var(--card-border)"
              }`,
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Clock
                className="w-5 h-5"
                style={{ color: isOverdue ? "var(--destructive)" : isUrgent ? "var(--accent)" : "var(--primary)" }}
              />
              <span className="text-sm font-medium" style={{ color: "var(--muted-foreground)" }}>
                Current Epoch Ends In
              </span>
            </div>
            <p
              className="text-4xl font-black mb-1"
              style={{
                color: isOverdue ? "var(--destructive)" : isUrgent ? "var(--accent)" : "var(--foreground)",
              }}
            >
              {status ? formatTimeRemaining(status.deadline) : "--"}
            </p>
            {status && (
              <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                Deadline: {new Date(status.deadline * 1000).toLocaleString()} · interval{" "}
                {status.interval}s
              </p>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="p-6 rounded-none flex flex-col justify-between"
            style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
          >
            <p className="text-sm font-medium mb-3" style={{ color: "var(--muted-foreground)" }}>
              Vault Status
            </p>
            {status?.activated ? (
              <div className="flex items-center gap-2">
                <XCircle className="w-6 h-6" style={{ color: "var(--destructive)" }} />
                <span className="font-bold text-lg" style={{ color: "var(--destructive)" }}>
                  ACTIVATED
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <CheckCircle className="w-6 h-6" style={{ color: "var(--success)" }} />
                <span className="font-bold text-lg" style={{ color: "var(--success)" }}>
                  SECURE
                </span>
              </div>
            )}
          </motion.div>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <div className="p-6 rounded-none" style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}>
            <p className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>
              Last Check-in
            </p>
            <p className="text-lg font-bold">
              {status?.lastCheckin
                ? new Date(status.lastCheckin * 1000).toLocaleString()
                : "Never"}
            </p>
          </div>

          <div
            className="p-6 rounded-none"
            style={{
              background: "var(--card)",
              border: `1px solid ${(status?.missedCount ?? 0) > 0 ? "rgba(239,68,68,0.4)" : "var(--card-border)"}`,
            }}
          >
            <p className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>
              Consecutive Misses
            </p>
            <p
              className="text-3xl font-black"
              style={{ color: (status?.missedCount ?? 0) > 0 ? "var(--destructive)" : "var(--success)" }}
            >
              {status?.missedCount ?? 0}
              <span className="text-lg font-normal" style={{ color: "var(--muted-foreground)" }}>
                {" "}/ {status?.maxMissed ?? 3}
              </span>
            </p>
          </div>

          <div className="p-6 rounded-none" style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}>
            <div className="flex items-center gap-1 mb-1">
              <Users className="w-3.5 h-3.5" style={{ color: "var(--muted-foreground)" }} />
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                Group Members
              </p>
            </div>
            <p className="text-3xl font-black">{status?.memberCount ?? 0}</p>
          </div>
        </div>

        <div className="p-6 rounded-none mb-8" style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}>
          <h3 className="font-semibold mb-4">Identity &amp; Group</h3>
          <div className="mb-4">
            <p className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>
              Identity Commitment (public)
            </p>
            <p className="text-xs font-mono break-all opacity-70">
              0x{identity.commitment.toString(16).padStart(64, "0")}
            </p>
          </div>
          <div>
            <p className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>
              Group Root
            </p>
            <p className="text-xs font-mono break-all opacity-70">
              {status?.root ? shortenAddress(status.root, 12) : "N/A"}
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8 items-start">
          <FaucetButton />
          <KeeperWidget />
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <Link
            href="/checkin"
            className="flex-1 flex items-center justify-center gap-2 px-6 py-4 rounded-none font-bold text-background transition-all hover:opacity-90"
            style={{ background: "var(--primary)" }}
          >
            <Zap className="w-5 h-5" />
            Check In Now
          </Link>
          <Link
            href="/claim"
            className="flex-1 flex items-center justify-center gap-2 px-6 py-4 rounded-none font-medium transition-all hover:opacity-80"
            style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
          >
            Beneficiary Claim
          </Link>
        </div>

        {lastRefresh && (
          <p className="text-xs text-center mt-4" style={{ color: "var(--muted)" }}>
            Last updated: {lastRefresh.toLocaleTimeString()}
          </p>
        )}
      </main>
    </div>
  );
}
