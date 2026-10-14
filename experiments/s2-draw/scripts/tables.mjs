// Prints the README result tables (Markdown) from results/*.json.
// Usage: node scripts/tables.mjs [chrome webkit ...]
// results/native.json (from `cargo run --release --bin bench`) is added when
// it exists.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const names = process.argv.length > 2 ? process.argv.slice(2) : ["chrome", "webkit"];
const read = (n) => JSON.parse(readFileSync(join(root, "results", `${n}.json`), "utf8"));
const runs = names.map((n) => ({ name: n, r: read(n) }));
const native = existsSync(join(root, "results", "native.json")) ? read("native") : null;

const ms = (s, d = 1) => (s && Number.isFinite(s.median) ? `${s.median.toFixed(d)} / ${s.p95.toFixed(d)}` : "-");
const t = (x, d = 2) => (x ? `${x.medianMs.toFixed(d)} / ${x.p95Ms.toFixed(d)}` : "-");
const row = (cells) => `| ${cells.join(" | ")} |`;
const head = (cells) => `${row(cells)}\n${row(cells.map(() => "---"))}`;
const mb = (b) => (b / 1e6).toFixed(0);

console.log("### Browsers\n");
console.log(head(["Browser", "Version", "WebGL renderer", "Timer step (µs)"]));
for (const { name, r } of runs) {
  console.log(row([name, r.browserVersion, r.gl.renderer.renderer, r.timerResolutionUs]));
}

console.log("\n### Data, sorted check, and pyramid (in the worker, ms)\n");
console.log(
  head(["Run", "Make 10M points", "Sorted check (sorted x)", "Sorted check (unsorted x)", "Pyramid build", "Pyramid size (MB)", "Levels"]),
);
for (const { name, r } of runs) {
  const d = r.data;
  console.log(
    row([
      name,
      d.makeMs.toFixed(0),
      d.checkSortedMs.toFixed(1),
      r.dataUnsorted.checkSortedMs.toFixed(2),
      d.pyramidBuildMs.toFixed(0),
      (d.pyramidBytes / 1e6).toFixed(1),
      d.pyramidLevels,
    ]),
  );
}
if (native) {
  console.log(
    row([
      "native",
      native.make_ms.toFixed(0),
      native.check_sorted_ms.median.toFixed(1),
      native.check_sorted_unsorted_ms.median.toFixed(2),
      native.pyramid_build_ms.median.toFixed(0),
      (native.pyramid_bytes / 1e6).toFixed(1),
      "21",
    ]),
  );
}

console.log("\n### Decimation time (ms, median / p95, 3200 columns; browsers 20 runs, native 30 runs)\n");
console.log(head(["Run", "View", "Points out", "Scan", "Pyramid", "Scan, simd128 build", "Unsorted x, full scan"]));
for (const { name, r } of runs) {
  for (const v of ["full", "10%", "1%", "0.01%"]) {
    const get = (list, m) => list.find((x) => x.view === v && x.method === m);
    const a = get(r.decimate, "scan");
    console.log(
      row([
        name,
        v,
        a?.points ?? "-",
        t(a),
        t(get(r.decimate, "pyramid")),
        t(get(r.decimateSimd, "scan")),
        t(get(r.decimateUnsorted, "unsorted full scan")),
      ]),
    );
  }
}
if (native) {
  const f = (s) => `${s.median.toFixed(2)} / ${s.p95.toFixed(2)}`;
  for (const c of native.cases.filter((c) => c.data === "test trace")) {
    const u = native.unsorted_full_scan.find((x) => x.view === c.view);
    console.log(row(["native", c.view, c.points, f(c.scan_ms), f(c.pyramid_ms), "-", u ? f(u.ms) : "-"]));
  }
}

console.log("\n### NaN-dense data, full view (ms, median / p95)\n");
console.log(head(["Run", "NaN in y", "Points out", "Scan", "Pyramid"]));
for (const { name, r } of runs) {
  for (const d of r.decimateNanDense) {
    const get = (m) => d.results.find((x) => x.view === "full" && x.method === m);
    console.log(row([name, `every ${d.nanEvery} points`, get("scan")?.points ?? "-", t(get("scan")), t(get("pyramid"))]));
  }
}
if (native) {
  const f = (s) => `${s.median.toFixed(2)} / ${s.p95.toFixed(2)}`;
  for (const c of native.cases.filter((c) => c.data !== "test trace")) {
    console.log(row(["native", c.data.replace("NaN ", ""), c.points, f(c.scan_ms), f(c.pyramid_ms)]));
  }
}

console.log("\n### Canvas 2D redraw of one decimated trace (ms, median / p95 of 30 runs)\n");
console.log(head(["Browser", "Trace", "Points", "Path + stroke call", "With the stroke rasterized"]));
for (const { name, r } of runs) {
  console.log(row([name, "sorted x (test trace)", r.draw2d.points, ms(r.draw2d.pathMs, 2), ms(r.draw2d.pathAndFlushMs, 2)]));
  console.log(
    row([name, "unsorted x (tall columns)", r.draw2dUnsorted.points, ms(r.draw2dUnsorted.pathMs, 2), ms(r.draw2dUnsorted.pathAndFlushMs, 2)]),
  );
}

console.log("\n### Zoom and pan, 9.5 s scripted, 6 stops (ms, median / p95 per frame)\n");
console.log(
  head([
    "Browser",
    "Strategy",
    "Method",
    "Frames",
    "Dropped",
    "Main-thread work",
    "Picture age",
    "Data age",
    "Stop to exact figure (6 stops)",
    "Longest frame (ms, at s)",
    "Late replies",
    "Round trip",
    "Worker decimation",
    "Layer flush",
  ]),
);
for (const { name, r } of runs) {
  for (const i of r.interaction) {
    console.log(
      row([
        name,
        i.strategy,
        i.method,
        i.frames,
        i.droppedFrames,
        ms(i.mainThreadWorkMs, 2),
        ms(i.imageAgeMs),
        ms(i.dataAgeMs),
        i.stopLatencyMs.map((x) => (Number.isFinite(x) ? x.toFixed(0) : "-")).join(", "),
        `${i.longestFrame.ms.toFixed(0)} at ${i.longestFrame.at.toFixed(2)}`,
        i.lateReplies,
        ms(i.roundTripMs),
        ms(i.decimateMs),
        ms(i.layerFlushMs),
      ]),
    );
  }
}

console.log("\n### WebGL markers, 10 million points as gl.POINTS (fixed-point x)\n");
console.log(
  head([
    "Browser",
    "GPU data (MB)",
    "Chunks",
    "Upload wall (ms)",
    "Build in wasm (ms)",
    "Copy out (ms)",
    "bufferSubData (ms)",
    "wasm memory before / after (MB)",
    "First draw (ms)",
  ]),
);
for (const { name, r } of runs) {
  const g = r.gl;
  const u = g.upload;
  console.log(
    row([
      name,
      mb(u.bytes),
      u.chunks,
      u.wallMs.toFixed(0),
      u.buildMs.toFixed(0),
      u.copyMs.toFixed(0),
      u.bufferSubDataMs.toFixed(0),
      `${mb(g.wasmMemoryBefore)} / ${mb(u.wasmMemoryAfter)}`,
      g.firstDrawSyncMs.toFixed(0),
    ]),
  );
}
console.log("");
console.log(head(["Browser", "View", "Draw + GPU sync (ms, median / p95 of 30)"]));
for (const { name, r } of runs) {
  for (const v of r.gl.drawSyncByView) console.log(row([name, v.view, ms(v.ms, 2)]));
}
console.log("");
console.log(head(["Browser", "Frames", "Dropped", "Frame interval (ms)", "Longest frame (ms, at s)", "Main-thread work (ms)"]));
for (const { name, r } of runs) {
  const g = r.gl;
  const l = `${g.longestFrame.ms.toFixed(0)} at ${g.longestFrame.at.toFixed(2)}`;
  console.log(row([name, g.frames, g.droppedFrames, ms(g.frameInterval), l, ms(g.mainThreadWorkMs, 2)]));
}

console.log("\n### x precision against f64 (GPU positions read back with transform feedback)\n");
console.log(
  head(["Browser", "x mode", "View", "Points", "Max error (px)", "Mean error (px)", "Wrong columns", "Raster: missing / extra"]),
);
for (const { name, r } of runs) {
  for (const p of r.precision) {
    console.log(
      row([
        name,
        p.mode,
        p.view,
        p.points,
        p.maxErrorPx < 0.01 ? p.maxErrorPx.toExponential(1) : p.maxErrorPx.toFixed(2),
        p.meanErrorPx < 0.01 ? p.meanErrorPx.toExponential(1) : p.meanErrorPx.toFixed(2),
        p.wrongColumns,
        p.rasterMissing === null ? "-" : `${p.rasterMissing} / ${p.rasterExtra}`,
      ]),
    );
  }
}
console.log("");
console.log(head(["Browser", "View", "Max |lo| on the CPU", "Max |lo| read back from the GPU"]));
for (const { name, r } of runs) {
  console.log(row([name, r.hiloLo.view, r.hiloLo.maxLoCpu.toExponential(3), r.hiloLo.maxLoGpu.toExponential(3)]));
}
