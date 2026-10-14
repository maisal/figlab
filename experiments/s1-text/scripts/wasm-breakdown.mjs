// Code size per crate in a wasm module that still has its name section.
// Usage: node scripts/wasm-breakdown.mjs <file.wasm>
// Build with names: see scripts/build-wasm.sh (the "breakdown" step).
import { readFileSync } from "node:fs";

const buf = readFileSync(process.argv[2]);
let p = 8;
const leb = () => {
  let r = 0, s = 0, b;
  do { b = buf[p++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80);
  return r;
};
const str = () => { const n = leb(); const t = buf.toString("utf8", p, p + n); p += n; return t; };
let imported = 0;
const bodies = [];
const names = new Map();
while (p < buf.length) {
  const id = buf[p++];
  const size = leb();
  const end = p + size;
  if (id === 2) {
    for (let n = leb(); n > 0; n--) {
      str(); str();
      const kind = buf[p++];
      if (kind === 0) { leb(); imported++; }
      else if (kind === 1) { p++; const f = buf[p++]; leb(); if (f & 1) leb(); }
      else if (kind === 2) { const f = buf[p++]; leb(); if (f & 1) leb(); }
      else if (kind === 3) { p += 2; }
    }
  } else if (id === 10) {
    for (let n = leb(); n > 0; n--) { const s = leb(); bodies.push(s); p += s; }
  } else if (id === 0) {
    const name = str();
    if (name === "name") {
      while (p < end) {
        const sub = buf[p++]; const len = leb(); const subEnd = p + len;
        if (sub === 1) { for (let n = leb(); n > 0; n--) { const idx = leb(); names.set(idx, str()); } }
        p = subEnd;
      }
    }
  }
  p = end;
}
// Crate of a mangled Rust symbol: legacy (_ZN<len><name>) or v0 (_R...<len><name>).
const crateOf = (n) => {
  const m = /^_ZN(\d+)/.exec(n);
  if (m) return n.substr(3 + m[1].length, Number(m[1])).replace(/\$.*$/, "");
  // v0: the first crate root in the path ("C", optional "s<hash>_", then <len><name>).
  // For trait impls this is often the type's crate; for generic code it can be core.
  const v = /C(?:s[0-9a-zA-Z]*_)?(\d+)([a-zA-Z_][a-zA-Z0-9_]*)/.exec(n.startsWith("_R") ? n : "");
  if (v) return v[2].substr(0, Number(v[1]));
  if (n.startsWith("_ZN") === false && n.includes("::")) return n.split("::")[0].replace(/^</, "");
  return "(other)";
};
const per = new Map();
let total = 0;
bodies.forEach((s, i) => {
  const c = crateOf(names.get(i + imported) ?? "");
  per.set(c, (per.get(c) ?? 0) + s);
  total += s;
});
const rows = [...per.entries()].sort((a, b) => b[1] - a[1]);
console.log(`code section: ${(total / 1024).toFixed(1)} KB in ${bodies.length} functions`);
for (const [c, s] of rows.slice(0, 25)) console.log(`${(s / 1024).toFixed(1).padStart(8)} KB  ${(100 * s / total).toFixed(1).padStart(5)} %  ${c}`);
if (process.env.SHOW) {
  bodies.forEach((s, i) => {
    const n = names.get(i + imported) ?? "";
    if (crateOf(n) === process.env.SHOW) console.log(s, n.slice(0, 160));
  });
}
