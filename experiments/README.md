# Experiments

This folder holds the code of the M1 experiments (docs/roadmap.md M1).
Each experiment answers one question and ends with an ADR in `docs/adr/`.

The code here is not part of figlab:

- It is not built, tested, or shipped with the app or the `figlab` command.
- `mise run check` and CI do not check it.
- The product crates and `web/` must never depend on it.
- It is not maintained. It may be deleted once its decision is implemented. The ADR keeps the results.

## Layout

One folder per experiment:

| Folder | Question |
|---|---|
| `s1-text/` | Text shaping in wasm, glyphs on Canvas, the PDF library, and the fallback font |
| `s2-draw/` | Decimating, panning, and zooming 10 million points at 60 frames per second |
| `s3-transfer/` | Passing large arrays between workers as transferable buffers |
| `s4-size/` | The size of the wasm modules, loading export later, and startup within 2 seconds |
| `s5-ui/` | The UI framework |
| `s6-fit/` | Fitting: the `levenberg-marquardt` crate with bounds, cmpfit, and others on NIST StRD |

Each folder has a `README.md` with:

- the question
- how to run the experiment, in a few commands
- the results, with the machine, the browser, and the versions used
- a link to the ADR

## Rules

- Rust code in an experiment is its own Cargo workspace (`[workspace]` in its `Cargo.toml`) with its own `Cargo.lock`. The root workspace and its lock file do not change.
- npm packages for an experiment go in its own `package.json` and `pnpm-lock.yaml`.
- Dependencies follow the license allow list in docs/development.md 6.6. A candidate under test with another license is downloaded by a script and not committed. Its README says which license it has.
- Do not commit large or third-party files, such as fonts or generated data. A script downloads or makes them. Small public domain data, such as NIST StRD files, may be committed with its source.
- Build output goes in `target/`, `dist/`, or `pkg/`. Downloads go in `downloads/`. The root `.gitignore` ignores these folders in every experiment.
- Measured numbers are committed in the experiment's README (and in `results/` if they are long).
