// Messages between the main thread and the compute worker.
//
// The worker owns the arrays (in wasm memory). The main thread only gets
// decimated points (a transferred Float64Array of x, y pairs with NaN breaks),
// the GPU data for markers in chunks, and small slices of x for the
// precision check.
//
// Ordering: a worker handles messages one at a time, in order, so replies come
// back in request order. The main thread still tags each decimation request
// with `seq` and drops a reply whose `seq` is older than the last one it
// applied, so a late reply can never overwrite a newer picture.

/// 0 = direct scan, 1 = pyramid, 2 = full scan for unsorted x.
export type Method = 0 | 1 | 2;

/// GPU data kinds (src/lib.rs GpuKind): 0 main (x as two int32 words, y as
/// f32; 12 bytes per point), 1 naive f32 x, 2 f32 x minus one offset, 3 hi/lo
/// f32 pair (8 bytes per point each).
export type GpuKind = 0 | 1 | 2 | 3;

export interface ViewRange {
  x0: number;
  x1: number;
}

export type ToWorker =
  | { type: "init"; simd: boolean; n: number; sorted: boolean; pyramidBase: number; nanEvery: number }
  | { type: "decimate"; seq: number; method: Method; x0: number; x1: number; width: number; viewTime: number }
  | { type: "bench-decimate"; views: { name: string; x0: number; x1: number }[]; width: number; runs: number }
  | { type: "gpu-chunk"; kind: GpuKind; start: number; count: number }
  | { type: "x-slice"; x0: number; x1: number };

export interface DataInfo {
  n: number;
  sorted: boolean;
  simd: boolean;
  nanEvery: number;
  makeMs: number;
  checkSortedMs: number;
  pyramidBase: number;
  pyramidBuildMs: number;
  pyramidBytes: number;
  pyramidLevels: number;
  memoryBytes: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  fixedOrigin: number;
  fixedStep: number;
}

export interface DecimateTiming {
  view: string;
  method: string;
  runs: number;
  medianMs: number;
  p95Ms: number;
  points: number;
}

export type FromWorker =
  | { type: "ready"; info: DataInfo }
  | {
      type: "decimated";
      seq: number;
      method: Method;
      x0: number;
      x1: number;
      width: number;
      viewTime: number;
      points: Float64Array;
      decimateMs: number;
      copyMs: number;
    }
  | { type: "bench-decimate"; results: DecimateTiming[] }
  | {
      type: "gpu-chunk";
      kind: GpuKind;
      start: number;
      count: number;
      buf: ArrayBuffer;
      buildMs: number;
      copyMs: number;
      memoryBytes: number;
    }
  | { type: "x-slice"; lo: number; xs: Float64Array; ys: Float64Array };

/// Median and p95 of a list of numbers. With fewer than 20 values the p95 is
/// the largest value.
export function stats(values: number[]): { median: number; p95: number; n: number } {
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 0) return { median: NaN, p95: NaN, n: 0 };
  const at = (q: number) => v[Math.min(v.length - 1, Math.floor(q * v.length))] as number;
  return { median: at(0.5), p95: at(0.95), n: v.length };
}
