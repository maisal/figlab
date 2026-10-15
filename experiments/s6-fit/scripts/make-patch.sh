#!/bin/sh
# Write patches/lm-bounded.patch from the edited fork in downloads/lm-bounded.
# Use it only after you change the fork. scripts/fetch.sh applies the patch.
set -eu
cd "$(dirname "$0")/../downloads"
out=../patches/lm-bounded.patch
: > "$out"
for f in src/lm.rs src/problem.rs src/qr.rs src/utils.rs; do
    diff -u --label "a/$f" --label "b/$f" \
        "lm-orig/levenberg-marquardt-0.15.0/$f" "lm-bounded/$f" >> "$out" || true
done
echo "wrote patches/lm-bounded.patch"
