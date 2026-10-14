#!/bin/sh
# Download the candidates that are not committed, into downloads/:
#
# - cmpfit 1.5 (C, MINPACK-style license with an acknowledgment clause).
#   The author's site answers 403 to scripts, so the Internet Archive copy is
#   used. The SHA-256 is checked.
# - levenberg-marquardt 0.15.0 (MIT) from crates.io, patched with
#   patches/lm-bounded.patch into downloads/lm-bounded (candidate A2).
set -eu
cd "$(dirname "$0")/.."
mkdir -p downloads

cmpfit_sha=0652fdc04d4e76c3c3aee05d7a97507a9afe97758ee235fd2e7126f660a420e6
cmpfit_tgz=downloads/cmpfit-1.5.tar.gz
if [ ! -f "$cmpfit_tgz" ]; then
    curl -sS --fail -L -m 120 -o "$cmpfit_tgz" \
        "https://web.archive.org/web/2024id_/https://pages.physics.wisc.edu/~craigm/idl/down/cmpfit-1.5.tar.gz"
fi
echo "$cmpfit_sha  $cmpfit_tgz" | shasum -a 256 -c -
rm -rf downloads/cmpfit
mkdir -p downloads/cmpfit
tar -xzf "$cmpfit_tgz" -C downloads/cmpfit

lm_sha=8be7a65739a815308eef33a6d8c78e435a7317305d5b0af0c8c465a2d7ac6fc6
lm_crate=downloads/levenberg-marquardt-0.15.0.crate
if [ ! -f "$lm_crate" ]; then
    curl -sS --fail -L -m 120 -A "figlab-s6-experiment" -o "$lm_crate" \
        https://static.crates.io/crates/levenberg-marquardt/levenberg-marquardt-0.15.0.crate
fi
echo "$lm_sha  $lm_crate" | shasum -a 256 -c -
rm -rf downloads/lm-orig downloads/lm-bounded
mkdir -p downloads/lm-orig
tar -xzf "$lm_crate" -C downloads/lm-orig
cp -R downloads/lm-orig/levenberg-marquardt-0.15.0 downloads/lm-bounded
cp patches/lm-bounded.Cargo.toml downloads/lm-bounded/Cargo.toml
rm -f downloads/lm-bounded/Cargo.toml.orig downloads/lm-bounded/Cargo.lock
(cd downloads/lm-bounded && patch -s -p1 < ../../patches/lm-bounded.patch)
echo "fetched cmpfit 1.5 and made downloads/lm-bounded"
