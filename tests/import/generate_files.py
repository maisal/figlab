"""Generate the synthetic instrument files for the import tests.

The files imitate the layouts that measurement instruments commonly write:
metadata lines, unit rows, other encodings and delimiters, decimal commas,
missing values, and so on. They contain no real measurement data.

The files are committed, so you only need this script to change them.
It uses the Python 3 standard library only. The random seed is fixed, so the
output is the same every time. Each file gets a `.expected.json` file with the
settings that automatic detection must find (docs/spec.md 10.1).

Run from the repository root:

    python3 tests/import/generate_files.py
"""

import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent
rng = random.Random(20261014)


def write(name, text, encoding="utf-8", newline="\n", bom=False):
    data = text.replace("\n", newline).encode(encoding)
    if bom:
        data = b"\xef\xbb\xbf" + data
    (ROOT / name).write_bytes(data)


def expect(name, doc, columns, rows, missing=None, **settings):
    result = {"doc": doc}
    result.update(settings)
    missing = missing or [0] * len(columns)
    result["columns"] = [
        {"label": n, "unit": u, "type": t, "missing": m}
        for (n, u, t), m in zip(columns, missing)
    ]
    result["rows"] = rows
    path = ROOT / (name + ".expected.json")
    # UTF-8 and LF on every platform, so the output is the same everywhere.
    path.write_bytes((json.dumps(result, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))


def peak(x, center, width, height):
    return height * math.exp(-(((x - center) / width) ** 2))


def noisy(v, scale):
    return v + rng.gauss(0, scale)


# 1. A plain CSV file with one header row.
rows = []
for i in range(51):
    e = -5 + 0.2 * i
    y = noisy(10 + peak(e, 1.0, 1.2, 80), 1.5)
    rows.append(f"{e:.1f},{y:.3f},{math.sqrt(abs(y)):.3f}")
write("simple.csv", "energy,intensity,error\n" + "\n".join(rows) + "\n")
expect(
    "simple.csv",
    "Comma-separated, UTF-8, one header row.",
    [("energy", None, "number"), ("intensity", None, "number"), ("error", None, "number")],
    51, encoding="utf8", bom=False, sep="comma", decimal="point", skip=0, comment=None, header=1,
)

# 2. Metadata lines, then column names and units.
meta = [
    "Instrument: Model XR-100 diffractometer",
    "Operator: test",
    "Sample: powder A",
    "Date: 2026-03-01 14:05:00",
    "Wavelength: 1.5406 Angstrom",
    "Scan mode: continuous",
    "Step: 0.02 deg",
    "Count time: 1.0 s",
    "",
]
rows = []
for i in range(40):
    t = 20 + 0.02 * i
    y = noisy(200 + peak(t, 20.4, 0.08, 3000), 20)
    rows.append(f"{t:.2f},{y:.1f}")
write("metadata_units.csv", "\n".join(meta) + "\n2theta,counts\ndeg,cps\n" + "\n".join(rows) + "\n")
expect(
    "metadata_units.csv",
    "Nine metadata lines (the last is blank), then a header row and a unit row.",
    [("2theta", "deg", "number"), ("counts", "cps", "number")],
    40, encoding="utf8", bom=False, sep="comma", decimal="point", skip=9, comment=None, header=2,
)

# 3. Tab-separated, with a unit row.
rows = []
for i in range(30):
    t = 2 + 10 * i
    r = 0.5 + 0.002 * t + 0.0001 * t * t / 300
    rows.append(f"{t}\t{noisy(r, 0.002):.5f}")
write("tab_units.txt", "Temperature\tResistance\nK\tOhm\n" + "\n".join(rows) + "\n")
expect(
    "tab_units.txt",
    "Tab-separated, with a header row and a unit row.",
    [("Temperature", "K", "number"), ("Resistance", "Ohm", "number")],
    30, encoding="utf8", bom=False, sep="tab", decimal="point", skip=0, comment=None, header=2,
)

# 4. Shift_JIS with Japanese column names (temperature, voltage) and units.
#    The names are written with escapes to keep this script in English.
temperature = "\u6e29\u5ea6"
voltage = "\u96fb\u5727"
rows = []
for i in range(25):
    t = 300 - 10 * i
    rows.append(f"{t},{noisy(1.2 - 0.001 * t, 0.002):.4f}")
write(
    "shift_jis.csv",
    f"{temperature},{voltage}\nK,mV\n" + "\n".join(rows) + "\n",
    encoding="shift_jis",
)
expect(
    "shift_jis.csv",
    "Shift_JIS with Japanese column names, then a unit row.",
    [(temperature, "K", "number"), (voltage, "mV", "number")],
    25, encoding="shift_jis", bom=False, sep="comma", decimal="point", skip=0, comment=None, header=2,
)

# 5. UTF-8 with a byte order mark, as some spreadsheet programs write.
rows = [f"{0.1 * i:.1f},{noisy(math.sin(0.1 * i), 0.01):.4f}" for i in range(20)]
write("utf8_bom.csv", "time,signal\n" + "\n".join(rows) + "\n", bom=True)
expect(
    "utf8_bom.csv",
    "UTF-8 with a byte order mark.",
    [("time", None, "number"), ("signal", None, "number")],
    20, encoding="utf8", bom=True, sep="comma", decimal="point", skip=0, comment=None, header=1,
)

# 6. Semicolons and decimal commas, as written in many European locales.
rows = []
for i in range(30):
    w = 350 + 5 * i
    a = noisy(0.8 * math.exp(-((w - 420) / 40) ** 2) + 0.05, 0.005)
    rows.append(f"{w},0;{a:.4f}".replace(".", ","))
write("semicolon_decimal_comma.csv", "Wellenl\u00e4nge;Absorbanz\n" + "\n".join(rows) + "\n")
expect(
    "semicolon_decimal_comma.csv",
    "Semicolon-separated, with decimal commas and a non-ASCII column name.",
    [("Wellenl\u00e4nge", None, "number"), ("Absorbanz", None, "number")],
    30, encoding="utf8", bom=False, sep="semicolon", decimal="comma", skip=0, comment=None, header=1,
)

# 7. Columns aligned with spaces, after comment lines.
rows = []
for i in range(30):
    x = 0.05 * (i + 1)
    y = noisy(1000 * x ** -2.0, 5)
    rows.append(f"{x:10.4f}{y:14.4f}{math.sqrt(abs(y)):12.4f}")
write(
    "whitespace_aligned.dat",
    "# Small-angle scattering, reduced data\n# q in 1/Angstrom\n"
    + f"{'q':>10}{'I':>14}{'dI':>12}\n" + "\n".join(rows) + "\n",
)
expect(
    "whitespace_aligned.dat",
    "Columns aligned with spaces, after # comment lines.",
    [("q", None, "number"), ("I", None, "number"), ("dI", None, "number")],
    30, encoding="utf8", bom=False, sep="whitespace", decimal="point", skip=0, comment="#", header=1,
)

# 8. % comment lines and no header row.
rows = [f"{i}\t{noisy(5 + 0.3 * i, 0.2):.3f}\t{noisy(2 - 0.1 * i, 0.2):.3f}" for i in range(20)]
write("percent_comment_no_header.txt", "% exported data\n% columns: index, a, b\n" + "\n".join(rows) + "\n")
expect(
    "percent_comment_no_header.txt",
    "% comment lines, tab-separated, and no header row.",
    [(None, None, "number"), (None, None, "number"), (None, None, "number")],
    20, encoding="utf8", bom=False, sep="tab", decimal="point", skip=0, comment="%", header=0,
)

# 9. Missing values written in several ways.
markers = ["", "NaN", "NA", "-"]
rows = []
for i in range(24):
    v = f"{noisy(1.0 + 0.1 * i, 0.05):.3f}"
    if i % 6 == 5:
        v = markers[(i // 6) % 4]
    rows.append(f"{i},{v}")
write("missing_values.csv", "channel,value\n" + "\n".join(rows) + "\n")
expect(
    "missing_values.csv",
    "Missing values: an empty field, NaN, NA, and -. Each becomes NaN.",
    [("channel", None, "number"), ("value", None, "number")],
    24, missing=[0, 4], encoding="utf8", bom=False, sep="comma", decimal="point", skip=0, comment=None, header=1,
)

# 10. CRLF line endings.
rows = [f"{i},{noisy(i * 0.5, 0.1):.3f}" for i in range(15)]
write("crlf.csv", "x,y\n" + "\n".join(rows) + "\n", newline="\r\n")
expect(
    "crlf.csv",
    "CRLF line endings.",
    [("x", None, "number"), ("y", None, "number")],
    15, encoding="utf8", bom=False, sep="comma", decimal="point", skip=0, comment=None, header=1,
)

# 11. A date-time column.
rows = []
for i in range(24):
    hour = i
    rows.append(f"2026-03-01T{hour:02d}:00:00,{noisy(20 + 3 * math.sin(i / 4), 0.1):.2f},{noisy(1013, 0.5):.1f}")
write("datetime.csv", "timestamp,temperature,pressure\n" + "\n".join(rows) + "\n")
expect(
    "datetime.csv",
    "A date-time column in ISO 8601 form.",
    [("timestamp", None, "datetime"), ("temperature", None, "number"), ("pressure", None, "number")],
    24, encoding="utf8", bom=False, sep="comma", decimal="point", skip=0, comment=None, header=1,
)

# 12. A string column with categories.
materials = ["Fe", "Co", "Ni", "Cu", "Zn"]
rows = [f"{m},{noisy(1.5 + 0.2 * k, 0.05):.2f}" for k, m in enumerate(materials) for _ in range(3)]
write("categories.csv", "material,hardness\n" + "\n".join(rows) + "\n")
expect(
    "categories.csv",
    "A string column with repeated categories.",
    [("material", None, "string"), ("hardness", None, "number")],
    15, encoding="utf8", bom=False, sep="comma", decimal="point", skip=0, comment=None, header=1,
)

# 13. Scientific notation, leading spaces, ; comment lines, and no header row.
rows = [f"  {1e-3 * (i + 1):.6E}  {noisy(1e5 * math.exp(-i / 5), 10):.6E}" for i in range(20)]
write("scientific_semicolon_comment.txt", "; time constant measurement\n; units: s, counts\n" + "\n".join(rows) + "\n")
expect(
    "scientific_semicolon_comment.txt",
    "Numbers in E notation with leading spaces, ; comment lines, and no header row.",
    [(None, None, "number"), (None, None, "number")],
    20, encoding="utf8", bom=False, sep="whitespace", decimal="point", skip=0, comment=";", header=0,
)

print("written")
