"use client";

/**
 * Client-side provider boundary, mounted once in the root layout. Its only job
 * is to host WalletProvider (lib/wallet.tsx) — which is client-only because
 * Stellar Wallets Kit touches window/localStorage — without forcing the whole
 * layout into a client component. Add future app-wide client providers here.
 */

import { WalletProvider } from "@/lib/wallet";

export function Providers({ children }: { children: React.ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
