#!/usr/bin/env bash
#
# build_contracts.sh — compile every Obol Soroban contract to wasm.
#
# Runs `stellar contract build`, which builds all workspace members for the
# wasm32v1-none target in release mode, then lists the produced .wasm files.
#
# Toolchain:
#   * Rust + wasm32v1-none target  (rustup target add wasm32v1-none)
#   * Stellar CLI                  (stellar contract build)
#
# Usage:  ./scripts/build_contracts.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# nargo/bb not needed here, but keep PATH consistent across all Obol scripts.
export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

echo "==> Obol :: build_contracts"
echo "    repo root : $REPO_ROOT"
echo "    stellar   : $(command -v stellar || echo 'NOT FOUND')"

cd "$REPO_ROOT/contracts"

echo "==> stellar contract build"
stellar contract build

WASM_DIR="$REPO_ROOT/contracts/target/wasm32v1-none/release"
echo "==> Built wasm artifacts in $WASM_DIR :"
ls -lh "$WASM_DIR"/*.wasm

echo "==> Done."
