// The compute worker. It owns the 10-million-point trace in wasm memory and
// answers decimation requests. See protocol.ts for the messages.

import type { DecimateTiming, FromWorker, GpuKind, Method, ToWorker } from "./protocol";
import { stats } from "./protocol";
import wasmUrl from "../pkg/s2_draw.wasm?url";
import wasmSimdUrl from "../pkg/s2_draw_simd.wasm?url";

interface Exports {
  memory: WebAssembly.Memory;
  make(n: number, seed: number, sorted: number, nanEvery: number): void;
  len(): number;
  x_ptr(): number;
  y_ptr(): number;
  x_min(): number;
  x_max(): number;
  y_min(): number;
  y_max(): number;
  check_sorted(): number;
  build_pyramid(base: number): number;
  pyramid_levels(): number;
  decimate(method: number, x0: number, x1: number, width: number): number;
  out_ptr(): number;
  range_lo(x0: number, x1: number): number;
  range_hi(x0: number, x1: number): number;
  fixed_origin(): number;
  fixed_step(): number;
  gpu_chunk_build(kind: number, start: number, count: number): number;
}

let wasm: Exports | null = null;
let wasmIsSimd: boolean | null = null;
let sorted = true;

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  postMessage(msg, transfer);
}

async function load(simd: boolean): Promise<Exports> {
  const url = simd ? wasmSimdUrl : wasmUrl;
  const { instance } = await WebAssembly.instantiateStreaming(fetch(url), {});
  return instance.exports as unknown as Exports;
}

function need(): Exports {
  if (!wasm) throw new Error("init first");
  return wasm;
}

/// Runs one decimation and copies the result out of wasm memory.
/// The copy is needed because wasm memory cannot be transferred, and the
/// output buffer is reused by the next call.
function decimate(method: Method, x0: number, x1: number, width: number) {
  const w = need();
  const t0 = performance.now();
  const count = w.decimate(method, x0, x1, width);
  const t1 = performance.now();
  // memory.buffer may be a new object after growth, so read it every time.
  const points = new Float64Array(w.memory.buffer, w.out_ptr(), count).slice();
  const t2 = performance.now();
  return { points, decimateMs: t1 - t0, copyMs: t2 - t1 };
}

onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case "init": {
      // A new instance only when the build changes. Otherwise make() frees
      // the old trace inside the same memory (wasm memory never shrinks).
      if (!wasm || wasmIsSimd !== msg.simd) {
        wasm = await load(msg.simd);
        wasmIsSimd = msg.simd;
      }
      const w = wasm;
      const t0 = performance.now();
      w.make(msg.n, 1, msg.sorted ? 1 : 0, msg.nanEvery);
      const t1 = performance.now();
      const isSorted = w.check_sorted() === 1;
      const t2 = performance.now();
      sorted = isSorted;
      let pyramidBytes = 0;
      let pyramidBuildMs = 0;
      if (isSorted) {
        pyramidBytes = w.build_pyramid(msg.pyramidBase);
        pyramidBuildMs = performance.now() - t2;
      }
      post({
        type: "ready",
        info: {
          n: w.len(),
          sorted: isSorted,
          simd: msg.simd,
          nanEvery: msg.nanEvery,
          makeMs: t1 - t0,
          checkSortedMs: t2 - t1,
          pyramidBase: msg.pyramidBase,
          pyramidBuildMs,
          pyramidBytes,
          pyramidLevels: w.pyramid_levels(),
          memoryBytes: w.memory.buffer.byteLength,
          xMin: w.x_min(),
          xMax: w.x_max(),
          yMin: w.y_min(),
          yMax: w.y_max(),
          fixedOrigin: w.fixed_origin(),
          fixedStep: w.fixed_step(),
        },
      });
      break;
    }
    case "decimate": {
      const method: Method = sorted ? msg.method : 2;
      const r = decimate(method, msg.x0, msg.x1, msg.width);
      post(
        {
          type: "decimated",
          seq: msg.seq,
          method,
          x0: msg.x0,
          x1: msg.x1,
          width: msg.width,
          viewTime: msg.viewTime,
          points: r.points,
          decimateMs: r.decimateMs,
          copyMs: r.copyMs,
        },
        [r.points.buffer],
      );
      break;
    }
    case "bench-decimate": {
      const results: DecimateTiming[] = [];
      const methods: [string, Method][] = sorted
        ? [
            ["scan", 0],
            ["pyramid", 1],
          ]
        : [["unsorted full scan", 2]];
      for (const v of msg.views) {
        for (const [name, method] of methods) {
          const times: number[] = [];
          let points = 0;
          for (let i = 0; i < msg.runs; i++) {
            const r = decimate(method, v.x0, v.x1, msg.width);
            times.push(r.decimateMs);
            points = r.points.length / 2;
          }
          const s = stats(times);
          results.push({ view: v.name, method: name, runs: s.n, medianMs: s.median, p95Ms: s.p95, points });
        }
      }
      post({ type: "bench-decimate", results });
      break;
    }
    case "gpu-chunk": {
      // One chunk at a time: wasm memory grows by one chunk (reused), and
      // only one chunk is copied and in flight.
      const w = need();
      const kind: GpuKind = msg.kind;
      const count = Math.max(0, Math.min(msg.count, w.len() - msg.start));
      const words = kind === 0 ? 3 : 2;
      const t0 = performance.now();
      const ptr = w.gpu_chunk_build(kind, msg.start, count);
      const t1 = performance.now();
      const buf = new Uint32Array(w.memory.buffer, ptr, count * words).slice().buffer;
      const t2 = performance.now();
      post(
        {
          type: "gpu-chunk",
          kind,
          start: msg.start,
          count,
          buf,
          buildMs: t1 - t0,
          copyMs: t2 - t1,
          memoryBytes: w.memory.buffer.byteLength,
        },
        [buf],
      );
      break;
    }
    case "x-slice": {
      const w = need();
      const lo = w.range_lo(msg.x0, msg.x1);
      const hi = w.range_hi(msg.x0, msg.x1);
      const n = w.len();
      const xs = new Float64Array(w.memory.buffer, w.x_ptr(), n).slice(lo, hi);
      const ys = new Float64Array(w.memory.buffer, w.y_ptr(), n).slice(lo, hi);
      post({ type: "x-slice", lo, xs, ys }, [xs.buffer, ys.buffer]);
      break;
    }
  }
};
