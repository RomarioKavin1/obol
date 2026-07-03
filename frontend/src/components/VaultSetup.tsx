"use client";

/**
 * Vault creation wizard — the owner-side entry point to the protocol.
 *
 * Four steps: (1) generate {nullifier, secret} in-browser (prover.ts) and force
 * an identity backup download before continuing — it is the owner's ONLY key;
 * (2) pick the check-in interval; (3) enter the beneficiary's Stellar address;
 * (4) deposit MockToken. The final deploy generates a random 32-byte salt,
 * derives vault_commitment via the VaultController's derive_commitment view
 * (so client and contract can never disagree on the hash), then submits two
 * wallet-signed transactions: LivenessRegistry.register(identity_commitment,
 * vault_commitment, interval) and VaultController.deposit.
 *
 * Identity and vault metadata (commitment, salt, beneficiary, interval) are
 * persisted to localStorage via lib/identity.ts; the success screen surfaces
 * the vault commitment + salt because the beneficiary needs the salt (with
 * their own address) to claim later. Nothing secret ever goes on-chain: the
 * beneficiary is hidden behind the commitment until claim.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Key,
  Clock,
  Coins,
  Check,
  ChevronRight,
  Download,
  AlertTriangle,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@/lib/wallet";
import {
  generateSecrets,
  computeIdentityCommitment,
} from "@/lib/prover";
import {
  storeIdentity,
  exportIdentityBackup,
  storeVault,
  type Identity,
} from "@/lib/identity";
import {
  deriveVaultCommitment,
  registerIdentity,
  depositToVault,
} from "@/lib/stellar";
import { CONTRACTS, txUrl } from "@/lib/config";
import { FaucetButton } from "@/components/FaucetButton";
import {
  bigintToBytes32,
  bytesToHex,
  isValidStellarAddress,
  parseTokenAmount,
} from "@/lib/format";

const STEPS = [
  { id: 1, title: "Generate Identity", icon: Key },
  { id: 2, title: "Configure Interval", icon: Clock },
  { id: 3, title: "Beneficiary", icon: Shield },
  { id: 4, title: "Deposit", icon: Coins },
];

// 60s default is intentional for the live demo so a full lifecycle (register ->
// miss -> activate -> claim) can be observed in minutes. Real deployments would
// pick days/weeks.
const INTERVAL_OPTIONS = [
  { label: "Demo (60s)", seconds: 60, note: "60 seconds between check-ins" },
  { label: "Hourly", seconds: 3600, note: "1 hour between check-ins" },
  { label: "Daily", seconds: 86400, note: "24 hours between check-ins" },
  { label: "Weekly", seconds: 7 * 86400, note: "7 days between check-ins" },
];

export function VaultSetup() {
  const { address } = useWallet();

  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  // Step 1
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [identityBackedUp, setIdentityBackedUp] = useState(false);

  // Step 2
  const [selectedInterval, setSelectedInterval] = useState(INTERVAL_OPTIONS[0]);

  // Step 3
  const [beneficiary, setBeneficiary] = useState("");

  // Step 4
  const [depositAmount, setDepositAmount] = useState("");

  // Result
  const [deployed, setDeployed] = useState<{
    vaultCommitment: string;
    salt: string;
    registerTx: string;
    depositTx: string;
  } | null>(null);

  const handleGenerateIdentity = async () => {
    setIsLoading(true);
    try {
      const { nullifier, secret } = generateSecrets();
      const commitment = await computeIdentityCommitment(nullifier, secret);
      const id: Identity = { nullifier, secret, commitment };
      setIdentity(id);
      storeIdentity(id);
      toast.success("Identity generated.");
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate identity.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportBackup = () => {
    if (!identity) return;
    exportIdentityBackup(identity);
    setIdentityBackedUp(true);
    toast.success("Identity backup downloaded.");
  };

  const handleDeploy = async () => {
    if (!address || !identity) {
      toast.error("Connect a wallet first.");
      return;
    }
    if (!isValidStellarAddress(beneficiary)) {
      toast.error("Beneficiary must be a valid Stellar address (G...).");
      return;
    }
    const amountRaw = parseTokenAmount(depositAmount);
    if (amountRaw <= 0n) {
      toast.error("Enter a valid deposit amount.");
      return;
    }

    setIsLoading(true);
    try {
      // Random 32-byte salt for the vault commitment.
      const saltBytes = new Uint8Array(32);
      crypto.getRandomValues(saltBytes);
      const saltHex = bytesToHex(saltBytes);

      toast.loading("Deriving vault commitment...", { id: "deploy" });
      // vault_commitment = derive_commitment(recipient, salt)  (on-chain view)
      const vaultCommitment = await deriveVaultCommitment(beneficiary, saltBytes);
      const vaultHex = bytesToHex(vaultCommitment);

      // identity_commitment as BytesN<32>
      const identityCommitment = bigintToBytes32(identity.commitment);

      // "encrypted_beneficiary" — a demo placeholder blob. This is NOT real
      // encryption: we store the beneficiary address bytes so the vault record
      // carries a hint. A production build would encrypt this to the heir's key.
      const encryptedBeneficiary = new TextEncoder().encode(beneficiary);

      toast.loading("Registering identity on Stellar...", { id: "deploy" });
      const registerRes = await registerIdentity(
        address,
        identityCommitment,
        vaultCommitment,
        selectedInterval.seconds
      );

      toast.loading("Depositing tokens into the vault...", { id: "deploy" });
      const depositRes = await depositToVault(
        address,
        address,
        vaultCommitment,
        encryptedBeneficiary,
        CONTRACTS.mockToken,
        amountRaw
      );

      storeVault({
        vaultCommitment: vaultHex,
        salt: saltHex,
        beneficiary,
        intervalSeconds: selectedInterval.seconds,
        createdAt: Date.now(),
      });

      setDeployed({
        vaultCommitment: vaultHex,
        salt: saltHex,
        registerTx: registerRes.hash,
        depositTx: depositRes.hash,
      });
      toast.success("Vault deployed!", { id: "deploy", duration: 6000 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      toast.error(`Deployment failed: ${msg}`, { id: "deploy" });
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return identity !== null && identityBackedUp;
      case 2:
        return selectedInterval.seconds > 0;
      case 3:
        return isValidStellarAddress(beneficiary);
      case 4:
        return parseTokenAmount(depositAmount || "0") > 0n;
      default:
        return false;
    }
  };

  const copy = (v: string, label: string) => {
    navigator.clipboard.writeText(v);
    toast.success(`${label} copied.`);
  };

  // -------------------------------------------------------------------------
  // Success screen
  // -------------------------------------------------------------------------
  if (deployed) {
    return (
      <div className="max-w-2xl mx-auto">
        <div
          className="p-8 rounded-none"
          style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
        >
          <div className="flex items-center gap-3 mb-6">
            <Check className="w-8 h-8" style={{ color: "var(--success)" }} />
            <div>
              <h2 className="text-2xl font-bold">Vault Deployed</h2>
              <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                Share the two values below with your beneficiary. They need both to
                claim once the vault activates.
              </p>
            </div>
          </div>

          <div
            className="p-4 rounded-none mb-4"
            style={{ background: "var(--background)", border: "1px solid var(--card-border)" }}
          >
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                Vault Commitment
              </p>
              <button onClick={() => copy(deployed.vaultCommitment, "Vault commitment")}>
                <Copy className="w-3.5 h-3.5" style={{ color: "var(--muted-foreground)" }} />
              </button>
            </div>
            <p className="text-xs font-mono break-all">{deployed.vaultCommitment}</p>
          </div>

          <div
            className="p-4 rounded-none mb-6"
            style={{ background: "var(--background)", border: "1px solid var(--card-border)" }}
          >
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                Claim Salt (secret)
              </p>
              <button onClick={() => copy(deployed.salt, "Salt")}>
                <Copy className="w-3.5 h-3.5" style={{ color: "var(--muted-foreground)" }} />
              </button>
            </div>
            <p className="text-xs font-mono break-all">{deployed.salt}</p>
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <a
              href={txUrl(deployed.registerTx)}
              target="_blank"
              rel="noreferrer"
              className="underline"
              style={{ color: "var(--muted-foreground)" }}
            >
              View register tx
            </a>
            <a
              href={txUrl(deployed.depositTx)}
              target="_blank"
              rel="noreferrer"
              className="underline"
              style={{ color: "var(--muted-foreground)" }}
            >
              View deposit tx
            </a>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Wizard
  // -------------------------------------------------------------------------
  return (
    <div className="max-w-2xl mx-auto">
      {/* Step indicators */}
      <div className="flex items-center justify-between mb-10">
        {STEPS.map((step, i) => (
          <div key={step.id} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all"
                style={{
                  background:
                    currentStep > step.id
                      ? "var(--success)"
                      : currentStep === step.id
                        ? "var(--primary)"
                        : "var(--card)",
                  border:
                    currentStep === step.id
                      ? "2px solid var(--primary)"
                      : "2px solid var(--card-border)",
                  color: currentStep >= step.id ? "var(--background)" : "var(--muted-foreground)",
                }}
              >
                {currentStep > step.id ? <Check className="w-5 h-5" /> : step.id}
              </div>
              <span
                className="text-xs mt-2 font-medium hidden sm:block"
                style={{
                  color:
                    currentStep === step.id ? "var(--foreground)" : "var(--muted-foreground)",
                }}
              >
                {step.title}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className="flex-1 h-px mx-3"
                style={{
                  background: currentStep > step.id ? "var(--success)" : "var(--card-border)",
                  minWidth: "40px",
                }}
              />
            )}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="p-8 rounded-none"
          style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
        >
          {/* Step 1 */}
          {currentStep === 1 && (
            <div>
              <h2 className="text-2xl font-bold mb-2">Generate Your Identity</h2>
              <p className="mb-6" style={{ color: "var(--muted-foreground)" }}>
                Your identity is a random nullifier + secret stored only in your browser.
                You use it to generate ZK proofs of liveness without revealing who you are
                on-chain.
              </p>

              {!identity ? (
                <button
                  onClick={handleGenerateIdentity}
                  disabled={isLoading}
                  className="w-full py-4 rounded-none font-semibold text-background transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: "var(--primary)" }}
                >
                  <Key className="w-5 h-5" />
                  {isLoading ? "Generating..." : "Generate Identity"}
                </button>
              ) : (
                <div>
                  <div
                    className="p-4 rounded-none mb-4"
                    style={{ background: "var(--background)", border: "1px solid var(--card-border)" }}
                  >
                    <p className="text-xs font-mono mb-1" style={{ color: "var(--muted-foreground)" }}>
                      Identity Commitment (public)
                    </p>
                    <p className="text-sm font-mono break-all">
                      0x{identity.commitment.toString(16).padStart(64, "0")}
                    </p>
                  </div>

                  <div
                    className="flex items-start gap-3 p-4 rounded-none mb-6"
                    style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)" }}
                  >
                    <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: "var(--accent)" }} />
                    <p className="text-sm" style={{ color: "var(--accent)" }}>
                      <strong>Critical:</strong> Download your identity backup now. It is
                      your ONLY key. If you lose it you cannot prove liveness and your
                      vault will activate after missed check-ins.
                    </p>
                  </div>

                  <button
                    onClick={handleExportBackup}
                    className="w-full py-3 rounded-none font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90"
                    style={{
                      background: identityBackedUp ? "rgba(34,197,94,0.15)" : "var(--accent)",
                      color: identityBackedUp ? "var(--success)" : "var(--background)",
                      border: identityBackedUp ? "1px solid var(--success)" : "none",
                    }}
                  >
                    {identityBackedUp ? (
                      <>
                        <Check className="w-4 h-4" /> Backup Downloaded
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" /> Download Identity Backup
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step 2 */}
          {currentStep === 2 && (
            <div>
              <h2 className="text-2xl font-bold mb-2">Configure Check-in Interval</h2>
              <p className="mb-6" style={{ color: "var(--muted-foreground)" }}>
                How often must you check in? Miss the maximum number of consecutive
                intervals and your vault activates. The 60-second option is for demos so
                the full lifecycle is observable in minutes.
              </p>

              <div className="grid grid-cols-2 gap-3">
                {INTERVAL_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => setSelectedInterval(opt)}
                    className="p-4 rounded-none text-left transition-all"
                    style={{
                      background:
                        selectedInterval.label === opt.label
                          ? "rgba(255,255,255,0.08)"
                          : "var(--background)",
                      border:
                        selectedInterval.label === opt.label
                          ? "2px solid var(--primary)"
                          : "2px solid var(--card-border)",
                    }}
                  >
                    <div className="font-semibold">{opt.label}</div>
                    <div className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
                      {opt.note}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3 */}
          {currentStep === 3 && (
            <div>
              <h2 className="text-2xl font-bold mb-2">Setup Beneficiary</h2>
              <p className="mb-6" style={{ color: "var(--muted-foreground)" }}>
                Enter your beneficiary&apos;s Stellar address. A random secret salt is
                generated at deploy time; the vault commitment is derived on-chain from
                (beneficiary, salt). Only this address, holding the salt, can claim.
              </p>

              <label className="text-sm font-medium mb-2 block">
                Beneficiary Stellar Address
              </label>
              <input
                type="text"
                placeholder="G... (56-char Stellar public key)"
                value={beneficiary}
                onChange={(e) => setBeneficiary(e.target.value)}
                className="w-full px-4 py-3 rounded-none text-sm font-mono"
                style={{
                  background: "var(--background)",
                  border: `1px solid ${
                    beneficiary && !isValidStellarAddress(beneficiary)
                      ? "var(--destructive)"
                      : "var(--card-border)"
                  }`,
                  color: "var(--foreground)",
                  outline: "none",
                }}
              />
              <p className="text-xs mt-2" style={{ color: "var(--muted-foreground)" }}>
                After deploy you will receive the vault commitment + salt to hand to your
                beneficiary.
              </p>
            </div>
          )}

          {/* Step 4 */}
          {currentStep === 4 && (
            <div>
              <h2 className="text-2xl font-bold mb-2">Deposit Assets</h2>
              <p className="mb-6" style={{ color: "var(--muted-foreground)" }}>
                Deposit mock stablecoin into your vault. It transfers to your beneficiary
                when the vault activates. Need funds? Use the faucet below.
              </p>

              <div className="mb-6">
                <FaucetButton compact />
              </div>

              <div className="mb-4">
                <label className="text-sm font-medium mb-2 block">Token</label>
                <div
                  className="w-full px-4 py-3 rounded-none text-xs font-mono break-all"
                  style={{ background: "var(--background)", border: "1px solid var(--card-border)", color: "var(--muted-foreground)" }}
                >
                  MockToken · {CONTRACTS.mockToken}
                </div>
              </div>

              <div className="mb-6">
                <label className="text-sm font-medium mb-2 block">Amount (MockToken)</label>
                <input
                  type="number"
                  placeholder="100"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full px-4 py-3 rounded-none text-sm"
                  style={{
                    background: "var(--background)",
                    border: "1px solid var(--card-border)",
                    color: "var(--foreground)",
                    outline: "none",
                  }}
                />
                <p className="text-xs mt-2" style={{ color: "var(--muted-foreground)" }}>
                  You must hold MockToken. It is mintable only by the contract deployer.
                  see the README for how to fund a demo account.
                </p>
              </div>

              <button
                onClick={handleDeploy}
                disabled={isLoading || !address}
                className="w-full py-4 rounded-none font-bold text-background transition-all hover:opacity-90 disabled:opacity-50"
                style={{ background: "var(--primary)" }}
              >
                {isLoading
                  ? "Deploying..."
                  : !address
                    ? "Connect a Wallet First"
                    : "Register + Deposit on Stellar"}
              </button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <button
          onClick={() => setCurrentStep((s) => Math.max(1, s - 1))}
          disabled={currentStep === 1}
          className="px-6 py-3 rounded-none font-medium transition-all hover:opacity-80 disabled:opacity-30"
          style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
        >
          Back
        </button>

        {currentStep < 4 && (
          <button
            onClick={() => setCurrentStep((s) => Math.min(4, s + 1))}
            disabled={!canProceed()}
            className="px-6 py-3 rounded-none font-semibold text-background flex items-center gap-2 transition-all hover:opacity-90 disabled:opacity-40"
            style={{ background: "var(--primary)" }}
          >
            Continue
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
