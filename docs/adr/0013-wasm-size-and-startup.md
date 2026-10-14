# 0013. Split the wasm modules, load export later, and check the startup download size

- Status: Accepted
- Date: 2026-10-14

## Context

spec.md Section 4 has three wasm parts: the compute worker, the render module on the main thread, and the language service worker.
spec.md 13 asks that the app is usable within 2 seconds of opening the page, from the second visit, with the cache in effect.
roadmap.md M5 and development.md 5.2 ask for a CI check of the initial download size, but give no limit.

We did not know how large the modules would be, whether PDF and PNG export must be in the render module, or whether 2 seconds is easy or hard.
The product crates are still empty.
So experiment S4 ([experiments/s4-size](../../experiments/s4-size/README.md)) built stand-in modules from the libraries figlab will use, plus stand-in code and an allowance for figlab's own code, and measured them.

This ADR refines ADR 0007. The decision of ADR 0007 (rendering and export are done in Rust) does not change. What changes is the packaging: export is not in the render module, but in separate wasm modules that load on first use.

The main case follows the choices that the other experiments recommend:

- S1 (ADR 0010): shaping with harfrust + skrifa (default features off, `libm` only), PDF with pdf-writer + subsetter (no `variable-fonts`) + skrifa, fallback font Noto Sans Math.
- S5 (ADR 0014): Preact 10 with `@preact/signals`.
- S6 (ADR 0015): a fork of levenberg-marquardt 0.15 with bounds (about the size of the crate). nalgebra with default features off, `alloc` and `libm`.

The other candidates (rustybuzz, krilla, plain TypeScript, React, rmpfit) are in the README tables.

Measured (sizes in KiB, gzip -9, after `wasm-opt -Oz`; GitHub Pages sends gzip, not brotli):

| Module | Built with only the libraries | With stand-in code | With stand-in code and allowance |
|---|---:|---:|---:|
| compute (csv, encoding_rs, levenberg-marquardt) | 162 | 206 | 434 |
| render (harfrust + skrifa) | 301 | 315 | 442 |
| render (rustybuzz + ttf-parser), other choice | 219 | 235 | 357 |
| language service (`commands.json` as Rust tables) | none | 53 | 124 |
| export-pdf (pdf-writer + subsetter + skrifa) | | 112 | |
| export-pdf (krilla, default features off), other choice | | 449 | |
| export-png (tiny-skia + png) | | 136 | |

- The "libraries only" column is a module with the libraries and no stand-in code. It includes about 7 KiB of fixed cost per module. The language service has no big library.
- In compute, encoding_rs (Shift_JIS decoding) is 122 of the 155 KiB of libraries. levenberg-marquardt with nalgebra adds 16 KiB and rmpfit 21 KiB.
- `commands.json` costs 9 KiB as Rust tables made by build.rs. Reading it with serde_json at runtime costs 29 KiB.
- tiny-skia without the PNG encoder is 84 KiB. The PNG encoder adds 52 KiB on top of it. The png crate alone, as a module, adds 41 KiB.
- The allowance is a size we chose (generated code, 228 KiB for compute, 127 KiB for render, 71 KiB for the language service). It is not a forecast of figlab's size. No allowance is added to the export modules.
- The bundled font Arimo Regular is 260 KiB, as large as a wasm module. Without TrueType hinting, which figlab does not use, it is 167 KiB. Noto Sans Math is 477 KiB (322 KiB without hinting).
- The JS is mostly CodeMirror 6 with `basicSetup`: 122 KiB. Preact with signals adds 7.5 KiB, React 66 KiB. The page has no real UI code, only a trivial component. The 133 KiB (page and workers) will grow.
- The whole startup download of the stand-in app with Preact and the font without hinting is 1,300 KiB (1.27 MiB): 1,000 KiB of wasm, 167 KiB of font, 133 KiB of JS. With the hinted font it is 1,393 KiB. With React it is 1,358 KiB.

Startup in Chrome 155 (headless, 10 Mbit/s, 40 ms round trip). "Usable" means that the UI is painted, the three startup wasm modules are instantiated, and the compute worker and the language service worker have each answered a first request. The font is not part of it.
The app uses Preact and the font without hinting. Medians of 10 runs per case, from the full run on 2026-10-15:

| Visit | CPU 1x | CPU 4x (main thread only) |
|---|---:|---:|
| first (empty cache), HTTP cache and Service Worker alike | 1.24 s | 1.36 s (HTTP), 1.35 s (Service Worker) |
| second, HTTP cache (within `max-age=600`) | 0.09 s | 0.28 s |
| second, Service Worker cache | 0.10 s | 0.26 s |

- The full run had no other builds running. The machine was still not quiet: the user's normal apps were open, and macOS background services (Microsoft Defender's scanner at about 100% CPU, `mediaanalysisd` at about 80%) were busy, probably scanning the fresh build output. The load average was about 8 at the start and up to about 20 during the run.
  The medians agree within about 0.02 s with earlier quick runs that were made while other builds ran, so we do not think the load changed them much. Some second-visit 95th percentiles are higher (0.14 to 0.15 s at CPU 1x, up to 0.35 s at CPU 4x), probably from one or two slow runs of ten. The README has the details.
- With React the first visit is 1.30 s at CPU 1x, and the second visit is 0.09 s. With plain TypeScript, the first visit is 1.23 s.
- Only Chrome ran with throttling. WebKit (no throttling) was usable in about 0.17 s on both visits. Firefox did not start, so it is not measured.
- The second visit in the HTTP cache came right after the first, so it was within `max-age=600`: the browser did not ask the server again. A revisit after 10 minutes is not measured. The Service Worker case holds for every revisit.
- The first visit takes the download time at 10 Mbit/s plus about 0.2 s.
- On the first visit the font shares the link with the wasm. The render module was ready at 1,223 ms and the font at 1,224 ms. In an earlier quick run (3 runs), the hinted font made "usable" 1,318 ms against 1,254 ms with the unhinted font, about 0.06 s later.

## Options

Module split:

1. One wasm module for render and export, on the main thread.
2. Render (layout, draw data, SVG) at startup. PDF export and PNG export each in their own module, loaded with `import()` on first use.

Size budget for the CI check:

1. No budget. Watch the size by hand.
2. A budget per module and for the whole startup download, in gzip bytes, checked by the web job.

## Decision

Option 2 for both.

1. **Modules at startup:** compute (worker), render (main thread, with SVG export), language service (worker), the JS with CodeMirror and the UI, and the main font.
2. **Modules loaded later:** export-pdf and export-png. Each is its own wasm module, loaded with `import()` the first time the user exports. They take the draw data and the font bytes as input and share no memory with the render module.
   - They can run on the main thread or in a worker. We recommend a worker for export-png, because a 300 dpi PNG took 190 to 240 ms of main thread time at CPU 4x. export-pdf took 7 to 30 ms for the test figure. M5 decides, with real figures.
   - The wasm memory of a module stays allocated after the export, because wasm memory never shrinks (ADR 0012). A worker that is stopped after the export frees it.
   - The Service Worker precaches both modules after startup, so export also works offline.
3. **The fallback font** (Noto Sans Math) loads on first need. The Service Worker precaches it, so it is also there offline. When it arrives after a layout was made, the text has to be laid out again. This is the open point of ADR 0010, and we hand it to M5.
4. **Raster content in SVG and PDF** (`raster=true` markers, spec.md 9.3, and heatmaps, in the MVP) needs rasterizing, and for SVG also PNG encoding. Rasterizing and PNG encoding live in export-png only.
   - An SVG or PDF export with raster content loads export-png on demand. For SVG it takes PNG data. For PDF it takes pixels, and export-pdf puts them in an image with the deflate code that it already has (miniz_oxide), so export-pdf needs no PNG encoder.
   - The render module and export-pdf have no rasterizer. Their budgets do not include rasterizing or PNG encoding.
   - This is a known gap. S4 did not build it. M5 confirms it when heatmaps are built, and may change it, for example by putting a small rasterizer elsewhere.
5. **Build settings:**
   - Render, language service, and the export modules: `opt-level = "z"`, `lto = true`, `codegen-units = 1`, `panic = "abort"`, then `wasm-bindgen --target web` and `wasm-opt -Oz`. Modules use `WebAssembly.instantiateStreaming`.
     opt-level 3 would make render 28% larger (315 → 403 KiB), tiny-skia 35% larger (136 → 184), and the language service 20% larger.
   - Compute: not decided. opt-level 3 costs only 17 KiB there (206 → 223, +8%), and "z" may be slower. M2 measures the speed of fitting and decimation with "z" and with 3 before the level is fixed.
   - The native `figlab` command stays at opt-level 3. The root `[profile.release]` must not force "z". The wasm modules use a wasm-only profile (for example `[profile.wasm]`, inheriting from release), with per-package overrides or a second profile for compute if M2 shows it needs 3.
6. **Bundled fonts are stored without TrueType hinting.**
7. **`commands.json` gets into the language service as Rust tables made at build time**, not parsed with serde_json at runtime.
8. **Budgets** (gzip -9 of the files in the Pages build; the CI check fails above them). They assume the choices of S1, S5, and S6 above:

| What | Budget | Stand-in today |
|---|---:|---:|
| compute module | 500 KiB | 434 KiB |
| render module (harfrust + skrifa) | 500 KiB | 442 KiB |
| language service module | 150 KiB | 124 KiB |
| startup JS (page and workers), provisional | 200 KiB | 133 KiB (Preact), 191 KiB (React) |
| fonts loaded at startup | 200 KiB | 167 KiB (Arimo Regular without hinting) |
| **whole startup download** | **1.5 MiB (1,536 KiB)** | **1,300 KiB (1.27 MiB)** |
| export-pdf, loaded later (pdf-writer + subsetter + skrifa) | 200 KiB | 112 KiB |
| export-png, loaded later | 200 KiB | 136 KiB |

   - The margin of each budget over the stand-in is 13% to 21% for the three wasm modules and the font, and 18% for the total.
   - The parts add up to 1,550 KiB, which is more than the total. The total is the limit that binds. The budgets of the parts show which part grew.
   - The 133 KiB of JS has no real UI code. The 200 KiB is provisional. Check it again once `web/` has a real UI.
   - The export modules have no allowance for figlab's own code. The room above the stand-in (88 KiB for PDF and 64 KiB for PNG) is for it.
   - Not in the budgets: Parquet import (v1, in the compute worker, spec.md 4.1 and 10), which is a known future cost, and raster content (decision 4).

## Reasons

- **Splitting export out keeps 195 KiB out of the startup download.** One module with render, pdf-writer, and tiny-skia would be 509 KiB (without the allowance) at startup instead of 315 KiB, because code that is shared would not be repeated. That is 13% of what an unsplit app would download at startup.
  The two export files are 248 KiB together. The cost of splitting is about 53 KiB of code that is in more than one module (std, the allocator, font parsing), and a copy of the draw data and font bytes into the export module. That copy and the export take 4 to 15 ms for a PDF.
  The png crate and tiny-skia are only in export-png. miniz_oxide is in two versions (0.8.9 in png, 0.9.1 in export-pdf), so it is not shared either.
  With pdf-writer the gain is 0.15 to 0.2 s on the first visit. It is not needed to reach 2 seconds. We still split because `import()` is cheap to use, and because the gain would be much larger with krilla (449 KiB for PDF alone).
- **Loading later is fast enough.** First use of PDF export takes 0.19 s on an empty cache at 10 Mbit/s, and 0.01 s from the cache. PNG takes 0.26 s and 0.07 s (mostly drawing at 300 dpi).
- **2 seconds is met with a wide margin, in Chrome with throttling.** The second visit is usable in 0.1 to 0.3 s, so the margin is more than 1.7 s.
  Even the first visit is usable in 1.24 s at 10 Mbit/s. It is bound by the download: 1.27 MiB takes about 1.07 s.
  At the 1.5 MiB budget, the first visit would take about 1.45 s on the same network.
  So the budget protects the first visit more than the second, and leaves room for growth.
  WebKit was measured without throttling and Firefox not at all, so the 2-second result is for Chrome only.
- **The font delays the first visit.** It is not part of "usable", but on the first visit it shares the link with the modules. Fetching it after the modules would save about 0.14 s more (167 KiB at 10 Mbit/s, an estimate). This is an optional improvement for M5.
- **Other choices of S1, S5, and S6 also fit the startup budgets.** rustybuzz instead of harfrust makes render 85 KiB smaller. React instead of Preact adds 58 KiB of JS (191 KiB, still under 200 KiB; the total is 1,358 KiB). rmpfit instead of levenberg-marquardt changes compute by 1 KiB.
  Only krilla does not fit the export-pdf budget (449 KiB). It does not change the startup download. If S1 chooses krilla, the export-pdf budget becomes 500 KiB.
- **gzip, not brotli**, because GitHub Pages sends gzip for `.wasm`, `.js`, and `.ttf`. This was checked on 2026-10-15 with `curl -sI -H 'Accept-Encoding: gzip, br' <url>` on the Pages sites of other projects (the headers are in `experiments/s4-size/results/pages-headers.txt`). It must be checked again on figlab's own site. If `.ttf` were sent without compression, the total would be 1,407 KiB, still under the budget.
- **The build settings are the smallest on stable Rust.** LTO with one codegen unit and "z" is 6% to 28% smaller than Cargo's default release profile. `wasm-opt -Oz` saves 4% to 19%; -Os, -O3, and `--converge` give the same size within 1%.
  A nightly build with `-Cpanic=immediate-abort` and `build-std` is 7% to 23% smaller. It needs nightly Rust, so we do not use it now.
- **Hinting is not needed.** figlab draws glyph outlines (spec.md 9.1). Removing hinting makes Arimo 36% smaller.
- **The wasm code cache does not matter here.** Chrome writes compiled wasm to its cache only after the code is hot. At startup it is not, so the second visit compiles again. With lazy compilation this takes a few ms.

## Consequences

Changes this decision makes in the documents:

- spec.md 9.4 Formats: SVG is written by the render module. PDF and PNG are written by separate export modules that load when the user first exports. They take the draw data and the font bytes as input.
- spec.md 13, Startup row: "usable" means that the UI is painted, the three startup wasm modules are instantiated, and the compute worker and the language service worker have each answered a first request. The bundled font is not part of it. The row points to the budgets in this ADR (the whole startup download is at most 1.5 MiB gzip).
  It could also add a first-visit target, for example "within 2 seconds at 10 Mbit/s".

How the modules map to crates:

- One Cargo package builds one cdylib, so five wasm modules need five packages. Each is a thin boundary package, like the current `figlab-wasm`: compute, render, language service, export-pdf, and export-png. The names are not decided here (for example `figlab-wasm-compute`).
- Export code moves out of `figlab-render` into two library crates (for example `figlab-export-pdf` and `figlab-export-png`), so that a wasm package links only what it needs. `figlab-cli` links all of them in one native binary.
- The draw data types must be in a crate that has no font libraries (for example a small `figlab-draw` crate). Otherwise the export modules would link the shaping libraries.

Other consequences:

- The budgets assume harfrust + skrifa, pdf-writer + subsetter + skrifa, Preact, and the levenberg-marquardt fork. If S1, S5, or S6 end up different, check the budgets against the tables in the README.
  Only the render and export-pdf budgets depend on S1.
- The budgets need a new ADR if figlab's own code grows past them. The allowance is a size we chose, not a forecast.
- encoding_rs is the largest part of compute (122 KiB). A later option is to decode Shift_JIS with the browser's `TextDecoder` in the web app and use encoding_rs only in the `figlab` command. Both follow the WHATWG Encoding Standard, but this needs a test that they give the same text.
- About 55 KiB of the startup download is code duplicated across the three startup modules (std, the allocator, and the parser in both compute and the language service). We accept this.
- The first-visit measurement ran only in Chrome with throttling, and in WebKit without. Firefox is not measured.

## Follow-up

Changes for other documents and for later work. They are not part of this decision's own change:

- spec.md Section 4: the bullet "The Rust render module (wasm) decides what to draw ... and SVG/PDF/PNG export", and the diagram (it shows Export inside the render module). PDF and PNG export are separate modules, and the render module writes SVG.
- spec.md 4.1: the Render module row, and the Export row. Say which modules load at startup (compute, render, language service) and which load on first export (PDF, PNG).
- spec.md 9.3 and 9.4: say that an SVG or PDF export with raster content also loads export-png (decision 4), once M5 confirms it.
- spec.md 9.1: "Everything up to this point, including export, is done by the Rust render module". Say that point coordinates are read from wasm memory without copying only on the screen path. The export modules get a copy of the draw data.
- spec.md 9.2 (Fonts): bundled fonts are stored without hinting. The fallback font loads on first need and the Service Worker precaches it. If the static Arimo Regular is used, not the variable font from google/fonts, subsetter's `variable-fonts` feature is not needed.
- development.md Section 2: `figlab-render` ("SVG/PDF/PNG export") and `figlab-wasm` ("one boundary for compute worker, language service, render module"). The crate list needs the export crates, the draw data crate, and five boundary packages.
- development.md Section 9: "Layout, text measurement, draw data, and SVG/PDF/PNG export live in `figlab-render`".
- `mise.toml` and development.md 3.2: `cargo check -p figlab-wasm --target wasm32-unknown-unknown` must check each of the five packages.
- development.md 5.2 (web job): the check of the initial download size sums the gzip sizes of the startup files of the Pages build and compares them with the budgets above. It needs a stable way to tell Vite's hashed files apart. `experiments/s4-size/scripts/startup-bytes.mjs` uses name prefixes. A Vite manifest (`build.manifest`) lists the entry, its static imports, and its dynamic imports, and can replace the prefixes.
- roadmap.md M5 "a CI check of the first download size": point to this ADR. Also give M5: where raster content for SVG and PDF is made (decision 4), whether export runs in a worker, the re-layout when the fallback font arrives, and (optional) fetching the font after the modules.
- roadmap.md M2: measure the speed of fitting and decimation in compute with opt-level "z" and with 3.
- The root `Cargo.toml` when the wasm build is added: a wasm-only profile (decision 5). The native `figlab` command keeps opt-level 3.
- `mise.toml`: pin wasm-bindgen-cli (0.2.129 here) and binaryen (wasm-opt, 133 here) when the wasm build is added.
