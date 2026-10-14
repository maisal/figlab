# S6: Fitting library

## Question

Which Levenberg–Marquardt implementation should figlab use for `fit` and
Quick Fit (docs/spec.md 6.5)? It needs bounds, fixed parameters, parameter
errors and the covariance matrix, results that match NIST StRD, a gauss fit of
100,000 points within 0.2 s, and the same bits in the browser and on the
command line (docs/spec.md 13).

The decision is in [ADR 0015](../../docs/adr/0015-fitting-library.md).

## Short answer

Use the code of the `levenberg-marquardt` crate 0.15 (MIT, a port of MINPACK
`lmder`), forked, with cmpfit-style bounds added (candidate A2). Keep it in
figlab-core.

- Accuracy is the same as cmpfit. Without bounds the fork gives the same bits
  as the crate. With analytic derivatives, it gives the same parameter bits as
  cmpfit in 52 of 54 NIST runs. All candidates solve 53 of 54 NIST runs. The
  one failure (BoxBOD, start 1) is the same for all.
- The patch is small: 148 added and 15 removed lines in four files. Of these,
  130 and 4 are the bounds. The rest replaces `powi(x, 2)` with `x * x`.
- With bounds that are active at the solution, the fork and cmpfit agree with
  the reference to 7.6 to 15 digits, and both put the parameter exactly on
  the bound.
- It is pure Rust, the patched code calls no forbidden float function, and it
  gives the same bits natively (aarch64 macOS) and in wasm.
- License: the crate, cmpfit, and rmpfit all derive from MINPACK. Only cmpfit
  ships the MINPACK notice. The safer path is to allow the Minpack license
  for code ported from MINPACK and ship its notice (see "Licenses").
- The bounds by a parameter transformation (A1) are worse: 2 or 3 more NIST
  failures in a loose box, up to 9 times more iterations, parameters that never
  reach the bound exactly, and wrong errors near a bound.
- cmpfit (B) works well, but it needs a C toolchain for wasm and an `unsafe`
  FFI layer, it gives different bits natively unless it is built with
  `-ffp-contract=off`, and Markwardt's own notice is on no license list.
- rmpfit (C) has a bounds bug that stops parameters at 0, and its package
  drops the MINPACK and cmpfit notices.
- Speed is not a deciding point. All candidates fit 100,000 points in 47 to
  108 ms (median 53 to 107 ms with the error step), natively and in wasm.

## Setup

- Machine: Apple M1 Max, 64 GB, macOS 27.0.1.
- Rust 1.99.0 (LLVM 23.1.1), target wasm32-unknown-unknown. Node 24.14.1.
- Homebrew clang 23.1.2 and llvm-ar for cmpfit in wasm. Apple clang 21 for
  cmpfit natively (through the `cc` crate).
- binaryen 133 (`wasm-opt`), gzip, brotli 1.x.
- Candidates:

| | Candidate | Version | License |
|---|---|---|---|
| A0 | `levenberg-marquardt` crate as it is (no bounds) | 0.15.0, with nalgebra 0.34.2 | MIT (nalgebra: Apache-2.0). A port of MINPACK without the MINPACK notice |
| A1 | A0 with the MINUIT/lmfit parameter transformation for bounds | same | same |
| A2 | A0 forked, with cmpfit-style bounds (`patches/lm-bounded.patch`) | same | same |
| B | cmpfit (C, Craig Markwardt) | 1.5 (2022-12-09) | MINPACK license (SPDX `Minpack`) plus a custom notice. Not on the allow list |
| C | `rmpfit` crate (Rust port of cmpfit) | 2.0.0 | MIT, as the package says, without the MINPACK or cmpfit notices |

Other crates found on crates.io and not tested: `trust-region-least-squares`
0.11 (a SciPy TRF port with bounds, first release 2026-06, depends on
`libloading` and `rayon`), `lmfit` 0.5 (first release 2026-09, a wrapper of
the `levenberg-marquardt` crate), and `numeris`, `basin`, and `numra-optim`
(large general libraries, all first released in 2026). None is both
established and focused on bounded least squares.

All runs use the same settings: `ftol = xtol = gtol = 30 * f64::EPSILON` (the
crate's default) and at most 1000 iterations (200 for the speed test).
Forward differences use the MINPACK step `sqrt(eps) * |x|`. Fixed parameters
are left out of the optimizer by the wrapper for A0 to A2. The
errors and the covariance that figlab would output are computed the same way
for every candidate: from the Jacobian at the solution, with a Householder QR
with column pivoting, `cov = s^2 (J^T J)^-1`, `s^2 = rss / (m - p)`
(`crates/s6fit/src/linalg.rs`). Parameters at a bound get error 0, as in
cmpfit. "At a bound" is decided by position only.

## How to run

From this folder, with mise active (or prefix each command with `mise exec --`):

```sh
scripts/fetch.sh      # cmpfit 1.5 and the fork, into downloads/ (not committed)
scripts/run-all.sh    # accuracy, bounds, determinism; writes results/tables.md
scripts/speed.sh 21   # timing, 21 runs; writes results/speed-*.json
scripts/size.sh       # wasm size; writes results/size.json
cargo deny --locked check licenses bans sources
```

`scripts/download-nist.sh` downloads the NIST files again. The committed copies
in `data/` came from it.

## Results

All tables except the speed table are final. The full tables are in
[results/tables.md](results/tables.md).

### NIST StRD without bounds

All 27 nonlinear problems, both starting points (54 runs per row). LRE is the
number of correct significant digits against the certified values (at most
11). Medians are over the solved runs (smallest parameter LRE at least 4).

| Candidate | Derivatives | Solved | LRE parameters | LRE errors | LRE library errors | Iterations | nfev |
|---|---|---:|---:|---:|---:|---:|---:|
| A0 lm | analytic | 53/54 | 8.9 | 8.8 | - | 3111 | 3544 |
| A0 lm | forward | 53/54 | 7.6 | 6.7 | - | 3118 | 16406 |
| A2 lm-bounded | analytic | 53/54 | 8.9 | 8.8 | - | 3111 | 3544 |
| A2 lm-bounded | forward | 53/54 | 7.6 | 6.7 | - | 3118 | 16406 |
| B cmpfit | analytic | 53/54 | 8.9 | 8.8 | 8.4 | 3128 | 6664 |
| B cmpfit | forward | 53/54 | 7.9 | 6.7 | 6.8 | 3157 | 16548 |
| C rmpfit | analytic | 53/54 | 9.3 | 8.9 | 8.6 | 3369 | 7409 |
| C rmpfit | forward | 53/54 | 7.8 | 6.8 | 6.8 | 3393 | 17677 |

- The failure is BoxBOD from start 1 for every candidate. They stop at a
  local minimum (rss 9771.5). This is a known MINPACK result.
- "errors": computed by the common method above. "library errors": cmpfit's
  and rmpfit's own `xerror`, scaled by `sqrt(rss/dof)`. cmpfit computes its
  covariance from the QR of the last Jacobian before the final step, so it
  has slightly fewer digits.
- nfev counts every evaluation of the residual vector, including those for
  forward differences. cmpfit and rmpfit also evaluate the residuals with each
  analytic Jacobian, so their analytic nfev is about twice A0's.
- A2 without bounds gives the same bits as A0 in every run. A0 and cmpfit
  with analytic derivatives give the same parameter bits in 52 of 54 runs.
  rmpfit does so in only 26 of 54, so it is not a faithful port.
- Per-problem LREs are in results/tables.md. The smallest LRE among solved
  runs is 5.5 (Lanczos3, start 1, A0 and A2 with forward differences).

### NIST StRD in a loose box

The same runs with a box around both starts and the certified values
(`[min(c, s) - |c| - |s|, max(c, s) + |c| + |s|]`). No bound is active at the
solution, but a bound can be hit on the way.

| Candidate | Derivatives | Solved | LRE parameters | Iterations | Not solved |
|---|---|---:|---:|---:|---|
| A1 lm-transform | analytic | 51/54 | 9.2 | 2592 | Lanczos3/1, MGH17/1, MGH10/1 |
| A1 lm-transform | forward | 50/54 | 7.1 | 2606 | Lanczos3/1, MGH17/1, MGH09/1, MGH10/1 |
| A2 lm-bounded | analytic | 53/54 | 8.7 | 3717 | MGH10/1 |
| A2 lm-bounded | forward | 53/54 | 7.7 | 3688 | MGH10/1 |
| B cmpfit | analytic | 53/54 | 8.9 | 3734 | MGH10/1 |
| B cmpfit | forward | 53/54 | 8.0 | 3734 | MGH10/1 |
| C rmpfit | analytic | 53/54 | 9.3 | 3903 | MGH10/1 |
| C rmpfit | forward | 53/54 | 8.0 | 4126 | MGH10/1 |

BoxBOD start 1 is solved inside the box. In MGH10 start 1 a step on the way
crosses a bound. A2, cmpfit, and rmpfit then need 6,785 to 6,892 iterations
instead of 253, so they stop at the limit of 1000. `s6cli mgh10 --maxiter
20000` (part of `scripts/run-all.sh`) shows this; the numbers are in
results/mgh10-box.json and results/tables.md. A1 stops after 184 iterations
at a wrong point. This is a property of the cmpfit method
(the step is shortened at the first bound), not of one implementation.

### Bounds active at the solution

Five cases. The reference fixes the active parameters at their bounds and fits
the rest without bounds. The active set is found by trying every set, so the
reference is the true optimum in the box. In "gauss x0<=0.05 w>=0.1" only the
x0 bound is active.

Smallest parameter LRE against the reference (analytic / forward), and
iterations with analytic derivatives:

| Case (active bound) | A1 lm-transform | A2 lm-bounded | B cmpfit | C rmpfit |
|---|---:|---:|---:|---:|
| expdecay tau<=1.5 (tau=1.5) | 9.4 / 9.8 (14 it) | 14.8 / 9.5 (3 it) | 14.8 / 8.7 (3 it) | 14.8 / 9.5 (3 it) |
| gauss w>=0.1 (w=0.1) | 7.9 / 7.9 (23 it) | 7.6 / 7.6 (34 it) | 7.6 / 7.6 (35 it) | 0.0 / 0.0 (11 it) |
| gauss x0<=0.05 w>=0.1 (x0=0.05) | 6.8 / 7.9 (180 it) | 7.9 / 7.8 (19 it) | 7.9 / 8.0 (20 it) | 0.0 / 0.0 (9 it) |
| Misra1a start 1, b1>=300 (b1=300) | 9.4 / 9.0 (28 it) | 9.4 / 9.4 (15 it) | 9.4 / 9.3 (28 it) | 9.0 / 9.0 (25 it) |
| BoxBOD start 2, b2>=0.65 (b2=0.65) | 8.6 / 8.5 (15 it) | 15.0 / 10.4 (6 it) | 15.0 / 10.0 (6 it) | 15.0 / 10.4 (6 it) |

Smallest LRE of the errors of the free parameters against the reference
(analytic / forward):

| Case | A1 common | A1 library (lmfit style) | A2 common | B library | C library |
|---|---:|---:|---:|---:|---:|
| expdecay tau<=1.5 | 15.0 / 8.4 | 0.5 / 0.0 | 15.0 / 8.4 | 15.0 / 8.4 | 15.0 / 8.3 |
| gauss w>=0.1 | 11.4 / 0.7 | 0.7 / 0.0 | 15.0 / 8.5 | 15.0 / 8.3 | 0.0 / 0.0 |
| gauss x0<=0.05 w>=0.1 | 6.8 / 2.9 | 6.8 / 0.0 | 7.9 / 7.9 | 7.2 / 7.2 | 0.0 / 0.0 |
| Misra1a start 1, b1>=300 | 10.0 / 7.9 | 0.0 / 0.0 | 10.1 / 8.2 | 10.1 / 11.7 | 9.7 / 8.5 |
| BoxBOD start 2, b2>=0.65 | 15.0 / 0.3 | 0.4 / 0.0 | 15.0 / 9.6 | 15.0 / 8.6 | 15.0 / 9.6 |

What this shows:

- A2 and cmpfit give the same answers. Their paths differ (for example 15
  and 28 iterations for Misra1a with b1>=300), because A2 computes the
  predicted reduction of a shortened step differently (see "Size of the A2
  change"). Both put a parameter exactly on its bound, so figlab can tell
  that it is at the bound. Both report error 0 for it.
- A1 never lands exactly on a bound. It ends about 1e-9 away, so the common
  error method counts the parameter as free and gives wrong errors (LRE 0.3
  to 2.9 with forward differences). The lmfit-style errors, mapped through
  `d ext / d int`, are wrong whenever a parameter is near a bound (for
  example 22.2 instead of 0 for b1 of Misra1a). With forward differences in
  internal space, the Jacobian column of a parameter at the bound is zero and
  the covariance is singular (NaN). A1 also needed 180 iterations where A2
  needed 19.
- rmpfit fails both gauss cases. Its `check_limits` tests
  `j < self.qllim.len()` instead of `self.qllim[j]`. So a parameter without a
  bound counts as pegged when its value equals `limit_low` (0 by default).
  Here y0 and x0 start at 0 and never move. Setting `limit_low = -inf` for
  free parameters works around it (checked by hand: then it finds the
  reference).

### Errors and covariance

- A0, A1, and A2 give no errors. figlab computes them from the Jacobian at
  the solution (about 90 lines, `linalg.rs`). The median LRE of the NIST
  standard errors is 8.8 with analytic derivatives and 6.7 with forward
  differences, the same as cmpfit.
- cmpfit and rmpfit compute the covariance (`covar`) and `xerror`. They assume
  unit weights, so figlab must scale them by `sqrt(rss/dof)` for an
  unweighted fit. cmpfit's median LRE is 8.4 (analytic) and 6.8 (forward).
- Derived quantities (Quick Fit FWHM and area) need the covariance matrix in
  any case. So figlab needs its own covariance code with every candidate.

### Determinism

The same runs (all NIST, bounds, and gauss runs: 917 records) natively on
aarch64 macOS and in wasm32-unknown-unknown under Node 24, compared bit for
bit (parameters, errors, rss, iterations, nfev). See results/determinism.json.

| Candidate | cmpfit with `-ffp-contract=off` | cmpfit with the clang default (`on`) |
|---|---|---|
| A0, A1, A2 (Rust) | 456 of 456 the same | 456 of 456 the same |
| B cmpfit | 228 of 228 the same | 9 of 228 the same |
| C rmpfit | 228 of 228 the same | 228 of 228 the same |

- Rust never fuses `a*b+c`. Clang does by default on arm64 (`-ffp-contract=on`
  is the default for C). wasm has no scalar FMA instruction. So cmpfit gives
  different bits natively unless every native build passes
  `-ffp-contract=off`. With FMA, the smallest NIST LRE changes by up to 3.1
  digits in some runs, and the gauss fit with forward differences differs in
  the 10th digit.
- Float functions: the original crate calls `Float::powi(x, 2)`, `sqrt`,
  `abs`, `min`, and `max` through num-traits. figlab's clippy.toml forbids
  `powi`, because its result can depend on how the compiler expands it. With
  nalgebra's `libm` feature and no `std`, num-traits computes `powi` with a
  multiply loop, so `powi(x, 2)` is `x*x` here. But that depends on how
  num-traits is built, so the patch replaces each `powi(x, 2)` with `x * x`.
  The results did not change by a single bit. nalgebra's own code paths used
  here are plain arithmetic. rmpfit uses `f64::powi(x, 2)` and `sqrt`. cmpfit
  uses `sqrt` and `fabs`. A1 needs `sin`, `cos`, and `asin`; the experiment
  takes them from libm. The experiment code passes clippy with figlab's
  clippy.toml.
- Not tested: x86_64 natively, and real browsers. wasm results should not
  depend on the engine, as wasm floats are IEEE 754 without FMA.

### Speed

A gauss fit (`y0 + a*exp(-((x - x0)/w)^2)`) to 100,000 points, 21 runs after 2
warm-up runs, in ms. "errors" adds the Jacobian and QR at the solution. The
timing comes from a run on 2026-10-15 with no other builds running (normal
desktop apps open, load average about 9 to 12). It can be repeated with
`scripts/speed.sh 21`. The raw numbers are in results/speed-native.json and
results/speed-wasm.json.

| Candidate | Derivatives | Iterations | Native fit | Native fit + errors (median / p95) | wasm fit | wasm fit + errors (median / p95) |
|---|---|---:|---:|---:|---:|---:|
| A0 lm | analytic | 8 | 50 | 55 / 57 | 64 | 69 / 70 |
| A0 lm | forward | 8 | 72 | 81 / 83 | 95 | 105 / 107 |
| A2 lm-bounded | analytic | 8 | 49 | 54 / 56 | 64 | 70 / 71 |
| A2 lm-bounded | forward | 8 | 72 | 81 / 82 | 95 | 107 / 108 |
| B cmpfit | analytic | 8 | 47 | 53 / 54 | 59 | 64 / 65 |
| B cmpfit | forward | 8 | 64 | 72 / 75 | 80 | 91 / 93 |
| C rmpfit | analytic | 8 | 50 | 54 / 56 | 64 | 69 / 71 |
| C rmpfit | forward | 8 | 67 | 76 / 79 | 88 | 100 / 102 |

All are below the 0.2 s Quick Fit target. The slowest case (wasm, forward
differences, fit + errors) has a p95 of 108 ms. Most of the time is spent on
the model (`libm::exp` on 100,000 points per evaluation), not on the
algorithm, so the candidates are close: A0 and A2 are within 3 ms of each
other, and cmpfit is 1 to 16 ms faster than A2. wasm is about 1.2 to 1.3
times slower than native. Analytic gradients for the built-in models save
about a third. The error step could reuse the last Jacobian of the fit.

### wasm size

A minimal module with one gauss fit (forward differences, bounds where the
candidate has them), `opt-level = "z"`, LTO, `panic = "abort"`, then
`wasm-opt -Oz`. Bytes. "base" evaluates the model once and has no fit.

| Module | cargo | wasm-opt -Oz | gzip -9 | brotli -q 11 | brotli minus base |
|---|---:|---:|---:|---:|---:|
| base | 19,034 | 16,360 | 7,656 | 6,636 | 0 |
| A0 lm | 71,886 | 63,673 | 28,075 | 24,935 | 18,299 |
| A1 lm-transform | 75,320 | 67,009 | 29,676 | 26,290 | 19,654 |
| A2 lm-bounded | 74,579 | 66,333 | 29,229 | 25,842 | 19,206 |
| B cmpfit | 56,944 | 51,084 | 22,784 | 20,214 | 13,578 |
| C rmpfit | 95,939 | 85,944 | 37,151 | 32,129 | 25,493 |

The A modules are larger mostly because of nalgebra's generic code. About
6 KB (brotli) more than cmpfit is small next to the other modules.

### Licenses and maintenance

All three candidates derive from MINPACK (Argonne National Laboratory). The
MINPACK distribution carries a 1999 notice by the University of Chicago, which
SPDX calls `Minpack`. It is BSD-style:

- clause 1: source redistributions keep the copyright notice, the conditions,
  and the disclaimer
- clause 2: binary redistributions reproduce them in the documentation
- clause 3: the end-user documentation (or the software, where such notices
  normally appear) includes the acknowledgment "This product includes
  software developed by the University of Chicago, as Operator of Argonne
  National Laboratory"

The Minpack license is not on the allow list (docs/development.md 6.6).

- `levenberg-marquardt` 0.15.0: MIT, LICENSE file present. rust-cv. Its README
  says it is "a port of the classic MINPACK implementation", and one of its QR
  tests was "generated directly from MINPACK's QRFAC". It ships only the MIT
  license, with no MINPACK notice. Whether a Rust port is bound by the MINPACK
  notice is a legal question this experiment cannot answer; the crate authors
  chose MIT. Last release 2025-08-03, 1.4 million downloads. Dependencies:
  nalgebra (Apache-2.0), num-traits, cfg-if (MIT OR Apache-2.0).
  `cargo deny check licenses` passes.
- cmpfit 1.5: the only candidate that ships the MINPACK notice. Markwardt's
  own part adds a custom notice: copying is allowed "provided this copyright
  and disclaimer are included unchanged". That notice is on no license list.
  The author's site answers 403 to scripts; `fetch.sh` uses the Internet
  Archive copy, checked by SHA-256. Version history: 1.0 (2009) to 1.5
  (2022). Its two-sided derivative (`side = 2`) reads `wa2[ij]` instead of
  `wa2[i]` in the non-debug path, an out-of-bounds read (1.4 says it fixed
  two-sided derivatives; the bug is still in 1.5). figlab would not use
  `side = 2`, but it is a sign of little testing.
- rmpfit 2.0.0: Cargo.toml says MIT. The package has no LICENSE file. Its
  README says the code is "mainly copied directly from CMPFIT", but the
  package has neither the MINPACK notice nor Markwardt's. Copying Markwardt's
  code needs his notice, so its MIT label is doubtful. One maintainer, a
  self-hosted git server, and six releases in 2026 (0.4.0 to 2.0.0). The
  analytic Jacobian API allocates a vector per column per iteration.

So the fork (A2) has the same open MINPACK question as rmpfit. ADR 0015 gives
the owner two choices: accept the crate authors' MIT label with that risk, or
(safer) add the Minpack license to the allow list for code ported from
MINPACK and ship the full Minpack notice with the copied code.

### What building cmpfit for wasm takes

- clang with the wasm32 target, and llvm-ar (Homebrew LLVM here; the `cc`
  crate is told where they are). CI and every contributor would need them.
- Four small headers (`csrc/include`): `stdio.h`, `stdlib.h`, `string.h`, and
  `math.h`, where `sqrt`, `fabs`, and `isfinite` are builtins.
- C stubs (`csrc/wasm_shim.c`): `printf`, `puts`, `calloc`, and `strcpy`.
  clang turns `malloc` plus `memset` into `calloc`, and a `printf` of a
  constant line into `puts`, so those are needed even though the code does
  not call them.
- `malloc` and `free` on the Rust allocator (`src/wasm_libc.rs`, with a
  16-byte size header). `memset` and `memcpy` come from Rust's
  compiler_builtins. The final module has no imports.
- `-ffp-contract=off` on every native build.
- An `unsafe` FFI layer (about 220 lines with the callback).

### Size of the A2 change

`patches/lm-bounded.patch` adds 148 lines and removes 15 in four files.

The bounds are 130 added and 4 removed lines: `src/problem.rs` (+13: a
`bounds()` method with a default of `None`) and `src/lm.rs` (+117, -4). They
add:

1. a check that the bounds are valid (lower < upper, right length) and that
   the start is inside them, before the early return for zero residuals,
2. zeroing the Jacobian column of a parameter at a bound whose gradient
   points out of the box (as cmpfit),
3. dropping moves out of the box and shortening the step by a factor
   `alpha` so that it stops at the first bound it meets (as cmpfit),
4. the predicted reduction for the shortened step. This is a deliberate
   change from cmpfit. The patch uses the exact reduction of the linear model
   for the step `alpha * p`: `((2 - alpha) * t1 + 2 * t2) / alpha`, with
   `t1 = (|J d| / |r|)^2`, `t2 = lambda * (|D d| / |r|)^2`, and `d` the
   shortened step. cmpfit (mpfit.c lines 775 to 778) uses
   `alpha^2 * t1 + 2 * alpha * t2`, a heuristic. Both agree only at
   `alpha = 1`. So A2 and cmpfit
   take different paths when a step is shortened, and
5. putting a parameter that ends next to a bound exactly on it.

The other 18 added and 11 removed lines (`lm.rs`, `qr.rs`, `utils.rs`) replace
each `Float::powi(x, 2)` with a helper `sq(x) = x * x`. The results did not
change.

Without bounds the original code path runs, so results do not change. Forward
differences that step backward next to an upper bound are done in the
wrapper (`problem.rs`, `fd_step`). The crate's source is 2,424 lines without
its test modules (4,774 with them).

Known limits of the patch, the same as in cmpfit:

- The thresholds are absolute (machine epsilon, cmpfit's `MP_MACHEP0`). A
  move counts only if `|move| > 2.2e-16`, and a value within 2.2e-16 of a
  bound at 0 snaps to 0. A parameter whose size is about 1e-16 or less (for
  example a cross section in m² or a decay time in s) cannot be fitted next
  to a bound at 0. Thresholds relative to the parameter's scale would fix
  this.
- If every move of a step is dropped (all free parameters push against their
  bounds), the step is zero and the fit ends as converged (xtol), possibly at
  a point that is not stationary.

## Limits

- One machine (aarch64 macOS). x86_64 and Windows builds were not run.
- wasm ran in Node only, not in browsers.
- Timing was measured on one machine (Apple M1 Max, Node 24) with normal
  desktop apps open. Browsers may give other numbers.
- Tolerances were the same for all candidates and tight (`30 * eps`). figlab
  may choose looser ones; that changes LRE and iterations, not the ranking.
- Only five cases with active bounds. Only one parameter is active in each.
- Weighted fits (`sigma`) were not tested separately. They only scale the
  residuals and the Jacobian.
- The candidates' own Jacobian-free modes were not used. A0 to A2 get forward
  differences from the wrapper; cmpfit and rmpfit compute their own.
