# 0002. Use a strict syntax for the command language

- Status: Accepted
- Date: 2026-10-09

## Context

Commands come from several places:

- people type them on the command line
- the GUI records each operation as a command in the history
- AI writes and checks them

The history is re-run later to recreate figures.
So every command must mean exactly one thing, now and later.

## Options

1. A forgiving syntax: optional quotes, aliases, implicit type conversion, guessing what the user meant
2. A strict syntax: each statement can be read in only one way

## Decision

Option 2. The rules are in language.md Section 1. In short:

- The grammar is an unambiguous context-free grammar. The EBNF in language.md Section 3 is complete.
- The first word decides the kind of statement.
- There is one way to write one thing.
- There is no implicit behavior. Shape mismatches, implicit type conversion, out-of-range indices, and unknown options are errors.

## Reasons

- Syntax, names, and types can be checked without running (`figlab check`).
- A canonical format and conformance tests become possible (language.md 10.3, 10.4).
- Commands written by AI can be verified by tools, not only by reading them.
- Mistakes show up as errors at once, not as wrong figures later.
- The history re-runs the same way in the browser and on the command line.

## Consequences

- Some shortcuts that other tools allow are errors in figlab.
- Error messages must be clear, because users will see more of them.
- A change to the grammar changes language.md, `spec/commands.json`, and the conformance tests together.
