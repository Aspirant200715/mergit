#!/usr/bin/env bash
# Builds the Rust verifier (verifier/wasm) into src/verifier/pkg so the proofs page can verify receipts in the
# browser. Runs in Render's build and in CI; installs Rust and wasm-pack only when they are missing.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v cargo >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain 1.98.0
  . "$HOME/.cargo/env"
fi
rustup target add wasm32-unknown-unknown
command -v wasm-pack >/dev/null || cargo install wasm-pack --locked

# --out-dir is relative to the crate directory.
wasm-pack build ../verifier/wasm --release --target web --out-dir ../../frontend/src/verifier/pkg
