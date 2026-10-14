#!/bin/sh
# Build the wasm module of the tests (target/wasm32-unknown-unknown/release/s6wasm.wasm).
set -eu
cd "$(dirname "$0")/.."
cargo build --release --locked -p s6wasm --target wasm32-unknown-unknown
