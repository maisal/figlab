# S2: decimate and draw 10 million points

ADR: [docs/adr/0011-drawing-large-traces.md](../../docs/adr/0011-drawing-large-traces.md)

## Question

Can a 10-million-point trace be decimated, panned, and zoomed at 60 frames per second in the browser, with the architecture of spec.md Section 4 (data in a compute worker in Rust/wasm, drawing on the main thread)?

## Short answer

Yes, with a min/max pyramid in the worker and a transformed image on the main thread. The numbers come from a run on 2026-10-15 with no other builds running (normal desktop apps open; load average about 8–10). Where two numbers are given, Chrome comes first, then WebKit.

- Decimating the full view (10 million points to 3200 columns) takes 53 / 40 ms with a direct scan and 3.3 / 2.8 ms with a precomputed min/max pyramid. The pyramid costs 78 / 32 ms to build and 30 MB. Data with a NaN in most blocks falls back to the cost of the scan.
- With the "hybrid" strategy (transform the last image every frame, and ask the worker for the latest view with one request in flight), zoom and pan of a line run at 60 frames per second with 0 dropped frames in 9.5 s, about 1 ms of main-thread work per frame, and data one frame old. The exact figure is on screen 9–16 ms after the movement stops (target: 50 ms).
- 10 million markers as WebGL points draw in about 5 ms at the full view and 1.4–2 ms when zoomed in. x must be stored as integer fixed point: then every point is within 0.004 px of its f64 position. f32 x, f32 x minus one offset, and a hi/lo f32 pair all fail, by up to 3,466 px. The hi/lo pair fails because the shader compilers in both browsers regroup its sum.
- The spec.md 13 targets are met with these margins: exact figure about 3×, redraw about 70×, re-decimation about 150×. The weak spot is the Canvas 2D stroke of very tall columns in Chrome (unsorted x), which blocks the main thread for tens of milliseconds.

## Setup

- Machine: Apple M1 Max, 64 GB, macOS (Darwin 27.0.0). Run on 2026-10-15 with no other builds running; normal desktop apps were open (load average about 8–10).
- Browsers (Playwright 1.64.0, headless, viewport 1700 × 900 CSS pixels at `deviceScaleFactor: 2`):
  - Google Chrome 155.0.8059.79 (`chromium.launch({ channel: "chrome" })`). WebGL used the real GPU: `ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)`.
  - WebKit 27.2 (Playwright build 2370). WebGL renderer: `Apple GPU`.
  - Firefox: not measured. The Playwright Firefox build (1555) does not start on this machine ("Could not find profile folder").
- Rust 1.99.0, target `wasm32-unknown-unknown`, release profile with `opt-level = 3`, `lto = true`, `codegen-units = 1`, `panic = "abort"`. No crates besides `std`. wasm-opt 133 (`-O3`). The wasm module is 31 KB. A second build with `-C target-feature=+simd128` is used for the SIMD comparison.
- npm (devDependencies only, nothing ships): vite 8.3.4 (MIT), typescript 6.0.3 (Apache-2.0), playwright 1.64.0 (Apache-2.0). The lock file also has lightningcss 1.33.0 (MPL-2.0), an optional dependency of vite. It is a build tool and is not used by this page. MPL-2.0 is on the tools-only list of `tools/check-npm-licenses.mjs`.
- Plot: 1600 × 600 CSS pixels at DPR 2, so 3200 × 1200 device pixels. The canvas backing store is always 3200 × 1200, whatever the real DPR.
- Data (`src/lib.rs`, `make_trace`): 10,000,000 points. x starts at 1e6 and goes up by 0.001 × (0.5 + u) per point (ascending with jitter; span about 1e4). y is a random walk with a spike at about one point in 100,000, a NaN gap of 50,000 points at 60 % of the trace, and a single NaN point every 1,234,567 points. The unsorted case uses a random walk for x too. The NaN-dense cases add a NaN every 1,000, 100, or 10 points.
- Time resolution: the page sends COOP, COEP, and CORP headers (`vite.config.ts`), so `performance.now()` has 5–10 µs steps in Chrome (100 µs without). Nothing else depends on this: there is no SharedArrayBuffer, and postMessage works the same. GitHub Pages cannot send these headers (spec.md 13), so figlab must not rely on them. WebKit refuses a second `new Worker` with the same URL under these headers, so the page keeps one worker and re-initializes it for each data set (the app will also keep one compute worker).

## How to run

From this folder:

```sh
mise exec -- pnpm install
mise exec -- pnpm run build        # cargo build (wasm) + wasm-opt + vite build
mise exec -- pnpm run measure      # headless Chrome; writes results/chrome.json
mise exec -- pnpm run measure -- --browser webkit
mise exec -- pnpm run measure -- --browser firefox   # needs `pnpm exec playwright install firefox`
mise exec -- node scripts/tables.mjs chrome webkit   # prints the tables below
```

The measurement serves the page with `vite preview` on port 4273 and fails if that port is in use.

To watch it in a browser window, start the dev server and open the page. The buttons run the same scripted zoom and pan and print the numbers below the plot. `window.s2` has the same functions for the console (`await s2.all()`).

```sh
mise exec -- pnpm run dev          # http://localhost:5173/
```

Native timing of the decimation, for comparison with wasm, and the tests:

```sh
mise exec -- cargo run --release --bin bench   # writes results/native.json
mise exec -- cargo test --release
```

## What was built

- `src/lib.rs`: the trace; M4 decimation (first, min, max, last per pixel column) by a direct scan of the visible index range; the same from a min/max pyramid; a full-scan version for unsorted x; and the GPU data for markers (fixed-point x and the reference encodings). Plain `extern "C"` exports; the worker reads the output from wasm memory. The tests check that the scan and the pyramid give the same bits (also with NaN, ±inf, ties, and NaN x), the rules below, and the fixed-point formula against f64.
- `web/worker.ts`: the compute worker. It owns the arrays and answers `decimate` requests with a transferred `Float64Array` of x, y pairs (a NaN pair is a break). It sends the GPU data in chunks of 1 million points.
- `web/plot2d.ts`: the image of the series on Canvas 2D. An exact draw strokes the decimated line into an off-screen canvas and copies it to the screen. During movement the image is drawn with a transform (`drawImage` with scale and offset). There are no axes or text.
- `web/gl.ts`: WebGL2 markers. All points are uploaded once; zoom and pan are uniforms. Four x modes: fixed point (the product layout), and f32 x, f32 x minus one offset, and a hi/lo f32 pair as references. The x that the shader computes can be read back with transform feedback.
- `web/bench.ts`, `web/view.ts`: the scripted movement and the three redraw strategies:
  1. every frame: ask the worker on every frame, draw the reply when it arrives (no transform)
  2. transform: draw the last image with a transform while moving; ask for the exact figure on the first frame without movement
  3. hybrid: transform every frame, and ask the worker every frame; each reply replaces the image, and a reply that arrives after the view has moved on is drawn moved to the current view
- The script (9.5 s): zoom in to 1 %, pan by half a view, zoom in to 0.01 %, pan by one view, zoom out to 10 %, zoom out to the full view, with a 0.5 s pause after each move. Each move ends half a frame off the frame grid. The zoomed views stay between 37 % and 47 % of the span, away from the NaN gap.
- At most one request is in flight. A request made while one is in flight replaces the pending one (latest wins). Replies carry the request sequence number, and a reply older than the last applied one is dropped.
- `scripts/measure.mjs`: runs `window.s2.all()` in a headless browser and writes `results/<browser>.json`. `scripts/tables.mjs` prints the tables.

### Decimation rules

- **Breaks.** A NaN in x or y is a break in the line. A NaN in x does not make a sorted trace unsorted (the sorted check skips NaN). Such a point belongs to the column of the point before it. Binary searches use the last x that is not NaN, so a run of L NaN values costs O(L) per probe.
- **Columns with breaks.** In a column, the points before the first break and after the last break each get their M4 points. The points between the first and the last break (segments between two breaks) are kept as one vertical line from their minimum to their maximum, followed by a break. Example: y = [0, NaN, 100, −100, 50, NaN, 1] in one column gives (0), break, (100, −100), break, (1). So the vertical extent is kept, but such segments are not drawn exactly as without decimation.
- **Plot edges.** One point beyond each edge of the view is included, so the segments that cross the plot edges are drawn. With x = 0, 10, …, 90 and a view of 42 to 48, the output is the segment from 40 to 50.
- **Ties and infinities.** Ties in min or max go to the lower index. ±inf is kept as a value.
- **Pyramid.** Blocks of 16 points, then 32, 64, and so on, each with min, max, and their indices. A block with a NaN in x or y is marked. A column query starts at the lowest level whose blocks are as long as the column and goes down into marked blocks, so only the 16-point blocks with a NaN are scanned. Columns of 32 points or fewer are scanned. When more than a quarter of the 16-point blocks hold a NaN, the pyramid is skipped and the scan is used.

### Unsorted x

The worker checks once whether x is ascending, ignoring NaN. On sorted data this is a full pass (21 ms in Chrome, 7.2 ms in WebKit, 6.4 ms native). On unsorted data it stops at the first descent. For unsorted x, the binary search and the pyramid do not apply, and every request scans all 10 million points at every zoom. The result is the per-column envelope (min and max), with "first" and "last" the lowest and highest index in the column. A point outside the view is kept when the segment to its neighbor in index order crosses the view; points with NaN x are skipped. This is right for markers. For a line it is not: the line visits columns in index order and goes back and forth, so the connections between columns are lost. The envelope of a random walk in x also spans most of the height in every column, which makes the Canvas 2D stroke expensive in Chrome. Lines with unsorted x need another method (all points as a WebGL line strip, or decimation in index order).

### Marker x precision

The shader computes the clip-space x of each point. The page reads it back with transform feedback (`v_clip`, the same value as `gl_Position.x`) and compares it with the position computed in f64 on the CPU. It also draws the points of the small views as 1 px points and checks which pixel columns are lit.

- **Fixed point** (`fixed`): q = round((x − origin) / step) with step = span / 2^40. q is sent as two int32 words, q = hi × 2^30 + lo with 0 ≤ lo < 2^30. The shader subtracts the words of the view's x0 as integers, then converts to float. When the high words differ by at most 1, it forms the difference as one int32 first, so the low word is never rounded on its own. q is clamped to ±2^53, so views up to about 8,000 data spans wide work. The view's x0 is rounded to a whole step (span / 2^40, about 9e-9 here). This causes most of the remaining error.
- **f32 x** (`naive`): x at 1e6 has an f32 spacing of 0.0625.
- **One offset** (`offset`): f32(x − origin), with the subtraction in f64. x − origin goes up to 1e4, where the f32 spacing is 9.8e-4 (about one point step), so it fails in the middle and at the end of the trace.
- **hi/lo pair** (`hilo`): hi = f32(x), lo = f32(x − hi); the shader computes (hi − x0hi) + (lo − x0lo). Its result is exactly the result of f32 x, in both browsers. The lo attribute does reach the GPU: drawn alone, its largest value matches the CPU. The shader compilers regroup the sum as (hi + lo) − (x0hi + x0lo), and hi + lo rounds back to hi.
- **Log x.** log(x) computed on the GPU in f32 loses the small steps with any of these schemes. The worker must compute log(x) in f64 and send the points again when log x is turned on or off. That costs about one upload (see the upload table).

## Results

### Browsers

| Browser | Version | WebGL renderer | Timer step (µs) |
| --- | --- | --- | --- |
| chrome | 155.0.8059.79 | ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version) | 10 |
| webkit | 27.2 | Apple GPU | 20 |

### Data, sorted check, and pyramid (in the worker, ms)

| Run | Make 10M points | Sorted check (sorted x) | Sorted check (unsorted x) | Pyramid build | Pyramid size (MB) | Levels |
| --- | --- | --- | --- | --- | --- | --- |
| chrome | 366 | 21.2 | 0.00 | 78 | 30.0 | 21 |
| webkit | 184 | 7.2 | 0.00 | 32 | 30.0 | 21 |
| native | 98 | 6.4 | 0.00 | 16 | 30.0 | 21 |

### Decimation time (ms, median / p95, 3200 columns; browsers 20 runs, native 30 runs)

| Run | View | Points out | Scan | Pyramid | Scan, simd128 build | Unsorted x, full scan |
| --- | --- | --- | --- | --- | --- | --- |
| chrome | full | 12635 | 53.20 / 58.28 | 3.31 / 5.32 | 53.22 / 59.49 | 51.23 / 52.20 |
| chrome | 10% | 12366 | 6.10 / 6.40 | 1.14 / 1.28 | 6.07 / 6.20 | 17.88 / 18.18 |
| chrome | 1% | 11511 | 0.88 / 0.96 | 0.66 / 0.94 | 0.88 / 0.89 | 12.13 / 12.63 |
| chrome | 0.01% | 991 | 0.02 / 0.02 | 0.02 / 0.03 | 0.02 / 0.02 | 11.43 / 11.61 |
| webkit | full | 12635 | 40.26 / 42.48 | 2.84 / 5.32 | 40.26 / 41.28 | 43.04 / 45.08 |
| webkit | 10% | 12366 | 4.92 / 5.04 | 1.00 / 1.30 | 5.00 / 5.16 | 16.90 / 17.34 |
| webkit | 1% | 11511 | 0.76 / 0.84 | 0.66 / 0.68 | 0.76 / 0.86 | 11.96 / 12.36 |
| webkit | 0.01% | 991 | 0.02 / 0.02 | 0.02 / 0.02 | 0.02 / 0.02 | 11.12 / 11.28 |
| native | full | 12635 | 31.91 / 32.70 | 2.56 / 2.85 | - | 35.03 / 36.06 |
| native | 10% | 12366 | 3.78 / 3.81 | 0.99 / 1.06 | - | 15.07 / 15.42 |
| native | 1% | 11511 | 0.56 / 0.57 | 0.59 / 0.60 | - | 11.79 / 12.10 |
| native | 0.01% | 991 | 0.01 / 0.01 | 0.01 / 0.01 | - | 11.05 / 11.22 |

### NaN-dense data, full view (ms, median / p95)

| Run | NaN in y | Points out | Scan | Pyramid |
| --- | --- | --- | --- | --- |
| chrome | every 1000 points | 37254 | 56.93 / 64.42 | 7.30 / 9.40 |
| chrome | every 100 points | 35185 | 69.80 / 71.58 | 23.47 / 24.38 |
| chrome | every 10 points | 27830 | 95.80 / 102.24 | 95.75 / 104.63 |
| webkit | every 1000 points | 37254 | 44.36 / 46.00 | 6.64 / 9.62 |
| webkit | every 100 points | 35185 | 58.98 / 60.76 | 21.62 / 22.46 |
| webkit | every 10 points | 27830 | 86.40 / 88.28 | 87.00 / 90.22 |
| native | every 1000 points | 37254 | 34.69 / 35.53 | 5.92 / 7.57 |
| native | every 100 points | 35185 | 45.16 / 46.16 | 21.25 / 21.88 |
| native | every 10 points | 27830 | 69.21 / 71.14 | 69.31 / 71.91 |

### Canvas 2D redraw of one decimated trace (ms, median / p95 of 30 runs)

| Browser | Trace | Points | Path + stroke call | With the stroke rasterized |
| --- | --- | --- | --- | --- |
| chrome | sorted x (test trace) | 12635 | 0.17 / 0.19 | 2.79 / 5.81 |
| chrome | unsorted x (tall columns) | 13804 | 0.17 / 0.18 | 13.72 / 14.32 |
| webkit | sorted x (test trace) | 12635 | 0.52 / 0.56 | 2.26 / 2.82 |
| webkit | unsorted x (tall columns) | 13804 | 0.52 / 0.54 | 2.28 / 2.82 |

### Zoom and pan, 9.5 s scripted, 6 stops (ms, median / p95 per frame)

| Browser | Strategy | Method | Frames | Dropped | Main-thread work | Picture age | Data age | Stop to exact figure (6 stops) | Longest frame (ms, at s) | Late replies | Round trip | Worker decimation | Layer flush |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chrome | every-frame | scan | 571 | 0 | 0.73 / 1.70 | 16.7 / 66.7 | 16.7 / 66.7 | 12, 11, 9, 10, 17, 88 | 17 at 0.03 | 0 | 2.0 / 25.4 | 1.0 / 25.2 | 0.9 / 1.5 |
| chrome | every-frame | pyramid | 571 | 0 | 0.98 / 1.79 | 16.7 / 16.7 | 16.7 / 16.7 | 11, 11, 15, 13, 15, 16 | 17 at 4.50 | 0 | 2.4 / 6.0 | 1.0 / 5.2 | 1.0 / 1.7 |
| chrome | transform | scan | 571 | 0 | 0.05 / 0.11 | 0.0 / 0.0 | 733.3 / 1449.9 | 28, 32, 29, 28, 38, 85 | 17 at 0.28 | 0 | 3.3 / 57.3 | 2.6 / 56.8 | 1.5 / 1.6 |
| chrome | transform | pyramid | 571 | 0 | 0.05 / 0.12 | 0.0 / 0.0 | 716.6 / 1433.3 | 32, 31, 28, 29, 34, 35 | 17 at 1.98 | 0 | 4.3 / 7.8 | 3.2 / 7.1 | 1.5 / 2.2 |
| chrome | hybrid | scan | 571 | 0 | 0.77 / 1.69 | 0.0 / 0.0 | 16.7 / 66.7 | 16, 11, 13, 10, 17, 101 | 17 at 0.07 | 37 | 2.6 / 24.9 | 1.1 / 24.7 | 0.9 / 1.5 |
| chrome | hybrid | pyramid | 571 | 0 | 0.93 / 1.77 | 0.0 / 0.0 | 16.7 / 16.7 | 11, 16, 10, 10, 12, 15 | 17 at 0.22 | 0 | 1.7 / 5.4 | 0.8 / 5.0 | 1.0 / 1.9 |
| chrome | hybrid | unsorted full scan | 392 | 179 | 3.87 / 57.72 | 0.0 / 0.0 | 16.7 / 116.7 | 197, 200, 25, 24, 212, 111 | 100 at 2.15 | 130 | 25.2 / 59.3 | 11.5 / 38.4 | 19.3 / 58.5 |
| webkit | every-frame | scan | 571 | 1 | 0.50 / 1.36 | 16.6 / 50.0 | 16.6 / 50.0 | 22, 2, 1, 19, 6, 78 | 28 at 2.66 | 0 | 1.7 / 21.7 | 0.9 / 21.5 | 0.0 / 0.0 |
| webkit | every-frame | pyramid | 570 | 0 | 0.54 / 1.70 | 16.2 / 18.6 | 16.2 / 18.6 | 14, 12, 12, 11, 12, 14 | 23 at 7.17 | 0 | 2.0 / 4.8 | 1.1 / 4.5 | 0.0 / 0.0 |
| webkit | transform | scan | 571 | 0 | 0.04 / 0.14 | 0.0 / 0.0 | 733.2 / 1434.2 | 27, 28, 27, 26, 36, 68 | 23 at 3.54 | 0 | 1.1 / 41.5 | 0.8 / 41.0 | 0.0 / 0.0 |
| webkit | transform | pyramid | 571 | 0 | 0.06 / 0.10 | 0.0 / 0.0 | 717.7 / 1433.6 | 30, 29, 25, 25, 31, 31 | 22 at 4.14 | 0 | 2.9 / 5.1 | 2.5 / 4.6 | 0.0 / 0.1 |
| webkit | hybrid | scan | 571 | 0 | 0.52 / 1.52 | 0.0 / 0.0 | 16.6 / 49.9 | 19, 19, 14, 14, 19, 72 | 24 at 6.06 | 30 | 2.7 / 22.0 | 1.7 / 21.7 | 0.0 / 0.1 |
| webkit | hybrid | pyramid | 570 | 0 | 0.56 / 1.90 | 0.0 / 0.0 | 16.5 / 17.8 | 14, 10, 9, 11, 13, 15 | 22 at 1.21 | 0 | 2.7 / 4.9 | 1.8 / 4.4 | 0.0 / 0.0 |
| webkit | hybrid | unsorted full scan | 571 | 0 | 0.24 / 0.88 | 0.0 / 0.0 | 16.7 / 66.6 | 19, 19, 18, 18, 22, 72 | 18 at 9.27 | 72 | 12.2 / 27.1 | 11.9 / 26.8 | 0.0 / 0.0 |

### WebGL markers, 10 million points as gl.POINTS (fixed-point x)

| Browser | GPU data (MB) | Chunks | Upload wall (ms) | Build in wasm (ms) | Copy out (ms) | bufferSubData (ms) | wasm memory before / after (MB) | First draw (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chrome | 120 | 10 | 70 | 44 | 11 | 12 | 191 / 204 | 30 |
| webkit | 120 | 10 | 59 | 37 | 7 | 12 | 191 / 204 | 25 |

| Browser | View | Draw + GPU sync (ms, median / p95 of 30) |
| --- | --- | --- |
| chrome | full | 4.86 / 5.16 |
| chrome | 10% | 1.99 / 2.67 |
| chrome | 1% | 1.66 / 2.38 |
| chrome | 0.01% | 1.66 / 1.98 |
| webkit | full | 4.78 / 5.06 |
| webkit | 10% | 1.80 / 2.32 |
| webkit | 1% | 1.44 / 1.48 |
| webkit | 0.01% | 1.42 / 1.46 |

| Browser | Frames | Dropped | Frame interval (ms) | Longest frame (ms, at s) | Main-thread work (ms) |
| --- | --- | --- | --- | --- | --- |
| chrome | 551 | 20 | 16.7 / 16.7 | 350 at 0.35 | 0.04 / 0.08 |
| webkit | 570 | 0 | 16.7 / 17.6 | 21 at 3.14 | 0.06 / 0.12 |

### x precision against f64 (GPU positions read back with transform feedback)

| Browser | x mode | View | Points | Max error (px) | Mean error (px) | Wrong columns | Raster: missing / extra |
| --- | --- | --- | --- | --- | --- | --- | --- |
| chrome | fixed | start, 64 points | 67 | 3.8e-4 | 1.4e-4 | 0 | 0 / 0 |
| chrome | fixed | middle, 64 points | 69 | 4.6e-4 | 1.9e-4 | 0 | 0 / 0 |
| chrome | fixed | end, 64 points | 69 | 4.3e-4 | 1.7e-4 | 0 | 0 / 0 |
| chrome | fixed | middle, 8 points | 10 | 2.7e-3 | 1.1e-3 | 0 | 0 / 0 |
| chrome | fixed | end, 8 points | 10 | 3.2e-3 | 1.7e-3 | 0 | 0 / 0 |
| chrome | fixed | end, 1% of the span | 99967 | 2.5e-4 | 5.1e-5 | 0 | - |
| chrome | naive | start, 64 points | 67 | 3058.95 | 1454.76 | 67 | 62 / 1 |
| chrome | naive | middle, 64 points | 69 | 2999.00 | 1359.34 | 68 | 65 / 0 |
| chrome | naive | end, 64 points | 69 | 3034.01 | 1407.76 | 68 | 59 / 1 |
| chrome | naive | middle, 8 points | 10 | 3386.87 | 1660.80 | 10 | 8 / 0 |
| chrome | naive | end, 8 points | 10 | 3466.45 | 1671.68 | 10 | 8 / 0 |
| chrome | naive | end, 1% of the span | 99967 | 1.18 | 0.52 | 53237 | - |
| chrome | offset | start, 64 points | 67 | 4.0e-3 | 1.4e-3 | 0 | 0 / 0 |
| chrome | offset | middle, 64 points | 69 | 22.35 | 9.16 | 64 | 62 / 63 |
| chrome | offset | end, 64 points | 69 | 35.78 | 13.81 | 68 | 59 / 61 |
| chrome | offset | middle, 8 points | 10 | 135.83 | 70.79 | 10 | 8 / 7 |
| chrome | offset | end, 8 points | 10 | 252.66 | 136.53 | 10 | 8 / 8 |
| chrome | offset | end, 1% of the span | 99967 | 0.02 | 8.2e-3 | 675 | - |
| chrome | hilo | start, 64 points | 67 | 3058.95 | 1454.76 | 67 | 62 / 1 |
| chrome | hilo | middle, 64 points | 69 | 2999.00 | 1359.34 | 68 | 65 / 0 |
| chrome | hilo | end, 64 points | 69 | 3034.01 | 1407.76 | 68 | 59 / 1 |
| chrome | hilo | middle, 8 points | 10 | 3386.87 | 1660.80 | 10 | 8 / 0 |
| chrome | hilo | end, 8 points | 10 | 3466.45 | 1671.68 | 10 | 8 / 0 |
| chrome | hilo | end, 1% of the span | 99967 | 1.18 | 0.52 | 53237 | - |
| webkit | fixed | start, 64 points | 67 | 3.8e-4 | 1.4e-4 | 0 | 0 / 0 |
| webkit | fixed | middle, 64 points | 69 | 4.6e-4 | 1.9e-4 | 0 | 0 / 0 |
| webkit | fixed | end, 64 points | 69 | 4.3e-4 | 1.7e-4 | 0 | 0 / 0 |
| webkit | fixed | middle, 8 points | 10 | 2.7e-3 | 1.1e-3 | 0 | 0 / 0 |
| webkit | fixed | end, 8 points | 10 | 3.2e-3 | 1.7e-3 | 0 | 0 / 0 |
| webkit | fixed | end, 1% of the span | 99967 | 2.5e-4 | 5.1e-5 | 0 | - |
| webkit | naive | start, 64 points | 67 | 3058.95 | 1454.76 | 67 | 62 / 1 |
| webkit | naive | middle, 64 points | 69 | 2999.00 | 1359.34 | 68 | 65 / 0 |
| webkit | naive | end, 64 points | 69 | 3034.01 | 1407.76 | 68 | 59 / 1 |
| webkit | naive | middle, 8 points | 10 | 3386.87 | 1660.80 | 10 | 8 / 0 |
| webkit | naive | end, 8 points | 10 | 3466.45 | 1671.68 | 10 | 8 / 0 |
| webkit | naive | end, 1% of the span | 99967 | 1.18 | 0.52 | 53237 | - |
| webkit | offset | start, 64 points | 67 | 4.0e-3 | 1.4e-3 | 0 | 0 / 0 |
| webkit | offset | middle, 64 points | 69 | 22.35 | 9.16 | 64 | 62 / 63 |
| webkit | offset | end, 64 points | 69 | 35.78 | 13.81 | 68 | 59 / 61 |
| webkit | offset | middle, 8 points | 10 | 135.83 | 70.79 | 10 | 8 / 7 |
| webkit | offset | end, 8 points | 10 | 252.66 | 136.53 | 10 | 8 / 8 |
| webkit | offset | end, 1% of the span | 99967 | 0.02 | 8.2e-3 | 675 | - |
| webkit | hilo | start, 64 points | 67 | 3058.95 | 1454.76 | 67 | 62 / 1 |
| webkit | hilo | middle, 64 points | 69 | 2999.00 | 1359.34 | 68 | 65 / 0 |
| webkit | hilo | end, 64 points | 69 | 3034.01 | 1407.76 | 68 | 59 / 1 |
| webkit | hilo | middle, 8 points | 10 | 3386.87 | 1660.80 | 10 | 8 / 0 |
| webkit | hilo | end, 8 points | 10 | 3466.45 | 1671.68 | 10 | 8 / 0 |
| webkit | hilo | end, 1% of the span | 99967 | 1.18 | 0.52 | 53237 | - |

| Browser | View | Max |lo| on the CPU | Max |lo| read back from the GPU |
| --- | --- | --- | --- |
| chrome | middle, 64 points | 3.101e-2 | 3.101e-2 |
| webkit | middle, 64 points | 3.101e-2 | 3.101e-2 |

### Reading the tables

- "median / p95" is per run (decimation, draw) or per frame (interaction). With fewer than 20 samples, the p95 is the largest value. "Dropped" counts frame intervals longer than 1.5 nominal frames, as extra frames. "Longest frame" is the longest frame interval and the script time when it ended.
- Headless frame intervals come from a synthetic 60 Hz clock, not from a display. They show main-thread stalls, but not when a frame is really shown.
- "Picture age" is the time since the geometry on screen matched the view. It is 0 when the screen shows the current view, as the exact figure or as the last image moved to it. "Data age" is the same for the decimated data behind the picture. In the transform strategy the data is only refreshed at a stop, so it is up to 1.4 s old during the moves.
- "Stop to exact figure" runs from the scripted stop to the end of the exact draw, for the six stops. Each stop is half a frame off the frame grid, so the first frame after it comes about 8 ms later. In Chrome, frame callbacks may run later than their timestamps. The time until the browser shows the next frame is not included. The last stop is at the full view, where the scan is slowest.
- "Late replies" counts replies that arrived after the view had moved on. They were drawn moved to the current view.
- "Layer flush" is the copy of the off-screen canvas to the screen after an exact draw. In Chrome this waits for the stroke to be rasterized. In WebKit it does not block.
- The decimation views are centered at 37 % of the span. The 1 % view holds one of the single NaN points.
- In Chrome, the WebGL run dropped its frames in one stall of 350 ms right after the upload, and none after it.
- The precision table is identical in both browsers, bit for bit, for every mode.

## Limits

- Headless browsers. Chrome used the real GPU through ANGLE Metal. The numbers in a real browser window may differ.
- One machine, with normal desktop apps open (load average about 8–10). An earlier run with other builds running gave similar medians; p95 values move the most.
- The scripted movement changes the view every frame. Real wheel and drag input comes in bursts, which is easier. The transform strategy detects a stop as one frame without movement; a real wheel zoom needs a timeout.
- The 2D draw has no axes, ticks, or text. Each reply in the product goes through the render module (layout and draw data), which is not part of this experiment.
- One trace. Several traces multiply the decimation and stroke costs; the pyramid cost per trace is the same.
- The pyramid holds f64 min and max and u32 indices (24 bytes per block of 16 points). M4 needs the indices for the order of the min and max points.
- The page sends COOP, COEP, and CORP headers only for finer timers. Nothing measured depends on cross-origin isolation, but GitHub Pages cannot send these headers. Keeping one worker for all data sets is partly a workaround for WebKit under COEP.
- Firefox was not measured. It does not use ANGLE Metal, so its shader compiler may treat the float schemes differently. The fixed-point scheme does not depend on that, because integer arithmetic is exact.
- The WebGL marker test draws 2 × 2 pixel points without blending. Larger or blended markers cost more fill.
- The per-chunk-origin fallback for marker x was not built.
