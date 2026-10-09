# 0004. Make `for` over a collection of known size the only loop

- Status: Accepted
- Date: 2026-10-09

## Context

Users often repeat the same steps over many data sets.
For example, they normalize and fit every scan in a folder.
At the same time:

- every statement should finish
- a long run should be stoppable
- results should be deterministic
- the checker should be able to check a script without running it

## Options

1. General loops: `while` and recursion
2. No loops. Users repeat commands by hand
3. Only `for` over a collection whose size is known when the loop starts. No `while`, no recursion

## Decision

Option 3. A `for` loop can go over (language.md 5.5):

- an integer range `a..b`
- a list `[…]`
- `folders(folder)`
- `arrays(folder)`

The collection is evaluated once, when the loop starts.
There is no `if` statement. The expression `if … then … else …` selects values.

## Reasons

- Every statement finishes in finite time. A mistake cannot hang the app.
- The compute worker runs one iteration at a time. It can stop between iterations (spec.md Section 4).
- `figlab check` can check the body once. With a project, it can check each element of the collection.
- The history records a loop as written, so it stays short and readable.
- Looping over folders covers the main use case.

## Consequences

- Algorithms that need open-ended iteration cannot be written in the language.
  They must be built-in functions or commands, written in Rust.
- The grammar of `for` is fixed in the MVP. The feature ships in v1 (spec.md Section 14).
