"use client";

import { BeneficiaryClaim } from "@/components/BeneficiaryClaim";

export default function ClaimPage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--background)" }}>
      <main className="max-w-3xl mx-auto px-6 pt-32 pb-16">
        <div className="mb-12 border-b border-card-border pb-10">
          <span className="kicker block mb-5">// Beneficiary</span>
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tighter uppercase leading-[0.95]">
            Claim Inheritance
          </h1>
          <p className="mt-5 max-w-xl leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
            If you were named as a beneficiary and the vault has activated, reveal your
            salt and claim what was left to you.
          </p>
        </div>

        <BeneficiaryClaim />
      </main>
    </div>
  );
}
