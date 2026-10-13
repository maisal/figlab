# fig03-dispersion-map

A 2D intensity map with a color bar.
This is typical for an excitation spectrum.

Tests: heatmap of a 2D array, coordinates given by start and step, pixel placement, NaN pixels, values outside the color range, and the color bar.

## Data

`data/map.csv`: a matrix of 101 rows × 151 columns, without a header.

- Each row is one energy. Row 1 is E = 0 and row 101 is E = 20 meV (step 0.2 meV). So the first row is drawn at the bottom of the plot.
- Each column is one Q. Column 1 is Q = 0 and column 151 is Q = 3 Å⁻¹ (step 0.02 Å⁻¹).
- Values are intensities in arbitrary units. `NaN` marks points that were not measured (the upper left corner).
- In figlab terms: a 2D array with x coordinates start=0, step=0.02, unit Å⁻¹ (columns), and y coordinates start=0, step=0.2, unit meV (rows).

`data/viridis.csv`: the viridis color map as 256 colors (columns `red`, `green`, `blue`, from 0 to 1). Row 1 is the color for 0 and row 256 the color for 1. It is taken from matplotlib. The color map is released under CC0. Use it in tools that do not have viridis.

## Figure

- Plot area: 70 mm wide, 50 mm high
- Pixels: each value is at the center of its pixel. A pixel reaches half a step in each direction. The pixels at the edges are cut by the axis range, so only half of each is shown.
- The image is not smoothed. Each pixel is a flat rectangle.
- Color map: viridis (figlab's default), linear from 0 (darkest) to 1 (brightest). Values below 0 get the color of 0. Values above 1 get the color of 1. NaN pixels are not drawn, so the white background shows.
- x axis (bottom): range 0 to 3. Major ticks every 0.5, labeled `0.0`, `0.5`, …, `3.0`. Minor ticks every 0.1. Label: `\it{Q} (\AA^{−1})`
- y axis (left): range 0 to 20. Major ticks every 5, labeled `0`, `5`, …, `20`. Minor ticks every 1. Label: `\it{E} (meV)`
- Axis lines and ticks are black and drawn on top of the image.
- Color bar:
  - To the right of the plot area, with a 3 mm gap. 3 mm wide and as high as the plot area
  - Frame 0.75 pt, black
  - Ticks on its right side, inward, every 0.2, labeled `0.0`, `0.2`, …, `1.0`. No minor ticks
  - Label `Intensity (arb. units)` to the right of the tick labels, rotated 90° (reads from bottom to top)

## MVP features used

Heatmap (image) of a 2D array with coordinates, color map with a fixed range, NaN pixels, color bar, text formatting (italic, Å, superscript).

## Notes from the reference figure

- Minus signs are hyphens (in the exponent of Å⁻¹).
