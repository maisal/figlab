# Architecture decision records

This folder records significant decisions, one per file (development.md 6.3).
Each record has the context, the options, the decision, and the reasons.
The repository is public, so anyone can later see why things are the way they are.

## Rules

- Name each file `NNNN-short-title.md`. Numbers go up by one and are never reused.
- Do not rewrite an accepted record. To change a decision, add a new record.
  Then set the status of the old one to `Superseded by NNNN`.
- Fixing typos and broken links is fine.

## Records

| Number | Decision | Status |
|---|---|---|
| [0001](0001-command-language-and-rust.md) | Computation uses a custom command language and Rust/wasm, not Python | Accepted |
| [0002](0002-strict-syntax.md) | The command language has a strict syntax: each statement can be read in only one way | Accepted |
| [0003](0003-storage-format.md) | The storage format is a folder of JSON and .npy files, with zip to bundle it into one file | Accepted |
| [0004](0004-for-is-the-only-loop.md) | The only loop is `for` over a collection of known size | Accepted |
| [0005](0005-name.md) | The name is figlab | Accepted |
| [0006](0006-english-only-ui.md) | The UI language is English only | Accepted |
| [0007](0007-rendering-in-rust.md) | Rendering and export are done in Rust | Accepted |
| [0008](0008-plain-english-repository.md) | Everything in the repository is written in plain English | Accepted |
| [0009](0009-license.md) | The license is MIT OR Apache-2.0 | Accepted |
| [0010](0010-text-shaping-pdf-and-fallback-font.md) | Text is shaped with harfrust, PDF is written with pdf-writer, and the fallback font is Noto Sans Math | Accepted |
| [0011](0011-drawing-large-traces.md) | Large traces: M4 decimation from a min/max pyramid in the compute worker, redraw with a transform while the next view is decimated, and WebGL markers with x as integer fixed point | Accepted |
| [0012](0012-data-transfer-between-workers.md) | Arrays move between threads by transfer, with one copy at each wasm boundary; no shared memory | Accepted |
| [0013](0013-wasm-size-and-startup.md) | Three wasm modules at startup, export modules loaded on first use, and size budgets for the startup download | Accepted |

## Template

```markdown
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context

What problem or question led to this decision.

## Options

1. …
2. …

## Decision

What we chose.

## Reasons

Why we chose it over the other options.

## Consequences

What follows from the decision, good and bad.
```
