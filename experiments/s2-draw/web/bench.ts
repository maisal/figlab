// The measurements. Each function returns plain JSON for scripts/measure.mjs.

import { GlMarkers, type GlMode } from "./gl";
import { Plot2D } from "./plot2d";
import type { DataInfo, DecimateTiming, FromWorker, GpuKind, Method, ToWorker } from "./protocol";
import { stats } from "./protocol";
import { type Bounds, SCRIPT_SECONDS, STOP_TIMES, type View, WIDTH, fullView, sameView, scriptedView } from "./view";

export type Strategy = "every-frame" | "transform" | "hybrid";

export interface LoadOptions {
  simd: boolean;
  sorted: boolean;
  n: number;
  pyramidBase: number;
  nanEvery: number;
}

type Decimated = Extract<FromWorker, { type: "decimated" }>;
type Stats = ReturnType<typeof stats>;

/// The main-thread side of the worker. At most one decimation request is in
/// flight. A request made while one is in flight replaces the pending one
/// (latest wins), so the queue never grows when the worker is slower than
/// the frame rate.
export class Client {
  private worker: Worker;
  private seq = 0;
  private inFlight = false;
  private pending: ToWorker | null = null;
  private lastApplied = -1;
  private waiters = new Map<string, (msg: FromWorker) => void>();
  onDecimated: ((msg: Decimated, sentAt: number) => void) | null = null;
  private sentAt = new Map<number, number>();

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
  }

  private receive(msg: FromWorker): void {
    if (msg.type === "decimated") {
      this.inFlight = false;
      const sent = this.sentAt.get(msg.seq) ?? performance.now();
      this.sentAt.delete(msg.seq);
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        this.send(p);
      }
      // A reply older than the last applied one is dropped (out of order
      // cannot happen with one worker, but the check costs nothing).
      if (msg.seq < this.lastApplied) return;
      this.lastApplied = msg.seq;
      this.onDecimated?.(msg, sent);
      return;
    }
    const w = this.waiters.get(msg.type);
    if (w) {
      this.waiters.delete(msg.type);
      w(msg);
    }
  }

  private send(msg: ToWorker): void {
    if (msg.type === "decimate") {
      this.inFlight = true;
      this.sentAt.set(msg.seq, performance.now());
    }
    this.worker.postMessage(msg);
  }

  /// Asks for a decimation of [x0, x1]. Coalesced: latest wins.
  requestDecimate(view: View, method: Method, viewTime: number): void {
    const msg: ToWorker = {
      type: "decimate",
      seq: ++this.seq,
      method,
      x0: view.x0,
      x1: view.x1,
      width: WIDTH,
      viewTime,
    };
    if (this.inFlight) this.pending = msg;
    else this.send(msg);
  }

  /// Sends a request and waits for the reply of the same type. One call at
  /// a time per reply type.
  call<T extends FromWorker["type"]>(msg: ToWorker, reply: T): Promise<Extract<FromWorker, { type: T }>> {
    return new Promise((resolve) => {
      this.waiters.set(reply, (m) => resolve(m as Extract<FromWorker, { type: T }>));
      this.send(msg);
    });
  }
}

export interface Session {
  client: Client;
  info: DataInfo;
  bounds: Bounds;
  plot: Plot2D;
  gl: GlMarkers | null;
  glUploaded: boolean;
}

export async function load(canvas2d: HTMLCanvasElement, opts: LoadOptions, old: Session | null): Promise<Session> {
  // One worker for the whole session, re-initialized for each data set, as
  // the compute worker in the app. (WebKit also refuses a second `new Worker`
  // with the same URL under Cross-Origin-Embedder-Policy.)
  const client = old?.client ?? new Client();
  const { info } = await client.call({ type: "init", ...opts }, "ready");
  const bounds = { xMin: info.xMin, xMax: info.xMax, yMin: info.yMin, yMax: info.yMax };
  const plot = old?.plot ?? new Plot2D(canvas2d);
  plot.clear();
  return { client, info, bounds, plot, gl: old?.gl ?? null, glUploaded: false };
}

/// The views of the decimation and marker timing (also in src/bin/bench.rs):
/// the full view and views centered at 37% of the span.
function views(b: Bounds): { name: string; x0: number; x1: number }[] {
  const span = b.xMax - b.xMin;
  const c = b.xMin + span * 0.37;
  return [
    { name: "full", x0: b.xMin, x1: b.xMax },
    { name: "10%", x0: c - span * 0.05, x1: c + span * 0.05 },
    { name: "1%", x0: c - span * 0.005, x1: c + span * 0.005 },
    { name: "0.01%", x0: c - span * 0.00005, x1: c + span * 0.00005 },
  ];
}

/// Decimation time in the worker for the full view and zoomed views.
export async function benchDecimate(s: Session, runs = 20, only?: string[]): Promise<DecimateTiming[]> {
  const vs = views(s.bounds).filter((v) => !only || only.includes(v.name));
  const r = await s.client.call({ type: "bench-decimate", views: vs, width: WIDTH, runs }, "bench-decimate");
  return r.results;
}

/// The time to draw one decimated trace on Canvas 2D (path + stroke).
export async function benchDraw2d(
  s: Session,
  runs = 30,
): Promise<{ points: number; pathMs: Stats; pathAndFlushMs: Stats }> {
  const v = fullView(s.bounds);
  const got = await new Promise<Decimated>((resolve) => {
    s.client.onDecimated = (m) => resolve(m);
    s.client.requestDecimate(v, s.info.sorted ? 1 : 2, 0);
  });
  s.client.onDecimated = null;
  const times: number[] = [];
  const flushed: number[] = [];
  // Two warm-up draws: the first stroke on a fresh canvas is much slower.
  for (let i = 0; i < 2; i++) {
    s.plot.drawExact(got.points, v);
    s.plot.flush();
  }
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const r = s.plot.drawExact(got.points, v);
    times.push(r.pathMs);
    // Canvas 2D work is deferred; reading one pixel back forces it to finish.
    s.plot.flush();
    flushed.push(performance.now() - t0);
  }
  return { points: got.points.length / 2, pathMs: stats(times), pathAndFlushMs: stats(flushed) };
}

function nextFrame(): Promise<number> {
  return new Promise((r) => requestAnimationFrame(r));
}

/// The longest frame interval and the script time (s) of the frame that ended it.
export interface Longest {
  ms: number;
  at: number;
}

function countDropped(intervals: number[], times: number[]): { nominal: number; dropped: number; longest: Longest } {
  const nominal = stats(intervals).median;
  let dropped = 0;
  let longest: Longest = { ms: 0, at: 0 };
  intervals.forEach((d, i) => {
    dropped += Math.max(0, Math.round(d / nominal) - 1);
    if (d > longest.ms) longest = { ms: d, at: times[i] ?? 0 };
  });
  return { nominal, dropped, longest };
}

export interface InteractionResult {
  strategy: Strategy;
  method: string;
  frames: number;
  seconds: number;
  nominalFrameMs: number;
  frameInterval: Stats;
  droppedFrames: number;
  longestFrame: Longest;
  mainThreadWorkMs: Stats;
  /// Age of the picture on screen: the time since the geometry on screen
  /// matched the view. 0 when the screen shows the current view (exact, or
  /// the last image moved to it).
  imageAgeMs: Stats;
  /// Age of the decimated data behind the picture.
  dataAgeMs: Stats;
  /// From each scripted stop to the exact figure drawn for it.
  stopLatencyMs: number[];
  stopLatency: Stats;
  /// Round trip of a decimation request (main thread to main thread).
  roundTripMs: Stats;
  /// Decimation time inside the worker.
  decimateMs: Stats;
  /// Canvas 2D path + stroke of an exact draw.
  exactDrawMs: Stats;
  /// Copy of the layer to the screen after an exact draw. This waits for the
  /// deferred stroke to be rasterized, so it holds the real cost of the stroke.
  layerFlushMs: Stats;
  /// drawImage with a transform.
  transformDrawMs: Stats;
  /// Replies that arrived after the view had moved on, drawn moved to the
  /// current view.
  lateReplies: number;
  requests: number;
}

/// Runs the scripted zoom and pan with one redraw strategy.
export async function runInteraction(s: Session, strategy: Strategy, method: Method): Promise<InteractionResult> {
  const { client, plot, bounds } = s;
  const full = fullView(bounds);
  // Start from an exact picture of the full view.
  await new Promise<void>((resolve) => {
    client.onDecimated = (m) => {
      plot.drawExact(m.points, { ...full, x0: m.x0, x1: m.x1 });
      resolve();
    };
    client.requestDecimate(full, method, 0);
  });

  const intervals: number[] = [];
  const frameTimes: number[] = [];
  const work: number[] = [];
  const imageAge: number[] = [];
  const dataAge: number[] = [];
  const roundTrip: number[] = [];
  const decimate: number[] = [];
  const exactDraw: number[] = [];
  const layerFlush: number[] = [];
  const transformDraw: number[] = [];
  const stopLatency: number[] = STOP_TIMES.map(() => NaN);
  let requests = 0;
  let lateReplies = 0;
  let workAcc = 0;

  // A view is identified by its time in the script. The y range in a request
  // is the one of that time.
  const viewAt = (t: number) => scriptedView(bounds, t);
  let layerTime = 0; // script time of the data in the layer
  let shownTime = 0; // script time of the geometry on screen
  let lastView: View = full;
  let lastTime = 0;
  let requestedStill = true;
  let start = 0;

  client.onDecimated = (m, sent) => {
    const t0 = performance.now();
    roundTrip.push(t0 - sent);
    decimate.push(m.decimateMs);
    requests++;
    const layerView = { ...viewAt(m.viewTime), x0: m.x0, x1: m.x1 };
    const r = plot.drawExact(m.points, layerView);
    exactDraw.push(r.pathMs);
    layerFlush.push(r.copyMs);
    layerTime = m.viewTime;
    const current = sameView(layerView, lastView);
    if (strategy === "every-frame") {
      // The screen shows the reply's own view, as it is.
      shownTime = m.viewTime;
    } else if (!current) {
      // A late reply: the view has moved since the request. Show the new
      // layer moved to the current view.
      transformDraw.push(plot.drawTransformed(lastView));
      shownTime = lastTime;
      lateReplies++;
    } else {
      shownTime = m.viewTime;
    }
    const now = performance.now();
    if (strategy === "every-frame" || current) {
      STOP_TIMES.forEach((ts, i) => {
        if (Number.isNaN(stopLatency[i]) && m.viewTime >= ts && sameView(layerView, viewAt(ts))) {
          stopLatency[i] = now - (start + ts * 1000);
        }
      });
    }
    workAcc += now - t0;
  };

  let prevTs = await nextFrame();
  start = prevTs;
  let t = 0;
  while (t < SCRIPT_SECONDS) {
    const ts = await nextFrame();
    const f0 = performance.now();
    intervals.push(ts - prevTs);
    prevTs = ts;
    t = (ts - start) / 1000;
    frameTimes.push(t);
    const view = viewAt(t);
    const moved = !sameView(view, lastView);
    switch (strategy) {
      case "every-frame":
        if (moved) client.requestDecimate(view, method, t);
        break;
      case "transform":
        if (moved) {
          transformDraw.push(plot.drawTransformed(view));
          shownTime = t;
          requestedStill = false;
        } else if (!requestedStill) {
          // The first frame without movement: ask for the exact figure once.
          client.requestDecimate(view, method, t);
          requestedStill = true;
        }
        break;
      case "hybrid":
        if (moved) {
          transformDraw.push(plot.drawTransformed(view));
          shownTime = t;
          client.requestDecimate(view, method, t);
        }
        break;
    }
    if (moved) {
      lastView = view;
      lastTime = t;
    }
    workAcc += performance.now() - f0;
    work.push(workAcc);
    workAcc = 0;
    imageAge.push(sameView(viewAt(shownTime), view) ? 0 : (t - shownTime) * 1000);
    dataAge.push(sameView(viewAt(layerTime), view) ? 0 : (t - layerTime) * 1000);
  }
  // Let the last exact draw arrive.
  for (let i = 0; i < 60 && Number.isNaN(stopLatency[STOP_TIMES.length - 1]); i++) await nextFrame();
  client.onDecimated = null;

  const { nominal, dropped, longest } = countDropped(intervals, frameTimes);
  const methodName = !s.info.sorted ? "unsorted full scan" : method === 0 ? "scan" : "pyramid";
  return {
    strategy,
    method: methodName,
    frames: intervals.length,
    seconds: SCRIPT_SECONDS,
    nominalFrameMs: nominal,
    frameInterval: stats(intervals),
    droppedFrames: dropped,
    longestFrame: longest,
    mainThreadWorkMs: stats(work),
    imageAgeMs: stats(imageAge),
    dataAgeMs: stats(dataAge),
    stopLatencyMs: stopLatency,
    stopLatency: stats(stopLatency.filter((v) => !Number.isNaN(v))),
    roundTripMs: stats(roundTrip),
    decimateMs: stats(decimate),
    exactDrawMs: stats(exactDraw),
    layerFlushMs: stats(layerFlush),
    transformDrawMs: stats(transformDraw),
    lateReplies,
    requests,
  };
}

/// Points per GPU chunk message.
const CHUNK = 1_000_000;

interface UploadResult {
  bytes: number;
  chunks: number;
  wallMs: number;
  buildMs: number;
  copyMs: number;
  bufferSubDataMs: number;
  wasmMemoryAfter: number;
}

/// Uploads one kind of GPU data in chunks: one chunk is built in wasm,
/// copied out, transferred, and written to the GPU buffer at a time.
async function upload(s: Session, gl: GlMarkers, kind: GpuKind): Promise<UploadResult> {
  const t0 = performance.now();
  const n = s.info.n;
  if (kind === 0) gl.allocMain(n, s.info.fixedOrigin, s.info.fixedStep);
  else gl.allocRef();
  let buildMs = 0;
  let copyMs = 0;
  let subMs = 0;
  let bytes = 0;
  let chunks = 0;
  let mem = 0;
  for (let start = 0; start < n; start += CHUNK) {
    const r = await s.client.call({ type: "gpu-chunk", kind, start, count: CHUNK }, "gpu-chunk");
    buildMs += r.buildMs;
    copyMs += r.copyMs;
    mem = r.memoryBytes;
    const a = performance.now();
    if (kind === 0) gl.writeMain(r.start, r.buf);
    else gl.writeRef(r.start, r.buf);
    subMs += performance.now() - a;
    bytes += r.buf.byteLength;
    chunks++;
  }
  return {
    bytes,
    chunks,
    wallMs: performance.now() - t0,
    buildMs,
    copyMs,
    bufferSubDataMs: subMs,
    wasmMemoryAfter: mem,
  };
}

export interface GlResult {
  renderer: { vendor: string; renderer: string };
  points: number;
  upload: UploadResult;
  wasmMemoryBefore: number;
  firstDrawSyncMs: number;
  /// Draw of all points plus a GPU sync, per view (30 samples each).
  drawSyncByView: { view: string; ms: Stats }[];
  frames: number;
  nominalFrameMs: number;
  frameInterval: Stats;
  droppedFrames: number;
  longestFrame: Longest;
  mainThreadWorkMs: Stats;
}

function ensureGl(s: Session, canvas: HTMLCanvasElement): GlMarkers {
  if (!s.gl) s.gl = new GlMarkers(canvas);
  return s.gl;
}

/// Uploads all points once (fixed-point x) and runs the scripted zoom and
/// pan as gl.POINTS.
export async function runGl(s: Session, canvas: HTMLCanvasElement): Promise<GlResult> {
  const gl = ensureGl(s, canvas);
  gl.mode = "fixed";
  gl.pointSize = 2;
  canvas.style.display = "block";
  s.plot.element.style.display = "none";
  const up = await upload(s, gl, 0);
  s.glUploaded = true;
  const full = fullView(s.bounds);
  const firstDrawSyncMs = gl.drawSync(full);
  const drawSyncByView: { view: string; ms: Stats }[] = [];
  for (const v of views(s.bounds)) {
    const view = { ...full, x0: v.x0, x1: v.x1 };
    gl.drawSync(view);
    const times: number[] = [];
    for (let i = 0; i < 30; i++) times.push(gl.drawSync(view));
    drawSyncByView.push({ view: v.name, ms: stats(times) });
  }

  const intervals: number[] = [];
  const frameTimes: number[] = [];
  const work: number[] = [];
  let prevTs = await nextFrame();
  const start = prevTs;
  let t = 0;
  while (t < SCRIPT_SECONDS) {
    const ts = await nextFrame();
    const f0 = performance.now();
    intervals.push(ts - prevTs);
    prevTs = ts;
    t = (ts - start) / 1000;
    frameTimes.push(t);
    gl.draw(scriptedView(s.bounds, t));
    work.push(performance.now() - f0);
  }
  const { nominal, dropped, longest } = countDropped(intervals, frameTimes);
  return {
    renderer: gl.rendererInfo(),
    points: s.info.n,
    upload: up,
    wasmMemoryBefore: s.info.memoryBytes,
    firstDrawSyncMs,
    drawSyncByView,
    frames: intervals.length,
    nominalFrameMs: nominal,
    frameInterval: stats(intervals),
    droppedFrames: dropped,
    longestFrame: longest,
    mainThreadWorkMs: stats(work),
  };
}

export interface PrecisionResult {
  mode: GlMode;
  view: string;
  points: number;
  /// Largest |GPU x − f64 x| in device pixels, from transform feedback.
  maxErrorPx: number;
  meanErrorPx: number;
  /// Points whose pixel column on the GPU differs from the f64 column
  /// (points within 0.001 px of a column edge are not counted).
  wrongColumns: number;
  /// Raster check (1 px points, views of up to 64 points): expected columns
  /// that are not lit, and lit columns that no point expects. Points within
  /// 1/32 px of a column edge may light either column (GPUs snap positions
  /// to a sub-pixel grid).
  rasterMissing: number | null;
  rasterExtra: number | null;
}

/// The views of the precision check: name, center, width in point steps.
function precisionViews(s: Session): { name: string; x0: number; x1: number }[] {
  const { xMin, xMax } = s.bounds;
  const span = xMax - xMin;
  const step = span / (s.info.n - 1);
  // A shift of a fraction of a step, so x0 is not on a point.
  const make = (name: string, center: number, points: number) => ({
    name,
    x0: center - (step * points) / 2 + step * 0.37,
    x1: center + (step * points) / 2 + step * 0.37,
  });
  return [
    make("start, 64 points", xMin + step * 1000, 64),
    make("middle, 64 points", xMin + span * 0.5, 64),
    make("end, 64 points", xMax - step * 1000, 64),
    make("middle, 8 points", xMin + span * 0.5, 8),
    make("end, 8 points", xMax - step * 1000, 8),
    make("end, 1% of the span", xMax - span * 0.006, span * 0.01 / step),
  ];
}

/// Compares the x that the GPU computes for each point with f64 positions
/// computed on the CPU, for each x mode and several views.
export interface HiLoCheck {
  view: string;
  /// Largest |lo| = |x − f32(x)| of the points in the view, on the CPU.
  maxLoCpu: number;
  /// The same, read back from the GPU (the lo attribute drawn alone).
  maxLoGpu: number;
}

export async function runPrecision(
  s: Session,
  canvas: HTMLCanvasElement,
): Promise<{ results: PrecisionResult[]; hiloLo: HiLoCheck }> {
  const gl = ensureGl(s, canvas);
  if (!s.glUploaded) await runGl(s, canvas);
  const full = fullView(s.bounds);
  const vs = precisionViews(s);
  const slices: Extract<FromWorker, { type: "x-slice" }>[] = [];
  for (const v of vs) slices.push(await s.client.call({ type: "x-slice", x0: v.x0, x1: v.x1 }, "x-slice"));
  const out: PrecisionResult[] = [];
  const kinds: [GlMode, GpuKind | null][] = [
    ["fixed", null],
    ["naive", 1],
    ["offset", 2],
    ["hilo", 3],
  ];
  for (const [mode, kind] of kinds) {
    if (kind !== null) await upload(s, gl, kind);
    gl.mode = mode;
    vs.forEach((v, vi) => {
      const sl = slices[vi];
      if (!sl) return;
      const view = { ...full, x0: v.x0, x1: v.x1 };
      const n = sl.xs.length;
      const clip = gl.capture(view, sl.lo, n);
      let maxErr = 0;
      let sumErr = 0;
      let counted = 0;
      let wrong = 0;
      const expected = new Set<number>();
      const allowed = new Set<number>();
      for (let i = 0; i < n; i++) {
        const y = sl.ys[i] as number;
        const x = sl.xs[i] as number;
        if (Number.isNaN(x) || Number.isNaN(y)) continue;
        const want = ((x - v.x0) / (v.x1 - v.x0)) * WIDTH;
        const got = ((clip[i] as number) + 1) * (WIDTH / 2);
        const err = Math.abs(got - want);
        maxErr = Math.max(maxErr, err);
        sumErr += err;
        counted++;
        const near = Math.abs(want - Math.round(want));
        if (near >= 1e-3 && Math.floor(got) !== Math.floor(want)) wrong++;
        if (want >= 0 && want < WIDTH) {
          if (near < 1 / 32) {
            allowed.add(Math.round(want) - 1);
            allowed.add(Math.round(want));
          } else {
            expected.add(Math.floor(want));
          }
        }
      }
      let missing: number | null = null;
      let extra: number | null = null;
      if (n <= 70) {
        gl.pointSize = 1;
        gl.draw(view, sl.lo, n);
        const lit = gl.litColumns();
        gl.pointSize = 2;
        missing = 0;
        extra = 0;
        for (const c of expected) if (!lit[c]) missing++;
        for (let c = 0; c < WIDTH; c++) if (lit[c] && !expected.has(c) && !allowed.has(c)) extra++;
      }
      out.push({
        mode,
        view: v.name,
        points: counted,
        maxErrorPx: maxErr,
        meanErrorPx: counted ? sumErr / counted : NaN,
        wrongColumns: wrong,
        rasterMissing: missing,
        rasterExtra: extra,
      });
    });
  }
  // The lo attribute (still uploaded from the hi/lo pass) drawn alone.
  const v = vs[1] as (typeof vs)[number];
  const sl = slices[1] as (typeof slices)[number];
  gl.mode = "hilo-lo";
  const view = { ...full, x0: v.x0, x1: v.x1 };
  const lo = gl.capture(view, sl.lo, sl.xs.length);
  let maxLoGpu = 0;
  let maxLoCpu = 0;
  for (let i = 0; i < sl.xs.length; i++) {
    maxLoGpu = Math.max(maxLoGpu, Math.abs((((lo[i] as number) + 1) / 2) * (v.x1 - v.x0)));
    const x = sl.xs[i] as number;
    maxLoCpu = Math.max(maxLoCpu, Math.abs(x - Math.fround(x)));
  }
  gl.mode = "fixed";
  return { results: out, hiloLo: { view: v.name, maxLoCpu, maxLoGpu } };
}

export function showLines(s: Session, canvas: HTMLCanvasElement): void {
  canvas.style.display = "none";
  s.plot.element.style.display = "block";
}
