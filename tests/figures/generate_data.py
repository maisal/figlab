"""Generate the synthetic data for the acceptance figures.

The CSV files are committed, so you only need this script to change the data.
It uses the Python 3 standard library only. The random seeds are fixed, so the
output is the same every time.

Run from the repository root:

    python3 tests/figures/generate_data.py
"""

import csv
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def fmt(v):
    if isinstance(v, str):
        return v
    if v is None or math.isnan(v):
        return "NaN"
    return format(v, ".6g")


def write_csv(path, header, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        if header:
            w.writerow(header)
        for row in rows:
            w.writerow([fmt(v) for v in row])


def gauss_peak(x, center, sigma, height):
    return height * math.exp(-((x - center) ** 2) / (2 * sigma**2))


def fig01():
    rng = random.Random(101)

    def model_a(e):
        return 10 + 0.5 * e + gauss_peak(e, 4.0, 0.6, 100)

    def model_b(e):
        return 14 + 0.5 * e + gauss_peak(e, 3.6, 0.9, 60)

    rows = []
    for i in range(71):
        e = -2.0 + 0.2 * i
        e = round(e, 6)
        ma, mb = model_a(e), model_b(e)
        ea, eb = math.sqrt(ma), math.sqrt(mb)
        ia = ma + rng.gauss(0, ea)
        ib = mb + rng.gauss(0, eb)
        if e == 8.0:
            ia += 25  # outlier, excluded from the fit and drawn as an open circle
        rows.append([e, round(ia, 1), round(ea, 2), round(ib, 1), round(eb, 2)])
    write_csv(ROOT / "fig01-peak-fit/data/measured.csv",
              ["energy", "intensity_a", "error_a", "intensity_b", "error_b"], rows)

    rows = []
    for i in range(701):
        e = round(-2.0 + 0.02 * i, 6)
        rows.append([e, model_a(e), model_b(e)])
    write_csv(ROOT / "fig01-peak-fit/data/fit.csv", ["energy", "fit_a", "fit_b"], rows)


def fig02():
    rng = random.Random(202)
    amps = [1e-3, 3e-4, 1e-4]
    backgrounds = [1.0, 0.5, 0.2]
    rows = []
    for i in range(50):
        q = 0.005 * (100.0 ** (i / 49))
        row = [q]
        for k in range(3):
            v = (amps[k] * q**-4 + backgrounds[k]) * (1 + 0.03 * rng.gauss(0, 1))
            if k == 1 and i == 20:
                v = float("nan")  # a missing point; the line must break here
            row.append(v)
        guide = 5e-3 * q**-4 if 0.01 <= q <= 0.1 else float("nan")
        row.append(guide)
        rows.append(row)
    write_csv(ROOT / "fig02-power-law/data/scattering.csv",
              ["q", "sample_a", "sample_b", "sample_c", "guide"], rows)


def fig03():
    rng = random.Random(303)
    rows = []
    for i in range(101):
        e = 0.2 * i
        row = []
        for j in range(151):
            q = 0.02 * j
            if e > 6 + 8 * q:
                row.append(float("nan"))  # not measured
                continue
            w = math.sqrt(3.0**2 + (15.0 * math.sin(math.pi * q / 2)) ** 2)
            v = (3.0 / w) * gauss_peak(e, w, 0.8, 1.0)
            v += gauss_peak(e, 0.0, 0.5, 2.0)  # elastic line, above the color range
            v += 0.02 + rng.gauss(0, 0.01)
            row.append(v)
        rows.append(row)
    write_csv(ROOT / "fig03-dispersion-map/data/map.csv", None, rows)


def fig04():
    rng = random.Random(404)
    tn, m0 = 120.0, 2.5

    def moment(t):
        return m0 * (1 - (t / tn) ** 2) ** 0.35 if t < tn else 0.0

    temps = [2, 5] + list(range(10, 111, 10)) + [112, 114, 116, 118, 119, 120, 121, 122, 124, 126, 130] \
        + list(range(140, 301, 20))
    rows = []
    for t in temps:
        m = moment(t)
        err = 0.05 + 0.02 * m
        rows.append([t, round(abs(m + rng.gauss(0, err)), 3), round(err, 3)])
    write_csv(ROOT / "fig04-twin-axes/data/moment.csv", ["temperature", "moment", "moment_error"], rows)

    rows = []
    for t in range(5, 301, 5):
        c = 5.400 + 1.5e-7 * t**2 - 0.002 * (moment(t) / m0) ** 2
        rows.append([t, round(c + rng.gauss(0, 0.0002), 5)])
    write_csv(ROOT / "fig04-twin-axes/data/lattice.csv", ["temperature", "c"], rows)


def fig05():
    rows = [
        ["Fe", 1.8, 1.2],
        ["Co", 2.4, 1.9],
        ["Ni", 1.6, 1.1],
        ["Cu", 0.9, 0.5],
        ["Zn", 0.6, 0.4],
    ]
    write_csv(ROOT / "fig05-grouped-bars/data/hardness.csv", ["material", "as_grown", "annealed"], rows)


if __name__ == "__main__":
    fig01()
    fig02()
    fig03()
    fig04()
    fig05()
