"use client";

/**
 * Wallet connect button for the navbar. Thin UI over useWallet()
 * (lib/wallet.tsx): disconnected it triggers connect(), which opens the Stellar
 * Wallets Kit modal (Freighter, xBull, Albedo, Rabet, Hana); connected it shows
 * the shortened address with a copy / disconnect dropdown. All session state
 * (selected wallet persistence, reconnection) lives in WalletProvider — this
 * component holds only local menu/copied UI state.
 */

import { useState } from "react";
import { Wallet, ChevronDown, LogOut, Copy, Check } from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";
import { useWallet } from "@/lib/wallet";
import { shortenAddress } from "@/lib/format";

export function ConnectWallet() {
  const { address, connecting, connect, disconnect } = useWallet();
  const [showMenu, setShowMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleConnect = async () => {
    try {
      await connect();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect wallet");
    }
  };

  const handleCopy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (address) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="flex items-center gap-2 px-4 py-2 rounded-none text-sm font-medium transition-all hover:opacity-90"
          style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
        >
          <div className="w-2 h-2 rounded-full" style={{ background: "var(--success)" }} />
          {shortenAddress(address)}
          <ChevronDown
            className={clsx("w-3 h-3 transition-transform", showMenu && "rotate-180")}
          />
        </button>

        {showMenu && (
          <div
            className="absolute right-0 top-12 w-52 rounded-none overflow-hidden shadow-xl z-50"
            style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
          >
            <button
              onClick={handleCopy}
              className="flex items-center gap-3 w-full px-4 py-3 text-sm text-left hover:opacity-80 transition-opacity"
            >
              {copied ? (
                <Check className="w-4 h-4" style={{ color: "var(--success)" }} />
              ) : (
                <Copy className="w-4 h-4" style={{ color: "var(--muted-foreground)" }} />
              )}
              {copied ? "Copied!" : "Copy address"}
            </button>
            <div style={{ height: "1px", background: "var(--card-border)" }} />
            <button
              onClick={() => {
                disconnect();
                setShowMenu(false);
              }}
              className="flex items-center gap-3 w-full px-4 py-3 text-sm text-left hover:opacity-80 transition-opacity"
              style={{ color: "var(--destructive)" }}
            >
              <LogOut className="w-4 h-4" />
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={connecting}
      className="flex items-center gap-2 px-4 py-2 rounded-none text-sm font-semibold text-background transition-all hover:opacity-90 disabled:opacity-50"
      style={{ background: "var(--primary)" }}
    >
      <Wallet className="w-4 h-4" />
      {connecting ? "Connecting..." : "Connect Wallet"}
    </button>
  );
}
