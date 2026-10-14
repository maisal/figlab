# 0010. Shape text with harfrust, write PDF with pdf-writer, and use Noto Sans Math as the fallback font

- Status: Accepted
- Date: 2026-10-14

## Context

The render module lays out text and draws it from the font files, in the browser and on the command line (ADR 0007, spec.md 9.1).
Text on screen must sit exactly where it does in exported figures.
Three choices were open (docs/roadmap.md S1 and D3):

- the text shaping library. spec.md 4.1 and ADR 0007 named rustybuzz with ttf-parser
- the PDF library: krilla, or pdf-writer with subsetter
- the fallback font for symbols that the main font lacks (spec.md 9.2). For example, Arimo has no "∝"

The experiment S1 tried all of them. Code, numbers, and how to run it are in [experiments/s1-text](../../experiments/s1-text/README.md).
Sizes and correctness results do not depend on load. The timing numbers come from a run on 2026-10-15 with the `libm` build and no other builds running (normal desktop apps and background services were open).
The browsers were Chrome 155 and WebKit 27.2 on one Apple M1 Max Mac. Firefox was not tested: neither Playwright's Firefox build nor the installed Firefox 157 starts headless on that machine.

## Options

Text shaping:

1. rustybuzz 0.20 with ttf-parser 0.25
2. harfrust 0.14 with skrifa 0.48 (both on read-fonts, from the HarfBuzz and fontations projects)

PDF:

1. krilla 0.8.2
2. pdf-writer 0.15 with subsetter 0.2.6, and figlab's own code for fonts

Fallback font (all OFL-1.1):

1. Noto Sans Math
2. STIX Two Math
3. Libertinus Math
4. Fira Math
5. Noto Sans Symbols, Noto Sans Symbols 2, or Noto Sans

Measured evidence:

- Shaping. rustybuzz and harfrust (0.14 and 0.8) give the same glyph ids, advances, offsets, and clusters for every sample text, with every fallback font. Kerning is applied by both. The outlines from ttf-parser and skrifa are the same shapes.
  - rustybuzz is archived. Its README tells users to switch to harfrust. Its last release was 2024-11.
  - harfrust is active and tracks HarfBuzz 14.5.1. It makes breaking releases often: 0.8 (2026-06) and 0.14 (2026-10) have different font APIs.
  - wasm size (wasm-opt -Oz / brotli): rustybuzz 531 / 175 KB, harfrust 0.14 789 / 250 KB.
  - Layout of 200 labels in wasm in Chrome: rustybuzz 2.53 ms, harfrust 0.99 ms (median).
- Positions. The layout gives runs of glyph ids and positions in pt. The PDF writers and the Canvas code use the same numbers.
  - PDF glyph origins match the layout exactly: poppler (`pdftotext -bbox`) reads back the left edges of all 57 words of horizontal text at the layout's positions (difference 0.0000 pt).
  - The Canvas drawing matches a Ghostscript render of the PDF within 0.2 pt (0.60 / 0.23 device px in x / y at DPR 2, ink centroid per run, render at 768 dpi scaled down). The rest is rasterizer differences.
  - The wasm and native builds give byte-identical output for 6 files: the draw data of the sample page (with two shapers) and four PDFs. This was checked on one arm64 Mac. The check does not cover composite glyphs with scaled offsets (the `hypot` path below), hinting, or variable font instancing.
  - Chrome's `fillText` of the same font files has the same advances within 0.011 pt. WebKit's `fillText` is up to 0.5 pt wider on a label, because it drops kerning next to spaces. This confirms spec.md 9.1: the browser's text rendering cannot be trusted for positions.
  - Drawing 200 labels (1424 glyphs) with cached `Path2D`s: about 2.3 to 3.1 ms in Chrome and 5 to 7 ms in WebKit, against 0.5 to 0.8 ms for `fillText`. The draw data for them is 36 KB.
- PDF. Both libraries write embedded subset CID fonts with ToUnicode. Text can be copied, and the same text comes out of both. Both handle TrueType and CFF fonts, give the same bytes on every run, and give the same bytes in wasm and natively.

  | | krilla 0.8.2 (default features off) | pdf-writer 0.15 + subsetter 0.2.6 |
  |---|---|---|
  | figlab code for the sample page (non-blank, non-comment lines) | 90 | 269 |
  | Added to the wasm module with harfrust 0.14 (-Oz / brotli) | +915 / +273 KB (two font stacks) | +173 / +75 KB |
  | Added with a shared font stack (harfrust 0.8.4) | +746 / +236 KB | (always shared) |
  | Font stack | pins skrifa 0.42 (read-fonts 0.39) | uses figlab's skrifa |
  | Output size of the sample page | 33.3 KB | 32.9 KB |
  | Extra features | PDF/A, PDF/UA, tagging, color glyphs, variable fonts. Images and bitmap glyphs need its `raster-images` feature, which was off in the measurement, so krilla with images costs more than shown | none; figlab writes them if needed |

- Fallback font. The list has 161 distinct code points from the text notation (Greek letters, `\AA`, superscripts and subscripts) and common science symbols. Arimo already has 117, including all Greek letters, ⁰–⁹ ⁺ ⁻ ₀–₉, ℏ, and −. It lacks 44, for example ∝ ∇ ⟨ ⟩ ∈ ⊂ ⊥ ∥ ⇒ ★.
  x-height and cap height below are the OS/2 table values. The minus bar is the height of the glyph box of − (U+2212).

  | Font | Adds (of 44) | Style | x-height / em (Arimo 0.528) | Cap height / em (Arimo 0.688) | Minus bar / em (Arimo 0.071) | File (brotli) |
  |---|---|---|---|---|---|---|
  | Noto Sans Math | 44 | sans | 0.536 | 0.714 | 0.071 | 992 KB (395 KB) |
  | STIX Two Math | 44 | serif | 0.473 | 0.657 | 0.068 | 1482 KB (632 KB) |
  | Libertinus Math | 43 | serif | 0.429 | 0.658 | 0.050 | 1230 KB (450 KB) |
  | Fira Math | 39 | sans | 0.527 | 0.689 | 0.076 | 176 KB (97 KB) |
  | Noto Sans Symbols 2 | 9 | sans | | | | 1204 KB (426 KB) |
  | Noto Sans Symbols, Noto Sans | 0 | sans | | | | |

  Glyph extents agree with the OS/2 values. In em, y min to y max: Arimo ± 0 to 0.595; Noto Sans Math ∈ −0.014 to 0.568, ⊥ 0 to 0.654, ⇒ −0.033 to 0.591.
  In the google/fonts build of Libertinus Math, the glyphs of ⊂ and ⊥ are malformed simple glyphs (a zero bounding box and invalid flag bytes). skrifa, ttf-parser, and FreeType all draw them in the wrong place.

## Decision

- Shape text with **harfrust**, and read cmaps, metrics, and outlines with **skrifa**. Both use read-fonts, so figlab has one parser for shaping, metrics, and outlines. (subsetter has its own small font reader.)
  - Pin exact versions. Keep the harfrust calls inside one small module of `figlab-render`, so that an upgrade changes one file.
  - Use harfrust, skrifa, and read-fonts with default features off and the `libm` feature on. With `std` on, skrifa and read-fonts call the platform's `f32::hypot` for composite glyphs with scaled component offsets, even when `libm` is also on. That result may differ between native and wasm. The clippy rule of roadmap.md M0 cannot see inside dependencies, so the features are the guard. The experiment builds and gives the same results with these features.
- Draw text on the screen from the draw data: per run, the font, the size, the text, the glyph ids and positions in pt, and for each glyph the range of the text it shows (its cluster). Each glyph outline is included once, in font units. TypeScript draws them with one cached `Path2D` per glyph. PDF ToUnicode and SVG `<text>` use the text and the ranges.
- Write PDF with **pdf-writer** and **subsetter** (default features off), with compression by miniz_oxide. figlab writes the CID font dictionaries, widths, ToUnicode, and subset tags itself.
- Use **Noto Sans Math** as the fallback font. A character that the chosen font does not map goes into a run in the fallback font.

## Reasons

- rustybuzz is archived and points to harfrust. harfrust gives the same results, is faster in wasm, and is maintained by the HarfBuzz project. Its size cost over rustybuzz (+258 KB -Oz, +75 KB brotli) is the price of a maintained shaper.
- skrifa reads outlines and metrics with the same read-fonts that harfrust uses, so shaping and drawing share one parser.
- The design in spec.md 9.1 works. Positions come only from the font files and the layout, so the screen, the PDF, and the command line agree. The browser's own text rendering would not: WebKit puts text up to 0.5 pt off.
- pdf-writer adds about a quarter of krilla's size to the module. krilla's extra size comes from features figlab does not need now (color glyphs, hinting code in skrifa, write-fonts for variable fonts, PDF/A checks).
- krilla pins an older skrifa (0.42). Together with harfrust 0.14, the module would contain two copies of read-fonts and skrifa. With pdf-writer, figlab picks one version for everything.
- The extra code with pdf-writer is small (269 lines for fonts, text, lines, and colors) and plain. It was correct on the first try for TrueType and CFF fonts. pdf-writer is the stable low-level layer that krilla itself builds on.
- Noto Sans Math is the only sans-serif candidate that covers every symbol on the list. Its x-height, cap height, and stroke weight are close to Arimo Regular's, so fallback symbols do not stand out in regular labels. spec.md 9.2 already named it as the candidate.

## Consequences

- This change also updates the documents:
  - spec.md 4.1: text shaping is harfrust with skrifa. PDF is pdf-writer with subsetter.
  - spec.md 9.1: the draw data contains text as glyph runs (text, glyph ids, positions in pt, and clusters) and glyph outlines in font units.
  - spec.md 9.2: Noto Sans Math is the fallback font. It is shipped as a subset and loaded when first needed (see below). The subsetting tool and the block list are to be confirmed.
  - development.md Section 9: a note that this record chose from the candidate libraries.
  - roadmap.md D3 points to this record.
- ADR 0007 lists rustybuzz, ttf-parser, and "krilla or pdf-writer" in its reasons. This record replaces that list. ADR 0007's decision does not change.
- The size and offset of superscripts and subscripts (spec.md 8.4) are left for M5. The experiment used 0.7 times the size, raised 0.36 em or lowered 0.14 em.
- harfrust breaks its API often. Upgrades take some work, but only in one module.
- If another dependency turns on `std` for skrifa or read-fonts, Cargo merges the features and the platform `hypot` comes back. Check the features of these crates when dependencies change.
- figlab owns its PDF font code. It must write more by hand later: images (heatmaps, raster markers), clipping, dashes, and vertical glyph offsets. PDF/A or tagged PDF would need much more work. If they are ever needed, reconsider krilla.
- ToUnicode in the experiment keeps the first text seen for each glyph. Arimo has 8 glyphs that stand for two code points each. To copy both correctly, figlab needs duplicate CIDs for such glyphs, or ActualText.
- Variable fonts: with default features off, subsetter embeds a TrueType (glyf) variable font at its default instance, and it refuses CFF2 fonts. The bundled fonts are static, so this matters only for fonts that users load. Exporting other instances or CFF2 fonts needs subsetter's `variable-fonts` feature, which brings skrifa 0.42, write-fonts, and kurbo (a second font stack), or instancing by figlab with its own skrifa. Decide this when user fonts are added.
- Noto Sans Math is large (992 KB, 395 KB brotli). Make a subset at build time with a tool that keeps the cmap, OS/2, GSUB, GPOS, and GDEF tables. subsetter drops them, so its estimate is a lower bound: a subset of the symbol blocks (Greek, letterlike symbols, arrows, mathematical operators, miscellaneous technical, geometric shapes, miscellaneous symbols, miscellaneous mathematical symbols A, supplemental arrows A) is 822 glyphs and 133 KB raw without those tables. The real subset is larger. The Noto fonts have no Reserved Font Name, so a subset may keep its name; check the OFL file when shipping it.
- A character that is in neither the chosen font nor the fallback subset stays in the main font as .notdef (an empty box). spec.md says nothing about this case yet. Decide in M5 whether to warn.
- If the fallback font is loaded only when needed, a label that needs it must be laid out again when the font arrives. Or the cmap of the subset must be known before layout, so that the layout knows which labels need it. Decide in S4 or M5. Loading it lazily keeps it out of the 2-second start (S4).
- One regular sans-serif fallback does not match every label. Next to Arimo Bold (minus bar 0.109 em) its symbols look light. Next to Tinos (x-height 0.459 em against 0.536 em) they look large and sans-serif.
- Kerning applies only inside a run. There is no kerning between a letter and a superscript, or between a letter and a fallback symbol. This is fine for figure labels.
- Drawing glyph paths is slower than `fillText` (5 to 7 ms for 200 labels in WebKit). The graph layer is kept as an image, so this cost is paid only when the figure changes. If it becomes a problem, a glyph atlas can be added later without changing the draw data.
- PNG export (tiny-skia) can fill the same skrifa outlines. This was not tested in S1.
