// Runs the render and export modules in Node and writes a test figure as SVG,
// PDF, and PNG into pkg/out/. Look at them (or run pdfinfo/pdftotext) to check
// that the stand-in modules make valid files.
//
// Usage: node scripts/check-outputs.mjs   (after `pnpm run build:wasm`)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "pkg", "app");
const out = join(root, "pkg", "out");
mkdirSync(out, { recursive: true });

async function load(dir, name) {
  const mod = await import(join(pkg, dir, `${name}.js`));
  await mod.default({ module_or_path: readFileSync(join(pkg, dir, `${name}_bg.wasm`)) });
  return mod;
}

const render = await load("render", "m_render");
const pdf = await load("pdf", "m_export_pdf");
const png = await load("png", "m_export_png");
const font = readFileSync(join(root, "downloads", "Arimo-Regular-nohint.ttf"));
if (!render.load_font(new Uint8Array(font))) throw new Error("load_font failed");

const x = Float64Array.from({ length: 200 }, (_, i) => i / 20);
const y = x.map((v) => Math.sin(v));
const draw = render.draw(x, y);
const texts = "0\n2\n4\n6\n8\n10\n-1.0\n-0.5\n0.0\n0.5\n1.0\nEnergy (meV)\nIntensity (counts)";
writeFileSync(join(out, "figure.svg"), render.svg(x, y));
writeFileSync(join(out, "figure.pdf"), pdf.export_pdf(draw, texts, new Uint8Array(font), 240, 180));
writeFileSync(join(out, "figure.png"), png.export_png(draw, 240, 180, 300));
console.log("wrote pkg/out/figure.{svg,pdf,png}");
