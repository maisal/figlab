// Production bundle size of each S5 app: raw, gzip, and brotli, and a split of
// the JavaScript into framework, CodeMirror, and app code.
//
// Use: node harness/size.mjs [app ...]     (default: every folder in apps/)
//
// Sizes do not depend on the load of the machine, so these numbers are final.
// The split comes from a second build with source maps: each byte of the
// minified code is counted for the source file it came from.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { SourceMapConsumer } from "source-map-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apps = process.argv.length > 2 ? process.argv.slice(2) : ["cm-only", "vanilla", "preact", "solid", "svelte", "react"];

const gzip = (b) => gzipSync(b, { level: 9 }).length;
const brotli = (b) =>
  brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: b.length } })
    .length;

const CODEMIRROR = /^(@codemirror\/|@lezer\/|codemirror$|style-mod$|w3c-keyname$|crelt$|@marijn\/)/;

/** The bucket of a source file: framework, codemirror, app, or other. */
function bucket(source) {
  const at = source.lastIndexOf("node_modules/");
  if (at < 0) {
    if (source.includes("vite/") || source.includes("\0") || source.startsWith("vite")) return "other";
    return "app";
  }
  const rest = source.slice(at + "node_modules/".length).split("/");
  const pkg = rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
  if (CODEMIRROR.test(pkg)) return "codemirror";
  if (pkg === "vite") return "other";
  return "framework";
}

/** Count the bytes of `code` per bucket, using its source map. */
function split(code, map) {
  const consumer = new SourceMapConsumer(map);
  const lines = code.split("\n");
  const byLine = lines.map(() => []);
  consumer.eachMapping((m) => {
    byLine[m.generatedLine - 1]?.push({ col: m.generatedColumn, source: m.source });
  });
  const counts = { framework: 0, codemirror: 0, app: 0, other: 0 };
  const packages = {};
  lines.forEach((line, i) => {
    const marks = byLine[i].sort((a, b) => a.col - b.col);
    let prevCol = 0;
    let prevSource = null;
    const add = (source, n) => {
      if (n <= 0) return;
      const b = source ? bucket(source) : "other";
      counts[b] += n;
      if (source && b !== "app") {
        const at = source.lastIndexOf("node_modules/");
        const rest = at >= 0 ? source.slice(at + 13).split("/") : [source];
        const pkg = rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
        packages[pkg] = (packages[pkg] ?? 0) + n;
      }
    };
    for (const mark of marks) {
      add(prevSource, mark.col - prevCol);
      prevCol = mark.col;
      prevSource = mark.source;
    }
    add(prevSource, line.length - prevCol + 1); // +1 for the newline
  });
  return { counts, packages };
}

function assets(dist) {
  const dir = join(dist, "assets");
  return readdirSync(dir)
    .filter((f) => [".js", ".css"].includes(extname(f)))
    .map((f) => ({ file: f, kind: extname(f).slice(1), bytes: readFileSync(join(dir, f)) }));
}

function versions(app) {
  const pkg = JSON.parse(readFileSync(join(root, "apps", app, "package.json"), "utf8"));
  return pkg.dependencies;
}

const results = [];
for (const app of apps) {
  const dir = join(root, "apps", app);
  const vite = join(dir, "node_modules", "vite", "bin", "vite.js");
  execFileSync(process.execPath, [vite, "build", "--logLevel", "error"], { cwd: dir, stdio: "inherit" });
  const files = assets(join(dir, "dist"));
  const total = (kind) => {
    const list = files.filter((f) => f.kind === kind);
    const all = Buffer.concat(list.map((f) => f.bytes));
    return { files: list.length, raw: all.length, gzip: list.reduce((s, f) => s + gzip(f.bytes), 0), brotli: list.reduce((s, f) => s + brotli(f.bytes), 0) };
  };
  const js = total("js");
  const css = total("css");

  // Second build with source maps, only to split the JavaScript.
  const mapDir = join(dir, "dist-map");
  execFileSync(process.execPath, [vite, "build", "--logLevel", "error", "--sourcemap", "--outDir", "dist-map"], {
    cwd: dir,
    stdio: "inherit",
  });
  const counts = { framework: 0, codemirror: 0, app: 0, other: 0 };
  const packages = {};
  for (const f of readdirSync(join(mapDir, "assets")).filter((f) => f.endsWith(".js"))) {
    const code = readFileSync(join(mapDir, "assets", f), "utf8").replace(/\n\/\/# sourceMappingURL=.*\s*$/, "");
    const map = JSON.parse(readFileSync(join(mapDir, "assets", `${f}.map`), "utf8"));
    const s = split(code, map);
    for (const k of Object.keys(counts)) counts[k] += s.counts[k];
    for (const [p, n] of Object.entries(s.packages)) packages[p] = (packages[p] ?? 0) + n;
  }
  if (existsSync(mapDir)) rmSync(mapDir, { recursive: true });
  results.push({ app, versions: versions(app), js, css, split: counts, packages });
}

// Differences from the CodeMirror-only baseline.
const base = results.find((r) => r.app === "cm-only");
for (const r of results) {
  if (!base) break;
  r.overBaseline = {
    raw: r.js.raw - base.js.raw,
    gzip: r.js.gzip - base.js.gzip,
    brotli: r.js.brotli - base.js.brotli,
  };
}

const kb = (n) => (n / 1000).toFixed(1);
console.log("JavaScript (kB = 1000 bytes)");
console.log("app        raw     gzip   brotli | over CM-only: raw  gzip brotli | split raw: framework  codemirror  app  other");
for (const r of results) {
  const o = r.overBaseline ?? { raw: 0, gzip: 0, brotli: 0 };
  console.log(
    `${r.app.padEnd(9)} ${kb(r.js.raw).padStart(6)} ${kb(r.js.gzip).padStart(7)} ${kb(r.js.brotli).padStart(7)} |` +
      ` ${kb(o.raw).padStart(17)} ${kb(o.gzip).padStart(5)} ${kb(o.brotli).padStart(6)} |` +
      ` ${kb(r.split.framework).padStart(19)} ${kb(r.split.codemirror).padStart(11)} ${kb(r.split.app).padStart(4)} ${kb(r.split.other).padStart(6)}`,
  );
}
console.log("CSS: " + results.map((r) => `${r.app} ${kb(r.css.raw)} raw / ${kb(r.css.gzip)} gzip`).join(", "));
const out = join(root, "results", "size.json");
writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), node: process.version, results }, null, 2) + "\n");
console.log(`written: ${out}`);
