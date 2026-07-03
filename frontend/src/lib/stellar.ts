/**
 * Soroban contract interaction layer for Obol Protocol.
 *
 * Reads are done by simulating an invocation and decoding the return value.
 * Writes build a tx -> simulate -> assemble -> sign with Freighter -> submit ->
 * poll for success.
 *
 * All contract addresses / network config come from lib/config.ts.
 */

import {
  rpc,
  TransactionBuilder,
  Contract,
  Account,
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
  BASE_FEE,
} from "@stellar/stellar-sdk";
// Import Buffer from the `buffer` polyfill (a stellar-sdk dependency) so this
// works in the browser bundle where the global Buffer is not defined.
import { Buffer } from "buffer";
import {
  RPC_URL,
  NETWORK_PASSPHRASE,
  READ_SOURCE,
  HORIZON_URL,
  CONTRACTS,
} from "./config";
import { signWithWallet } from "./wallet";
import { bytesToHex } from "./format";

export const server = new rpc.Server(RPC_URL, {
  allowHttp: RPC_URL.startsWith("http://"),
});

// ---------------------------------------------------------------------------
// ScVal builders
// ---------------------------------------------------------------------------

/** BytesN<32> or variable Bytes argument. */
export function scvBytes(bytes: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.from(bytes));
}

export function scvAddress(addr: string): xdr.ScVal {
  return new Address(addr).toScVal();
}

export function scvI128(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "i128" });
}

export function scvU64(value: number | bigint): xdr.ScVal {
  return nativeToScVal(BigInt(value), { type: "u64" });
}

export function scvU32(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: "u32" });
}

// ---------------------------------------------------------------------------
// Generic read (simulate) + write (submit)
// ---------------------------------------------------------------------------

/**
 * Simulate a contract call and decode the return value to a native JS value.
 * Used for all view methods. Does not require a wallet.
 */
export async function readContract(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = []
): Promise<unknown> {
  const contract = new Contract(contractId);
  // A source account is required to build the tx; simulation of a read-only
  // call never touches this account's balance or sequence number.
  const source = new Account(READ_SOURCE, "0");
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed for ${method}: ${sim.error}`);
  }
  const retval = sim.result?.retval;
  if (!retval) return null;
  return scValToNative(retval);
}

export interface WriteResult {
  hash: string;
  returnValue: unknown;
}

/**
 * Build, simulate, assemble, sign (Freighter) and submit a state-changing call.
 * Polls getTransaction until the tx is final.
 */
export async function invokeContract(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  walletAddress: string
): Promise<WriteResult> {
  const contract = new Contract(contractId);
  const source = await server.getAccount(walletAddress);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(120)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed for ${method}: ${sim.error}`);
  }

  // assembleTransaction attaches the Soroban footprint, resource fees, and any
  // required authorization entries from the simulation.
  const prepared = rpc.assembleTransaction(tx, sim).build();

  const signedXdr = await signWithWallet(prepared.toXDR(), walletAddress);
  const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);

  const sendResp = await server.sendTransaction(signedTx);
  if (sendResp.status === "ERROR") {
    throw new Error(
      `Submission failed: ${JSON.stringify(sendResp.errorResult ?? sendResp)}`
    );
  }

  // Poll until the tx leaves the NOT_FOUND (pending) state.
  const hash = sendResp.hash;
  let getResp = await server.getTransaction(hash);
  const start = Date.now();
  while (getResp.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    if (Date.now() - start > 60_000) {
      throw new Error(`Timed out waiting for tx ${hash}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
    getResp = await server.getTransaction(hash);
  }

  if (getResp.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    // A tx can pass simulation yet fail at execution (e.g. the check-in epoch
    // rolls over while the wallet prompt is open). Surface the actual contract
    // error code so callers can give a targeted message instead of "FAILED".
    const contractError = await fetchContractError(hash);
    throw new Error(
      `Transaction ${hash} failed: ${contractError ?? getResp.status}`
    );
  }

  let returnValue: unknown = null;
  if (getResp.returnValue) {
    try {
      returnValue = scValToNative(getResp.returnValue);
    } catch {
      returnValue = null;
    }
  }
  return { hash, returnValue };
}

/**
 * Best-effort: pull a failed transaction's diagnostic events from the RPC and
 * extract the first contract error, formatted like the simulation errors
 * ("Error(Contract, #10)") so downstream error matching works for both paths.
 */
async function fetchContractError(hash: string): Promise<string | null> {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: { hash },
      }),
    });
    const json = (await res.json()) as {
      result?: { diagnosticEventsXdr?: string[] };
    };
    for (const b64 of json.result?.diagnosticEventsXdr ?? []) {
      const de = xdr.DiagnosticEvent.fromXDR(b64, "base64");
      for (const topic of de.event().body().v0().topics()) {
        if (topic.switch() !== xdr.ScValType.scvError()) continue;
        const err = topic.error();
        if (err.switch() === xdr.ScErrorType.sceContract()) {
          return `Error(Contract, #${err.contractCode()})`;
        }
      }
    }
  } catch {
    /* diagnostics are a nicety; fall back to the bare status */
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ledger time / epoch
// ---------------------------------------------------------------------------

/**
 * Current ledger close time (unix seconds). The LivenessRegistry validates
 * `epoch == ledger_timestamp / interval`, so check-ins must use the ledger's
 * notion of time. We read the latest closed ledger from Horizon; if that is
 * unavailable we fall back to the local wall clock (Soroban ledger time tracks
 * wall-clock closely, within a few seconds).
 */
export async function getLedgerTime(): Promise<number> {
  try {
    const resp = await fetch(
      `${HORIZON_URL}/ledgers?order=desc&limit=1`,
      { headers: { Accept: "application/json" } }
    );
    if (resp.ok) {
      const json = await resp.json();
      const closedAt = json?._embedded?.records?.[0]?.closed_at;
      if (closedAt) {
        return Math.floor(new Date(closedAt).getTime() / 1000);
      }
    }
  } catch {
    /* fall through to wall clock */
  }
  return Math.floor(Date.now() / 1000);
}

/** epoch = floor(ledgerTime / intervalSeconds). */
export async function getCurrentEpoch(intervalSeconds: number): Promise<bigint> {
  const t = await getLedgerTime();
  return BigInt(Math.floor(t / intervalSeconds));
}

// ---------------------------------------------------------------------------
// LivenessRegistry
// ---------------------------------------------------------------------------

export async function registerIdentity(
  wallet: string,
  identityCommitment: Uint8Array,
  vaultCommitment: Uint8Array,
  intervalSeconds: number
): Promise<WriteResult> {
  return invokeContract(
    CONTRACTS.livenessRegistry,
    "register",
    [scvBytes(identityCommitment), scvBytes(vaultCommitment), scvU64(intervalSeconds)],
    wallet
  );
}

export async function submitCheckin(
  wallet: string,
  publicInputs: Uint8Array,
  proofBytes: Uint8Array
): Promise<WriteResult> {
  return invokeContract(
    CONTRACTS.livenessRegistry,
    "checkin",
    [scvBytes(publicInputs), scvBytes(proofBytes)],
    wallet
  );
}

export async function reportMissed(
  wallet: string,
  reporter: string,
  identityCommitment: Uint8Array
): Promise<WriteResult> {
  return invokeContract(
    CONTRACTS.livenessRegistry,
    "report_missed",
    [scvAddress(reporter), scvBytes(identityCommitment)],
    wallet
  );
}

export async function getRoot(): Promise<string | null> {
  const v = (await readContract(CONTRACTS.livenessRegistry, "get_root")) as
    | Uint8Array
    | null;
  return v ? bytesToHex(v) : null;
}

export async function getMemberCount(): Promise<number> {
  return Number((await readContract(CONTRACTS.livenessRegistry, "get_member_count")) ?? 0);
}

/**
 * Fetch every leaf of the on-chain anonymity set, as bigints. The prover uses
 * these to rebuild the Merkle tree client-side and derive a witness for any
 * member, so check-ins keep working as the tree grows.
 */
export async function getAllLeaves(): Promise<bigint[]> {
  const count = await getMemberCount();
  const leaves: bigint[] = [];
  const CHUNK = 50;
  for (let start = 0; start < count; start += CHUNK) {
    const chunk = (await readContract(CONTRACTS.livenessRegistry, "get_leaves", [
      scvU32(start),
      scvU32(Math.min(start + CHUNK, count)),
    ])) as Uint8Array[] | null;
    for (const b of chunk ?? []) {
      let n = 0n;
      for (const byte of b) n = (n << 8n) | BigInt(byte);
      leaves.push(n);
    }
  }
  return leaves;
}

export async function isRegistered(identityCommitment: Uint8Array): Promise<boolean> {
  return Boolean(
    await readContract(CONTRACTS.livenessRegistry, "is_registered", [
      scvBytes(identityCommitment),
    ])
  );
}

export async function getLastCheckin(identityCommitment: Uint8Array): Promise<number> {
  return Number(
    (await readContract(CONTRACTS.livenessRegistry, "get_last_checkin", [
      scvBytes(identityCommitment),
    ])) ?? 0
  );
}

export async function getMissedCount(identityCommitment: Uint8Array): Promise<number> {
  return Number(
    (await readContract(CONTRACTS.livenessRegistry, "get_missed_count", [
      scvBytes(identityCommitment),
    ])) ?? 0
  );
}

export async function getVaultCommitmentFor(
  identityCommitment: Uint8Array
): Promise<string | null> {
  const v = (await readContract(CONTRACTS.livenessRegistry, "get_vault_commitment", [
    scvBytes(identityCommitment),
  ])) as Uint8Array | null;
  return v ? bytesToHex(v) : null;
}

export async function getInterval(identityCommitment: Uint8Array): Promise<number> {
  return Number(
    (await readContract(CONTRACTS.livenessRegistry, "get_interval", [
      scvBytes(identityCommitment),
    ])) ?? 0
  );
}

export async function getMaxMissed(): Promise<number> {
  return Number((await readContract(CONTRACTS.livenessRegistry, "get_max_missed")) ?? 0);
}

export async function isNullifierUsed(nullifierHash: Uint8Array): Promise<boolean> {
  return Boolean(
    await readContract(CONTRACTS.livenessRegistry, "is_nullifier_used", [
      scvBytes(nullifierHash),
    ])
  );
}

// ---------------------------------------------------------------------------
// VaultController
// ---------------------------------------------------------------------------

/** derive_commitment(recipient, salt) -> BytesN<32> (view). */
export async function deriveVaultCommitment(
  recipient: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  const v = (await readContract(CONTRACTS.vaultController, "derive_commitment", [
    scvAddress(recipient),
    scvBytes(salt),
  ])) as Uint8Array;
  return v instanceof Uint8Array ? v : Uint8Array.from(v as number[]);
}

export async function depositToVault(
  wallet: string,
  from: string,
  vaultCommitment: Uint8Array,
  encryptedBeneficiary: Uint8Array,
  tokenAddr: string,
  amount: bigint
): Promise<WriteResult> {
  return invokeContract(
    CONTRACTS.vaultController,
    "deposit",
    [
      scvAddress(from),
      scvBytes(vaultCommitment),
      scvBytes(encryptedBeneficiary),
      scvAddress(tokenAddr),
      scvI128(amount),
    ],
    wallet
  );
}

export async function claimVault(
  wallet: string,
  vaultCommitment: Uint8Array,
  salt: Uint8Array,
  recipient: string
): Promise<WriteResult> {
  return invokeContract(
    CONTRACTS.vaultController,
    "claim",
    [scvBytes(vaultCommitment), scvBytes(salt), scvAddress(recipient)],
    wallet
  );
}

export async function isActivated(vaultCommitment: Uint8Array): Promise<boolean> {
  return Boolean(
    await readContract(CONTRACTS.vaultController, "is_activated", [
      scvBytes(vaultCommitment),
    ])
  );
}

export async function isClaimed(vaultCommitment: Uint8Array): Promise<boolean> {
  return Boolean(
    await readContract(CONTRACTS.vaultController, "is_claimed", [
      scvBytes(vaultCommitment),
    ])
  );
}

export async function vaultExists(vaultCommitment: Uint8Array): Promise<boolean> {
  return Boolean(
    await readContract(CONTRACTS.vaultController, "vault_exists", [
      scvBytes(vaultCommitment),
    ])
  );
}

export async function getVaultAmount(vaultCommitment: Uint8Array): Promise<bigint> {
  const v = await readContract(CONTRACTS.vaultController, "get_amount", [
    scvBytes(vaultCommitment),
  ]);
  return BigInt((v as bigint | number | null) ?? 0);
}

// ---------------------------------------------------------------------------
// MockToken (SEP-41)
// ---------------------------------------------------------------------------

export async function getTokenBalance(id: string): Promise<bigint> {
  const v = await readContract(CONTRACTS.mockToken, "balance", [scvAddress(id)]);
  return BigInt((v as bigint | number | null) ?? 0);
}

/** Permissionless demo faucet: mint a fixed batch of test tokens to the wallet. */
export async function faucetTokens(walletAddress: string): Promise<WriteResult> {
  return invokeContract(
    CONTRACTS.mockToken,
    "faucet",
    [scvAddress(walletAddress)],
    walletAddress
  );
}

// ---------------------------------------------------------------------------
// KeeperRegistry
// ---------------------------------------------------------------------------

export async function keeperStake(
  wallet: string,
  keeper: string,
  amount: bigint
): Promise<WriteResult> {
  return invokeContract(
    CONTRACTS.keeperRegistry,
    "stake",
    [scvAddress(keeper), scvI128(amount)],
    wallet
  );
}

export async function keeperUnstake(
  wallet: string,
  keeper: string,
  amount: bigint
): Promise<WriteResult> {
  return invokeContract(
    CONTRACTS.keeperRegistry,
    "unstake",
    [scvAddress(keeper), scvI128(amount)],
    wallet
  );
}

export async function getKeeperStake(keeper: string): Promise<bigint> {
  const v = await readContract(CONTRACTS.keeperRegistry, "get_stake", [
    scvAddress(keeper),
  ]);
  return BigInt((v as bigint | number | null) ?? 0);
}

export async function isActiveKeeper(keeper: string): Promise<boolean> {
  return Boolean(
    await readContract(CONTRACTS.keeperRegistry, "is_active_keeper", [
      scvAddress(keeper),
    ])
  );
}

export async function getMinStake(): Promise<bigint> {
  const v = await readContract(CONTRACTS.keeperRegistry, "get_min_stake");
  return BigInt((v as bigint | number | null) ?? 0);
}
