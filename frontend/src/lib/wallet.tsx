"use client";

/**
 * Multi-wallet integration via Stellar Wallets Kit.
 *
 * One modal, many wallets: Freighter, xBull, Albedo (web, no extension), Rabet,
 * and Hana. The rest of the app only sees `useWallet()` (address + connect +
 * disconnect) and `signWithWallet()`, so swapping or adding wallets is isolated
 * here.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { FreighterModule, FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { RabetModule } from "@creit.tech/stellar-wallets-kit/modules/rabet";
import { HanaModule } from "@creit.tech/stellar-wallets-kit/modules/hana";
import { NETWORK_PASSPHRASE } from "./config";

const STORAGE_KEY = "obol_wallet_id";

// The kit is a static singleton; initialise once, client-side only.
let _initialized = false;
function ensureKit(): void {
  if (_initialized || typeof window === "undefined") return;
  StellarWalletsKit.init({
    network: NETWORK_PASSPHRASE as Networks,
    selectedWalletId: FREIGHTER_ID,
    modules: [
      new FreighterModule(),
      new xBullModule(),
      new AlbedoModule(),
      new RabetModule(),
      new HanaModule(),
    ],
  });
  _initialized = true;
}

/** Sign a transaction XDR with the connected wallet; returns the signed XDR. */
export async function signWithWallet(xdr: string, address: string): Promise<string> {
  ensureKit();
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
    address,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  if (!signedTxXdr) {
    throw new Error(
      "Wallet did not return a signed transaction. Make sure it is unlocked and set to Testnet."
    );
  }
  return signedTxXdr;
}

interface WalletState {
  address: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Restore a previously-selected wallet on load. Only initialise the kit if a
  // wallet was previously connected, so first-time visitors don't pay the kit's
  // <html> theme mutation before hydration.
  useEffect(() => {
    const id = localStorage.getItem(STORAGE_KEY);
    if (!id) return;
    ensureKit();
    let cancelled = false;
    (async () => {
      try {
        StellarWalletsKit.setWallet(id);
        const { address: addr } = await StellarWalletsKit.getAddress();
        if (!cancelled && addr) setAddress(addr);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    ensureKit();
    setConnecting(true);
    try {
      const { address: addr } = await StellarWalletsKit.authModal();
      if (!addr) throw new Error("No account returned from wallet.");
      const id = StellarWalletsKit.selectedModule?.productId;
      if (id) localStorage.setItem(STORAGE_KEY, id);
      setAddress(addr);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    void StellarWalletsKit.disconnect().catch(() => {});
    localStorage.removeItem(STORAGE_KEY);
    setAddress(null);
  }, []);

  const value = useMemo(
    () => ({ address, connecting, connect, disconnect }),
    [address, connecting, connect, disconnect]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
