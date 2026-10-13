# fig02-power-law

Three scattering curves on log–log axes, with a guide line for a power law.

Tests: log axes over many decades, 10ⁿ tick labels, minor log ticks, lines with markers, a NaN that breaks a line, a line that covers only part of the x range, a dashed line, and Å and superscripts in text.

## Data

`data/scattering.csv` (50 rows)

| Column | Meaning | Unit |
|---|---|---|
| `q` | Scattering vector, 0.005 to 0.5, evenly spaced on a log scale | Å⁻¹ |
| `sample_a`, `sample_b`, `sample_c` | Intensity of three samples | cm⁻¹ |
| `guide` | A q⁻⁴ guide line. Defined only for 0.01 ≤ q ≤ 0.1, `NaN` elsewhere | cm⁻¹ |

`sample_b` has one missing value (`NaN`) at q ≈ 0.0328 (row 21).

## Figure

- Plot area: 60 mm wide, 60 mm high
- x axis (bottom): log scale, range 10⁻³ to 10⁰. Major ticks at each decade, labeled `10^{−3}`, `10^{−2}`, `10^{−1}`, `10^{0}`. Minor ticks at 2–9 times each decade, without labels. Label: `\it{q} (\AA^{−1})`
- y axis (left): log scale, range 10⁻¹ to 10⁷. Major ticks at each decade, labeled `10^{−1}` to `10^{7}`. Minor ticks at 2–9 times each decade, without labels. Label: `\it{I}(\it{q}) (cm^{−1})`
- Traces, from bottom to top:
  1. `guide` vs `q`: gray dashed line (3 pt dash, 2 pt gap), no markers
  2. `sample_c` vs `q`: blue line and blue filled triangles (pointing up)
  3. `sample_b` vs `q`: red line and red filled squares. The line breaks at the NaN: there is no line between the two points next to it
  4. `sample_a` vs `q`: black line and black filled circles

  Markers in this figure are 3 pt wide.
- Legend: bottom left. Entries with line and marker symbols:
  - `Sample A`, `Sample B`, `Sample C`
  - Gray dashed line: `∝ \it{q}^{−4}`

## MVP features used

xy traces (lines + markers, dashed lines), NaN handling, log axes, exponent tick labels, text formatting (italic, superscript, Å), legend.

## Notes from the reference figure

"∝" is AppleSymbols font because it is not included in Arimo font.
