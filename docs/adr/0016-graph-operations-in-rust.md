# 0016. Apply graph operations in Rust, on the main thread

- Status: Accepted
- Date: 2026-10-16

## Context

spec.md Section 4 says that the graph model on the main thread (JSON) is the single owner of each graph.
GUI operations and commands both change a graph through the same "graph operations".
A graph operation has a fixed kind and typed arguments.
This gives three things: GUI operations are recorded in the history as matching commands, undo and redo are built from inverse operations, and graphs can be edited while calculations run.

roadmap.md D1 asks where graph operations are applied. It must be decided before M2, which builds the graph model and the first graph operations.

Facts that constrain the answer:

- `figlab run` must produce the same figures as the browser (spec.md 13, ADR 0007). It runs commands such as `graph`, `plot`, `style`, `axis`, and `legend` without a browser.
- Graphs and traces are names in the command language. A command fails if a graph or trace does not exist (E3001) or already exists (E3008), and some operations fail on some axes (E5010). The error must belong to the command that caused it, in the browser and on the command line alike.
- The compute worker runs commands one statement at a time and can be busy for a long time (fits, imports, `for` loops). The UI must stay responsive, and graphs must stay editable meanwhile (spec.md Section 4).
- Data moves between threads only by messages (ADR 0012). Graph operations are small messages.
- The render module (Rust, on the main thread) already reads the graph model to make the layout (ADR 0007, ADR 0013).

## Options

1. **TypeScript on the main thread.** The UI applies graph operations in TypeScript. `figlab run` needs a second implementation in Rust.
2. **Rust, on the main thread.** A Rust crate defines the graph model, the graph operations, their checks, and their inverses. The render module links it, so the main thread applies operations in wasm. `figlab run` links the same crate.
3. **Rust, in the compute worker.** The compute worker owns the graphs as well as the data, and applies every operation there.

## Decision

Option 2.

- A new crate, `figlab-graph`, holds:
  - the graph model types, which read and write the JSON of spec.md 8.1 (also the storage format, ADR 0003)
  - the graph operation kinds with typed arguments
  - `apply(model, operation)`: it checks the operation, returns the changed model and the inverse operation, or returns an error with its code from spec/errors.json
- It has no I/O and no font libraries. It follows the determinism rules (language.md 10.2), so native and wasm give the same result.
- In the browser, the render module links `figlab-graph`. The graph model stays on the main thread as the single owner of each graph. TypeScript keeps it as UI state and asks the render module to apply each operation.
- `figlab run` links the same crate and applies the operations with direct calls.
- The compute worker does not keep graphs. A graph command becomes a graph operation, which the worker sends to the main thread. The worker waits for the result before it runs the next statement. So a graph error belongs to its command, and the next statement sees the change, the same as in `figlab run`.
- A GUI operation is applied on the main thread at once. It is then sent to the compute worker, which formats it as a command (with `figlab-lang`, in the canonical format of language.md 10.3) and records it in the history.
- Undo and redo keep the operations and their inverses on the main thread.
- The view state (zoom range, temporarily hidden series; spec.md 12.3.1) is not a graph operation. It stays in TypeScript and is not recorded.

## Reasons

- Option 1 needs two implementations of every graph operation and its checks, one in TypeScript and one in Rust for `figlab run`. They would drift apart, and the browser and the command line would give different figures or different errors. ADR 0007 moved rendering to Rust for the same reason.
- Option 3 puts graphs behind a worker that can be busy for seconds. A click on the legend or a style change would wait for a fit or an import to finish. This breaks "graphs can be edited while calculations run" and the 50 ms response targets of spec.md 13.
- Option 2 keeps one implementation and keeps the main thread in charge of graphs. The render module is already on the main thread and already reads the graph model, so it is the natural place.
- Waiting for the result of each graph command costs one message round trip, about 0.05 to 0.1 ms (ADR 0012), plus the work of `apply`. Even a `for` loop that plots hundreds of files spends well under a second on this.
- Formatting GUI operations in the compute worker keeps the parser and formatter out of the render module. The render module stays within its size budget (ADR 0013), and the history is written by the code that also checks and runs commands.

## Consequences

- development.md Section 2 lists `figlab-graph`. It is linked by the render module, by the compute module (for the operation types it sends), and by `figlab-cli`.
- spec.md Section 4 shows the graph operations in the render module, and says how the compute worker sends graph commands to the main thread and waits for the result.
- The size of `figlab-graph`, including reading and writing JSON, counts against the render module's budget (ADR 0013).
- The graph model and the operation list need a contract that TypeScript can also check, for example a JSON Schema in spec/schema/, written in M2 together with the first operations.
- A test sends every GUI operation through "format as a command, parse, run" and checks that the result equals applying the operation directly. This is the M4 done condition ("every GUI operation … gives the same result when it runs again").
- Open for M4: the order in the history when a GUI operation happens while a command is running in the compute worker. The operation is applied at once, but the worker records it only after the running statement.
