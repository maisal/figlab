// Small helpers shared by the scripts.

import { brotliCompressSync, constants, gzipSync } from "node:zlib";

/** Raw, gzip -9, and brotli quality 11 (window 24) sizes in bytes. */
export function sizes(buf) {
  return {
    raw: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
    brotli: brotliCompressSync(buf, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_LGWIN]: 24,
        [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      },
    }).length,
  };
}

/** Formats bytes as KiB with one decimal. */
export function kib(n) {
  return (n / 1024).toFixed(1);
}

/** Median and 95th percentile (nearest rank) of a list of numbers. */
export function stats(values) {
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 0) return { n: 0, median: null, p95: null, min: null, max: null };
  const at = (q) => v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)];
  const median = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return { n: v.length, median, p95: at(0.95), min: v[0], max: v[v.length - 1] };
}
