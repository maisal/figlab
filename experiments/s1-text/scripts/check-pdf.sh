#!/usr/bin/env bash
# Checks the PDFs from `cargo run --release -p s1-native --bin outputs` with the
# tools on this machine: poppler (pdfinfo, pdffonts, pdftotext) and Ghostscript.
# Also renders them at 192 dpi (2.667 px per pt, the scale of the Canvas at DPR 2)
# (and at 768 dpi) into dist/pdf-render/ for the Canvas-versus-PDF comparison in scripts/measure.mjs.
# Output: results/pdf-check.txt
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist/pdf-render results
{
  echo "poppler $(pdfinfo -v 2>&1 | head -1 | awk '{print $3}'), ghostscript $(gs --version)"
  for f in target/out/*.pdf; do
    n=$(basename "$f" .pdf)
    echo
    echo "== $n.pdf ($(wc -c < "$f" | tr -d ' ') bytes, sha256 $(shasum -a 256 "$f" | cut -c1-16))"
    pdfinfo "$f" | grep -E "^(PDF version|Pages|Page size|Producer|CreationDate)" || true
    pdffonts "$f"
    # Rendering must not print errors. -dPDFSTOPONERROR makes errors fatal.
    gs -q -dSAFER -dBATCH -dNOPAUSE -dPDFSTOPONERROR -sDEVICE=png16m -r192 \
      -dTextAlphaBits=4 -dGraphicsAlphaBits=4 -sOutputFile="dist/pdf-render/$n.png" "$f"
    # Also at 768 dpi (4 times). Scaled down in the browser, this removes most of the
    # effect of Ghostscript's pixel grid fitting at 192 dpi.
    gs -q -dSAFER -dBATCH -dNOPAUSE -dPDFSTOPONERROR -sDEVICE=png16m -r768 \
      -dTextAlphaBits=4 -dGraphicsAlphaBits=4 -sOutputFile="dist/pdf-render/$n-768.png" "$f"
    echo "ghostscript render (192 and 768 dpi): ok"
    pdftotext -raw "$f" "dist/pdf-render/$n.txt"
    pdftotext -bbox "$f" "dist/pdf-render/$n-bbox.html"
  done
  echo
  for t in noto fira; do
    if cmp -s "dist/pdf-render/krilla-$t.txt" "dist/pdf-render/pdfwriter-$t.txt"; then
      echo "pdftotext -raw: krilla-$t and pdfwriter-$t give the same text"
    else
      echo "pdftotext -raw: krilla-$t and pdfwriter-$t differ:"
      diff "dist/pdf-render/krilla-$t.txt" "dist/pdf-render/pdfwriter-$t.txt" || true
    fi
  done
  echo
  echo "Word positions (pdftotext -bbox) versus the layout:"
  mise exec -- cargo run --release -q -p s1-native --bin pdfpos
  echo
  echo "Extracted text (pdfwriter-noto, pdftotext -raw):"
  cat dist/pdf-render/pdfwriter-noto.txt
} > results/pdf-check.txt 2>&1
cat results/pdf-check.txt
