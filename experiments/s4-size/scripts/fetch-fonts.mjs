// Downloads the fonts into downloads/ (not committed) and writes their sizes
// to results/fonts.json. The sources are pinned to commits.
//
// Usage: node scripts/fetch-fonts.mjs

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sizes } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "downloads");
mkdirSync(out, { recursive: true });

// All fonts are SIL Open Font License 1.1.
export const FONTS = [
  {
    file: "Arimo-Regular.ttf",
    note: "Arimo Regular, static (googlefonts/Arimo)",
    url: "https://raw.githubusercontent.com/googlefonts/Arimo/4a6255f269916ae7ad3fc2706b0935e7621396b8/fonts/ttf/Arimo-Regular.ttf",
  },
  {
    file: "Arimo-VF.ttf",
    note: "Arimo variable (wght 400-700), as in google/fonts",
    url: "https://raw.githubusercontent.com/google/fonts/903d46673260c1f4c7f7ef67f5190fb03eab5042/ofl/arimo/Arimo%5Bwght%5D.ttf",
  },
  {
    file: "Tinos-Regular.ttf",
    note: "Tinos Regular (google/fonts)",
    url: "https://raw.githubusercontent.com/google/fonts/ba95515f1333efe9342c2ad988b9c2f6bef6dbad/ofl/tinos/Tinos-Regular.ttf",
  },
  {
    file: "NotoSansMath-Regular.ttf",
    note: "Noto Sans Math Regular (google/fonts), the fallback for symbols",
    url: "https://raw.githubusercontent.com/google/fonts/823468bd7825152bce2b8fd2cf740432ad2fce8d/ofl/notosansmath/NotoSansMath-Regular.ttf",
  },
];

// Derived fonts made with fontTools (MIT), run with uvx, not committed.
// Hinting is not needed: figlab draws outlines, not hinted glyphs.
const LATIN_GREEK_SYMBOLS =
  "U+0000-024F,U+02B0-02FF,U+0370-03FF,U+2000-206F,U+2070-209F,U+20A0-20CF,U+2100-214F,U+2150-218F,U+2190-21FF,U+2200-22FF,U+2300-23FF,U+25A0-25FF";
const DERIVED = [
  { file: "Arimo-Regular-nohint.ttf", from: "Arimo-Regular.ttf", unicodes: "*", note: "Arimo Regular without hinting" },
  {
    file: "Arimo-Regular-sub.ttf",
    from: "Arimo-Regular.ttf",
    unicodes: LATIN_GREEK_SYMBOLS,
    note: "Arimo Regular without hinting, Latin, Greek, and symbol blocks only",
  },
  { file: "NotoSansMath-nohint.ttf", from: "NotoSansMath-Regular.ttf", unicodes: "*", note: "Noto Sans Math without hinting" },
];

const results = [];
for (const f of [...FONTS, ...DERIVED]) {
  if (f.from && !existsSync(join(out, f.file))) {
    const r = spawnSync(
      "mise",
      [
        "exec",
        "uv",
        "--",
        "uvx",
        "--from",
        "fonttools==4.66.1",
        "pyftsubset",
        join(out, f.from),
        `--unicodes=${f.unicodes}`,
        "--no-hinting",
        "--layout-features=*",
        "--name-IDs=*",
        `--output-file=${join(out, f.file)}`,
      ],
      { stdio: "inherit" },
    );
    if (r.status !== 0) {
      console.log(`skip ${f.file}: fontTools did not run`);
      continue;
    }
  }
  const path = join(out, f.file);
  if (!f.from && !existsSync(path)) {
    process.stdout.write(`download ${f.file} ... `);
    const res = await fetch(f.url);
    if (!res.ok) throw new Error(`${f.url}: ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    console.log("ok");
  }
  const data = readFileSync(path);
  const sha256 = createHash("sha256").update(data).digest("hex");
  results.push({ ...f, sha256, ...sizes(data) });
}

mkdirSync(join(root, "results"), { recursive: true });
writeFileSync(join(root, "results", "fonts.json"), JSON.stringify(results, null, 2) + "\n");
console.log("| Font | Raw | gzip -9 | brotli 11 |");
console.log("|---|---:|---:|---:|");
for (const r of results) {
  console.log(`| ${r.file} | ${r.raw} | ${r.gzip} | ${r.brotli} |`);
}
