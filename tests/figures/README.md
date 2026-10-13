# Acceptance figures

These figures define what figlab must be able to draw.
The MVP is complete when figlab reproduces all of them (docs/spec.md Section 14).

Each folder has:

- `README.md`: what the figure tests, the data, and the exact figure spec
- `data/`: synthetic data (CSV), made by `generate_data.py`. It is safe to publish
- `reference.pdf`: the target figure. It is made by hand with another tool, from the same data and spec

Later, each folder also gets `figure.figc` (the figlab commands) and `expected.svg` (the approved figlab output, used by the `figures` CI job).

| Folder | Main features |
|---|---|
| `fig01-peak-fit` | Markers with y error bars, fit curves, a per-point style override, italic text, legend |
| `fig02-power-law` | Log–log axes, 10ⁿ tick labels, lines with markers, a NaN gap, a dashed line, Å and superscripts |
| `fig03-dispersion-map` | Heatmap of a 2D array with coordinates, NaN pixels, a clipped color range, color bar |
| `fig04-twin-axes` | Left and right y axes, two data sets with different x, subscripts, colored axis text |
| `fig05-grouped-bars` | Category axis from a string column, grouped bars, legend with box symbols |

Other MVP features (histograms, `count()`, log color scales, and so on) are tested by unit tests and end-to-end tests.

## Reference PDFs

- One PDF per figure, named `reference.pdf`, in the figure's folder.
- Vector graphics with fonts embedded. RGB colors.
- The page size and the margins do not matter. Comparisons line up the plot areas.
- Follow the figure spec as closely as your tool allows. Small differences that the tool cannot control (for example the dash pattern, the exact marker size, or the length of legend symbols) are fine.
- Write every difference in "Notes from the reference figure" at the end of the figure's README.
- The reference PDF is a visual target. The figlab output (`expected.svg`) follows the spec exactly.

PDF is the target format because it keeps the physical size, the vector shapes, and the fonts.
For comparison, the PDF is rasterized at a fixed resolution.

## Common style

All figures use this style unless their README says otherwise.
figlab's default publication style should match it.

Sizes are in mm or pt (1 pt = 1/72 inch = 0.3528 mm).
The size given for each figure is the size of the plot area (the rectangle inside the axes).
The total size follows from the labels.

| Item | Value |
|---|---|
| Font | Arimo (same metrics as Arial and Helvetica). Arial or Helvetica is fine if Arimo is not installed. Symbols that Arimo does not have (such as "∝") may come from any fallback font |
| Font sizes | Axis labels 9 pt. Tick labels 8 pt. Legend 8 pt. Color bar label 9 pt |
| Axis lines | On all four sides of the plot area. 0.75 pt, black |
| Ticks | Inward. Major ticks 3.5 pt long, minor ticks 2 pt long, both 0.75 pt wide. The length is the visible part, measured from the inner edge of the axis line. The top and right sides repeat the ticks of the bottom and left sides, without labels, unless that side has its own axis |
| Tick labels | About 3 pt from the axis line. All labels on one axis have the same number of decimals (0.0, 0.5, 1.0). Negative numbers use the minus sign "−" (U+2212), not a hyphen |
| Axis labels | About 4 pt from the tick labels. The left label is rotated 90° and reads from bottom to top |
| Lines | 1 pt, solid, round joins |
| Markers | 4 pt wide, including the edge. Edge 0.75 pt. Filled markers have the fill and the edge in the same color. Open markers have no fill |
| Error bars | 0.75 pt, the same color as the marker. Caps 3 pt wide. Drawn below the markers, so they show through open markers |
| Colors | Black #000000, red #d62728, blue #1f77b4, orange #ff7f0e, gray #7f7f7f |
| Legend | Inside the plot area, 4 pt from the given corner. No frame and no background. Line symbols are 12 pt long |
| Background | White. No grid lines |
| Drawing order | The order in the figure's README. The first trace is at the bottom |

## Text notation

The figure READMEs write text in figlab notation (docs/spec.md 8.4).
For example, `\it{E} (meV)` is "E (meV)" with an italic E, and `\AA^{−1}` is "Å⁻¹".
