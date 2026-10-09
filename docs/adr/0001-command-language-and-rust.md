# 0001. Use a custom command language and Rust/wasm for computation

- Status: Accepted
- Date: 2026-10-09

## Context

figlab needs the kind of calculations a spreadsheet can do:

- simple corrections to data
- standard functions and user functions
- curve fitting with built-in models or models written as expressions

No simulations or complex analysis are planned.
The page should be usable within 2 seconds of opening (spec.md Section 13).
The browser app and the `figlab` command should give the same results.

## Options

1. Python in the browser (Pyodide with NumPy and SciPy)
2. JavaScript
3. A custom command language, with the computational core in Rust, built to wasm and to native code

## Decision

Option 3.
The language is defined in language.md and `spec/commands.json`.
The core is a set of Rust crates (development.md Section 2).

## Reasons

- Pyodide with NumPy and SciPy is a large download. It does not fit the 2-second startup target.
- Python and JavaScript are general-purpose languages. They allow many ways to write the same thing. A custom language can be strict and can be checked without running it (0002).
- The required calculations go no further than fitting. A small language covers them.
- Rust builds to wasm for the browser and to a native binary for the command line. With the `libm` crate, both give bit-identical results.

## Consequences

- We design, document, and maintain the language ourselves.
- Users cannot reuse Python code. Compatibility with the scripting languages of other tools is a non-goal (draft.md).
- Anything beyond the language must be added as a built-in function or command in Rust.

## History

Python was chosen at first.
It was changed after confirming that the required calculations go no further than fitting (draft.md, Decision 1).
