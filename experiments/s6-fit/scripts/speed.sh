#!/bin/sh
# Time the Quick Fit case: a gauss fit with 100,000 points, natively and in
# wasm under Node. Prints the numbers and writes results/speed-native.json
# and results/speed-wasm.json. Usage: scripts/speed.sh [runs] (default 21)
set -eu
cd "$(dirname "$0")/.."
runs=${1:-21}
cargo build --release --locked -p s6cli
./scripts/build-wasm.sh
./target/release/s6cli speed --runs "$runs"
node js/speed-wasm.mjs "$runs"
