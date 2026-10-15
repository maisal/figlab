// Time the gauss fit with 100,000 points in wasm under Node.
// Usage: node js/speed-wasm.mjs [runs] ; writes results/speed-wasm.json
// Build first: scripts/build-wasm.sh
import { readFileSync, writeFileSync } from "node:fs";

const runs = Number(process.argv[2] ?? 21);
const wasmPath = new URL("../target/wasm32-unknown-unknown/release/s6wasm.wasm", import.meta.url);
const { exports } = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(wasmPath)), {});
const points = 100000;
exports.gauss_setup(points);

// The same candidates as the native speed test (A1 is A0 without bounds).
const cands = [["lm", 0], ["lm-bounded", 2], ["cmpfit", 3], ["rmpfit", 4]];
const derivs = [["analytic", 0], ["forward", 1]];
const pct = (sorted, q) => sorted[Math.min(sorted.length, Math.max(1, Math.ceil(q * sorted.length))) - 1];
const results = [];
for (const [cand, c] of cands) {
  for (const [deriv, d] of derivs) {
    // The fit alone, and the fit plus the error analysis.
    const time = (errors) => {
      for (let i = 0; i < 2; i++) exports.gauss_fit(c, d, errors);
      const ms = [];
      for (let i = 0; i < runs; i++) {
        const t = performance.now();
        exports.gauss_fit(c, d, errors);
        ms.push(performance.now() - t);
      }
      return ms.sort((a, b) => a - b);
    };
    const fit = time(0);
    const total = time(1);
    const iterations = exports.gauss_fit(c, d, 0);
    const r = {
      cand,
      deriv,
      median_ms: +pct(total, 0.5).toFixed(3),
      p95_ms: +pct(total, 0.95).toFixed(3),
      min_ms: +total[0].toFixed(3),
      fit_only_median_ms: +pct(fit, 0.5).toFixed(3),
      fit_only_p95_ms: +pct(fit, 0.95).toFixed(3),
      runs,
      iterations,
    };
    console.log(
      `wasm   ${cand.padEnd(11)} ${deriv.padEnd(8)} fit+errors median ${r.median_ms.toFixed(2).padStart(7)} ms  p95 ${r.p95_ms.toFixed(2).padStart(7)} ms  (fit only ${r.fit_only_median_ms.toFixed(2).padStart(7)} ms)  runs ${runs}  iterations ${iterations}`,
    );
    results.push(r);
  }
}
const out = {
  platform: `wasm32 (Node ${process.version})`,
  points,
  note: "median_ms and p95_ms time the fit plus the error analysis",
  results,
};
writeFileSync("results/speed-wasm.json", JSON.stringify(out, null, 1) + "\n");
console.error("wrote results/speed-wasm.json");
