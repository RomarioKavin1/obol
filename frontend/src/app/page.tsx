"use client";

/**
 * Landing page. Pure presentation — no wallet or identity state and no contract
 * writes. Explains the protocol flow (mint identity -> seal vault -> prove
 * liveness -> silence releases funds) and links into /setup and /checkin.
 *
 * The "live on testnet" section is real, not decorative: PROOF_TX is the hash
 * of an actual on-chain-verified UltraHonk check-in, and the contract cards link
 * to the deployed testnet contracts from config.ts via txUrl()/contractUrl().
 * If the contracts are redeployed, config.ts updates the cards automatically but
 * PROOF_TX must be replaced with a check-in against the new deployment.
 */

import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { CONTRACTS, txUrl, contractUrl } from "@/lib/config";

// A real proof of life, verified on Stellar testnet through LivenessRegistry.checkin.
const PROOF_TX =
  "2f4083e8b52c05fb3b6d6e278fbdabe47749d7fa16952a40b27cc7612668ae72";

const deployed = [
  { name: "LivenessRegistry", role: "Group + ZK check-in", id: CONTRACTS.livenessRegistry },
  { name: "ObolVerifier", role: "On-chain UltraHonk", id: CONTRACTS.obolVerifier },
  { name: "VaultController", role: "Sealed escrow", id: CONTRACTS.vaultController },
  { name: "MockToken", role: "SEP-41 test asset", id: CONTRACTS.mockToken },
];

const features = [
  {
    title: "Unlinkable Liveness",
    description:
      "Check-ins are zero-knowledge proofs. No wallet address is ever tied to your identity on-chain, and no epoch can be correlated to another. You prove you exist without revealing who you are.",
  },
  {
    title: "The River Styx",
    description:
      "Funds rest inside a Soroban vault on Stellar. The beneficiary is sealed behind a commitment until the moment of claim: invisible until the ferry departs.",
  },
  {
    title: "Epoch Nullifiers",
    description:
      "Each check-in period derives a unique nullifier, so proofs can never be replayed. Miss enough consecutive epochs and the vault activates, irreversibly.",
  },
  {
    title: "The Obol",
    description:
      "A Noir circuit compiled to UltraHonk, verified on-chain by the ObolVerifier contract. Every proof is checked by Stellar itself. No oracle. No trust.",
  },
];

const steps = [
  {
    step: "[01]",
    title: "MINT.",
    description:
      "Generate your identity in the browser. The commitment is public; the nullifier and secret never leave your device.",
  },
  {
    step: "[02]",
    title: "PACT.",
    description:
      "Deposit assets into your Soroban vault. The beneficiary address is sealed under a commitment, hidden on-chain until claim.",
  },
  {
    step: "[03]",
    title: "PULSE.",
    description:
      "Prove you exist with a Noir ZK proof. Barretenberg generates it in-browser; the ObolVerifier confirms it on Stellar.",
  },
  {
    step: "[04]",
    title: "SILENCE.",
    description:
      "When the proofs stop, the vault unlocks. Soroban enforces the transfer to your heir. No lawyers. No multisig. No human in the loop.",
  },
];

const stack = [
  { label: "NOIR", sub: "Client-side ZK circuit" },
  { label: "ULTRAHONK", sub: "Barretenberg proof system" },
  { label: "SOROBAN", sub: "On-chain proof verifier" },
  { label: "STELLAR", sub: "Testnet smart contracts" },
];

export default function HomePage() {
  const { scrollYProgress } = useScroll();
  const heroOpacity = useTransform(scrollYProgress, [0, 0.2], [1, 0]);
  const heroY = useTransform(scrollYProgress, [0, 0.2], [0, 50]);

  return (
    <div className="min-h-screen relative text-foreground font-sans selection:bg-foreground selection:text-background">
      <div className="bg-noise" />

      {/* Hero */}
      <motion.section
        style={{ opacity: heroOpacity, y: heroY }}
        className="relative flex flex-col justify-center min-h-screen px-6 pt-32 pb-12"
      >
        <div className="w-full h-full flex flex-col justify-between max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-end mb-24">
            <div className="md:col-span-8">
              <h1 className="text-6xl md:text-[7rem] font-bold tracking-tighter leading-[0.9] uppercase">
                Zero
                <br />
                Knowledge
                <br />
                Legacy.
              </h1>
            </div>
            <div className="md:col-span-4 pb-4 flex flex-col items-start gap-6">
              <div className="w-12 h-[1px]" style={{ background: "var(--accent)" }} />
              <p className="text-xs font-mono text-muted-foreground uppercase leading-relaxed max-w-xs">
                A trustless dead man&apos;s switch on Stellar. Prove liveness
                cryptographically. Pass on assets silently.
              </p>
              <div className="flex flex-col gap-3 w-full max-w-xs pt-1">
                <Link
                  href="/setup"
                  className="group flex items-center justify-between px-5 py-3 text-xs font-mono uppercase tracking-widest text-background transition-opacity hover:opacity-90"
                  style={{ background: "var(--accent)" }}
                >
                  Set up a vault
                  <ArrowUpRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </Link>
                <Link
                  href="/checkin"
                  className="group flex items-center justify-between px-5 py-3 text-xs font-mono uppercase tracking-widest border transition-colors hover:border-foreground"
                  style={{ borderColor: "var(--card-border)" }}
                >
                  Prove liveness
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
          </div>

          {/* Hero motif: the obol, a coin for the ferryman, minted in CSS */}
          <div className="w-full relative h-[42vh] md:h-[52vh] bg-card overflow-hidden border border-card-border flex items-center justify-center">
            <div className="absolute inset-0 bg-noise opacity-10 mix-blend-overlay pointer-events-none" />
            {/* concentric engraving rings */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="rounded-full border" style={{ width: "72vh", height: "72vh", maxWidth: "88%", maxHeight: "88%", borderColor: "var(--card-border)" }} />
              <div className="absolute rounded-full border" style={{ width: "52vh", height: "52vh", maxWidth: "64%", maxHeight: "64%", borderColor: "var(--card-border)" }} />
            </div>
            <motion.div
              initial={{ scale: 0.86, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
              className="relative"
            >
              <motion.div
                animate={{ y: [-8, 8, -8] }}
                transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
                className="obol-coin relative flex items-center justify-center w-52 h-52 md:w-72 md:h-72"
              >
                <div
                  className="flex flex-col items-center justify-center text-center select-none"
                  style={{ color: "oklch(0.28 0.06 55)" }}
                >
                  <span className="font-mono text-[10px] tracking-[0.35em] mb-2 opacity-80">
                    ΟΒΟΛΟΣ
                  </span>
                  <span className="text-5xl md:text-6xl font-black leading-none">Ω</span>
                  <span className="font-mono text-[9px] tracking-[0.3em] mt-3 opacity-70">
                    MMXXVI
                  </span>
                </div>
              </motion.div>
            </motion.div>
            <div className="absolute bottom-6 right-6 flex flex-col items-end">
              <span className="text-xs font-mono font-bold tracking-widest uppercase" style={{ color: "var(--accent)" }}>
                PROTOCOL.OBOL // PAID
              </span>
              <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase">
                ZKP_STATE: SEALED
              </span>
            </div>
          </div>
        </div>

        <div className="absolute bottom-10 left-6 flex items-center gap-4 text-xs font-mono uppercase text-muted-foreground">
          <motion.div
            animate={{ x: [0, 10, 0] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
          >
            <ArrowRight className="w-4 h-4" />
          </motion.div>
          <span>Scroll to uncover</span>
        </div>
      </motion.section>

      {/* Ticker */}
      <div className="w-full bg-foreground text-background py-3 overflow-hidden border-y border-foreground flex relative">
        <motion.div
          animate={{ x: [0, -1035] }}
          transition={{ ease: "linear", duration: 15, repeat: Infinity }}
          className="flex whitespace-nowrap gap-12 text-sm font-bold tracking-[0.2em] uppercase items-center"
        >
          {Array(10)
            .fill(0)
            .map((_, i) => (
              <span key={i} className="flex items-center gap-12">
                <span>MEMENTO MORI</span>
                <span className="w-1.5 h-1.5 bg-background rounded-full" />
                <span>TRUSTLESS EXECUTION</span>
                <span className="w-1.5 h-1.5 bg-background rounded-full" />
              </span>
            ))}
        </motion.div>
      </div>

      {/* Statement */}
      <section className="py-24 px-6 border-t border-card-border bg-card relative overflow-hidden">
        <div className="absolute -top-10 -right-10 text-[15rem] md:text-[20rem] font-black text-foreground/[0.02] tracking-tighter leading-none select-none pointer-events-none z-0">
          ΟΒΟΛΟΣ
        </div>

        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16 relative z-10">
          <div>
            <span className="text-xs font-mono uppercase text-muted-foreground block mb-8">
              [01] Immutable Wills.
            </span>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight">
              A Trustless Dead Man&apos;s Switch.
            </h2>
            <Link href="/setup">
              <button className="mt-12 group flex items-center gap-4 text-xs font-mono uppercase border-b border-foreground pb-2 hover:text-muted-foreground hover:border-muted-foreground transition-all">
                Enter The Vault
                <ArrowUpRight className="w-4 h-4 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
              </button>
            </Link>
          </div>
          <div className="flex flex-col justify-end">
            <p className="text-muted-foreground text-lg leading-relaxed">
              In antiquity an obol was the coin placed with the dead to pay the
              ferryman across the Styx. Obol Protocol mimics that quiet passage.
              Prove you exist periodically with a zero-knowledge proof. Once the
              proofs cease, your encrypted assets flow securely across the river to
              your chosen heir. No intermediaries required.
            </p>
          </div>
        </div>
      </section>

      {/* Stack strip */}
      <section className="border-t border-card-border">
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-card-border border-b border-card-border">
          {stack.map((item, i) => (
            <div key={i} className="p-6 flex flex-col gap-1">
              <span className="text-[10px] font-mono text-muted-foreground uppercase">
                BUILT WITH {i + 1}/{stack.length}
              </span>
              <span className="text-lg font-black tracking-tighter uppercase">
                {item.label}
              </span>
              <span className="text-xs text-muted-foreground font-mono">{item.sub}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="py-0 border-t border-card-border">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-card-border border-b border-card-border">
          {features.map((feature, i) => (
            <div key={i} className="p-8 pb-12 brutal-panel group">
              <span className="text-[10px] font-mono text-muted-foreground mb-12 block">
                --- FEATURE {i + 1}
              </span>
              <h3 className="text-xl font-bold mb-4 uppercase tracking-tight">
                {feature.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="py-32 px-6">
        <div className="max-w-7xl mx-auto">
          <span className="text-xs font-mono uppercase text-muted-foreground block mb-12">
            [02] The Sequence
          </span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-24">
            {steps.map((item, i) => (
              <div key={i} className="border-t border-card-border pt-8 group">
                <div className="flex justify-between items-start mb-6">
                  <h3 className="text-3xl font-bold uppercase tracking-tighter group-hover:ml-4 transition-all duration-300">
                    {item.title}
                  </h3>
                  <span className="text-sm font-mono text-muted-foreground">
                    {item.step}
                  </span>
                </div>
                <p className="text-muted-foreground max-w-md text-lg leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Live on testnet: real proof, real contracts */}
      <section className="py-32 px-6 border-t border-card-border">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:items-end mb-16">
            <div className="md:col-span-8">
              <span className="text-xs font-mono uppercase text-muted-foreground block mb-6">
                [03] Proof of life, on-chain
              </span>
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight">
                Not a diagram. A real proof,
                <br />
                verified by Stellar.
              </h2>
            </div>
            <div className="md:col-span-4">
              <p className="text-muted-foreground leading-relaxed">
                A live UltraHonk proof of life was generated in a browser and
                verified on testnet through the LivenessRegistry. These contracts
                are deployed and running right now.
              </p>
            </div>
          </div>

          <a
            href={txUrl(PROOF_TX)}
            target="_blank"
            rel="noreferrer"
            className="block border border-card-border p-6 md:p-8 mb-6 group transition-colors"
            style={{ background: "var(--card)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-mono uppercase" style={{ color: "var(--accent)" }}>
                Verified check-in transaction
              </span>
              <ArrowUpRight className="w-4 h-4 text-muted-foreground transition-colors group-hover:text-foreground" />
            </div>
            <p className="font-mono text-sm md:text-base break-all group-hover:text-foreground transition-colors">
              {PROOF_TX}
            </p>
          </a>

          <div className="grid grid-cols-1 sm:grid-cols-2 border border-card-border divide-y sm:divide-y-0 divide-card-border">
            {deployed.map((c, i) => (
              <a
                key={c.name}
                href={contractUrl(c.id)}
                target="_blank"
                rel="noreferrer"
                className={`p-6 group transition-colors hover:bg-[var(--card)] ${
                  i % 2 === 0 ? "sm:border-r border-card-border" : ""
                } ${i < 2 ? "sm:border-b border-card-border" : ""}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-base font-bold tracking-tight">{c.name}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
                </div>
                <span className="text-[10px] font-mono uppercase text-muted-foreground block mb-2">
                  {c.role}
                </span>
                <span className="font-mono text-xs text-muted-foreground break-all">
                  {c.id.slice(0, 10)}…{c.id.slice(-6)}
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom ticker */}
      <div className="w-full py-4 overflow-hidden border-y border-card-border flex relative mt-24">
        <motion.div
          animate={{ x: [-1035, 0] }}
          transition={{ ease: "linear", duration: 20, repeat: Infinity }}
          className="flex whitespace-nowrap gap-16 text-xs text-muted-foreground font-mono uppercase items-center"
        >
          {Array(10)
            .fill(0)
            .map((_, i) => (
              <span key={i} className="flex items-center gap-16">
                <span>CRYPTOGRAPHIC LEGACY MANAGEMENT</span>
                <span>+++</span>
                <span>THE PROTOCOL DEMANDS SILENCE</span>
                <span>+++</span>
              </span>
            ))}
        </motion.div>
      </div>

      {/* Footer */}
      <footer className="pt-24 pb-8 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-24">
            <div className="md:col-span-2">
              <span className="text-[10px] font-mono text-muted-foreground uppercase block mb-4">
                --- Fragments of Trust, Gently Returned.
              </span>
              <h2 className="text-4xl font-bold tracking-tight max-w-sm leading-tight">
                Some legacies are meant to stay quiet.
              </h2>
            </div>

            <div>
              <span className="text-[10px] font-mono text-muted-foreground uppercase block mb-4">
                Network
              </span>
              <ul className="space-y-2 text-sm">
                <li>Stellar Testnet</li>
                <li>Soroban Smart Contracts</li>
              </ul>
            </div>

            <div>
              <span className="text-[10px] font-mono text-muted-foreground uppercase block mb-4">
                Explore
              </span>
              <ul className="space-y-2 text-sm">
                <li>
                  <a
                    href="https://testnet.stellarchain.io"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-muted-foreground transition-colors"
                  >
                    Stellar Expert
                  </a>
                </li>
                <li>
                  <a
                    href="https://soroban-testnet.stellar.org"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-muted-foreground transition-colors"
                  >
                    Soroban RPC
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-center justify-between pt-8 border-t border-card-border text-xs font-mono text-muted-foreground uppercase">
            <p>&copy; 2026 Obol Protocol. All rights reserved.</p>
            <div className="flex gap-4 mt-4 md:mt-0">
              <span>Testnet Demo</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
