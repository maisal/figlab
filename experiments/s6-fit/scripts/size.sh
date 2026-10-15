#!/bin/sh
# The wasm size of each candidate: a minimal module with one gauss fit
# (crates/s6size), built with opt-level "z", LTO, and panic=abort, then
# wasm-opt -Oz. Prints the sizes and writes results/size.json.
set -eu
cd "$(dirname "$0")/.."
out=target/size
mkdir -p "$out"
json="["
sep=""
for f in base lm lm-transform lm-bounded cmpfit rmpfit; do
    cargo build --locked -q --profile size -p s6size --target wasm32-unknown-unknown \
        --no-default-features --features "$f"
    cp target/wasm32-unknown-unknown/size/s6size.wasm "$out/$f.raw.wasm"
    mise exec aqua:WebAssembly/binaryen@133 -- wasm-opt -Oz --strip-debug --strip-producers \
        --enable-bulk-memory --enable-bulk-memory-opt --enable-nontrapping-float-to-int \
        --enable-sign-ext --enable-mutable-globals --enable-multivalue --enable-reference-types \
        "$out/$f.raw.wasm" -o "$out/$f.wasm"
    raw=$(wc -c < "$out/$f.raw.wasm" | tr -d ' ')
    opt=$(wc -c < "$out/$f.wasm" | tr -d ' ')
    gz=$(gzip -9 -n -c "$out/$f.wasm" | wc -c | tr -d ' ')
    br=$(brotli -q 11 -c "$out/$f.wasm" | wc -c | tr -d ' ')
    printf '%-13s cargo %7d  wasm-opt -Oz %7d  gzip -9 %7d  brotli -q 11 %7d\n' "$f" "$raw" "$opt" "$gz" "$br"
    json="$json$sep{\"module\":\"$f\",\"cargo\":$raw,\"wasm_opt_oz\":$opt,\"gzip\":$gz,\"brotli\":$br}"
    sep=","
done
echo "$json]" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(JSON.parse(s),null,1)+"\n"))' > results/size.json
echo "wrote results/size.json"
