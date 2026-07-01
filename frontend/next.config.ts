import type { NextConfig } from "next";

// Turbopack (Next.js 16 default) handles the Barretenberg (bb.js) WASM proving
// backend natively — no custom webpack loader/polyfill config is required. bb.js
// and noir_js are imported dynamically (client-only) in src/lib/prover.ts.
const nextConfig: NextConfig = {
  turbopack: {},
  // bb.js / noir_js are used client-only (dynamic import in src/lib/prover.ts).
  // Marking them external keeps the server file-tracer from following their
  // Node-only code paths (e.g. worker_threads), which otherwise breaks the
  // production build.
  serverExternalPackages: ["@aztec/bb.js", "@noir-lang/noir_js"],
};

export default nextConfig;
