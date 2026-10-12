# 0007. Do rendering and export in Rust

- Status: Accepted
- Date: 2026-10-09

## Context

spec.md Section 4 first placed layout, draw data, and export on the main thread in TypeScript.
With that design:

- `figlab run` could not export figures
- we could not check that the browser and the command line make the same figures
- figure comparison tests would need a browser

## Options

1. Layout and export in TypeScript, with browser APIs (Canvas, SVG DOM, a JavaScript PDF library)
2. A Rust render module that does layout, text measurement, draw data, and SVG/PDF/PNG export.
   It runs as wasm in the browser and natively in the `figlab` command.
   TypeScript only draws the draw data on the screen.

## Decision

Option 2 (spec.md 9.1, development.md Section 9).
The module is the crate `figlab-render`.

## Reasons

- The browser and the command line make the same figures from the same code.
- Figure comparison tests run in Rust and in CI, without a browser.
- Text is measured from the font files, not by the browser. So text on screen sits exactly where it does in exported figures.
- The needed libraries are pure Rust and work in wasm:
  - text shaping: rustybuzz
  - font loading and subsetting: ttf-parser, subsetter
  - PDF: krilla or pdf-writer
  - PNG: tiny-skia

## Consequences

- The browser's own text rendering is not used for figures. Fonts must be bundled or loaded by the user (spec.md 9.2).
- The draw data format is a contract between Rust and TypeScript. It is versioned and documented.
- The size of the render module counts toward the startup target.
