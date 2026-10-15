# S1: Text, PDF, and the fallback font

This experiment answers S1 in docs/roadmap.md M1. The decision is in
[ADR 0010](../../docs/adr/0010-text-shaping-pdf-and-fallback-font.md).

## Question

1. Can text be shaped in wasm and drawn on a Canvas from glyph outlines, so that text on screen sits exactly where it does in exports (spec.md 9.1)?
2. Which PDF library: krilla or pdf-writer (with subsetter)?
3. Which fallback font for symbols that the main font lacks (spec.md 9.2)?

## Short answer

1. Yes. Text is shaped in wasm, and the glyphs are drawn with `Path2D` on a Canvas 2D from the same runs that the PDF uses.
   PDF glyph origins match the layout exactly (poppler reads back the left edges of the words in horizontal text). The Canvas matches the Ghostscript render of the PDF within 0.2 pt (0.60 / 0.23 device px at DPR 2).
   The wasm and native builds give byte-identical draw data and PDFs (6 files, one arm64 Mac).
   Shape text with **harfrust** (with skrifa for outlines), not rustybuzz: rustybuzz is archived, and both give identical glyphs and advances on every sample.
2. **pdf-writer 0.15 + subsetter 0.2.6** (default features off).
   It needs 269 lines of figlab code, against 90 for krilla (non-blank, non-comment lines).
   It adds 173 KB to the optimized wasm module (75 KB brotli), against 746 to 915 KB (236 to 273 KB brotli) for krilla without image support.
   It also lets figlab keep one parser for shaping, metrics, and outlines (read-fonts and skrifa) at the version that harfrust needs. subsetter has its own small font reader.
3. **Noto Sans Math**. It has all 44 symbols on the list that Arimo lacks. Its x-height, cap height, and stroke weight are close to Arimo Regular's.
   The full file is large (992 KB, 395 KB brotli), so ship a subset and load it when it is first needed.

## Setup

| Item | Version |
|---|---|
| Machine | Apple M1 Max, 64 GB, macOS 27.0.1 |
| Rust | 1.99.0, target wasm32-unknown-unknown |
| wasm-opt | binaryen 133 |
| Node, pnpm | 24.14.1, 10.25.0 |
| Browsers (headless, Playwright 1.64.0) | Google Chrome 155.0.8059.79 (installed), WebKit 27.2 (Playwright build). Firefox was not tested: Playwright's Firefox build did not start ("Could not find profile folder"), and the installed Firefox 157 does not start headless on this machine either |
| PDF tools | poppler 26.10.0 (pdfinfo, pdffonts, pdftotext), Ghostscript 10.08.0 |

Rust crates (pinned with `=` in [Cargo.toml](Cargo.toml)):

| Crate | Version | License | Role |
|---|---|---|---|
| rustybuzz | 0.20.1 (2024-11-12) | MIT | shaping candidate 1 (archived; the README says to use harfrust) |
| ttf-parser | 0.25.1 | MIT OR Apache-2.0 | cmap and outlines for rustybuzz |
| harfrust | 0.14.0 (2026-10-04), features `libm` only | MIT | shaping candidate 2 (HarfBuzz project, matches HarfBuzz 14.5.1) |
| skrifa | 0.48.0, features `libm` only | MIT OR Apache-2.0 | cmap, metrics, and outlines for harfrust (read-fonts 0.45, also `libm` only) |
| harfrust, skrifa (old) | 0.8.4, 0.42.1 | MIT; MIT OR Apache-2.0 | the versions on krilla's read-fonts 0.39, to measure one shared font stack |
| krilla | 0.8.2, default features off | MIT OR Apache-2.0 | PDF candidate 1 |
| pdf-writer | 0.15.0 | MIT OR Apache-2.0 | PDF candidate 2 |
| subsetter | 0.2.6, default features off | MIT OR Apache-2.0 | font subsetting for candidate 2 |
| miniz_oxide | 0.9.1 | MIT OR Zlib OR Apache-2.0 | compression for candidate 2 (krilla uses the same version through flate2) |

harfrust and skrifa have default features off and `libm` on. With `std` on, skrifa (outline/glyf/mod.rs) and read-fonts (glyf/outline/scale.rs) call the platform `f32::hypot` for composite glyphs with scaled component offsets, and that may differ between native and wasm. With `libm` only, they use core_maths. The fonts in this experiment do not reach that code, so the native-versus-wasm check does not test it.

`cargo deny --locked check licenses bans sources` passes with a copy of the root [deny.toml](deny.toml).
It warns about duplicate versions of harfrust, skrifa, read-fonts, and font-types. These are on purpose: the experiment compares them.

npm packages (dev only): esbuild 0.28.2 (MIT), playwright 1.64.0 (Apache-2.0), typescript 6.0.3 (Apache-2.0).
pnpm does not run esbuild's install script. esbuild still works through its platform package.

Fonts: [scripts/fetch-fonts.sh](scripts/fetch-fonts.sh) downloads them into `downloads/fonts/` from pinned commits of googlefonts/Arimo and google/fonts, and from the Fira Math v0.3.4 release. It checks SHA-256 sums. All fonts are OFL-1.1 (read from the name table). Noto Sans Symbols and Noto Sans are variable fonts in google/fonts. The experiment uses their default instance.

wasm build profile `wasm`: `opt-level = "z"`, `lto = "fat"`, `codegen-units = 1`, `panic = "abort"`, `strip = true`, then `wasm-opt -Oz`.
The module uses a plain C ABI (no wasm-bindgen), so the sizes show the libraries, not binding glue.

## How to run

From this folder:

```sh
./scripts/run-all.sh
```

It runs these steps, which also work one by one:

```sh
./scripts/fetch-fonts.sh                               # fonts into downloads/fonts/
mise exec -- pnpm install --frozen-lockfile
mise exec -- cargo run --release -p s1-native --bin compare    # shapers: results/compare.json
mise exec -- cargo run --release -p s1-native --bin coverage   # fonts: results/coverage.{json,md}
mise exec -- cargo run --release -p s1-native --bin outputs    # PDFs and draw data: target/out/
./scripts/build-wasm.sh                                # sizes: results/wasm-sizes.{json,md}, wasm-breakdown.txt
mise exec -- pnpm run check:wasm                       # wasm == native: results/determinism.json
./scripts/check-pdf.sh                                 # PDF checks: results/pdf-check.txt
mise exec -- cargo run --release -p s1-native --bin measure    # native timing: results/measure-native.json
mise exec -- pnpm run measure                          # browser: results/browser.json, dist/images/
```

`BROWSERS=chrome pnpm run measure` limits the browsers. `REPS=100` changes the number of timed samples (default 100; the numbers below used 100).

## What the code does

- [crates/s1-core](crates/s1-core/src/lib.rs): no font library. The sample page, labels built by hand as spans, the `Shaper` trait, layout (spans to runs, with fallback), and the draw data format.
- [crates/s1-rb](crates/s1-rb/src/lib.rs), [crates/s1-hr](crates/s1-hr/src/lib.rs), [crates/s1-hr08](crates/s1-hr08/src/lib.rs): the `Shaper` for rustybuzz, harfrust 0.14, and harfrust 0.8.
- [crates/s1-pdf-krilla](crates/s1-pdf-krilla/src/lib.rs), [crates/s1-pdf-writer](crates/s1-pdf-writer/src/lib.rs): the same page as PDF with each library.
- [crates/s1-wasm](crates/s1-wasm/src/lib.rs): the wasm module. Cargo features pick the candidates.
- [crates/s1-native](crates/s1-native/src/bin): the native tools named above.
- [web/main.ts](web/main.ts): decodes the draw data and draws it with one cached `Path2D` per glyph. It also draws the same runs with `fillText` from the same font files (FontFace) for the comparison.

Text notation: superscripts and subscripts are spans at 0.7 times the size, raised by 0.36 em or lowered by 0.14 em. Italic and bold are spans in Arimo Italic and Arimo Bold. Tinos stands for `\font{Times}{…}`.

Fallback: before shaping, each span is split by font. A character that the span's font does not map (glyph id 0) goes into a run in the fallback font. Spaces stay in the main font. Kerning applies inside a run only.

Draw data (version 1, little endian): a font table (units per em), unique glyph outlines as verbs and `i16` coordinates in font units, runs (font, size, color, origin, advance, text, and per glyph: outline index, dx, dy in pt), and lines.
The format is in the comment on `encode_draw_data` in s1-core. The runs in Rust also carry each glyph's text range (cluster), which the PDF writers use for ToUnicode. The draw data for the Canvas leaves the ranges out, but figlab's format should have them for SVG `<text>`.

## Results

The timing numbers come from a run on 2026-10-15 with the `libm` build and no other builds running. Normal desktop apps and background services were open, so the load average was about 9 to 15. Sizes and correctness results do not depend on load.

### Shaping: rustybuzz and harfrust give the same result

From `compare` ([results/compare.json](results/compare.json)):

- Every run of every sample text, with each of the 7 fallback fonts, gives the same glyph ids, advances, offsets, and clusters with rustybuzz 0.20, harfrust 0.14, and harfrust 0.8.
- Laying out the whole sample page gives identical runs with all three.
- Kerning is applied: "AVATAR To We Yo" has 9 kerned pairs in Arimo (for example "AV" 1366 to 1214 units, "To" 1251 to 1024). Arimo also kerns a space before T and Y.
- Outlines: ttf-parser adds a line back to the start point before each close. skrifa does not. After dropping those lines, all 86 outlines on the page are identical.

| Shaper | wasm -Oz KB | brotli KB | Layout of 200 labels, Chrome wasm (median / p95 ms) | Native (median ms) | Status |
|---|---|---|---|---|---|
| rustybuzz 0.20 + ttf-parser 0.25 | 531 | 175 | 2.53 / 2.77 | 0.79 | archived, last release 2024-11 |
| harfrust 0.14 + skrifa 0.48 | 789 | 250 | 0.99 / 1.02 | 0.66 | active; tracks HarfBuzz; breaking releases every few weeks (0.8 in 2026-06, 0.14 in 2026-10, with a new font API) |
| harfrust 0.8.4 + skrifa 0.42 | 651 | 209 | not measured in the browser | 0.74 | old |

The 200 labels have 300 runs and 1424 glyphs.

### Glyphs on the Canvas

From `pnpm run measure` ([results/browser.json](results/browser.json)). The sample page is drawn twice: from the draw data with `Path2D`, and with `fillText` of the same font files.
"Advance" compares our run advance with `measureText`. "Centroid" compares the ink centroid of each run in the two images, in device pixels.

| Browser | DPR | Max advance difference | Max centroid difference x / y | Mean ink difference (0 to 255, inked pixels) |
|---|---|---|---|---|
| Chrome 155 | 1 | 0.011 pt | 0.37 / 0.72 px | 35 |
| Chrome 155 | 2 | 0.005 pt | 0.60 / 0.70 px | 31 |
| WebKit 27.2 | 1 | 0.50 pt | 0.44 / 0.93 px | 43 |
| WebKit 27.2 | 2 | 0.50 pt | 0.58 / 0.89 px | 44 |

- In Chrome the advances agree to about 0.01 pt. The remaining differences are rendering: the browser's glyphs carry about 15 % more ink (stem darkening), and the browser seems to snap the baseline to whole pixels.
- WebKit's `fillText` loses the kerning between a space and the next letter (it shapes word by word). So "α β γ Δ" is 0.50 pt wider and "AVATAR To We Yo" 0.33 pt wider than in the PDF. This is the problem that spec.md 9.1 avoids by not using the browser's text rendering.
- [results/compare-chrome-dpr2.png](results/compare-chrome-dpr2.png): left, glyphs from the draw data; middle, `fillText`; right, overlay (red: ours only, cyan: browser only).

The Canvas against the PDF: Ghostscript renders the PDFs at 192 dpi (the Canvas scale at DPR 2) and at 768 dpi (scaled down in the browser).

| PDF | Render | Max centroid difference x / y | Mean ink difference |
|---|---|---|---|
| krilla or pdf-writer (same result) | 192 dpi | 1.12 / 0.87 px | 36 |
| krilla or pdf-writer (same result) | 768 dpi | 0.60 / 0.23 px | 13 |

At 192 dpi, Ghostscript fits glyphs to the pixel grid, which moves them. At 768 dpi most of that goes away.
The glyph origins in the PDF itself are exact: `pdftotext -bbox` finds the left edge of all 57 words of horizontal text where the layout put the first glyph (max difference 0.0000 pt, for both PDFs; see `pdfpos`). The rotated label is not checked this way.
So: the PDF matches the layout exactly, and the Canvas matches the Ghostscript render within 0.2 pt (0.60 / 0.23 device px at 768 dpi).

Timing for 200 labels, harfrust, median / p95 in ms ("flush" reads one pixel back, so it includes the GPU work):

| Browser | DPR | Layout | Layout + draw data | Decode in JS | Draw, new Path2D | Draw, cached Path2D + flush | fillText + flush |
|---|---|---|---|---|---|---|---|
| Chrome 155 | 1 | 0.99 / 1.02 | 1.21 / 1.27 | 0.10 / 0.12 | 2.10 / 3.84 | 2.33 / 2.53 | 0.53 / 0.58 |
| Chrome 155 | 2 | 0.98 / 1.03 | 1.25 / 1.30 | 0.10 / 0.12 | 2.97 / 5.59 | 3.10 / 3.30 | 0.82 / 0.87 |
| WebKit 27.2 | 1 | 0.90 / 1.00 | 1.13 / 1.25 | 0.09 / 0.09 | 6.11 / 6.44 | 5.00 / 6.00 | 0.53 / 0.59 |
| WebKit 27.2 | 2 | 0.90 / 1.00 | 1.13 / 1.25 | 0.10 / 0.10 | 8.38 / 9.38 | 7.00 / 8.00 | 0.71 / 0.82 |

- Filling glyph paths costs 4 to 10 times more than `fillText`, but it stays under 10 ms for 200 labels. The graph layer is kept as an image and redrawn only when the figure changes (spec.md 9.1), so this is fine.
- WebKit rounds `performance.now()` to 1 ms, so its numbers are coarse.

Draw data size: 36,468 bytes for the 200 labels (87 outlines, 300 runs), 16,442 bytes for the sample page (86 outlines). Most of it is outlines, which are sent once per glyph.

### PDF: krilla and pdf-writer

Both write the same page (Arimo Regular, Italic, Bold, Tinos, and the fallback font; a frame, ticks, a red line, a rotated label).
Both PDFs have embedded subset CID fonts with ToUnicode (`pdffonts`: emb, sub, uni = yes), and `pdftotext -raw` gives the same text from both.
The CFF path works too: with Fira Math (CFF) as the fallback, both embed it as `CID Type 0C`. Ghostscript renders all four PDFs with `-dPDFSTOPONERROR`. See [results/pdf-check.txt](results/pdf-check.txt).

| | krilla 0.8.2 | pdf-writer 0.15 + subsetter 0.2.6 |
|---|---|---|
| figlab code for the page (non-blank, non-comment lines: `grep -v -E '^\s*(//\|$)'`) | 90 | 269 |
| Written by figlab | nothing for fonts | CID font dictionaries (TrueType and CFF), widths, ToUnicode, compression, subset tags, TJ kerning |
| Output, Noto Sans Math fallback | 33,292 bytes | 32,933 bytes |
| Output, Fira Math fallback | 30,525 bytes | 30,150 bytes |
| Same bytes on repeated runs | yes (IDs are hashes of the content) | yes |
| Same bytes in wasm and native | yes | yes |
| Native time for the page (median) | 1.21 ms | 0.98 ms |
| Chrome wasm time for the page (median, DPR 1) | 2.02 ms | 1.68 ms |
| Extra features | PDF/A and PDF/UA checks, tagging, COLR/SVG glyphs, Type3, variable fonts, gradients. Images and bitmap glyphs need the `raster-images` feature, which was off here (default features off), so the sizes below do not include them | none beyond the PDF objects; images and the rest are written by hand |
| Font stack | pins skrifa 0.42 (read-fonts 0.39); harfrust 0.14 needs read-fonts 0.45, so two copies | uses the skrifa that figlab picks |
| License, maintenance | MIT OR Apache-2.0; active (by a typst developer); 0.x | MIT OR Apache-2.0; typst project; stable low-level API |

wasm sizes ([results/wasm-sizes.md](results/wasm-sizes.md)), in KB:

| Module | Raw | wasm-opt -Oz | gzip -9 | brotli -q 11 |
|---|---|---|---|---|
| base (no shaper) | 22.2 | 19.1 | 8.9 | 7.6 |
| rustybuzz | 581.4 | 531.3 | 226.7 | 175.2 |
| harfrust 0.14 | 938.9 | 789.0 | 313.7 | 249.7 |
| harfrust 0.8.4 | 789.4 | 650.7 | 259.0 | 208.6 |
| rustybuzz + krilla | 1687.9 | 1449.8 | 601.6 | 466.8 |
| harfrust 0.14 + krilla (two font stacks) | 2051.7 | 1704.2 | 694.9 | 522.4 |
| harfrust 0.8.4 + krilla (one font stack) | 1669.9 | 1397.0 | 574.3 | 444.5 |
| rustybuzz + pdf-writer | 777.6 | 703.6 | 308.7 | 249.1 |
| **harfrust 0.14 + pdf-writer** (one font stack) | 1134.1 | 961.5 | 406.6 | 324.7 |

What the PDF part adds (wasm-opt -Oz / brotli): pdf-writer +173 / +75 KB over harfrust 0.14. krilla +915 / +273 KB over harfrust 0.14 (with a second font stack), or +746 / +236 KB over harfrust 0.8.4 (shared stack). krilla with images would cost more.
The harfrust and skrifa builds use the `libm` feature, which made the harfrust module 4 KB smaller than with `std`.
[results/wasm-breakdown.txt](results/wasm-breakdown.txt) shows why: with krilla, skrifa grows from 113 to 243 KB of code (krilla uses more of it: hinting, color glyphs, bitmaps), and krilla itself, write-fonts (forced on through subsetter's variable-fonts feature), tiny-skia-path, and hashbrown add the rest.
`cargo tree -d` ([results/cargo-tree-duplicates.txt](results/cargo-tree-duplicates.txt)) lists two read-fonts, two skrifa, and two font-types only for harfrust 0.14 + krilla. rustybuzz + krilla has no duplicate versions, but it carries two font parsers (ttf-parser and read-fonts).
In every option, subsetter reads fonts with its own small reader. With its `variable-fonts` feature (which krilla turns on), it also brings skrifa 0.42, write-fonts, and kurbo.

### Fallback font

From `coverage` ([results/coverage.md](results/coverage.md)). The list has 161 distinct code points in 8 groups: Greek, units (Å ° µ ± × ℏ, the angstrom sign U+212B, the ohm sign U+2126 …), superscripts and subscripts, operators and relations, arrows, marker shapes, and punctuation.
Arimo Regular already has 117 of them, including all Greek letters, ⁰–⁹ ⁺ ⁻ ₀–₉, ℏ, ∞, ≈, ≤, ≥, ∂, ∑, √, and −.
It lacks 44: ∓∝≪≫≲≳∼≃≅∇∮∈∉⊂⊃⊆⊇∪∅∀∃∧∨⊥∥∠∘∗⋅⊗⊕⊙⟨⟩⇐⇒⇔↦△▽◆◇★☆

x-height and cap height are the OS/2 table values. The minus bar is the height of the glyph box of − (U+2212), a sign of stroke weight.

| Candidate | Adds (of 44) | Style | x-height / em | Cap height / em | Minus bar / em | File KB (brotli) | Subset, 4 figure glyphs | Subset, all 44 |
|---|---|---|---|---|---|---|---|---|
| Arimo (reference) | | sans | 0.528 | 0.688 | 0.071 | 467 (204) | | |
| **Noto Sans Math** | **44** | sans | 0.536 | 0.714 | 0.071 | 992 (395) | 6.1 KB | 11.8 KB |
| STIX Two Math | 44 | serif | 0.473 | 0.657 | 0.068 | 1482 (632) | 6.4 KB | 12.5 KB |
| Libertinus Math | 43 | serif | 0.429 | 0.658 | 0.050 | 1230 (450) | 5.8 KB | 11.5 KB |
| Fira Math (CFF) | 39 (no ⊥ △ ▽ ★ ☆) | sans | 0.527 | 0.689 | 0.076 | 176 (97) | 2.0 KB | 4.4 KB |
| Noto Sans Symbols 2 | 9 (shapes, ∘, ⋅, ⊙) | sans | 0.536 | 0.945 | 0.078 | 1204 (426) | none | 6.4 KB |
| Noto Sans Symbols | 0 | sans | | | | 364 (176) | | |
| Noto Sans | 0 | sans | | | | 2001 (899) | | |

The glyph boxes agree with the OS/2 values (y min to y max, in em; the full table is in results/coverage.md): Arimo x 0–0.528, ± 0–0.595; Noto Sans Math x 0–0.536, ∈ −0.014–0.568, ⊥ 0–0.654, ⇒ −0.033–0.591.
One regular sans-serif fallback does not match every label. Arimo Bold has a minus bar of 0.109 em against 0.071, so fallback symbols look light in bold labels. Tinos has an x-height of 0.459 em against 0.536, so they look large next to Tinos.

The "figure glyphs" are the characters of the sample texts that Arimo lacks: ∝ ∇ ⟨ ⟩. Subset sizes are raw TrueType from subsetter (about half after compression in the PDF).

A bundled subset: whole symbol blocks (Greek, letterlike symbols, arrows, mathematical operators, miscellaneous technical, geometric shapes, miscellaneous symbols for ★ ☆, miscellaneous mathematical symbols A, supplemental arrows A) are 822 glyphs from Noto Sans Math, 133 KB raw (71 KB deflate) from subsetter.
This is a lower bound. subsetter makes subsets for PDF only: it drops the cmap, OS/2, GSUB, GPOS, and GDEF tables. A bundled subset needs a tool that keeps them, so it is larger.
A character outside the subset that the chosen font also lacks is drawn as .notdef (an empty box) in the main font, as for any character that no font has.

How they look next to Arimo: [results/fallback-sheet-dpr1.png](results/fallback-sheet-dpr1.png) (drawn from the draw data; .notdef boxes where the candidate lacks a glyph).
Noto Sans Math matches Arimo's size and weight best. STIX Two Math and Libertinus Math look like serif fonts next to Arimo. Fira Math is close, but its ★ is much larger and it lacks ⊥.
In the google/fonts build of Libertinus Math, the glyphs of ⊂ (gid 2198) and ⊥ (gid 2233) are malformed: simple glyphs with a zero bounding box and invalid flag bytes. skrifa, ttf-parser, and FreeType (`hb-shape --font-funcs=ft --show-extents`) all place them far from the baseline, and Chrome does not draw them. This is a problem of the font file, not of the parsers. Libertinus Math is not a good candidate.

## Limits

- The timing is from one run on one machine (2026-10-15, no other builds, but normal desktop apps and background services open). Timing varies by a few percent from run to run. Re-run the last two steps of `run-all.sh` to check.
- No Firefox numbers. Neither Playwright's Firefox nor the installed Firefox 157 starts headless on this machine. Chrome and WebKit were tested.
- The native-versus-wasm check covers 6 outputs on one arm64 Mac. It does not cover composite glyphs with scaled offsets (the `hypot` path), hinting, or variable font instancing.
- One machine and one OS. Browser text rendering differs on Windows and Linux. Our glyph drawing does not depend on the OS, apart from antialiasing.
- The layout is minimal: no line breaking, no bidirectional text, no math layout. Superscript and subscript sizes and offsets are guesses.
- The PDF writers are minimal: text, strokes, and RGB fill colors. Images (heatmaps), clipping, dashes, and markers were not written with either library.
- pdf-writer code handles horizontal glyph offsets (kerning) only. Vertical glyph offsets (marks) would need more code.
- Variable fonts: the pdf-writer path uses subsetter without variable-font support. A TrueType (glyf) variable font is embedded at its default instance, and a CFF2 font fails (subsetter returns Unimplemented).
- ToUnicode in the pdf-writer path keeps the first text seen for each glyph. A glyph used for two code points (Arimo has 8 such glyphs) copies as the first one.
- PDF validity was checked with poppler and Ghostscript only (no veraPDF or qpdf on this machine).
- The fallback comparison is by eye and by three metrics. It does not cover every symbol.

## ADR

[docs/adr/0010-text-shaping-pdf-and-fallback-font.md](../../docs/adr/0010-text-shaping-pdf-and-fallback-font.md)
