# fig04-twin-axes

The temperature dependence of two quantities.
They share the x axis but have different y scales.

Tests: a right y axis, two data sets with different x values, y error bars, subscripts and Greek letters, and colored axis text.

## Data

- `data/moment.csv` (33 rows): `temperature` (K), `moment` (μB), `moment_error` (μB)
- `data/lattice.csv` (60 rows): `temperature` (K, 5 to 300 in steps of 5), `c` (Å)

The two files have different temperatures.

## Figure

- Plot area: 60 mm wide, 45 mm high
- x axis (bottom): range 0 to 300. Major ticks every 50, labeled `0`, `50`, …, `300`. Minor ticks every 10. Label: `\it{T} (K)`. The top side repeats the ticks without labels
- Left y axis: range −0.1 to 3.0. Major ticks every 0.5, labeled `0.0`, `0.5`, …, `3.0`. Minor ticks every 0.1. Label: `Ordered moment (\mu_{B})`. All black
- Right y axis: range 5.395 to 5.415. Major ticks every 0.005, labeled `5.395`, `5.400`, …, `5.415`. Minor ticks every 0.001. Label: `\it{c} (\AA)`. The tick labels and the axis label are red (#d62728). The axis line and the ticks are black
- The left and right sides do not repeat each other's ticks. Each side has its own axis
- Traces:
  1. `moment` vs `temperature` (moment.csv) on the left axis, error bars ± `moment_error`: black filled circles, no line
  2. `c` vs `temperature` (lattice.csv) on the right axis: red open diamonds, no line
- No legend

## MVP features used

xy traces on left and right axes, y error bars, axis text colors, text formatting (italic, Greek, subscript, Å).

## Notes from the reference figure

- The diamonds are about 5 pt wide, not 4 pt.
