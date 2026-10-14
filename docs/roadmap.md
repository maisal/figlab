# figlab Roadmap to the MVP

This document is the plan of work up to the MVP.
The scope of the MVP is in spec.md Section 14. This document only says in which order the work is done.

Progress is tracked with GitHub milestones and Issues (development.md 5.5).
Update this document when the plan changes, not when a task is done.

Status (2026-10-14): M0 is done. M1 (experiments) is next.

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

| # | Question |
|---|---|
| S1 | Text: can rustybuzz and ttf-parser shape text in wasm, and can the glyphs be drawn on Canvas from the draw data? Choose the PDF library (krilla or pdf-writer) and the fallback font for symbols (spec.md 9.2) |
| S2 | Drawing speed: can 10 million points be decimated and panned and zoomed at 60 frames per second? |
| S3 | Data transfer between workers: GitHub Pages cannot use SharedArrayBuffer. How long does it take to pass large arrays as transferable buffers? |
| S4 | Size and startup: how large are the three wasm modules (compute, render, language service)? Can PDF and PNG export be loaded later? Can the app start within 2 seconds? |
| S5 | UI framework: choose by download size, how well it works with CodeMirror 6, and how well AI agents know it |
| S6 | Fitting: compare the `levenberg-marquardt` crate with bounds added and cmpfit on a few NIST StRD problems |

### M2 Thin slice

- core: 1D arrays with coordinates and units, folders
- io: simple CSV (UTF-8, comma-separated, one header row)
- lang: lexer and parser for the whole grammar. Only `load`, `plot`, and `export` run
- Graph model and graph operations (see D1)
- render: xy lines, linear axes, ticks, labels, and SVG export
- web: drop a file, draw it, and save it as SVG
- cli: `figlab run` writes the same SVG
- CI: the first determinism test and the first figure comparison test. Publish the web app on Pages

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
- Finishing: offline use, start within 2 seconds, a CI check of the first download size, third-party notices, and releases of the command-line tool

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
| D1 | Where graph operations are applied | In Rust, so that the browser and `figlab run` share them. The graph model (JSON) stays on the main thread. Update spec.md Section 4 when this is decided | Before M2 |
| D2 | UI framework | Decided by S5 | M1 |
| D3 | PDF library and fallback font | Decided by S1 | M1 |
| D4 | Fitting library | Decided by S6 | M1 |
| D5 | Open questions in language.md Section 11 | Decided. See language.md Section 11 | M0 |
