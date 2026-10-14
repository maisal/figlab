// Timing of the S5 apps: build time, and time to first render and to
// "editor ready" in headless Chrome (cold and warm cache, CPU 1x and 4x).
//
// Use: node harness/measure.mjs [--runs N] [--builds N] [app ...]
//      (default: 15 page loads per case, 5 builds per app, every app)
//
// Other work on the machine changes these numbers. Run it on a quiet machine.
// It prints a table and writes results/timing.json with median, p95, and the
// number of runs for every case.
//
// Page timing is read in the page, with no help from the app:
// - firstRender: the first element inside #app appears (a MutationObserver)
// - editorReady: the CodeMirror `.cm-content` element appears
// - fcp: first-contentful-paint from the Paint Timing API
// All are in milliseconds from the start of the navigation.
// Apps are measured in turns (app 1, app 2, …, app 1, …) so that a slow
// moment of the machine does not fall on one app only.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { chromium } from "playwright";
import { serve } from "./serve.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const value = Number(args[i + 1]);
  args.splice(i, 2);
  return value;
};
const RUNS = option("--runs", 15);
const BUILDS = option("--builds", 5);
const apps = args.length > 0 ? args : ["cm-only", "vanilla", "preact", "solid", "svelte", "react"];

function stats(values) {
  const v = [...values].sort((a, b) => a - b);
  const at = (q) => v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)];
  const round = (x) => Math.round(x * 10) / 10;
  return { n: v.length, median: round(at(0.5)), p95: round(at(0.95)), min: round(v[0]), max: round(v[v.length - 1]) };
}

// 1. Build time.
const buildTimes = Object.fromEntries(apps.map((a) => [a, []]));
for (let round = 0; round < BUILDS; round++) {
  for (const app of apps) {
    const dir = join(root, "apps", app);
    const started = performance.now();
    execFileSync(process.execPath, [join(dir, "node_modules", "vite", "bin", "vite.js"), "build", "--logLevel", "error"], {
      cwd: dir,
      stdio: "inherit",
    });
    buildTimes[app].push(performance.now() - started);
  }
}

// 2. Page timing.
const OBSERVER = () => {
  const t = {};
  window.__s5Timing = t;
  const mark = (k) => {
    if (!(k in t)) t[k] = performance.now();
  };
  new MutationObserver(() => {
    if (document.querySelector("#app > *")) mark("firstRender");
    if (document.querySelector('[data-testid="editor"] .cm-content')) mark("editorReady");
  }).observe(document, { childList: true, subtree: true });
};

async function load(context, url, rate) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  await page.goto(url);
  await page.waitForFunction(() => window.__s5Timing && "firstRender" in window.__s5Timing && "editorReady" in window.__s5Timing, null, {
    timeout: 30000,
  });
  // Wait for the first paint entry, which comes after the frame is drawn.
  const result = await page.evaluate(
    () =>
      new Promise((done) => {
        const finish = () => {
          const fcp = performance.getEntriesByName("first-contentful-paint")[0];
          if (fcp) done({ ...window.__s5Timing, fcp: fcp.startTime });
          else requestAnimationFrame(finish);
        };
        finish();
      }),
  );
  await cdp.detach();
  await page.close();
  return result;
}

const servers = {};
for (const app of apps) servers[app] = await serve(join(root, "apps", app, "dist"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const chromeVersion = browser.version();
const samples = {};
const key = (app, cache, rate) => `${app}|${cache}|${rate}x`;
try {
  for (const rate of [1, 4]) {
    // Warm cache: one context per app, loaded once before the runs.
    const warm = {};
    for (const app of apps) {
      warm[app] = await browser.newContext();
      await warm[app].addInitScript(OBSERVER);
      await load(warm[app], servers[app].url, rate);
      await load(warm[app], servers[app].url, rate);
    }
    for (let run = 0; run < RUNS; run++) {
      for (const app of apps) {
        // Cold cache: a new context has an empty HTTP cache.
        const cold = await browser.newContext();
        await cold.addInitScript(OBSERVER);
        const c = await load(cold, servers[app].url, rate);
        await cold.close();
        (samples[key(app, "cold", rate)] ??= []).push(c);
        const w = await load(warm[app], servers[app].url, rate);
        (samples[key(app, "warm", rate)] ??= []).push(w);
      }
    }
    for (const app of apps) await warm[app].close();
  }
} finally {
  await browser.close();
  for (const s of Object.values(servers)) await s.close();
}

const results = { builds: {}, loads: {} };
for (const app of apps) results.builds[app] = stats(buildTimes[app]);
for (const [k, list] of Object.entries(samples)) {
  results.loads[k] = {
    firstRender: stats(list.map((s) => s.firstRender)),
    editorReady: stats(list.map((s) => s.editorReady)),
    fcp: stats(list.map((s) => s.fcp)),
  };
}

console.log("Build time (ms): median / p95, n");
for (const app of apps) {
  const b = results.builds[app];
  console.log(`  ${app.padEnd(9)} ${String(Math.round(b.median)).padStart(6)} / ${String(Math.round(b.p95)).padStart(6)}  n=${b.n}`);
}
console.log("Page load (ms from navigation start): median / p95");
console.log("  app       case         firstRender      editorReady      fcp");
for (const [k, r] of Object.entries(results.loads)) {
  const [app, cache, rate] = k.split("|");
  const f = (s) => `${s.median.toFixed(0).padStart(5)} / ${s.p95.toFixed(0).padStart(5)}`;
  console.log(`  ${app.padEnd(9)} ${`${cache} ${rate}`.padEnd(10)} ${f(r.firstRender)}    ${f(r.editorReady)}    ${f(r.fcp)}  n=${r.fcp.n}`);
}

const out = join(root, "results", "timing.json");
writeFileSync(
  out,
  JSON.stringify(
    {
      date: new Date().toISOString(),
      machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGB: Math.round(os.totalmem() / 2 ** 30), os: `${os.type()} ${os.release()}` },
      browser: `Chrome ${chromeVersion}`,
      node: process.version,
      runs: RUNS,
      builds: BUILDS,
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(`written: ${out}`);
