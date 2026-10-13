# fig05-grouped-bars

Values per material for two conditions, drawn as grouped bars.

Tests: a category axis from a string column, grouped bars, bars that start at zero, a legend with box symbols, and an axis without a label.

## Data

`data/hardness.csv` (5 rows): `material` (string), `as_grown` and `annealed` (GPa)

## Figure

- Plot area: 60 mm wide, 40 mm high
- x axis (bottom): category axis, in the order of the file: Fe, Co, Ni, Cu, Zn
  - The categories are evenly spaced. The first and the last are half a spacing from the edges of the plot area
  - Each label is centered under its group
  - No tick marks on the bottom and top sides. No axis label
- y axis (left): range 0 to 3. Major ticks every 0.5, labeled `0.0`, `0.5`, …, `3.0`. Minor ticks every 0.1. Label: `Hardness (GPa)`. The right side repeats the ticks without labels
- Bars: grouped. Each group is 70 % of the category spacing wide. It is split equally into two bars with no gap between them. `as_grown` is on the left and `annealed` on the right. Bars start at 0.
  1. `as_grown`: gray (#7f7f7f) fill, 0.5 pt edge in the same color
  2. `annealed`: blue (#1f77b4) fill, 0.5 pt edge in the same color
- Legend: top right. Two entries with 6 pt square symbols that have the same fill and edge as the bars: `As-grown`, `Annealed`

## MVP features used

Category axis from a string array, grouped bars, legend.

## Notes from the reference figure

- The edge of the gray bars and the gray legend symbol are #777777, slightly darker than the fill (#7f7f7f).
