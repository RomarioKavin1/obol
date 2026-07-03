"use client";

/**
 * /setup route: page shell (heading + copy) around the <VaultSetup> wizard,
 * which owns all state and contract interaction for creating a vault —
 * identity generation, interval choice, sealed beneficiary, and deposit.
 */

import { VaultSetup } from "@/components/VaultSetup";

export default function SetupPage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--background)" }}>
      <main className="max-w-3xl mx-auto px-6 pt-32 pb-16">
        <div className="mb-12 border-b border-card-border pb-10">
          <span className="kicker block mb-5">// New vault</span>
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tighter uppercase leading-[0.95]">
            Setup Your Vault
          </h1>
          <p className="mt-5 max-w-xl leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
            Configure your dead man&apos;s switch and deploy your inheritance vault
            on Stellar.
          </p>
        </div>

        <VaultSetup />
      </main>
    </div>
  );
}
