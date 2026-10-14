# 0015. Fit with a fork of the `levenberg-marquardt` crate with cmpfit-style bounds

- Status: Accepted
- Date: 2026-10-14

## Context

`fit` and Quick Fit (spec.md 6.5, 6.5.1) need a Levenberg–Marquardt solver.
The solver must:

- support `init`, `fix`, `bounds`, `sigma`, and `maxiter`
- give parameter errors, the covariance matrix, χ², the number of iterations, and whether it converged
- match the certified values of NIST StRD
- fit a gauss model to 100,000 points within 0.2 s (spec.md 13)
- give bit-identical results in the browser (wasm) and on the command line (spec.md 13, language.md 10.2)
- use a license on the allow list (development.md 6.6)

spec.md 4.1 names two candidates: the `levenberg-marquardt` crate with bounds added, or cmpfit compiled to wasm.
This is decision D4 in roadmap.md. Experiment S6 compared them.
The code, the commands, and all numbers are in [experiments/s6-fit](../../experiments/s6-fit/README.md).

## Options

1. **A1: the `levenberg-marquardt` crate 0.15 (MIT) as it is, with a parameter transformation for bounds** (the MINUIT/lmfit sin and sqrt mapping).
2. **A2: a fork of the crate with cmpfit-style bounds.**
   A parameter at a bound whose gradient points out of the box is held there.
   A step is shortened so that it stops at the first bound it meets.
   The patch adds 148 lines and removes 15, in four files.
   130 added and 4 removed lines are the bounds. The rest replaces `powi(x, 2)` with `x * x`.
3. **B: cmpfit 1.5** (C, by Craig Markwardt), through FFI, built with the `cc` crate natively and with clang for wasm.
4. **C: the `rmpfit` crate 2.0** (a Rust port of cmpfit).

Other crates on crates.io with bounds (`trust-region-least-squares`, `lmfit`, `numeris`, and others) are all from 2026 and were not tested.

Measured evidence (aarch64 macOS and wasm under Node; all 27 NIST StRD problems from both starts):

| | A1 transform | A2 fork | B cmpfit | C rmpfit |
|---|---|---|---|---|
| NIST without bounds, solved (analytic / forward) | same as the crate: 53/54 / 53/54 | 53/54 / 53/54 | 53/54 / 53/54 | 53/54 / 53/54 |
| NIST median LRE of parameters (analytic / forward) | 8.9 / 7.6 (the crate) | 8.9 / 7.6 | 8.9 / 7.9 | 9.3 / 7.8 |
| NIST median LRE of standard errors (analytic / forward) | 8.8 / 6.7 (figlab's QR) | 8.8 / 6.7 (figlab's QR) | 8.4 / 6.8 (its own covar) | 8.6 / 6.8 (its own covar) |
| NIST in a loose box, solved (analytic / forward) | 51/54 / 50/54 | 53/54 / 53/54 | 53/54 / 53/54 | 53/54 / 53/54 |
| 5 cases with an active bound | right parameters, but never exactly on the bound; wrong errors; up to 180 iterations where A2 needs 19 | parameters exactly on the bound; agrees with the reference to 7.6 to 15 digits | the same answers as A2, by a different path | fails 2 of 5: a bug pegs free parameters whose value is 0 |
| Native and wasm give the same bits | yes | yes | only with `-ffp-contract=off`; with the clang default, 219 of 228 runs differ | yes |
| Gauss fit, 100,000 points, wasm, fit + errors, median (analytic / forward) | about the crate's: 69 / 105 ms | 70 / 107 ms | 64 / 91 ms | 69 / 100 ms |
| Minimal wasm module with one fit, brotli, minus a base module | 19.7 KB | 19.2 KB | 13.6 KB | 25.5 KB |
| License | MIT label. A port of MINPACK without the MINPACK notice | same as A1 | Ships the MINPACK notice (SPDX `Minpack`, not on the allow list) and Markwardt's own notice (on no license list) | MIT label. Copied from cmpfit without the MINPACK or Markwardt notices |
| Build | pure Rust | pure Rust | C toolchain with a wasm target; headers and stubs for `malloc`, `free`, `calloc`, `printf`, `puts`, `strcpy` | pure Rust |

All NIST failures except the loose-box ones are BoxBOD from start 1, a known local minimum, for every candidate.

## Decision

Option 2 (A2).
figlab-core keeps the code of the `levenberg-marquardt` crate 0.15.0 with the bounds patch from experiments/s6-fit/patches/lm-bounded.patch.

- The copied code keeps the crate's MIT notice, and a comment names the source and the license (AGENTS.md).
  The MINPACK notice is handled as in "License" below.
- figlab-core adds the parts the crate does not have:
  - fixed parameters are left out of the solver
  - forward differences with the MINPACK step `sqrt(eps)*|x|`, stepping backward next to an upper bound
  - `maxiter` counts Jacobian evaluations
  - errors and the covariance from a Householder QR with column pivoting of the Jacobian at the solution. A parameter at a bound gets error 0
  - checks of the bounds and the start before the solver runs (see Consequences)
- Built-in models get analytic gradients. User models use forward differences.

### License

All three code candidates derive from MINPACK, the Fortran library from Argonne National Laboratory.
The crate's README calls it "a port of the classic MINPACK implementation", and one of its tests was "generated directly from MINPACK's QRFAC".
cmpfit is a C translation of MINPACK, and rmpfit copies cmpfit.
Only cmpfit ships the 1999 MINPACK notice of the University of Chicago (SPDX `Minpack`).
Clause 1 of that notice requires source redistributions to keep the copyright, the conditions, and the disclaimer.
Clause 3 asks for an acknowledgment in the end-user documentation.
The acknowledgment alone does not meet clause 1.
Whether a port to another language is bound by the notice is a legal question; the crate authors chose MIT.

The owner chose (b) on 2026-10-15. The two choices were:

a. Accept the crate authors' MIT label and ship only the MIT notice.
   The risk: if the port is a derivative work of MINPACK, figlab redistributes MINPACK-derived source without its notice.
   This is the same doubt that counts against rmpfit.
b. Add the Minpack license to the allow list in development.md 6.6, only for code ported from MINPACK, with the reason as a comment in deny.toml.
   Ship the full Minpack notice (copyright, conditions, disclaimer, and acknowledgment) next to the copied code and in THIRD-PARTY-NOTICES.

(b) is the safer path, and it costs only a notice.
The terms are BSD-style and work with MIT OR Apache-2.0 distribution.

## Reasons

- A2 is as accurate as cmpfit. Both are MINPACK `lmder`: with analytic derivatives, they give the same parameter bits in 52 of 54 NIST runs. With bounds they give the same answers on every test. Their paths differ when a step is shortened at a bound (for example 15 and 28 iterations for Misra1a with b1>=300), because A2 uses the exact predicted reduction of the shortened step and cmpfit a heuristic (experiments/s6-fit/README.md, "Size of the A2 change").
- A2 is pure Rust. It needs no C toolchain and no `unsafe` FFI.
- The license does not separate A2 from cmpfit. Under (b), the MINPACK part of cmpfit is allowed too; only Markwardt's own notice remains, and it is on no list. Under (a), A2 needs no change to the allow list, but carries the risk above. In both cases the other reasons decide: the C toolchain, the `unsafe` FFI, FMA contraction, and maintenance.
- A2 gives the same bits natively and in wasm with no special care. cmpfit only does so if every native build turns off FMA contraction. Forgetting the flag breaks spec.md 13 without any error.
- The patch is small and leaves the code path without bounds unchanged. Owning the code also lets figlab fix bugs and add what it needs, for example returning the last QR so the covariance needs no extra Jacobian.
- A1 needs no fork, but it is worse where bounds matter. Parameters never land on the bound, so figlab cannot report "at bound". Errors near a bound are wrong. It fails 2 or 3 more NIST problems in a loose box and can need many more iterations.
- rmpfit has a bounds bug, and its MIT label is doubtful because it drops Markwardt's notice as well as the MINPACK one. It has one maintainer and changes fast.
- Speed does not decide: every candidate meets the 0.2 s Quick Fit target, also in wasm (slowest p95: 108 ms). Most of the time goes to evaluating the model. The timing comes from a run on 2026-10-15 with no other builds running (normal desktop apps open).
- Size does not decide: A2 is about 6 KB (brotli) larger than cmpfit.

## Consequences

- figlab maintains about 2,400 lines of solver code. Upstream fixes to the crate must be merged by hand. The crate's last release was 2025-08.
- figlab-core depends on nalgebra 0.34 (Apache-2.0) with `default-features = false` and the `alloc` and `libm` features. With `libm` and no `std`, num-traits uses libm, so the solver calls no OS math function. Removing nalgebra later would make the module smaller, but it is not needed.
- The original crate uses `Float::powi(x, 2)`, which clippy.toml forbids. It is exact only because num-traits is built without `std`. The patch replaces it with `x * x`; the results did not change by a single bit.
- The copied code is not a crate dependency, so cargo-about does not list it. THIRD-PARTY-NOTICES must add its notices by hand: the MIT notice, and under (b) the full Minpack notice.
- The bounds keep two limits of cmpfit:
  - The thresholds are absolute (machine epsilon, cmpfit's `MP_MACHEP0`). A move counts only if it is larger than 2.2e-16, and a value within 2.2e-16 of a bound at 0 snaps to 0. A parameter of size 1e-16 or less (SI units such as cross sections in m² or decay times in s) cannot be fitted next to a bound at 0. figlab-core can make the thresholds relative to the scale of each parameter.
  - If every move of a step is dropped because all free parameters push against their bounds, the fit ends as converged (xtol), possibly at a point that is not stationary.
- figlab-core must check, before the solver runs, that lower < upper for every bounded parameter and that the start is inside the bounds. This includes the automatic initial values of Quick Fit, which must be moved inside the bounds. spec/errors.json needs an error code for invalid bounds and for a start outside them (a follow-up change). The patch also checks both, before its early return for zero residuals, but only as a last guard.
- "At a bound" is decided by position. If the unconstrained minimum lies exactly on a bound, the parameter is really free, and error 0 understates it. figlab-core can also check the sign of the gradient, as the experiment's reference does, if this matters.
- With bounds, a path that runs into a bound can be slow. MGH10 from start 1 in a loose box needs 6,785 iterations (A2) instead of 253 without bounds (experiments/s6-fit/results/mgh10-box.json). figlab should show "did not converge" and let the user change the bounds or `maxiter` (spec.md 6.5.1 already has this flow).
- tests/numeric gets the 27 NIST StRD problems (the files in experiments/s6-fit/data can be copied), both starts, analytic and forward. In the experiment, the smallest parameter LRE of a solved run was 6.2 (analytic) and 5.5 (forward). BoxBOD from start 1 is an expected failure. Lanczos1 standard errors reach only 2.9 to 4.1 digits, because its certified rss (1.4e-25) is near the limit of double precision. These numbers and the same-bits counts are in experiments/s6-fit/results/tables.md and nist-summary.json.
- A determinism test compares native and wasm fit results bit for bit.
- This change also updates the documents:
  - spec.md 4.1, Numerics row: the fork with cmpfit-style bounds.
  - spec.md 6.5: a parameter that ends on a bound gets error 0. The degrees of freedom are the number of points minus the number of free parameters that are not on a bound. Whether `sigma` gives absolute errors or errors scaled by √χ²_red stays open ([To confirm]). The experiment scales by `sqrt(rss/dof)`, as NIST does for unweighted fits.
  - roadmap.md D4 points to this record.
  - development.md 6.6: Minpack is allowed only for code ported from MINPACK, with its full notice. deny.toml says why it is not on the crate allow list.
