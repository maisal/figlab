#!/usr/bin/env bash
# Runs every step of S1 in order. Sizes and correctness results are final.
# Timing (the last two steps) is preliminary when other jobs run on the machine.
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/fetch-fonts.sh
mise exec -- pnpm install --frozen-lockfile
mise exec -- cargo run --release -q --locked -p s1-native --bin compare
mise exec -- cargo run --release -q --locked -p s1-native --bin coverage > /dev/null
mise exec -- cargo run --release -q --locked -p s1-native --bin outputs
./scripts/build-wasm.sh
mise exec -- pnpm run -s check:wasm
./scripts/check-pdf.sh > /dev/null
echo "PDF checks: results/pdf-check.txt"
# Timing.
mise exec -- cargo run --release -q --locked -p s1-native --bin measure
mise exec -- pnpm run -s measure
