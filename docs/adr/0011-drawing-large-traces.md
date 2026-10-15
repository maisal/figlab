# 0011. Drawing large traces: pyramid decimation in the worker, transform on the main thread, WebGL markers with fixed-point x

- Status: Accepted
- Date: 2026-10-14

## Context

spec.md Section 13 asks for zoom and pan at 60 frames per second, the exact figure within 50 ms after the movement stops, a redraw of a 10-million-point trace within 0.2 s once decimated, and re-decimation on zoom within 0.5 s.
Section 4 puts the arrays in the compute worker (Rust/wasm) and the drawing on the main thread.
Section 9.3 said lines are decimated to the minimum and maximum per pixel column in the worker, and markers of large traces are drawn with WebGL from data coordinates.

Experiment S2 (`experiments/s2-draw/`) tested this with a 10-million-point trace at 1600 × 600 CSS pixels and DPR 2 (3200 × 1200 device pixels) in headless Chrome 155 and WebKit 27.2 on an Apple M1 Max.
The numbers below are Chrome first, then WebKit. They come from a run on 2026-10-15 with no other builds running (normal desktop apps open; load average about 8–10). Headless frame timing follows a synthetic 60 Hz clock.
`experiments/s2-draw/README.md` has all numbers and the setup.

## Options

### Decimation method (in the worker)

1. **Direct scan of the visible index range.** Binary search for the range, then one pass that computes first, min, max, and last per pixel column (M4). O(visible points). Full view: 53 / 40 ms (native 32 ms). 10 %: 6.1 / 4.9 ms. 1 %: 0.9 / 0.8 ms.
2. **Min/max pyramid.** Blocks of 16 points, then 32, 64, and so on (21 levels for 10 million points), each with min, max, and their indices. A block that holds a NaN in x or y is marked. A column query starts at the lowest level whose blocks are as long as the column and goes down into marked blocks, so only the 16-point blocks with a NaN are scanned. Same output as option 1, bit for bit (tested, including NaN, ±inf, ties, and NaN x). Build: 78 / 32 ms (native 16 ms), 30 MB (3 bytes per point). Full view: 3.3 / 2.8 ms. 10 %: 1.1 / 1.0 ms. 1 %: 0.7 / 0.7 ms.
   - NaN-dense data costs more. Full view with a NaN every 1,000 points: 7.3 / 6.6 ms (scan 57 / 44 ms). Every 100 points: 23 / 22 ms (scan 70 / 59 ms). Every 10 points, most blocks hold a NaN, so the pyramid uses the scan: 96 / 87 ms.
3. **Scan with wasm SIMD (simd128).** Built with `-C target-feature=+simd128` only (no hand-written vector code). No change (53 / 40 ms at the full view). The M4 loop tracks indices and checks NaN, so the compiler does not vectorize it.

Rules that both methods follow:

- A NaN in x or y is a break in the line. A NaN in x does not make a sorted trace unsorted; the point belongs to the column of the point before it.
- In a column, the points before the first break and the points after the last break each get their M4 points. The points between the first and the last break (short segments between two breaks) are kept as one vertical line from their minimum to their maximum, followed by a break. So the vertical extent of the column is kept, but these segments are not drawn as they are.
- One point beyond each edge of the view is included, so the segments that cross the plot edges are drawn. A view between two neighboring points shows the segment between them.
- Ties in min or max go to the lower index. Infinite values are kept.

When x is not sorted, the binary search and the pyramid do not apply. The check costs one pass over x: 21 / 7.2 ms for sorted x (native 6.4 ms). On unsorted x it stops at the first descent. A full scan of all points per request then takes 51 / 43 ms at the full view and 11–18 ms when zoomed in, and gives only the per-column envelope. A point outside the view is kept when the segment to its neighbor in index order crosses the view; points with NaN x are skipped. A line through unsorted x goes back and forth across columns, so the envelope is not the line. Sorted x is the case to optimize. Unsorted x needs another method (for example WebGL line strips of all points, or decimation in index order).

### Redraw during zoom and pan (on the main thread)

The script runs 9.5 s with six stops. Each stop is half a frame off the frame grid.

1. **Every frame:** ask the worker for a new decimation on every frame (one request in flight, latest wins) and draw it when it arrives. The picture is one frame old (16.7 ms) while moving. 0 dropped frames with the pyramid. With the scan, the data age reached 67 / 50 ms, and the exact figure took 88 / 78 ms after the stop at the full view.
2. **Transform:** draw the last exact image with a transform (`drawImage` with scale and offset) while moving, and ask for the exact figure on the first frame without movement. 0 dropped frames, main-thread work 0.05 ms per frame. The picture is current, but its data is up to 1.4 s old. The exact figure arrived 28–35 / 25–31 ms after the stop with the pyramid. In a real app the end of a wheel zoom is only known after a timeout, which adds to this.
3. **Hybrid:** transform every frame, and also ask for a new decimation every frame (latest wins). Each reply replaces the image. A reply that arrives after the view has moved on is drawn moved to the current view. Picture age 0, data age one frame with the pyramid, 0 dropped frames, main-thread work 0.9 / 0.6 ms per frame (p95 1.8 / 1.9 ms). The exact figure arrived 10–16 / 9–15 ms after the stop with the pyramid, and up to 101 / 72 ms with the scan at the full view.

### Markers

- **WebGL `gl.POINTS` with all 10 million points uploaded once** and a uniform transform per frame. Draw plus GPU sync, median of 30: 4.9 / 4.8 ms at the full view, 2.0 / 1.8 ms at 10 %, 1.7 / 1.4 ms at 1 %. The scripted zoom and pan ran at 60 frames per second. WebKit dropped no frame. Chrome dropped 20 frames, all in one 350 ms stall right after the upload, and none after it.
- **Upload in chunks of 1 million points.** The worker builds one chunk in wasm, copies it out, and transfers it; the main thread writes it with `bufferSubData`. 120 MB in 70 / 59 ms, plus 30 / 25 ms for the first draw. wasm memory grows by one chunk (12 MB), not by the whole buffer.
- **x precision.** x = 1e6 + 0.001 × i. The x that the shader computes for each point was read back with transform feedback and compared with the f64 position, at six views (64 points across the width at the start, middle, and end of the trace; 8 points at the middle and end; 1 % of the span at the end). Both browsers gave the same numbers:
  - **f32 x:** off by up to 3,466 px; 64 points fall into a few columns.
  - **One f64 offset**, f32(x − origin): right near the start (0.004 px), but 22–253 px off at the middle and end. x − origin reaches 1e4, where the f32 spacing is 9.8e-4, about one point step.
  - **hi/lo f32 pair** (hi = f32(x), lo = f32(x − hi), shader `(hi − x0hi) + (lo − x0lo)`): exactly the same result as f32 x, in both browsers. The lo attribute reaches the GPU (read back alone, its largest value is 0.0310, as on the CPU). The shader compiler regroups the sum as (hi + lo) − (x0hi + x0lo), and hi + lo rounds back to hi. GLSL ES has no way to forbid this (no `precise`), and a multiply-by-one guard is folded too.
  - **Integer fixed point:** q = round((x − origin) / step) with step = span / 2^40, sent as two int32 words (q = hi × 2^30 + lo). The shader subtracts the words of the view's x0 in integer arithmetic, which is exact and not regrouped, and only then converts to float. When the high words differ by at most 1, it forms the difference as one int32 first. Error 0.0003–0.0032 px, no point in the wrong column, and the raster check (1 px points) lights exactly the expected columns. Most of the error comes from rounding x0 to a whole step. 12 bytes per point with y as f32 (as many as hi/lo with y), 120 MB for 10 million points. Views up to about 8,000 data spans wide work.
  - Firefox does not use ANGLE Metal and was not measured. The integer scheme does not depend on how a compiler orders float operations, because highp int arithmetic in GLSL ES 3.00 is exact.
  - A fallback, not built here: per-chunk origins (for example 4,096-point chunks, a_off = f32(x − origin_k), and a texture of f32(origin_k − x0) updated per frame).
- **Log scale on x.** log(x) computed on the GPU in f32 loses the small steps with any of these schemes. So the worker computes log(x) in f64, and the points are sent again when log x is turned on or off (about the upload time: 60–70 ms for 10 million points).

## Decision

- **Decimation:** M4 from a min/max pyramid in the compute worker, with the rules above. The worker builds the pyramid for a plotted y series (with its x) when it is first needed, and drops it when the series is no longer plotted. When most blocks hold a NaN, the worker uses the scan.
- **Where each step runs:** the worker finds the visible index range, decimates, and transfers the points (about 12,600 points, 200 KB) as one `Float64Array`. The main thread draws them into the image of the series. In the product, each reply goes through the render module (layout, then draw data, then the screen; spec.md Section 4). This experiment drew the points directly, so the cost of that path is not measured.
- **Redraw strategy:** hybrid. During zoom and pan, the main thread draws the image of the series with a transform every frame, and asks the worker for the latest view with at most one request in flight (a new request replaces the pending one). Each reply replaces the image. A late reply is drawn moved to the current view. The transformed image holds only the series. Axes and text are not scaled; they are drawn again from the layout of each reply, so ticks follow the view one reply behind. When the movement stops, the last reply is the exact figure, so no end-of-movement detection is needed.
- **Markers:** traces above the 9.3 threshold are drawn as WebGL points from one upload in data coordinates, sent in chunks. x is integer fixed point, as above. The view transform is a set of uniforms. y is f32 here; the same scheme applies to y when its values have a large offset. For a log x axis, the worker sends log(x) computed in f64.
- **Unsorted x:** decimation per column is used only when x is ascending (ignoring NaN). The worker checks this once per array. How to draw lines with unsorted x is left for a later decision.

## Reasons

- The pyramid is the only method that keeps the full-view decimation well under one frame (3.3 / 2.8 ms against 53 / 40 ms for the scan) and the exact figure within 50 ms after a stop at every zoom. It costs 30 MB and 32–78 ms per 10 million points, far inside the 0.5 s target.
- The hybrid strategy gives the current picture of the transform strategy and the fresh data of the every-frame strategy. With the pyramid, the worker keeps up with the frame rate at every zoom, so the data on screen is one frame old.
- Transforming the image is 0.05 ms per frame, so zoom and pan cost almost nothing on the main thread. This matches spec.md 12.3 ("TypeScript scales and moves the current image").
- 10 million WebGL points run at 60 frames per second on this GPU. Integer fixed point is the only scheme measured that matches f64 at every view, in both browsers. It costs the same memory and frame time as the hi/lo pair, which fails.
- The SIMD build gave nothing without hand-written vector code, and the pyramid makes a faster scan unnecessary.

## Consequences

- This change updates spec.md:
  - 9.3, "Screen (lines)": M4 (first, min, max, and last per column), the point beyond each edge, NaN as a break, the vertical line for points between two breaks, and the pyramid per plotted y series, built when needed and dropped when not plotted.
  - 9.3, "Screen (markers)": x as integer fixed point, so that the positions match f64; log x computed in f64 by the worker.
  - 12.3: only the image of the series is scaled; each reply goes through the render module, which also recomputes the ticks; a late reply is moved to the current view; no end-of-movement detection.
- spec.md 9.1 should say that the image of the series is kept apart from the axes and text, so that it can be scaled alone. This change does not edit 9.1.
- spec.md 13 keeps its targets ([Proposal]). Measured margins with the pyramid and the hybrid strategy:
  - 60 frames per second: 0 dropped frames in 9.5 s for lines in both browsers. Markers: none in WebKit, and one 350 ms stall right after the upload in Chrome.
  - exact figure within 50 ms after the movement stops: 9–16 ms, about 3×. With the scan instead of the pyramid it fails (up to 101 ms at the full view).
  - redraw of a decimated trace within 0.2 s: 2–3 ms with the stroke rasterized (p95 up to 6 ms), about 70×. For tall columns (the unsorted case) Chrome needs 14 ms in this bench and up to 59 ms in the hybrid run, still within 0.2 s. But each such draw blocks the main thread, so Chrome dropped 179 frames there (WebKit none). For such traces, rate-limit the exact draw or make the stroke cheaper (for example one vertical line per column instead of a zigzag with round joins).
  - re-decimation on zoom within 0.5 s: 3.3 ms at the full view, about 150×. The first decimation also pays the pyramid build (32–78 ms).
- Memory (the 2 GB budget of spec.md 13): the pyramid adds 3 bytes per point for each plotted y series, built when needed and dropped when not plotted. The marker upload grows wasm memory by one 12 MB chunk; wasm memory never shrinks, so the chunk stays reserved. Each chunk is copied once more on its way to the main thread. The 120 MB GPU buffer is outside wasm memory. A log x axis needs one more upload.
- Worker protocol: decimation replies carry the request sequence number and the view. The main thread drops a reply older than the last one applied, keeps at most one request in flight, and moves a late reply to the current view.
- Traces whose x is not sorted need a separate decision for lines. Markers work the same way for sorted and unsorted x.
- The experiment page sends COOP, COEP, and CORP headers only to get finer timers (5–10 µs instead of 100 µs in Chrome). Nothing measured depends on cross-origin isolation: there is no SharedArrayBuffer, and postMessage works the same. GitHub Pages cannot send these headers (spec.md 13), so figlab must not rely on them. The page keeps one worker for all data sets, as the app will. This also avoids a WebKit failure under COEP, where a second `new Worker` with the same URL is refused.
- The measurements are from headless browsers on one machine. Numbers in a real browser window and on slower machines are still to be taken.
