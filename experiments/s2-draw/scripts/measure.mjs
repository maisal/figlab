// Runs the measurements in a headless browser and writes results/<browser>.json.
//
// Usage (from experiments/s2-draw, after `pnpm run build`):
//   pnpm run measure                 # Chrome (the installed Google Chrome)
//   pnpm run measure -- --browser firefox
//   pnpm run measure -- --browser webkit
//
// The page is served by `vite preview` on port 4273, started here.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const browserName = args.includes("--browser") ? args[args.indexOf("--browser") + 1] : "chrome";
const port = 4273; // an uncommon port: other experiments use 4173

// Fails if the port is in use: an old server would serve old files.
function checkPortFree() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", () => reject(new Error(`port ${port} is in use; stop the old vite preview first`)));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve()));
  });
}

// vite is started directly (not through pnpm), so that killing it stops the server.
function startPreview() {
  const vite = join(root, "node_modules", "vite", "bin", "vite.js");
  const p = spawn(process.execPath, [vite, "preview", "--port", String(port), "--strictPort"], {
    cwd: root,
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve, reject) => {
    p.stdout.on("data", (d) => {
      if (String(d).includes("localhost")) resolve(p);
    });
    p.on("exit", (code) => reject(new Error(`vite preview exited with ${code}`)));
    setTimeout(() => reject(new Error("vite preview did not start")), 20000);
  });
}

async function launch() {
  if (browserName === "chrome") {
    // Headless Chrome on macOS used the real GPU through ANGLE Metal without
    // extra flags (see results/chrome.json, gl.renderer).
    return chromium.launch({ channel: "chrome", headless: true });
  }
  if (browserName === "firefox") return firefox.launch({ headless: true });
  if (browserName === "webkit") return webkit.launch({ headless: true });
  throw new Error(`unknown browser ${browserName}`);
}

await checkPortFree();
const preview = await startPreview();
let browser = null;
try {
  browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1700, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.error("page:", m.text());
  });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`http://localhost:${port}/`);
  console.log(`${browserName}: ${browser.version()}`);
  const results = await page.evaluate(() => window.s2.all());
  results.browser = browserName;
  results.browserVersion = browser.version();
  results.playwright = "1.64.0";
  results.headless = true;
  results.date = new Date().toISOString();
  results.timerResolutionUs = await page.evaluate(() => {
    const a = performance.now();
    let b = a;
    while (b === a) b = performance.now();
    return Math.round((b - a) * 1000);
  });

  mkdirSync(join(root, "results"), { recursive: true });
  const file = join(root, "results", `${browserName}.json`);
  writeFileSync(file, JSON.stringify(results, null, 2) + "\n");
  print(results);
  console.log(`\nwritten: ${file}`);
} finally {
  await browser?.close();
  preview.kill();
}

function ms(s) {
  return `${s.median.toFixed(2)} / ${s.p95.toFixed(2)}`;
}

// A short summary. `node scripts/tables.mjs` prints all tables.
function print(r) {
  const d = r.data;
  console.log(`\nData: ${d.n} points, make ${d.makeMs.toFixed(0)} ms, sorted check ${d.checkSortedMs.toFixed(1)} ms`);
  console.log(`Pyramid: build ${d.pyramidBuildMs.toFixed(1)} ms, ${(d.pyramidBytes / 1e6).toFixed(1)} MB`);
  console.log("\nDecimation in the worker (median / p95 ms):");
  for (const x of r.decimate) console.log(`  ${x.view.padEnd(6)} ${x.method.padEnd(8)} ${x.medianMs.toFixed(2)} / ${x.p95Ms.toFixed(2)}`);
  console.log(`\nCanvas 2D redraw with the stroke rasterized: ${ms(r.draw2d.pathAndFlushMs)} ms`);
  console.log("\nInteraction (median / p95 per frame):");
  for (const i of r.interaction) {
    console.log(
      `  ${i.strategy.padEnd(11)} ${i.method.padEnd(18)} dropped ${String(i.droppedFrames).padEnd(4)} work ${ms(i.mainThreadWorkMs)}  data age ${ms(i.dataAgeMs)}  stops ${i.stopLatencyMs.map((x) => x.toFixed(0)).join(", ")}`,
    );
  }
  const g = r.gl;
  console.log(`\nWebGL: ${g.renderer.renderer}; upload ${g.upload.wallMs.toFixed(0)} ms; dropped ${g.droppedFrames}`);
  for (const v of g.drawSyncByView) console.log(`  draw + sync ${v.view.padEnd(6)} ${ms(v.ms)} ms`);
  console.log("\nx precision against f64 (max error px, wrong columns):");
  for (const p of r.precision) {
    console.log(`  ${p.mode.padEnd(7)} ${p.view.padEnd(20)} ${p.maxErrorPx.toFixed(4).padStart(10)}  ${p.wrongColumns}`);
  }
  console.log(`  hi/lo: max |lo| on the CPU ${r.hiloLo.maxLoCpu}, on the GPU ${r.hiloLo.maxLoGpu}`);
}
