// Counts the bytes each page of dist/ downloads at startup, and the bytes
// loaded later, as raw, gzip -9, and brotli 11. This is the number a CI
// check of the initial download size would look at (roadmap.md M5).
//
// Usage: node scripts/startup-bytes.mjs   (after `pnpm run build`)

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kib, sizes } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const assets = readdirSync(join(dist, "assets"));
const file = (f) => sizes(readFileSync(join(dist, f)));
const find = (prefix) => `assets/${assets.find((a) => a.startsWith(prefix))}`;

function kind(f) {
  if (f.endsWith(".html")) return "html";
  if (f.endsWith(".ttf")) return "font";
  if (f.endsWith(".wasm")) return "wasm";
  if (f.includes(".worker-")) return "worker js";
  return "js";
}

const result = {};
for (const page of ["index.html", "preact.html", "react.html"]) {
  const html = readFileSync(join(dist, page), "utf8");
  const refs = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map((m) => m[1]);
  const startup = [
    page,
    ...refs,
    find("compute.worker-"),
    find("lang.worker-"),
    find("m_render_bg-"),
    find("m_compute_bg-"),
    find("m_lang_bg-"),
    find("Arimo-Regular-"),
  ];
  const later = [find("m_export_pdf-"), find("m_export_pdf_bg-"), find("m_export_png-"), find("m_export_png_bg-")];
  const files = [...startup.map((f) => ({ f, when: "startup" })), ...later.map((f) => ({ f, when: "later" }))].map(
    ({ f, when }) => ({ file: f, when, kind: kind(f), ...file(f) }),
  );
  const sum = (when, k) =>
    files.filter((x) => x.when === when && (!k || x.kind === k)).reduce((a, x) => ({ raw: a.raw + x.raw, gzip: a.gzip + x.gzip, brotli: a.brotli + x.brotli }), { raw: 0, gzip: 0, brotli: 0 });
  result[page] = {
    files,
    startup: {
      js: sum("startup", "js"),
      workerJs: sum("startup", "worker js"),
      wasm: sum("startup", "wasm"),
      font: sum("startup", "font"),
      html: sum("startup", "html"),
      total: sum("startup"),
    },
    later: sum("later"),
  };
}

writeFileSync(join(root, "results", "startup-bytes.json"), JSON.stringify(result, null, 2) + "\n");
console.log("| Page | JS gz | Worker JS gz | wasm gz | Font gz | Startup total gz | Startup total br | Loaded later gz |");
console.log("|---|---:|---:|---:|---:|---:|---:|---:|");
for (const [page, r] of Object.entries(result)) {
  const s = r.startup;
  console.log(
    `| ${page} | ${kib(s.js.gzip)} | ${kib(s.workerJs.gzip)} | ${kib(s.wasm.gzip)} | ${kib(s.font.gzip)} | ${kib(s.total.gzip)} | ${kib(s.total.brotli)} | ${kib(r.later.gzip)} |`,
  );
}
console.log("\nFiles of index.html:");
for (const f of result["index.html"].files) console.log(`  ${f.when.padEnd(8)} ${f.file.padEnd(40)} raw ${kib(f.raw).padStart(8)}  gz ${kib(f.gzip).padStart(7)}  br ${kib(f.brotli).padStart(7)}`);
