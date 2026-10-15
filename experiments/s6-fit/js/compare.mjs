// Compare two result folders bit for bit (for example native and wasm).
// Usage: node js/compare.mjs <dirA> <dirB> [label] [--out file.json]
// For each candidate, it counts the runs whose parameters, errors, rss,
// iteration count, and evaluation count have the same bits. It fails if a
// result file or a record is missing on either side.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
const [dirA, dirB, label = `${dirA} vs ${dirB}`] = args.filter((_, i) => outIdx < 0 || (i !== outIdx && i !== outIdx + 1));

const key = (r) => [r.problem ?? r.case, r.start ?? "", r.cand, r.deriv, r.boxed ?? ""].join("/");
const summary = {};
const diffs = [];
const missing = [];
for (const name of ["nist", "bounds", "gauss"]) {
  const fa = `${dirA}/${name}.json`;
  const fb = `${dirB}/${name}.json`;
  if (!existsSync(fa) || !existsSync(fb)) {
    missing.push(`${name}.json`);
    continue;
  }
  const a = new Map(JSON.parse(readFileSync(fa, "utf8")).map((r) => [key(r), r]));
  const b = new Map(JSON.parse(readFileSync(fb, "utf8")).map((r) => [key(r), r]));
  for (const k of b.keys()) {
    if (!a.has(k)) missing.push(`${name}: ${k} (only in ${dirB})`);
  }
  for (const [k, ra] of a) {
    const rb = b.get(k);
    if (!rb) {
      missing.push(`${name}: ${k} (only in ${dirA})`);
      continue;
    }
    const s = (summary[ra.cand] ??= { same: 0, different: 0 });
    if (ra.bits === rb.bits) {
      s.same += 1;
    } else {
      s.different += 1;
      diffs.push(`${name}: ${k}`);
    }
  }
}
console.log(`${label}`);
for (const [cand, s] of Object.entries(summary)) {
  const n = s.same + s.different;
  console.log(
    `  ${cand.padEnd(13)} records ${String(n).padStart(4)}  same ${String(s.same).padStart(4)}  different ${String(s.different).padStart(4)}`,
  );
}
if (diffs.length > 0) {
  console.log(`  first differences: ${diffs.slice(0, 5).join("; ")}`);
}
if (missing.length > 0) {
  console.error(`missing on one side: ${missing.slice(0, 10).join("; ")}`);
  process.exit(1);
}
if (outFile) {
  let all = {};
  if (existsSync(outFile)) all = JSON.parse(readFileSync(outFile, "utf8"));
  for (const s of Object.values(summary)) s.records = s.same + s.different;
  all[label] = { summary, differences: diffs };
  writeFileSync(outFile, JSON.stringify(all, null, 2) + "\n");
}
