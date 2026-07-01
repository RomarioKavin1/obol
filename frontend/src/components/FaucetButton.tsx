"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Coins } from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@/lib/wallet";
import { faucetTokens, getTokenBalance } from "@/lib/stellar";
import { formatTokenAmount } from "@/lib/format";

/**
 * Self-contained demo faucet. Any connected wallet can mint a fixed batch of the
 * mock SEP-41 token, so the deposit / staking flows work end to end without the
 * deployer key.
 */
export function FaucetButton({ compact = false }: { compact?: boolean }) {
  const { address } = useWallet();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) {
      setBalance(null);
      return;
    }
    try {
      setBalance(await getTokenBalance(address));
    } catch {
      /* read errors are non-fatal here */
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const drip = async () => {
    if (!address) {
      toast.error("Connect a wallet first.");
      return;
    }
    setBusy(true);
    const id = toast.loading("Minting test tokens…");
    try {
      await faucetTokens(address);
      toast.success("10,000 mUSD minted to your wallet.", { id });
      // Re-read a few times: the balance view can lag the confirmed tx briefly.
      refresh();
      setTimeout(refresh, 2500);
      setTimeout(refresh, 6000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Faucet failed";
      toast.error(msg, { id });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="p-6"
      style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Coins className="w-4 h-4" style={{ color: "var(--accent)" }} />
        <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          Test tokens
        </h3>
      </div>

      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-3xl font-bold tracking-tight tabular-nums">
          {balance === null ? "0" : formatTokenAmount(balance)}
        </span>
        <span className="text-sm font-mono text-muted-foreground">mUSD</span>
      </div>

      <button
        onClick={drip}
        disabled={busy || !address}
        className="w-full py-3 text-xs font-mono uppercase tracking-widest text-background flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: "var(--accent)" }}
      >
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>Get 10,000 mUSD</>
        )}
      </button>

      {!compact && (
        <p className="text-xs mt-3 leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
          A permissionless demo faucet. Mint mock stablecoin to fund a vault
          deposit or a keeper stake. Testnet only.
        </p>
      )}
    </div>
  );
}
