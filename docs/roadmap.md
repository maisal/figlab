# figlab Roadmap to the MVP

This document is the plan of work up to the MVP.
The scope of the MVP is in spec.md Section 14. This document only says in which order the work is done.

Progress is tracked with GitHub milestones and Issues (development.md 5.5).
Update this document when the plan changes, not when a task is done.

Status (2026-10-15): M0 and M1 are done. M2 (thin slice) is next.

## Approach

- **Build a thin slice through all layers first.** Get "drop a CSV, draw it, export SVG" working in the browser and on the command line before any layer is complete. Design problems show up early this way.
- **Finish Quick Plot first.** It is the first goal of figlab (spec.md 1.1). It can be used on real data early, and that use gives feedback.
- **Try risky technology in small experiments first.** Each experiment ends with an ADR.
- **Release the MVP in three steps.** Each step is a release and a GitHub milestone.

| Release | Content | Milestone |
|---|---|---|
| v0.1 | Quick Plot | M3 |
| v0.2 | Command language and editor | M4 |
| v0.3 | Publication figures. This completes the MVP | M5 |

## Milestones

### M0 Foundation

- Repository, licenses, first documents, merge settings, and rulesets
- ADRs 0001–0009
- Acceptance figures: data, specs, and reference PDFs (`tests/figures/`)
- Fix the language before implementation (spec.md Section 14): turn the open questions in language.md Section 11 into decisions, write the schemas of `spec/commands.json` and `spec/errors.json`, and write the first conformance tests
- Cargo workspace with empty crates, the `web/` skeleton, and the mise tasks
- CI (rust, english, deps, web) as required checks. Dependabot, Issue and PR templates, labels, and milestones
- Determinism from the start: in the computing crates, forbid the standard float functions such as `f64::sin` (for example with clippy's `disallowed-methods`) and use the `libm` crate. Native builds call the OS math library, which can give results different from wasm
- A set of instrument files that may be published, for the import tests (`tests/import/`)

### M1 Experiments

Each experiment answers one question and ends with an ADR.
The code of the experiments is in `experiments/`. It is not part of the product (experiments/README.md).

| # | Question | Decision |
|---|---|---|
| S1 | Text: can rustybuzz and ttf-parser shape text in wasm, and can the glyphs be drawn on Canvas from the draw data? Choose the PDF library (krilla or pdf-writer) and the fallback font for symbols (spec.md 9.2) | [ADR 0010](adr/0010-text-shaping-pdf-and-fallback-font.md) |
| S2 | Drawing speed: can 10 million points be decimated and panned and zoomed at 60 frames per second? | [ADR 0011](adr/0011-drawing-large-traces.md) |
| S3 | Data transfer between workers: GitHub Pages cannot use SharedArrayBuffer. How long does it take to pass large arrays as transferable buffers? | [ADR 0012](adr/0012-data-transfer-between-workers.md) |
| S4 | Size and startup: how large are the three wasm modules (compute, render, language service)? Can PDF and PNG export be loaded later? Can the app start within 2 seconds? | [ADR 0013](adr/0013-wasm-size-and-startup.md) |
| S5 | UI framework: choose by download size, how well it works with CodeMirror 6, and how well AI agents know it | [ADR 0014](adr/0014-ui-framework.md) |
| S6 | Fitting: compare the `levenberg-marquardt` crate with bounds added and cmpfit on a few NIST StRD problems | [ADR 0015](adr/0015-fitting-library.md) |

### M2 Thin slice

- core: 1D arrays with coordinates and units, folders
- io: simple CSV (UTF-8, comma-separated, one header row)
- lang: lexer and parser for the whole grammar. Only `load`, `plot`, and `export` run
- Graph model and graph operations in `figlab-graph` ([ADR 0016](adr/0016-graph-operations-in-rust.md)), with a JSON Schema for the graph model
- render: xy lines, linear axes, ticks, labels, and SVG export. Labels need the first part of the text path (ADR 0010):
  - Arimo Regular, bundled without hinting (ADR 0013)
  - shaping with harfrust and skrifa, both with default features off and `libm` on
  - glyph runs in the draw data, and `<text>` in SVG
  - the fallback font and the text notation (spec.md 8.4) come in M5
- web: drop a file, draw it, and save it as SVG
  - set up Preact with `@preact/signals` (ADR 0014): `@preact/preset-vite`, the hooks lint rules `rules-of-hooks` and `exhaustive-deps`, and lint and format checks for `web/**/*.tsx`
  - draw the text on Canvas from the glyph outlines, with one cached `Path2D` per glyph (ADR 0010)
- cli: `figlab run` writes the same SVG
- CI: the first determinism test and the first figure comparison test. Publish the web app on Pages (the owner turns on Pages in the repository settings)
- wasm build: the compute and render modules, each in its own boundary package (development.md Section 2). Use the build settings of [ADR 0013](adr/0013-wasm-size-and-startup.md): a wasm-only Cargo profile (the native `figlab` command keeps opt-level 3), `wasm-bindgen --target web`, and `wasm-opt -Oz`. Pin wasm-bindgen-cli and binaryen in `mise.toml`
- Measure the speed of fitting and decimation in the compute module with opt-level "z" and with 3, and fix its level (ADR 0013)

Done when: on the published page, a dropped CSV can be saved as SVG, and the SVG is the same as the one from `figlab run`.

### M3 Quick Plot → v0.1

- Full automatic detection (spec.md 10.1) and streaming import of large files
- The Quick Plot panel, zoom and pan, the log toggle, view state, tooltips, showing and hiding series from the legend, and the export dialog
- Table view (read only)
- Category axes and `count()`, histograms, and bar charts
- Quick Fit: built-in models, automatic initial values, range selection, and display and copy of the results. Checked against NIST StRD
- End-to-end tests in Firefox and Safari. Speed measured by `bench.yml`

Done when: the Quick Plot speed targets in spec.md Section 13 are met. Release v0.1 and start using it on real data.

### M4 Command language and editor → v0.2

- Interpreter: definitions, assignments, array arithmetic (shapes must match, and only scalars broadcast), indexing by index and by coordinate, built-in functions, `fn`, and error codes. `for` is parsed but does not run yet (it runs from v1)
- History: GUI operations are recorded as commands
- `figlab check`, `figlab fmt`, `figlab run`, and the conformance tests
- Language service: highlighting, completion, hover help, and diagnostics (CodeMirror 6). Help and the web reference are made from `commands.json`
- Data: 2D arrays, table editing and paste, `.npy`, saving and opening projects (Chrome), and undo and redo
- Complete the built-in functions and fit models in `spec/commands.json` before v0.2. After user functions are released, a new built-in name can clash with them (language.md 10.1)

Done when: the conformance tests pass, and every GUI operation from M3 is recorded as a command that gives the same result when it runs again.

### M5 Publication figures → v0.3 (MVP)

- The default publication style (the common style in `tests/figures/README.md`), physical sizes, fonts and the fallback font, text formatting, legends, axes on all four sides with their colors, error bars, per-point overrides, and heatmaps with color bars
- PDF export with embedded fonts, PNG export, and style templates
- The five acceptance figures, with `figure.figc` and `expected.svg` in each folder
- Export modules: export-pdf and export-png load the first time the user exports ([ADR 0013](adr/0013-wasm-size-and-startup.md)). Decide with real figures:
  - whether export runs on the main thread or in a worker (a worker is recommended for export-png)
  - where raster content in SVG and PDF is made (`raster=true` markers and heatmaps). The plan is to load export-png for it. Then update spec.md 9.3 and 9.4
- The fallback font: lay out a label again when the font arrives after the layout was made (ADR 0010, ADR 0013)
- Finishing: offline use, start within 2 seconds, a CI check of the download size against the budgets in [ADR 0013](adr/0013-wasm-size-and-startup.md) (development.md 5.2), third-party notices, and releases of the command-line tool. Optional: fetch the font after the wasm modules, which saves about 0.14 s on the first visit

Done when: all acceptance figures are reproduced and approved, and the speed targets are met. This completes the MVP.

## Order and parallel work

```
M0 → M1 → M2 → M3 (v0.1)
              ├→ M4 (v0.2) ──────────────┐
              └→ M5 rendering work ─────→ M5 (v0.3 = MVP)
```

- After M2, the command language (M4) does not depend on the UI. It can be built in parallel with M3, in its own jj workspace or by another agent.
- PDF, PNG, and text formatting (part of M5) can start once S1 is done.
- M2 is small, but everything else waits for it. Finish it first.

## Decisions to make

| # | Question | Proposal | When |
|---|---|---|---|
| D1 | Where graph operations are applied | Decided: in Rust (`figlab-graph`), applied on the main thread; the compute worker sends graph commands there and waits for the result ([ADR 0016](adr/0016-graph-operations-in-rust.md)) | Before M2 |
| D2 | UI framework | Decided by S5: Preact with `@preact/signals` ([ADR 0014](adr/0014-ui-framework.md)) | M1 |
| D3 | PDF library and fallback font | Decided by S1: pdf-writer with subsetter, and Noto Sans Math. Text shaping uses harfrust with skrifa ([ADR 0010](adr/0010-text-shaping-pdf-and-fallback-font.md)) | M1 |
| D4 | Fitting library | Decided by S6: a fork of the `levenberg-marquardt` crate with cmpfit-style bounds ([ADR 0015](adr/0015-fitting-library.md)) | M1 |
| D5 | Open questions in language.md Section 11 | Decided. See language.md Section 11 | M0 |
