# S4: wasm size, loading export later, and startup time

This is the M1 experiment S4 (docs/roadmap.md M1). The decision is in [ADR 0013](../../docs/adr/0013-wasm-size-and-startup.md).

The main case follows what the other experiments recommend (not yet accepted):

- S1 (ADR 0010): shaping with harfrust 0.14 + skrifa 0.48 (default features off, only `libm`), and PDF with pdf-writer 0.15 + subsetter 0.2.6 (no `variable-fonts`) with skrifa for the font metrics.
- S5 (ADR 0014): Preact 10 with `@preact/signals`.
- S6 (ADR 0015): a fork of levenberg-marquardt 0.15 with bounds. Its size is close to the crate's, so the compute module here uses the crate as it is.

The other candidates (rustybuzz, krilla, plain TypeScript, React, rmpfit) stay in the tables, so any other choice can be read off.

## Question

1. How large are the three wasm modules: compute, render, and language service?
2. Can PDF and PNG export be loaded later, only when the user exports?
3. Can the app start within 2 seconds (spec.md 13)?

## Short answer

1. With stand-in code and an allowance for figlab's own code, the three startup modules are about 1,000 KiB gzip together: compute 434 KiB, render (harfrust) 442 KiB, language service 124 KiB.
   A module built with only the libraries (no stand-in code):
   - compute: 162 KiB (122 KiB of it is encoding_rs for Shift_JIS)
   - render: 301 KiB with harfrust + skrifa, or 219 KiB with rustybuzz + ttf-parser
   - the language service has no big library. `commands.json` as Rust tables adds 9 KiB
2. Yes. PDF (pdf-writer + subsetter + skrifa, 112 KiB gzip) and PNG (tiny-skia, 136 KiB gzip) work as separate wasm modules loaded with `import()` on first use.
   First use takes about 0.2 s (PDF) and 0.3 s (PNG) on a cold cache at 10 Mbit/s, and 0.01 s and 0.07 s from the cache.
   Splitting keeps about 195 KiB gzip (13% of what an unsplit app would download at startup) out of the startup download. It costs about 53 KiB gzip of code that is in more than one module.
   Raster content in SVG and PDF (heatmaps, `raster=true`) is not in these modules. See the ADR.
   With krilla instead of pdf-writer, the PDF module would be 449 KiB gzip and splitting would matter more.
3. Yes, by a wide margin, in throttled Chrome (the only browser measured with throttling). With Preact, the second visit is usable in 0.09 to 0.10 s (CPU 1x) and 0.26 to 0.28 s (CPU 4x, main thread only), from the HTTP cache or a Service Worker cache.
   The first visit at 10 Mbit/s and 40 ms round trip is usable in 1.24 s (CPU 1x). It downloads 1.27 MiB gzip (with the font without hinting), and the download is most of the time.
   WebKit ran without throttling, and Firefox did not run, so they say little about 2 seconds.

"Usable" means: the UI is painted, the three startup wasm modules are instantiated (render on the main thread, compute and language service in workers), and the compute worker and the language service worker have each answered a first request. The bundled font is not part of it (spec.md 13, ADR 0013).

The timing numbers come from the full run on 2026-10-15 (10 runs per Chrome case, 5 per WebKit case), with no other builds running.
The machine was not quiet: the user's normal apps were open, and macOS background services (Microsoft Defender's scanner at about 100% CPU, `mediaanalysisd` at about 80%) were busy, probably scanning the fresh build output. The load average was about 8 at the start and up to about 20 during the run (see Limits).
The sizes are final.

## Setup

- Machine: Apple M1 Max, 64 GB, macOS 27.0.1.
- Rust 1.99.0 (wasm32-unknown-unknown), wasm-bindgen 0.2.129 (crate and CLI), binaryen 133 (wasm-opt).
  The nightly rows use rustc 1.99.0-nightly (2026-07-17) with `-Z build-std`.
- Release profile (`Cargo.toml`): `opt-level = "z"`, `lto = true`, `codegen-units = 1`, `panic = "abort"`.
  Then `wasm-bindgen --target web` and `wasm-opt -Oz` with the wasm features that Rust 1.99 enables by default.
  Other profiles (`release-s`, `release-o3`, `release-plain`) are for comparison.
- Node 24.14.1, pnpm 10.25.0, Vite 8.3.4, TypeScript 6.0.3, CodeMirror 6 (`codemirror` 6.0.2, `basicSetup`), Preact 10.29.8 with `@preact/signals` 2.11.3, React 19.3.0, Playwright 1.64.0.
- Browsers: Google Chrome 155.0.8059.79 (installed, headless), WebKit 27.2 (Playwright build).
  The Playwright build of Firefox did not start in the agent's sandbox, so there are no Firefox numbers.
- Crates (all pinned with `=` in `rust/*/Cargo.toml`): csv 1.4.0, encoding_rs 0.8.42, levenberg-marquardt 0.15.0 with nalgebra 0.34.2 (default features off, `alloc` and `libm`, as in ADR 0015), rmpfit 2.0.0, libm 0.2.16, harfrust 0.14.0 and skrifa 0.48.0 (default features off, `libm`), rustybuzz 0.20.1, ttf-parser 0.25.1, pdf-writer 0.15.0, subsetter 0.2.6 (default features off), miniz_oxide 0.9.1, krilla 0.8.2, tiny-skia 0.12.0, serde 1.0.229, serde_json 1.0.154.
  `cargo deny check licenses bans sources` with the root `deny.toml` passes for this workspace.
  The npm packages are MIT, Apache-2.0 (Playwright, TypeScript), and ISC. The build tool Vite uses lightningcss (MPL-2.0), which never ships.
- Fonts (OFL-1.1, downloaded by `scripts/fetch-fonts.mjs` from pinned commits): Arimo Regular (googlefonts/Arimo), Arimo variable, Tinos Regular, and Noto Sans Math (google/fonts).
  The script also makes copies without hinting with fontTools 4.66.1 (MIT, run with `uvx`).
- `cargo clippy --workspace --all-features` (wasm32 target) and `tsc --noEmit` pass without warnings.

### What the modules contain

The product crates are still empty. So the modules are stand-ins (`rust/`):

| Module | Libraries | Stand-in for figlab's own code |
|---|---|---|
| `m-compute` | csv, encoding_rs, levenberg-marquardt + nalgebra (or rmpfit), libm | lexer, parser, and interpreter of a subset of the language, CSV detection (spec.md 10.1) |
| `m-render` | harfrust + skrifa (or rustybuzz + ttf-parser) | axes, ticks, labels, draw data with glyph outlines, SVG writer |
| `m-lang` | none (serde_json in one variant) | the same lexer and parser, a checker with error codes, completion, hover help, `spec/commands.json` |
| `m-export-pdf` | pdf-writer + subsetter + skrifa + miniz_oxide (or krilla) | PDF from the draw data, with the font embedded as a subset |
| `m-export-png` | tiny-skia (with the png crate) | PNG from the draw data. Glyphs come as outlines in the draw data, so there is no font parser |
| `m-baseline` | none | one function, then + Vec, then + `format!` of a float |

`scripts/check-outputs.mjs` runs the render and export modules in Node and writes a figure as SVG, PDF, and PNG into `pkg/out/`.
`pdfinfo` reads the PDF (one page, Arimo embedded as a subset), and the PNG shows the plot.

#### Allowance for figlab's own code

The stand-ins are small (1,000 to 1,600 lines each). The real code will be larger.
The crate `rust/ballast` generates functions of varied arithmetic and control flow (fixed seed).
It gives the "app" modules a larger size, so the download sizes include something for figlab's own code:

- We chose the number of generated functions per module (`BALLAST` in `scripts/build-wasm.mjs`: 900 for compute, 450 for render, 250 for the language service). The sizes it gives are a choice, not an estimate made from a plan.
  It adds 228 KiB gzip to compute, 127 KiB to render, and 71 KiB to the language service.
- The stand-ins measure 18 to 30 bytes of gzip per line of Rust (non-blank, non-comment lines). For example, the interpreter stand-in is 47 KiB for about 1,560 lines, and the layout and SVG stand-in is 8 KiB for about 450 lines.
  Dividing the allowance by about 22 bytes per line gives about 10,000 lines for compute, 6,000 for render, and 3,500 for the language service. This is a conversion of the chosen size, not a forecast of figlab's size.
- The generated code compresses slightly worse than the stand-ins (about 2.07 bytes raw per gzip byte, against 2.2 for the stand-ins), so the allowance is a little high in gzip bytes.
- Only download size is meant to be realistic. The generated code does not give a faithful compile time, because it is not like real code.

## How to run

```sh
cd experiments/s4-size
mise exec -- pnpm install
mise exec -- pnpm exec playwright install webkit firefox  # once
mise exec -- pnpm run fonts     # download fonts into downloads/
mise exec -- pnpm run sizes     # all wasm variants: results/sizes.json and results/sizes.md (about 40 minutes)
mise exec -- pnpm run build     # app modules, Vite build into dist/, results/startup-bytes.json
mise exec -- pnpm run measure   # startup times: results/startup.json (about 30 minutes)
mise exec -- pnpm run probe     # throttling in workers and the wasm code cache: results/probe.json
mise exec -- pnpm run typecheck # tsc
```

`pnpm run measure` takes `--runs N` (Chrome, default 10), `--other-runs N` (WebKit and Firefox, default 5), `--browsers chrome,webkit,firefox`, and `--variants plain,preact,react`.
`node scripts/build-wasm.mjs --only a,b` rebuilds some variants and updates `results/sizes.json`.
`pnpm run serve` serves `dist/` with GitHub Pages-like headers on port 4610.

## Results: sizes

All sizes in KiB (1024 bytes) after `wasm-opt -Oz`. "gz" is gzip -9, "br" is brotli 11.
GitHub Pages sends gzip, not brotli, so gzip is the number that counts.
It was checked on 2026-10-15 with `curl -sI -H 'Accept-Encoding: gzip, br' <url>` on the Pages sites of other projects (`.wasm`, `.js`, and `.ttf`; the headers are in `results/pages-headers.txt`). Each answered `Content-Encoding: gzip`, also when `br` was offered.
figlab's own Pages site does not exist yet, so this must be checked again once it does.
If `.ttf` were sent uncompressed, the font without hinting would add 107 KiB, and the startup total (1,300 KiB) would still be under the 1.5 MiB budget.
`results/sizes.md` has every variant and every build setting.

### The modules

| Module | Contents | raw | gz | br |
|---|---|---:|---:|---:|
| compute | csv + encoding_rs + levenberg-marquardt + stand-in | 326.4 | 206.0 | 167.4 |
| compute, rmpfit | the same with rmpfit | 326.9 | 205.3 | 166.5 |
| compute, app | + allowance | 798.6 | 434.1 | 363.9 |
| **render, harfrust** | harfrust + skrifa + stand-in | 798.7 | 314.6 | 253.3 |
| **render, harfrust, app** | + allowance | 1040.2 | 441.7 | 359.0 |
| render, rustybuzz | rustybuzz + ttf-parser + stand-in | 541.4 | 234.7 | 179.5 |
| render, rustybuzz, app | + allowance | 785.1 | 357.1 | 284.1 |
| lang | parser stand-in + `commands.json` as Rust tables | 120.4 | 52.7 | 45.2 |
| lang, app | + allowance | 262.9 | 123.9 | 108.0 |
| **export-pdf, pdf-writer** | pdf-writer + subsetter (no `variable-fonts`) + skrifa + miniz_oxide | 221.3 | 111.7 | 97.1 |
| export-pdf, pdf-writer, ttf-parser | the same with ttf-parser for the metrics | 236.8 | 119.3 | 103.1 |
| export-pdf, pdf-writer, variable fonts | subsetter with `variable-fonts` + ttf-parser | 836.2 | 324.4 | 260.5 |
| export-pdf, krilla | krilla, default features off | 1193.7 | 448.5 | 350.9 |
| export-pdf, krilla default | krilla, default features on | 1363.5 | 510.5 | 401.3 |
| export-png | tiny-skia (std, png-format) | 344.5 | 136.2 | 111.3 |
| export-png without the encoder | tiny-skia only, returns raw pixels | 250.6 | 84.1 | 66.5 |

The JS glue made by wasm-bindgen is 1.6 to 2.5 KiB gzip per module.
S1 measured its harfrust module at 789 KB (-Oz) and 250 KB brotli. This module, which has the layout stand-in too, is 818 KB and 259 KB brotli.

### What each part adds (gz)

| Part | gz |
|---|---:|
| one module with wasm-bindgen, the allocator, and float formatting | 14.6 |
| csv | 20.9 |
| encoding_rs (Shift_JIS decoding) | 122.1 |
| levenberg-marquardt + nalgebra | 15.6 |
| rmpfit | 20.5 |
| interpreter stand-in | 46.8 |
| tiny-skia rasterizer (without the PNG encoder) | 78.5 |
| PNG encoder on top of tiny-skia (png crate) | 52.0 |
| the png crate alone, as a module | 41.5 |
| harfrust + skrifa (libm) | 286.2 |
| rustybuzz + ttf-parser | 204.3 |
| layout + SVG stand-in | 8.1 |
| `commands.json` as raw text | 8.1 |
| `commands.json` as Rust tables (build.rs) | 8.8 |
| `commands.json` read by serde_json at startup | 29.2 |

`spec/commands.json` itself is 55.1 KiB raw and 7.7 KiB gzip.
Rust tables cost about the same as the raw text. serde_json adds 20 KiB more.

### What dominates

From the names in a `wasm-opt -Oz -g` build (`scripts/attribute.mjs`; code inlined into a caller counts for the caller):

- compute: the data section is 45% (encoding_rs tables for Shift_JIS), the stand-in 12%, std 11%.
- render (harfrust): harfrust 27%, read-fonts 21%, data 17%, skrifa 11%.
- render (rustybuzz): data 37% (Unicode and shaping tables), rustybuzz 20%, ttf-parser 18%.
- export-pdf (pdf-writer + skrifa): subsetter 24%, std 21%, data 20%, miniz_oxide 7%.
- export-pdf (krilla): skrifa 22%, read-fonts 17%, data 12%, krilla 11%, subsetter 8%, write-fonts 7%.
- export-png: tiny-skia 50% (its raster pipelines).

### Size reductions

| Change | Effect on gz |
|---|---|
| opt-level "z" instead of "s" (both with LTO) | 0% to 9% smaller, most 1% to 9% (render, harfrust: 343 → 315). tiny-skia: 24% |
| opt-level 3 instead of "z" (both with LTO + codegen-units 1 + wasm-opt -Oz) | 4% to 35% larger: compute 206 → 223 (+8%), render, harfrust, 315 → 403 (+28%), language service 53 → 63 (+20%), pdf-writer 112 → 116, tiny-skia 136 → 184 (+35%). Speed was not measured |
| LTO + codegen-units 1 + "z" instead of Cargo's default release profile (opt-level 3, no LTO) | 6% to 28% smaller (render, harfrust: 414 → 315) |
| wasm-opt -Oz instead of nothing | 4% to 19% smaller (export-pdf, krilla: 552 → 449) |
| wasm-opt -Oz, -Os, or -O3 | within 1% of each other. `--converge` saves less than 0.5% |
| `panic = "abort"` | no change: it is already the default for wasm32-unknown-unknown |
| nightly `-Cpanic=immediate-abort` with `build-std` and `optimize_for_size` | 7% to 23% smaller (lang: 52.7 → 40.5, render, harfrust: 315 → 273). Not on stable Rust |
| no float formatting (`format!`) | 9 KiB per module (baseline: 5.6 → 14.6 with it) |
| `commands.json` as Rust tables instead of serde_json at runtime | 20 KiB |
| krilla without default features | 62 KiB (510 → 449) |
| subsetter without `variable-fonts` | 205 KiB (324 → 119 with ttf-parser). Then variable fonts cannot be subset |
| skrifa instead of ttf-parser for the PDF font metrics | 8 KiB (119 → 112) |
| tiny-skia without `simd` | no change: wasm SIMD is not enabled in the build |

### Fonts

| Font | raw | gz | br |
|---|---:|---:|---:|
| Arimo Regular (static) | 467.5 | 260.0 | 204.3 |
| Arimo variable (google/fonts) | 484.6 | 300.0 | 240.8 |
| Tinos Regular | 509.4 | 271.4 | 207.8 |
| Noto Sans Math Regular | 991.6 | 476.8 | 394.6 |
| Arimo Regular, no hinting | 273.3 | 166.7 | 138.1 |
| Arimo Regular, no hinting, Latin + Greek + symbol blocks | 92.8 | 60.2 | 53.8 |
| Noto Sans Math, no hinting | 583.1 | 321.6 | 277.5 |

Fonts are as large as a wasm module.
figlab draws outlines and never uses TrueType hinting, so removing the hinting saves 36% of Arimo at no cost.
The app uses the font without hinting.
The font is not part of "usable", but on the first visit it still shares the throttled link with the wasm modules, so it delays them: render ready at 1223 ms and font at 1224 ms.
With the hinted font (260 KiB) "usable" was 1318 ms in an earlier quick run (3 runs, Preact, HTTP, CPU 1x). With the font without hinting (167 KiB) it was 1254 ms in the same kind of quick run and 1243 ms in the full run, so the smaller file saved about 0.06 to 0.08 s.
The UI and the command line work without the font. Fetching the font after the modules would save about another 0.14 s on the first visit (167 KiB at 10 Mbit/s; an estimate, not measured). This is an optional improvement for M5.
Noto Sans Math is needed only when a glyph is missing from the main font, so it loads on first need. It should be precached by the Service Worker for offline use (the stand-in app has no fallback font).

### Startup download

`scripts/startup-bytes.mjs` on the built app (with the allowance, harfrust render, Arimo Regular without hinting):

| Page | JS gz | Worker JS gz | wasm gz | Font gz | Startup total gz | Startup total br | Loaded later gz |
|---|---:|---:|---:|---:|---:|---:|---:|
| **Preact + signals** | 130.0 | 3.0 | 999.6 | 166.7 | **1300.0 (1.27 MiB)** | 1084.1 | 250.3 |
| plain TypeScript | 122.5 | 3.0 | 999.6 | 166.7 | 1292.5 | 1077.2 | 250.3 |
| React | 188.2 | 3.0 | 999.6 | 166.7 | 1358.1 | 1133.8 | 250.3 |

With the hinted font (260 KiB) the Preact total is 1,393 KiB.
The JS is mostly CodeMirror 6 with `basicSetup` (122 KiB). It has no real UI code: the page is a trivial component.
Preact with signals adds 7.5 KiB. React adds 65.7 KiB, which is 58 KiB more than Preact.
With rustybuzz instead of harfrust, the total would be 85 KiB lower (about 1.19 MiB).
The wasm is 77% of the startup download.
`startup-bytes.mjs` finds the files by name prefix. A CI check needs a stable way to tell Vite's hashed files apart (see the ADR).

### Three modules or one

| Render | PDF | render + PDF + PNG as three modules (gz) | as one module (gz) | in more than one module |
|---|---|---:|---:|---:|
| harfrust | pdf-writer + skrifa | 562.5 | 509.3 | 53.1 |
| harfrust | krilla | 899.2 | 774.4 | 124.8 |
| rustybuzz | krilla | 819.3 | 699.7 | 119.6 |
| rustybuzz | pdf-writer | 695.2 | 542.6 | 152.6 |

(All without the allowance.) What is in more than one module:

- std, core, alloc, the allocator, and float formatting: about 15 KiB gzip in every module.
  The png crate and its deflate code are only in export-png. miniz_oxide is in two versions (0.8.9 in the png crate, 0.9.1 in export-pdf), so export-png and export-pdf do not share it.
- Font parsing: render uses read-fonts (through harfrust and skrifa), and export-pdf uses skrifa for the metrics. tiny-skia needs no font parser.
  krilla 0.8 uses skrifa 0.42 and read-fonts 0.39, while harfrust 0.14 uses read-fonts 0.45, so krilla and harfrust would not share font code even in one module.
- The lexer and parser are in both the compute module and the language service (roughly 20 to 25 KiB gzip of the stand-in).
- Draw data and font bytes are copied into the export module, because modules cannot share wasm memory.
  For the test figure, the copy and the export together take 4 to 15 ms (PDF) at CPU 1x.

At startup, about 55 KiB gzip of the 1.27 MiB is duplicated code.
The split keeps 194.7 KiB gzip (509.3 − 314.6, render with and without export) out of the startup download. The two export files are 247.9 KiB, but one module would not repeat the shared code.
That is 13% of what an unsplit app would download (1,300 + 195 = 1,495 KiB).

## Results: startup

"Usable" means: the UI is painted, the three startup wasm modules are instantiated, and the compute worker and the language service worker have each answered a first request. The font is not part of it.
`app/src/boot.ts` measures this (marks `usable` and `usable-font`).
All modules use `WebAssembly.instantiateStreaming` (the default of wasm-bindgen's `--target web`).
Each run starts the browser with a new profile (first visit), closes it, and starts it again with the same profile (second visit).
Chrome has 10 Mbit/s down, 40 ms round trip on both visits. Times are in ms from navigation start: the median, and the 95th percentile in brackets, of 10 runs per Chrome case and 5 per WebKit case.
They come from the full run of `pnpm run measure` on 2026-10-15, with no other builds running and the font without hinting. The machine was busy with background services (see Limits).
The second visit follows the first at once, so it is within the `max-age=600` of the server's headers: the browser does not ask the server again (no revalidation). Revisits after 10 minutes are not measured.
The Service Worker cache serves every file without the network, so its numbers hold for every revisit.

| Browser | UI | Cache | CPU | First visit | Second visit |
|---|---|---|---|---:|---:|
| Chrome | Preact | HTTP (within max-age) | 1x | 1243 (1306) | 89 (107) |
| Chrome | Preact | HTTP (within max-age) | 4x | 1360 (1370) | 276 (310) |
| Chrome | Preact | Service Worker | 1x | 1241 (1252) | 95 (144) |
| Chrome | Preact | Service Worker | 4x | 1352 (1392) | 263 (273) |
| Chrome | plain | HTTP (within max-age) | 1x | 1232 (1250) | 91 (149) |
| Chrome | plain | HTTP (within max-age) | 4x | 1330 (1341) | 260 (272) |
| Chrome | plain | Service Worker | 1x | 1233 (1287) | 100 (147) |
| Chrome | plain | Service Worker | 4x | 1336 (1379) | 249 (349) |
| Chrome | React | HTTP (within max-age) | 1x | 1295 (1300) | 88 (102) |
| Chrome | React | HTTP (within max-age) | 4x | 1424 (1445) | 285 (337) |
| Chrome | React | Service Worker | 1x | 1293 (1304) | 93 (102) |
| Chrome | React | Service Worker | 4x | 1431 (1468) | 286 (333) |
| WebKit (no throttling) | plain | HTTP | 1x | 172 (174) | 165 (167) |
| WebKit (no throttling) | plain | Service Worker | 1x | 165 (172) | 165 (170) |

`results/startup.json` has every case and every mark (first paint, each module, the font).
`results/startup-earlier-build.json` has an earlier 10-run measurement of an older build of this app (rustybuzz render, hinted font, 1.30 MiB download, Preact 11). It agrees with the full run within about 0.01 s on the first visit and 0.03 s on the second visit.
WebKit ran without throttling, so its first visit is a local download. Its "usable" time is set by the first paint (about 165 ms).
With a different UI, the first visit is 1.24 s (Preact), 1.23 s (plain TypeScript), and 1.30 s (React) at CPU 1x. The second visit is 0.09 to 0.10 s for all three.

Where the time goes (Chrome, Preact, HTTP, CPU 1x, medians):

- First visit: first paint 224 ms, the language service answers at 737 ms, the render module is ready at 1223 ms and the font at 1224 ms, the compute worker answers at 1243 ms.
  The startup files are 1.27 MiB gzip, which takes about 1.07 s at 10 Mbit/s. The other 0.17 s is round trips and instantiation.
- Second visit: first paint 68 ms, render 59 ms, font 63 ms, the compute worker answers at 89 ms.

The same model gives the first visit for other sizes: download time at 10 Mbit/s plus about 0.2 s. A 1.5 MiB download would be usable in about 1.45 s (this model was fitted on the runs above, not measured at 1.5 MiB).

### Loading export later

`exportPdf()` and `exportPng()` in `app/src/boot.ts` load their module with `import()`, then instantiate it, then export the test figure (PNG at 300 dpi).
Chrome, plain, HTTP cache, medians of 10 runs in ms (total, of which instantiate including the download), with pdf-writer + skrifa. The first-visit rows have the empty cache and the throttled network. The second-visit rows come from the HTTP cache.

| Case | CPU 1x | CPU 4x |
|---|---:|---:|
| PDF, first use, cold cache, 10 Mbit/s | 193 (137) | 226 (140) |
| PDF, second use in the same page | 4 | 12 |
| PDF, first use on the second visit (HTTP cache) | 13 (2) | 50 (6) |
| PNG, first use, cold cache, 10 Mbit/s | 264 (159) | 453 (161) |
| PNG, second use in the same page | 46 | 192 |
| PNG, first use on the second visit (HTTP cache) | 65 (3) | 253 (8) |

These runs export on the main thread. The PNG time is mostly the 300 dpi drawing, not the loading: it blocks the main thread for 190 to 240 ms at CPU 4x. The export modules take only draw data and font bytes, so they can also run in a worker (see the ADR).
The module's wasm memory stays allocated after the export, because wasm memory does not shrink.
With krilla (an earlier build), the first PDF export took 0.48 s on a cold cache and 0.03 s from the cache.
With the Service Worker, the app precaches every file after startup, including both export modules.
So after the first visit, export also works offline and loads from the cache.

### Chrome details (`pnpm run probe`)

- CPU throttling (`Emulation.setCPUThrottlingRate`) slows only the main thread. A busy loop took 156 ms on the main thread at 1x and 637 ms at 4x. The same loop in a dedicated worker took 30 ms at both.
  So the 4x rows slow the UI and the render module, but not the workers.
- Network throttling applies to fetches from workers too (a font fetch took 284 ms on the main thread and 281 ms in a worker).
- The wasm code cache was not used at startup: V8 writes compiled code to the cache only after hot functions are tiered up, and the startup code is not hot.
  After the test figure was exported three times, one module was written to the cache (`wasm.SerializeModule`). In this probe, the next visit read it back when it came from the HTTP cache (`wasm.Deserialize`), but not when the Service Worker served it.
  This does not matter much: with lazy compilation (`wasm.CompileLazy`), the second visit compiles in a few ms.
  The probe was re-run on the final build on 2026-10-15 and gave the same results as before.

## Limits

- The 2-second result is for Chrome with throttling only. WebKit ran without throttling (so it says little about slow links), and Firefox did not run.
- The timing numbers come from one full run on 2026-10-15 with no other builds running, but the machine was not quiet: the user's normal apps were open, and Microsoft Defender's scanner (about 100% CPU) and `mediaanalysisd` (about 80%) were busy, probably scanning the fresh build output. The load average was about 8 at the start and up to about 20 during the run.
  The medians agree with the earlier quick runs, which were made with other builds running (within about 0.02 s, on first and second visits, at both CPU rates), so the load did not change them much.
  Some second-visit 95th percentiles are high: 0.14 to 0.15 s at CPU 1x (Preact with the Service Worker, plain with the HTTP cache or the Service Worker) and 0.31 to 0.35 s at CPU 4x (Preact with the HTTP cache, React, plain with the Service Worker). The medians of the same cases are 0.09 to 0.10 s and 0.25 to 0.29 s. One or two slow runs of ten are probably caused by the scanner, but we did not prove it.
- The stand-ins are not figlab. The allowance for figlab's own code is a guess from line counts.
- Chrome's CPU throttling does not slow workers. A slow device would also slow the workers' compile time.
- There are no Firefox numbers: the Playwright build of Firefox did not start, in the agent's sandbox (`Could not find profile folder`) and in the full run (`Failed to launch the browser process`).
- The server runs on the same machine. It gzips like GitHub Pages, but real network jitter and GitHub's CDN are not simulated.
- The size of WebGL drawing code, the UI itself (data browser, tables, dialogs), and Parquet are not included. The Preact page is a trivial component, not the real UI.
- Raster content in SVG and PDF (`raster=true` markers, heatmaps) is not in any module. Rasterizing needs tiny-skia (84 KiB gzip) and PNG encoding for SVG needs the png crate (about 41 to 52 KiB). See the ADR.
- Parquet import (v1, in the compute worker, spec.md 4.1 and 10) is not in the compute module. The `parquet` crate or a JavaScript reader would add to the compute module or the JS.
- S6's levenberg-marquardt fork with bounds was not built. The crate without bounds stands in.
- cmpfit (C) was not built. rmpfit is its Rust port, so its size is a close estimate.
- The stand-in PDF export does not use the real text mapping (the texts for the ToUnicode map are not matched to the glyph runs).

## ADR

[docs/adr/0013-wasm-size-and-startup.md](../../docs/adr/0013-wasm-size-and-startup.md)
