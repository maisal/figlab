#!/bin/sh
# The accuracy, bounds, and determinism tests (no timing).
# - Runs the tests natively and in wasm (Node), and compares the bits.
# - Builds cmpfit a second time with -ffp-contract=on (the clang default
#   on arm64) and compares that too.
# - Runs MGH10 from start 1 in the loose box with a higher iteration limit.
# - Writes results/determinism.json, results/mgh10-box.json,
#   results/tables.md, and results/nist-summary.json. The raw records go to
#   target/s6-results/.
set -eu
cd "$(dirname "$0")/.."
[ -d downloads/lm-bounded ] || ./scripts/fetch.sh
cargo test --release --locked -p s6fit
cargo build --release --locked -p s6cli
./target/release/s6cli all --out target/s6-results/native
./scripts/build-wasm.sh
node js/run-wasm.mjs target/s6-results/wasm
S6_FP_CONTRACT=on CARGO_TARGET_DIR=target/contract-on cargo build --release --locked -p s6cli
./target/contract-on/release/s6cli all --out target/s6-results/native-contract-on
rm -f results/determinism.json
node js/compare.mjs target/s6-results/native target/s6-results/wasm \
    "native (cmpfit -ffp-contract=off) vs wasm" --out results/determinism.json
node js/compare.mjs target/s6-results/native-contract-on target/s6-results/wasm \
    "native (cmpfit -ffp-contract=on, the clang default) vs wasm" --out results/determinism.json
./target/release/s6cli mgh10 --maxiter 20000
node js/summary.mjs target/s6-results/native > /dev/null
echo "wrote results/tables.md and results/nist-summary.json"
