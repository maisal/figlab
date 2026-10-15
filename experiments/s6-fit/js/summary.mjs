// Make the result tables from the JSON records.
// Usage: node js/summary.mjs [dir] ; dir defaults to target/s6-results/native
// Writes results/tables.md (all tables) and results/nist-summary.json.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const dir = process.argv[2] ?? "target/s6-results/native";
const nist = JSON.parse(readFileSync(`${dir}/nist.json`, "utf8"));
const bounds = JSON.parse(readFileSync(`${dir}/bounds.json`, "utf8"));
const median = (a) => {
  const s = a.filter((v) => v !== null && v !== undefined).sort((x, y) => x - y);
  if (s.length === 0) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const f1 = (v) => (v === null || v === undefined ? "-" : v.toFixed(1));
const lines = [];
const table = (head, rows) => {
  lines.push(`| ${head.join(" | ")} |`);
  lines.push(`|${head.map((h, i) => (i === 0 ? "---" : "---:")).join("|")}|`);
  for (const r of rows) lines.push(`| ${r.join(" | ")} |`);
  lines.push("");
};

// NIST summary per candidate, derivative, and box.
const groups = [];
for (const boxed of [false, true]) {
  for (const cand of ["lm", "lm-transform", "lm-bounded", "cmpfit", "rmpfit"]) {
    for (const deriv of ["analytic", "forward"]) {
      const rs = nist.filter((r) => r.cand === cand && r.deriv === deriv && r.boxed === boxed);
      if (rs.length === 0) continue;
      const solved = rs.filter((r) => r.min_lre_params >= 4);
      groups.push({
        boxed,
        cand,
        deriv,
        runs: rs.length,
        solved: solved.length,
        failed: rs.filter((r) => r.min_lre_params < 4).map((r) => `${r.problem}/${r.start}`),
        median_lre_params: median(solved.map((r) => r.min_lre_params)),
        median_lre_err: median(solved.map((r) => r.min_lre_err)),
        median_lre_lib_err: median(solved.map((r) => r.min_lre_lib_err)),
        median_lre_rss: median(solved.map((r) => r.lre_rss)),
        min_lre_params_solved: Math.min(...solved.map((r) => r.min_lre_params)),
        iterations: rs.reduce((a, r) => a + r.iterations, 0),
        nfev: rs.reduce((a, r) => a + r.nfev, 0),
        not_converged: rs.filter((r) => !r.converged).length,
      });
    }
  }
}
for (const boxed of [false, true]) {
  lines.push(
    boxed
      ? "### NIST StRD in a loose box (bounds hold both starts and the certified value; none is active at the solution)\n"
      : "### NIST StRD without bounds (27 problems x 2 starts = 54 runs)\n",
  );
  table(
    ["candidate", "derivatives", "solved (LRE >= 4)", "median LRE params", "median LRE errors", "median LRE library errors", "median LRE rss", "iterations", "nfev", "not solved"],
    groups
      .filter((g) => g.boxed === boxed)
      .map((g) => [g.cand, g.deriv, `${g.solved}/${g.runs}`, f1(g.median_lre_params), f1(g.median_lre_err), f1(g.median_lre_lib_err), f1(g.median_lre_rss), g.iterations, g.nfev, g.failed.join(", ") || "-"]),
  );
}
lines.push("Medians are over the solved runs. LRE: the number of correct significant digits (at most 11, the digits of the certified values). \"errors\": from the Jacobian at the solution, computed the same way for all candidates. \"library errors\": as the library gives them (cmpfit and rmpfit: their covariance; lm-transform: the lmfit-style mapping), scaled by sqrt(rss/dof). iterations and nfev are sums over the runs. nfev counts every evaluation of the residual vector, including those for forward differences.\n");

// Per problem: min LRE of the parameters, start 1 / start 2.
lines.push("### NIST StRD per problem: smallest LRE of the parameters (start 1 / start 2), no bounds\n");
const cols = [["lm", "analytic"], ["lm", "forward"], ["cmpfit", "analytic"], ["cmpfit", "forward"], ["rmpfit", "analytic"], ["rmpfit", "forward"]];
const problems = [...new Set(nist.map((r) => r.problem))];
table(
  ["problem", "level", ...cols.map(([c, d]) => `${c} ${d === "analytic" ? "A" : "F"}`)],
  problems.map((p) => {
    const lvl = nist.find((r) => r.problem === p).level;
    return [
      p,
      lvl,
      ...cols.map(([c, d]) =>
        [1, 2].map((s) => f1(nist.find((r) => r.problem === p && r.start === s && r.cand === c && r.deriv === d && !r.boxed).min_lre_params)).join(" / "),
      ),
    ];
  }),
);
lines.push("A: analytic derivatives. F: forward differences. lm-bounded without bounds gives the same bits as lm.\n");

// Bounds.
lines.push("### Bounds that are active at the solution\n");
const cases = [...new Set(bounds.map((r) => r.case))];
const rows = [];
for (const c of cases) {
  const ref = bounds.find((r) => r.case === c && r.cand === "reference");
  rows.push([`**${c}**`, `reference (active: ${ref.active.join(", ")})`, "", "", "", "", ref.params.map((v) => v.toPrecision(8)).join(", "), ref.err.map((v) => (v === null ? "NaN" : v.toPrecision(3))).join(", ")]);
  for (const r of bounds.filter((r) => r.case === c && r.cand !== "reference")) {
    rows.push([
      "",
      `${r.cand} ${r.deriv === "analytic" ? "A" : "F"}`,
      f1(r.min_lre_params),
      f1(r.min_lre_err_free),
      f1(r.min_lre_lib_err_free),
      `${r.iterations} / ${r.nfev}`,
      r.params.map((v) => v.toPrecision(8)).join(", "),
      (r.lib_err ?? r.err).map((v) => (v === null ? "NaN" : v.toPrecision(3))).join(", "),
    ]);
  }
}
table(["case", "candidate", "LRE params", "LRE errors (free)", "LRE library errors (free)", "iterations / nfev", "parameters", "errors (library, else common)"], rows);
lines.push("The reference fixes the active parameters at their bounds and fits the others without bounds (A0, analytic). LRE is against the reference, at most 15. \"errors (free)\" leaves out the parameters at a bound.\n");

// Other numbers the README and ADR 0015 cite.
const unboxed = nist.filter((r) => !r.boxed);
const find = (cand, deriv, p, s) => unboxed.find((r) => r.cand === cand && r.deriv === deriv && r.problem === p && r.start === s);
const identical = [];
for (const [a, b] of [["lm", "lm-bounded"], ["lm", "cmpfit"], ["lm", "rmpfit"], ["cmpfit", "rmpfit"]]) {
  for (const deriv of ["analytic", "forward"]) {
    let same = 0;
    let n = 0;
    for (const ra of unboxed.filter((r) => r.cand === a && r.deriv === deriv)) {
      const rb = find(b, deriv, ra.problem, ra.start);
      n += 1;
      if (ra.params.length === rb.params.length && ra.params.every((v, i) => Object.is(v, rb.params[i]))) same += 1;
    }
    identical.push({ a, b, deriv, same_params: same, runs: n });
  }
}
const minSolved = {};
for (const g of groups.filter((g) => !g.boxed)) {
  const rs = unboxed.filter((r) => r.cand === g.cand && r.deriv === g.deriv && r.min_lre_params >= 4);
  const worst = rs.reduce((w, r) => (r.min_lre_params < w.min_lre_params ? r : w));
  minSolved[`${g.cand} ${g.deriv}`] = { min_lre_params: worst.min_lre_params, run: `${worst.problem}/${worst.start}` };
}
const lanczos1 = unboxed
  .filter((r) => r.problem === "Lanczos1")
  .map((r) => ({ cand: r.cand, deriv: r.deriv, start: r.start, min_lre_err: r.min_lre_err, min_lre_params: r.min_lre_params }));
lines.push("### Other numbers\n");
table(
  ["candidates", "derivatives", "runs with the same parameter bits (NIST, no bounds)"],
  identical.map((x) => [`${x.a} and ${x.b}`, x.deriv, `${x.same_params}/${x.runs}`]),
);
table(
  ["candidate", "smallest parameter LRE of a solved run (no bounds)", "run"],
  Object.entries(minSolved).map(([k, v]) => [k, v.min_lre_params.toFixed(2), v.run]),
);
const l1 = lanczos1.map((x) => x.min_lre_err);
lines.push(
  `Lanczos1: the smallest LRE of the standard errors is ${Math.min(...l1).toFixed(1)} to ${Math.max(...l1).toFixed(1)} over all candidates, starts, and derivatives. Its certified rss is 1.4e-25.\n`,
);
if (existsSync("results/mgh10-box.json")) {
  const m = JSON.parse(readFileSync("results/mgh10-box.json", "utf8"));
  lines.push("MGH10 from start 1 in the loose box (`s6cli mgh10`, analytic derivatives):\n");
  table(
    ["candidate", "bounds", "maxiter", "iterations", "status", "smallest LRE"],
    m.map((x) => [x.cand, x.bounds, x.maxiter, x.iterations, x.status, x.min_lre_params.toFixed(1)]),
  );
}

writeFileSync("results/tables.md", lines.join("\n"));
writeFileSync(
  "results/nist-summary.json",
  JSON.stringify({ groups, identical_params: identical, min_lre_solved: minSolved, lanczos1 }, null, 1) + "\n",
);
console.log(lines.join("\n"));
