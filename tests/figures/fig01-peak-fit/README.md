# fig01-peak-fit

Two measured spectra with error bars and their fit curves.
This is a typical figure for a fit result.

Tests: markers with y error bars, smooth lines from a second data set, a per-point style override, italic text, and a legend with marker symbols.

## Data

`data/measured.csv` (71 rows)

| Column | Meaning | Unit |
|---|---|---|
| `energy` | Energy transfer, −2 to 12 in steps of 0.2 | meV |
| `intensity_a`, `error_a` | Intensity and its error at T = 10 K | counts |
| `intensity_b`, `error_b` | Intensity and its error at T = 100 K | counts |

`data/fit.csv` (701 rows): `energy` (−2 to 12 in steps of 0.02, meV), `fit_a` and `fit_b` (counts). These are the fitted curves.

The point at energy = 8 in `intensity_a` is an outlier. It was left out of the fit.

## Figure

- Plot area: 60 mm wide, 45 mm high
- x axis (bottom): range −2 to 12. Major ticks every 2, labeled `−2`, `0`, …, `12`. Minor ticks every 1. Label: `\it{E} (meV)`
- y axis (left): range 0 to 140. Major ticks every 20, labeled `0`, `20`, …, `140`. Minor ticks every 10. Label: `Intensity (counts)`
- Traces, from bottom to top:
  1. `fit_b` vs `energy` (fit.csv): red line
  2. `fit_a` vs `energy` (fit.csv): black line
  3. `intensity_b` vs `energy`, error bars ± `error_b`: red open squares, no line
  4. `intensity_a` vs `energy`, error bars ± `error_a`: black filled circles, no line. The point at energy = 8 is a black open circle instead (a per-point override)
- Legend: top right. Two entries with marker symbols only:
  - Black filled circle: `\it{T} = 10 K`
  - Red open square: `\it{T} = 100 K`

  The fit curves are not in the legend.

## MVP features used

xy traces (markers, lines), per-point overrides, y error bars, linear axes, text formatting (italic), legend.

## Notes from the reference figure

Minus symbol is hyphen.
