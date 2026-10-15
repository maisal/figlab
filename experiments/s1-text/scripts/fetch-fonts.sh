#!/usr/bin/env bash
# Downloads the fonts used by S1 into downloads/fonts/ and checks their SHA-256.
# The fonts are not committed (experiments/README.md). All are under OFL-1.1.
# URLs are pinned to a commit or a release, so the files do not change.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p downloads/fonts

ARIMO="https://raw.githubusercontent.com/googlefonts/Arimo/4a6255f269916ae7ad3fc2706b0935e7621396b8/fonts/ttf"
GF="https://raw.githubusercontent.com/google/fonts/66928797f271fed5ee428544e7229685e2d90127/ofl"
FIRA="https://github.com/firamath/firamath/releases/download/v0.3.4"

# name | url | sha256
FONTS="
Arimo-Regular.ttf|$ARIMO/Arimo-Regular.ttf|41b22bc8f0b51f932825d37bc55b5eb6ba67dfe599a626e4aff2b43b624f9f8c
Arimo-Italic.ttf|$ARIMO/Arimo-Italic.ttf|ffdf690e4357a392e4edcc3df0b3adb0302920f75e54f2e6eec355afbe7edcba
Arimo-Bold.ttf|$ARIMO/Arimo-Bold.ttf|d7a8b187cf8444d4cfee102e8eae9e3043682fd5106d5d33ed677fe268a0e2ba
Tinos-Regular.ttf|$GF/tinos/Tinos-Regular.ttf|60a0e8ef0c04dd5dd69ffe91025fa2ae5836cbd35600a82ba031977557e2cb61
NotoSansMath-Regular.ttf|$GF/notosansmath/NotoSansMath-Regular.ttf|3f495fe933c06786e4d5f6d86b8ee70b6753a68ee3b9d87528726de0f6e2c47d
NotoSansSymbols-VF.ttf|$GF/notosanssymbols/NotoSansSymbols%5Bwght%5D.ttf|f7e7e04b4a24b6c78893d50cbfd2b2f6cae49617ab047bfef668d252adb128f7
NotoSansSymbols2-Regular.ttf|$GF/notosanssymbols2/NotoSansSymbols2-Regular.ttf|7d5fb73b7ca67a6798101741f5d280a3d016a56a197afcd4199dbb57b4b82a21
STIXTwoMath-Regular.ttf|$GF/stixtwomath/STIXTwoMath-Regular.ttf|562551b15b836e6e01d1b7350909baf3c8c8d83260c1190fbf4544333e6936de
LibertinusMath-Regular.ttf|$GF/libertinusmath/LibertinusMath-Regular.ttf|6eaebb1260c45328a49299a614eb20cee6d0b5c2fbb0d48314def159e0715318
NotoSans-VF.ttf|$GF/notosans/NotoSans%5Bwdth,wght%5D.ttf|bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d
FiraMath-Regular.otf|$FIRA/FiraMath-Regular.otf|2028cbd3dd4d8c0cf1608520eb4759956a83a67931d7b6d8e7c313520186e35b
"

status=0
while IFS='|' read -r name url sha; do
  [ -z "$name" ] && continue
  out="downloads/fonts/$name"
  if [ ! -f "$out" ]; then
    echo "fetch $name"
    curl -fsSL -o "$out.part" "$url"
    mv "$out.part" "$out"
  fi
  got=$(shasum -a 256 "$out" | cut -d' ' -f1)
  if [ "$got" != "$sha" ]; then
    echo "checksum mismatch: $name $got" >&2
    status=1
  fi
done <<< "$FONTS"
exit $status
