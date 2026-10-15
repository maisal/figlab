#!/bin/sh
# Download the NIST StRD nonlinear regression data files into data/.
# The files are public domain (a work of the US government).
# The committed copies in data/ came from this script.
set -eu
cd "$(dirname "$0")/.."
base=https://www.itl.nist.gov/div898/strd/nls/data/LINKS/DATA
names="Misra1a Chwirut2 Chwirut1 Lanczos3 Gauss1 Gauss2 DanWood Misra1b
Kirby2 Hahn1 Nelson MGH17 Lanczos1 Lanczos2 Gauss3 Misra1c Misra1d Roszman1 ENSO
MGH09 Thurber BoxBOD Rat42 MGH10 Eckerle4 Rat43 Bennett5"
mkdir -p data
for n in $names; do
    curl -sS --fail -m 60 -o "data/$n.dat" "$base/$n.dat"
    echo "data/$n.dat"
done
