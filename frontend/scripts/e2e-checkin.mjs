/**
 * Headless end-to-end test of the browser proving pipeline against the LIVE
 * testnet deployment. Mirrors src/lib/prover.ts exactly:
 *
 *   1. generate two identities, register both on-chain (leaf 0 and leaf 1)
 *   2. fetch the real on-chain leaves (get_leaves)
 *   3. build the Merkle witness for the SECOND identity (non-trivial path bits)
 *   4. generate the UltraHonk proof (bb.js, keccak oracle) for the current epoch
 *   5. submit checkin on-chain via the stellar CLI and require success
 *
 * Run from frontend/:  node scripts/e2e-checkin.mjs
 * Requires the `obol-deployer` CLI identity (used as tx source).
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Barretenberg, Fr, UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";

const REGISTRY = "CD2NYC2U3OKZ5Z355H3UXE3MVUWCROWRFEH4UQ6NGIPCYYGDS3VDWSLC";
const CLI_CWD = process.env.STELLAR_CLI_CWD ?? `${process.env.HOME}/Documents/Stellar hack`;
const TREE_DEPTH = 20;
const INTERVAL = 60n;

const cli = (args) =>
  execSync(`stellar contract invoke --id ${REGISTRY} --source obol-deployer --network testnet -- ${args}`, {
    cwd: CLI_CWD,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const toBytes = (n) => {
  const h = n.toString(16).padStart(64, "0");
  return Uint8Array.from({ length: 32 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));
};
const toHex = (n) => n.toString(16).padStart(64, "0");
const hex0x = (n) => "0x" + toHex(n);
const bytesToBig = (b) => b.reduce((a, x) => (a << 8n) | BigInt(x), 0n);
const rand = () => bytesToBig(crypto.getRandomValues(new Uint8Array(31)));

const bb = await Barretenberg.new({ threads: 1 });
const h2 = async (a, b) => bytesToBig((await bb.poseidon2Hash([new Fr(toBytes(a)), new Fr(toBytes(b))])).toBuffer());

// --- 1. two identities, register both --------------------------------------
const idA = { nullifier: rand(), secret: rand() };
const idB = { nullifier: rand(), secret: rand() };
const commitA = await h2(idA.nullifier, idA.secret);
const commitB = await h2(idB.nullifier, idB.secret);

console.log("registering identity A (filler leaf)...");
cli(`register --identity_commitment ${toHex(commitA)} --vault_commitment ${toHex(rand())} --interval_seconds 60`);
console.log("registering identity B (the one we prove)...");
cli(`register --identity_commitment ${toHex(commitB)} --vault_commitment ${toHex(rand())} --interval_seconds 60`);

// --- 2. fetch real on-chain leaves ------------------------------------------
const leavesJson = JSON.parse(cli(`get_leaves --start 0 --end 100`));
const leaves = leavesJson.map((h) => BigInt("0x" + h));
console.log(`on-chain leaves: ${leaves.length}`);
const leafIndex = leaves.findIndex((l) => l === commitB);
if (leafIndex < 1) throw new Error(`expected identity B at index >= 1, got ${leafIndex}`);
console.log(`identity B is leaf ${leafIndex}`);

// --- 3. Merkle witness (same algorithm as src/lib/prover.ts) ---------------
const zeroes = [0n];
for (let i = 0; i < TREE_DEPTH; i++) zeroes.push(await h2(zeroes[i], zeroes[i]));
const path_siblings = [];
const path_bits = [];
let level = leaves.slice();
let idx = leafIndex;
for (let d = 0; d < TREE_DEPTH; d++) {
  const bit = idx & 1;
  const sib = bit === 0 ? idx + 1 : idx - 1;
  path_siblings.push(sib < level.length ? level[sib] : zeroes[d]);
  path_bits.push(bit);
  const next = [];
  for (let i = 0; i < level.length; i += 2) {
    next.push(await h2(level[i], i + 1 < level.length ? level[i + 1] : zeroes[d]));
  }
  if (next.length === 0) next.push(await h2(zeroes[d], zeroes[d]));
  level = next;
  idx >>= 1;
}
const root = level[0];

const onchainRoot = BigInt("0x" + JSON.parse(cli(`get_root`)));
if (root !== onchainRoot) throw new Error(`local root ${toHex(root)} != on-chain ${toHex(onchainRoot)}`);
console.log("local root == on-chain root ✓");

// --- 4. prove for the current epoch -----------------------------------------
const epoch = BigInt(Math.floor(Date.now() / 1000)) / INTERVAL;
const nullifier_hash = await h2(idB.nullifier, epoch);
const inputs = {
  root: hex0x(root),
  identity_commitment: hex0x(commitB),
  nullifier_hash: hex0x(nullifier_hash),
  epoch: hex0x(epoch),
  nullifier: hex0x(idB.nullifier),
  secret: hex0x(idB.secret),
  path_siblings: path_siblings.map(hex0x),
  path_bits: path_bits.map((b) => (b === 0 ? "0x0" : "0x1")),
};
const circuit = JSON.parse(readFileSync(new URL("../public/circuits/liveness.json", import.meta.url), "utf8"));
console.log("computing witness...");
const noir = new Noir(circuit);
const { witness } = await noir.execute(inputs);
console.log("generating UltraHonk proof (keccak)...");
const backend = new UltraHonkBackend(circuit.bytecode, { threads: 1 });
const { proof } = await backend.generateProof(witness, { keccak: true });
console.log(`proof bytes: ${proof.length}`);

// --- 5. submit checkin -------------------------------------------------------
const pub = toHex(root) + toHex(commitB) + toHex(nullifier_hash) + toHex(epoch);
const proofHex = Buffer.from(proof).toString("hex");
console.log("submitting checkin on-chain...");
cli(`checkin --public_inputs ${pub} --proof_bytes ${proofHex}`);
console.log("CHECKIN VERIFIED ON-CHAIN ✓ (multi-leaf witness, leaf index " + leafIndex + ")");
process.exit(0);
