// Measures the startup of the stand-in app with Playwright.
//
// Usage: node scripts/measure.mjs [--runs N] [--other-runs N] [--browsers chrome,firefox,webkit]
//                                 [--variants plain,preact,react] [--out results/startup.json]
//
// Needs `pnpm run build` first. Each run starts a browser with a new, empty
// profile (first visit), closes it, and starts it again with the same profile
// (second visit, with the HTTP cache or the Service Worker cache). Chrome
// runs headless with network throttling (CDP Network.emulateNetworkConditions)
// on both visits, at CPU 1x and 4x slowdown (CDP Emulation.setCPUThrottlingRate).
// Firefox and WebKit have no throttling; they run as they are.

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";
import { startServer } from "./serve.mjs";
import { stats } from "./lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const RUNS = Number(arg("runs", "10"));
const OTHER_RUNS = Number(arg("other-runs", "5"));
const BROWSERS = arg("browsers", "chrome,firefox,webkit").split(",");
const VARIANTS = arg("variants", "plain,preact,react").split(",");
const OUT = join(root, arg("out", "results/startup.json"));
const PORT = Number(arg("port", "4610"));

// 10 Mbit/s down, 5 Mbit/s up, 40 ms round trip.
const NETWORK = { offline: false, latency: 40, downloadThroughput: 10e6 / 8, uploadThroughput: 5e6 / 8 };
const MARKS = [
  "fcp",
  "ui-painted",
  "render-ready",
  "compute-ready",
  "compute-answer",
  "lang-ready",
  "lang-answer",
  "usable",
  "font",
  "usable-font",
];
const PAGES = { plain: "index.html", preact: "preact.html", react: "react.html" };

// Browser profiles go in pkg/ (ignored by git). Firefox did not start with a
// profile in the system temp folder.
const PROFILES = join(root, "pkg", "profiles");
mkdirSync(PROFILES, { recursive: true });

const server = await startServer(PORT);
const base = `http://127.0.0.1:${PORT}/`;

async function visit(browser, dir, url, { cpu, lazy, sw }) {
  const type = browser === "chrome" ? chromium : browser === "firefox" ? firefox : webkit;
  const ctx = await type.launchPersistentContext(dir, {
    headless: true,
    ...(browser === "chrome" ? { channel: "chrome" } : {}),
  });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    if (browser === "chrome") {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", NETWORK);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    }
    await page.goto(url, { waitUntil: "commit" });
    await page.waitForFunction(() => window.__s4?.done, null, { timeout: 120000, polling: 100 });
    const result = await page.evaluate(() => ({
      marks: window.__s4.marks,
      errors: window.__s4.errors,
      resources: window.__s4.resources,
    }));
    if (lazy) {
      result.lazy = {};
      result.lazy.pdf = await page.evaluate(() => window.__s4.exportPdf());
      result.lazy.pdfAgain = await page.evaluate(() => window.__s4.exportPdf());
      result.lazy.png = await page.evaluate(() => window.__s4.exportPng());
      result.lazy.pngAgain = await page.evaluate(() => window.__s4.exportPng());
    }
    if (sw) await page.waitForFunction(() => window.__s4.swReady, null, { timeout: 120000, polling: 100 });
    // Give the browser time to write its caches (HTTP cache, wasm code cache).
    await page.waitForTimeout(2000);
    return result;
  } finally {
    await ctx.close();
  }
}

const cases = [];
for (const browser of BROWSERS) {
  const variants = browser === "chrome" ? VARIANTS : ["plain"];
  const cpus = browser === "chrome" ? [1, 4] : [1];
  const runs = browser === "chrome" ? RUNS : OTHER_RUNS;
  for (const variant of variants) {
    for (const mode of ["http", "sw"]) {
      for (const cpu of cpus) {
        cases.push({ browser, variant, mode, cpu, runs });
      }
    }
  }
}

const raw = [];
const summary = [];
const failed = [];
for (const c of cases) {
  try {
    await runCase(c);
  } catch (e) {
    // For example, a browser that cannot start here. Keep the other cases.
    console.log(`${c.browser} ${c.variant} ${c.mode} cpu${c.cpu} FAILED: ${e.message.split("\n")[0]}`);
    failed.push({ ...c, error: e.message.split("\n")[0] });
  }
}

async function runCase(c) {
  const url = base + PAGES[c.variant] + (c.mode === "sw" ? "?sw=1" : "");
  const lazy = c.variant === "plain" && c.mode === "http";
  const first = [];
  const second = [];
  for (let i = 0; i < c.runs; i++) {
    const dir = mkdtempSync(join(PROFILES, "p-"));
    try {
      const a = await visit(c.browser, dir, url, { cpu: c.cpu, lazy, sw: c.mode === "sw" });
      const b = await visit(c.browser, dir, url, { cpu: c.cpu, lazy, sw: false });
      first.push(a);
      second.push(b);
      raw.push({ ...c, run: i, first: a, second: b });
      const errs = [...a.errors, ...b.errors];
      console.log(
        `${c.browser} ${c.variant} ${c.mode} cpu${c.cpu} run ${i + 1}/${c.runs}: usable ${a.marks.usable} / ${b.marks.usable} ms, with font ${a.marks["usable-font"]} / ${b.marks["usable-font"]} ms${errs.length ? " ERRORS " + errs.join("; ") : ""}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  for (const [visitName, list] of [
    ["first", first],
    ["second", second],
  ]) {
    const marks = {};
    for (const m of MARKS) marks[m] = stats(list.map((r) => r.marks[m]).filter((v) => v !== undefined));
    const entry = { ...c, visit: visitName, marks };
    if (lazy) {
      entry.lazy = {};
      for (const k of ["pdf", "pdfAgain", "png", "pngAgain"]) {
        entry.lazy[k] = {
          total: stats(list.map((r) => r.lazy[k].total)),
          importJs: stats(list.map((r) => r.lazy[k].importJs)),
          instantiate: stats(list.map((r) => r.lazy[k].instantiate)),
          run: stats(list.map((r) => r.lazy[k].run)),
        };
      }
    }
    summary.push(entry);
  }
}

server.close();
const meta = {
  date: new Date().toISOString(),
  note: "Preliminary if other work ran on the machine at the same time.",
  network: NETWORK,
  runs: RUNS,
  otherRuns: OTHER_RUNS,
  browsers: {
    chrome: chromium.name(),
  },
};
const b = await chromium.launch({ channel: "chrome", headless: true });
meta.browsers.chrome = `Google Chrome ${b.version()}`;
await b.close();
for (const [name, type] of [
  ["firefox", firefox],
  ["webkit", webkit],
]) {
  if (!BROWSERS.includes(name)) continue;
  try {
    const x = await type.launch({ headless: true });
    meta.browsers[name] = `${name} ${x.version()} (Playwright build)`;
    await x.close();
  } catch {
    meta.browsers[name] = "could not start";
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ meta, failed, summary }, null, 2) + "\n");
// The raw data of every run is large, so it goes in pkg/ (not committed).
writeFileSync(join(root, "pkg", "startup-raw.json"), JSON.stringify({ meta, raw }) + "\n");

console.log(`\n${meta.browsers.chrome}; network ${NETWORK.downloadThroughput * 8e-6} Mbit/s, RTT ${NETWORK.latency} ms (Chrome only)`);
console.log("| Browser | UI | Cache | CPU | Visit | n | Usable median | Usable p95 | With font median | With font p95 |");
console.log("|---|---|---|---|---|---:|---:|---:|---:|---:|");
for (const s of summary) {
  const u = s.marks.usable;
  const f = s.marks["usable-font"];
  console.log(
    `| ${s.browser} | ${s.variant} | ${s.mode} | ${s.cpu}x | ${s.visit} | ${u.n} | ${u.median?.toFixed(0)} | ${u.p95?.toFixed(0)} | ${f.median?.toFixed(0)} | ${f.p95?.toFixed(0)} |`,
  );
}
console.log(`wrote ${OUT}`);
