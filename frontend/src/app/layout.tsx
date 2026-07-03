/**
 * Root layout (server component). Loads fonts, global CSS, and SEO metadata,
 * then wraps every page in <Providers> (client boundary that mounts the
 * WalletProvider from lib/wallet.tsx), the fixed <Navbar>, and the sonner
 * <Toaster> used for all tx progress/success/error toasts.
 *
 * The app is dark-only: <html class="dark"> is hardcoded, and
 * suppressHydrationWarning absorbs the <html> attribute mutation Stellar
 * Wallets Kit performs when it initialises.
 */

import type { Metadata } from "next";
import { Geist, Geist_Mono, Archivo } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "sonner";
import { Navbar } from "@/components/Navbar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Monumental grotesque for display headings: stark, engraved, ledger-like.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "Obol Protocol | ZK Dead Man's Switch for Crypto Inheritance",
  description:
    "Trustless, private crypto inheritance on Stellar. Prove you're alive with zero-knowledge proofs. Your beneficiary stays anonymous until the vault activates.",
  keywords: [
    "crypto inheritance",
    "dead man switch",
    "zero knowledge",
    "stellar",
    "soroban",
    "ZK proof",
    "privacy",
  ],
  openGraph: {
    title: "Obol Protocol",
    description:
      "ZK-powered dead man's switch for private crypto inheritance on Stellar",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${archivo.variable} antialiased min-h-screen`}
        style={{ background: "var(--background)", color: "var(--foreground)" }}
      >
        <Providers>
          <Navbar />
          {children}
          <Toaster
            theme="dark"
            position="bottom-right"
            toastOptions={{
              style: {
                background: "var(--card)",
                border: "1px solid var(--card-border)",
                color: "var(--foreground)",
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
