# figlab Requirements

> Legend
> - `TBD`: not yet written or decided
> - Replace the `[TBD]` at the start of each requirement with its priority (`MVP` / `v1` / `Future`)

## Purpose

I need a tool for making figures for papers and other publications.
Many analysis tools do much more than graphs: complex calculations, simulations, or control of other devices.
But my main need is well-formatted graphs. So I will build a tool that focuses on making graphs.
Simple corrections to data are also handy inside the tool. So the tool should allow the kind of calculations a spreadsheet can do.

There are two goals:

- Quickly plot CSV and similar files as a first check of measurement data
- Make figures good enough for publication

By specializing in plotting, the tool aims to be easier to use for plotting than Excel or Google Sheets.

## Scope

### Approach

- Cover the graphs needed for publication figures
    - The acceptance figures below make this concrete

### Acceptance figures (v1 is complete when these can be reproduced)

Choose 3–5 figures made for past publications.

| # | Figure (source / file) | Main features (plot types, axes, annotations, etc.) |
|---|---|---|
| 1 | TBD | TBD |
| 2 | TBD | TBD |
| 3 | TBD | TBD |

### Non-goals

- Instrument control and data acquisition
- Compatibility with the scripting languages of other tools
- Building GUI panels and controls

## Decisions

### 1. Language for calculations and scripting

- Options: a custom command language / Python (Pyodide + NumPy/SciPy) / JavaScript
- Decision: a command language with its own syntax that puts ease of writing and reading first. The computational core is implemented in Rust/wasm
- Reason: No complex calculations are planned, and fitting only needs models that can be written as expressions. Convenience takes priority over a rich feature set
- History: Python was chosen at first, and changed after confirming that the required calculations go no further than fitting

### 2. When calculations are evaluated

- Options: compute once / recompute when the source data changes (like Excel cell formulas) / both
- Decision: compute once

### 3. Supported browsers and where to save

- Options: Chrome/Edge only, saving directly to a folder (File System Access API) / all browsers, with zip download and upload / both
- Decision: For now, saving may be limited to Chrome

### 4. Storage format

- Options: structure and metadata in JSON, numeric data in CSV / .npy / Parquet, everything bundled in a folder or a zip file
- Decision: Something like the Excel file format?

### 5. Expected data size

- Maximum points per series: 10,000,000
- Total size per project: 10 GB

### 6. Output formats

- Options: SVG / PDF / EPS / PNG
- Decision: SVG / PDF / PNG

## Requirements

### Loading data

- [TBD] Load data from files such as CSV, TSV, Parquet, and TXT, and manage arrays by name
- [TBD] Detailed options when loading
    - Handling of header lines and comment lines: TBD
    - Specifying or auto-detecting the delimiter: TBD
    - Character encoding (UTF-8, Shift_JIS, etc.): TBD
- [TBD] Other formats (HDF5/NeXus, etc.): TBD
- [TBD] Importing by copy and paste from spreadsheet software: TBD

### Data model

- [TBD] Support 2D arrays
    - Support 3D and higher if this can be done without hurting usability
- [TBD] Manage loaded data in a hierarchical folder structure
- [TBD] Data types: TBD (candidates: floating point, integer, string, date/time, complex)
- [TBD] Whether arrays carry axis information (start, step, unit): TBD (This affects how the axis values of heatmaps are stored)
- [TBD] Handling of NaN and missing values: TBD
- [TBD] A note per array: TBD

### Viewing and editing data (tables)

- [TBD] View the contents of data like a spreadsheet
- [TBD] Compare several data side by side in a spreadsheet-like table
- [TBD] Editing values in the table: TBD

### Calculations

- [TBD] Allow calculations of the kind a spreadsheet can do, such as simple data corrections
- [TBD] Calculate on data by typing commands, as in a shell
- [TBD] Provide standard functions, and if possible allow user-defined functions
    - Range of standard functions: TBD
- [TBD] Curve fitting: included. Models are limited to built-in models and models that can be written as expressions
- [TBD] Record GUI operations in a history as matching commands: TBD

### Plot types

- [TBD] Standard plots such as histograms, scatter plots, and line graphs
- [TBD] 2D plots such as heatmaps
- [TBD] Plots with strings on the x axis (e.g. bar charts of counts per category)
- [TBD] Additional plot types: TBD (candidates: bar charts, contours, error bars, fills (to zero / between series), color bars, waterfalls)

### Assigning data and overplotting

- [TBD] Choose the data used for each of the x, y, and z axes
- [TBD] Make overplotting easy
- [TBD] Per-series offset and scale factor (e.g. stacked spectra): TBD

### Series style

- [TBD] Easily set the color, type, and size of markers and lines
    - Also change only specific markers within the same series
- [TBD] Change marker color and size according to data values: TBD

### Axes

- [TBD] Easily switch the scale of x, y, and z (log, time scale, etc.)
- [TBD] Multiple axes (right, top, additional axes) and specifying axis position and length: TBD
- [TBD] Axis range, reversal, and tick direction (inward/outward): TBD

### Text (labels, legends, ticks)

- [TBD] Fine control over labels, legends, and ticks
    - Support math, symbols, Greek letters, subscripts, and superscripts
    - Allow different font sizes within a single label
- [TBD] Label syntax: TBD (candidates: LaTeX notation, escape codes, a custom simple notation)
- [TBD] Tick label format (number of digits, exponent notation, manual labels): TBD

### Annotations

- [TBD] Text boxes: TBD
- [TBD] Tags attached to data points: TBD
- [TBD] Drawing arrows, lines, and shapes: TBD

### Layout

- [TBD] Set the figure size and the plot area size in physical units (mm, pt): TBD
- [TBD] Multi-panel figures ((a), (b), (c), etc.): TBD
- [TBD] Insets: TBD

### Reusing styles

- [TBD] Templates that make axis line widths, fonts, sizes, etc. consistent across figures: TBD

### Scripting

- [TBD] Describe complex plots with scripts

### Saving and resuming

- [TBD] Save data and graphs, and resume work by loading them
- [TBD] Avoid formats that cannot be inspected with other tools, such as proprietary binary formats
    - Prefer formats that AI can read and understand
- [TBD] Autosave: TBD

### Export

- [TBD] Output formats: see Decision 6
- [TBD] Font embedding: TBD
- [TBD] Text stays editable as text when opened in Illustrator, etc.: TBD
- [TBD] Specifying the resolution (dpi) for image output: TBD

### Usability

- [TBD] Undo/Redo: TBD
- [TBD] Keyboard shortcuts: TBD

## Non-functional requirements

- Supported browsers: see Decision 3
- Works offline (does not send data anywhere): TBD
- Performance (target response times for drawing and calculation): TBD
- UI language (Japanese / English): English only
- License: MIT OR Apache-2.0 (users may choose either)

## Technology stack

- Build it as an SPA and publish it on GitHub or a similar service.
- The rendering approach, libraries, and module structure are decided in the specification.
