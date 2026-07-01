"use client";

import { CheckIn } from "@/components/CheckIn";

export default function CheckInPage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--background)" }}>
      <main className="max-w-3xl mx-auto px-6 pt-32 pb-16">
        <div className="mb-12 border-b border-card-border pb-10">
          <span className="kicker block mb-5">// Proof of life</span>
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tighter uppercase leading-[0.95]">
            Prove You&apos;re Alive
          </h1>
          <p className="mt-5 max-w-xl leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
            Generate a zero-knowledge liveness proof in your browser and submit it to
            Stellar. No wallet, no personal data revealed.
          </p>
        </div>

        <CheckIn />
      </main>
    </div>
  );
}
