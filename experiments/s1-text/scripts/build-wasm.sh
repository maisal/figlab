#!/usr/bin/env bash
# Builds the wasm module once per candidate set and measures its size.
# Sizes do not depend on machine load, so these numbers are final.
# Output: dist/size/*.wasm, dist/s1_all.wasm (browser module), results/wasm-sizes.{json,md}.
#
# Profile "wasm" (Cargo.toml): opt-level = "z", lto = "fat", codegen-units = 1,
# panic = "abort", strip = true. Then wasm-opt -Oz (binaryen 133).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist/size results

WASM_OPT=(mise exec aqua:WebAssembly/binaryen@133 -- wasm-opt -Oz
  --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext
  --enable-mutable-globals --enable-multivalue --enable-reference-types)

# name | features | what it contains
CONFIGS="
base||allocator and layout code only, no shaper
rb|rb|rustybuzz 0.20 + ttf-parser 0.25 (shaping, outlines, draw data)
hr|hr|harfrust 0.14 + skrifa 0.48 (shaping, outlines, draw data)
hr08|hr08|harfrust 0.8.4 + skrifa 0.42 (shaping, outlines, draw data)
rb+krilla|rb,krilla|rustybuzz + krilla 0.8.2
hr+krilla|hr,krilla|harfrust 0.14 + krilla 0.8.2 (two font stacks: read-fonts 0.45 and 0.39)
hr08+krilla|hr08,krilla|harfrust 0.8.4 + krilla 0.8.2 (one font stack: read-fonts 0.39)
rb+pdfw|rb,pdfw|rustybuzz + pdf-writer 0.15 + subsetter 0.2.6 + skrifa 0.48
hr+pdfw|hr,pdfw|harfrust 0.14 + pdf-writer 0.15 + subsetter 0.2.6 (one font stack: read-fonts 0.45)
"

json="["
md="| Module | Contents | Raw KB | wasm-opt -Oz KB | gzip -9 KB | brotli -q 11 KB |
|---|---|---|---|---|---|
"
first=1
while IFS='|' read -r name feats what; do
  [ -z "$name" ] && continue
  if [ -n "$feats" ]; then
    mise exec -- cargo build -q -p s1-wasm --target wasm32-unknown-unknown --profile wasm --locked --no-default-features --features "$feats"
  else
    mise exec -- cargo build -q -p s1-wasm --target wasm32-unknown-unknown --profile wasm --locked --no-default-features
  fi
  cp target/wasm32-unknown-unknown/wasm/s1_wasm.wasm "dist/size/$name.raw.wasm"
  "${WASM_OPT[@]}" "dist/size/$name.raw.wasm" -o "dist/size/$name.wasm"
  raw=$(wc -c < "dist/size/$name.raw.wasm" | tr -d ' ')
  opt=$(wc -c < "dist/size/$name.wasm" | tr -d ' ')
  gz=$(gzip -9 -c "dist/size/$name.wasm" | wc -c | tr -d ' ')
  br=$(brotli -q 11 -c "dist/size/$name.wasm" | wc -c | tr -d ' ')
  [ $first -eq 0 ] && json="$json,"
  first=0
  json="$json
{\"name\":\"$name\",\"features\":\"$feats\",\"contents\":\"$what\",\"raw\":$raw,\"opt\":$opt,\"gzip\":$gz,\"brotli\":$br}"
  md="$md| $name | $what | $(echo "scale=1; $raw/1024" | bc) | $(echo "scale=1; $opt/1024" | bc) | $(echo "scale=1; $gz/1024" | bc) | $(echo "scale=1; $br/1024" | bc) |
"
  echo "$name: raw $raw, opt $opt, gzip $gz, brotli $br"
done <<< "$CONFIGS"
echo "$json
]" > results/wasm-sizes.json
printf "%s" "$md" > results/wasm-sizes.md

# Duplicate crate versions per candidate set (wasm target, normal dependencies).
{
  for feats in rb hr hr08 rb,krilla hr,krilla hr08,krilla rb,pdfw hr,pdfw; do
    echo "== features: $feats"
    mise exec -- cargo tree -q -p s1-wasm --target wasm32-unknown-unknown -e normal --no-default-features --features "$feats" -d --depth 0 2>/dev/null || true
  done
} > results/cargo-tree-duplicates.txt

# Code size per crate, from builds that keep the name section (before wasm-opt).
{
  for feats in rb hr hr08 rb,krilla hr,krilla hr08,krilla hr,pdfw; do
    echo "== features: $feats"
    mise exec -- cargo build -q -p s1-wasm --target wasm32-unknown-unknown --profile wasm --locked \
      --no-default-features --features "$feats" --config 'profile.wasm.strip=false'
    mise exec -- node scripts/wasm-breakdown.mjs target/wasm32-unknown-unknown/wasm/s1_wasm.wasm | head -14
  done
} > results/wasm-breakdown.txt

# The browser module with every candidate.
mise exec -- cargo build -q -p s1-wasm --target wasm32-unknown-unknown --profile wasm --locked --features all
"${WASM_OPT[@]}" target/wasm32-unknown-unknown/wasm/s1_wasm.wasm -o dist/s1_all.wasm
echo "dist/s1_all.wasm: $(wc -c < dist/s1_all.wasm | tr -d ' ') bytes"
