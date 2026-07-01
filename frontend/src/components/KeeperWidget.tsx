"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Shield } from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@/lib/wallet";
import {
  getKeeperStake,
  isActiveKeeper,
  getMinStake,
  keeperStake,
  keeperUnstake,
} from "@/lib/stellar";
import { formatTokenAmount, parseTokenAmount } from "@/lib/format";

export function KeeperWidget() {
  const { address } = useWallet();
  const [stake, setStake] = useState<bigint>(0n);
  const [minStake, setMinStake] = useState<bigint>(0n);
  const [active, setActive] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<"stake" | "unstake" | null>(null);

  const refresh = useCallback(async () => {
    try {
      const min = await getMinStake().catch(() => 0n);
      setMinStake(min);
      if (address) {
        const [s, a] = await Promise.all([
          getKeeperStake(address).catch(() => 0n),
          isActiveKeeper(address).catch(() => false),
        ]);
        setStake(s);
        setActive(a);
      }
    } catch (err) {
      console.error(err);
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const doStake = async (kind: "stake" | "unstake") => {
    if (!address) {
      toast.error("Connect a wallet first.");
      return;
    }
    const raw = parseTokenAmount(amount || "0");
    if (raw <= 0n) {
      toast.error("Enter a valid amount.");
      return;
    }
    setBusy(kind);
    try {
      const res =
        kind === "stake"
          ? await keeperStake(address, address, raw)
          : await keeperUnstake(address, address, raw);
      toast.success(`${kind === "stake" ? "Staked" : "Unstaked"} · ${res.hash.slice(0, 8)}…`);
      setAmount("");
      refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      toast.error(`${kind} failed: ${msg}`);
      console.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="p-6 rounded-none"
      style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-5 h-5" style={{ color: "var(--primary)" }} />
        <h3 className="font-semibold">Keeper Staking</h3>
        {active && (
          <span
            className="ml-auto text-xs font-mono px-2 py-1 rounded-none"
            style={{ background: "rgba(34,197,94,0.15)", color: "var(--success)" }}
          >
            ACTIVE KEEPER
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="p-3 rounded-none" style={{ background: "var(--background)", border: "1px solid var(--card-border)" }}>
          <p className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>
            Your Stake
          </p>
          <p className="text-lg font-bold">{formatTokenAmount(stake)}</p>
        </div>
        <div className="p-3 rounded-none" style={{ background: "var(--background)", border: "1px solid var(--card-border)" }}>
          <p className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>
            Min Stake
          </p>
          <p className="text-lg font-bold">{formatTokenAmount(minStake)}</p>
        </div>
      </div>

      <input
        type="number"
        placeholder="Amount (MockToken)"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-full px-4 py-3 rounded-none text-sm mb-3"
        style={{
          background: "var(--background)",
          border: "1px solid var(--card-border)",
          color: "var(--foreground)",
          outline: "none",
        }}
      />

      <div className="flex gap-3">
        <button
          onClick={() => doStake("stake")}
          disabled={busy !== null || !address}
          className="flex-1 py-3 rounded-none font-semibold text-background flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-40"
          style={{ background: "var(--primary)" }}
        >
          {busy === "stake" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Stake"}
        </button>
        <button
          onClick={() => doStake("unstake")}
          disabled={busy !== null || !address}
          className="flex-1 py-3 rounded-none font-medium transition-all hover:opacity-80 disabled:opacity-40"
          style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
        >
          {busy === "unstake" ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Unstake"}
        </button>
      </div>

      <p className="text-xs mt-3" style={{ color: "var(--muted-foreground)" }}>
        Keepers stake MockToken and can call report_missed to flag owners who stop checking
        in, activating their vaults.
      </p>
    </div>
  );
}
