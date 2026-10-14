// Runs every S3 measurement in headless browsers and writes results/results.json
// and results/summary.md.
//
//   node measure.mjs [--quick] [--browsers chrome,firefox,webkit] [--skip-memory]
//
// It prints Markdown tables (summary.mjs) to stdout and progress to stderr.
// --quick runs fewer times and writes target/results-quick.json instead.
// Chrome is the installed Google Chrome (channel "chrome"). Firefox and WebKit
// are Playwright's own builds (`pnpm exec playwright install firefox webkit`).
// A browser that is not installed is skipped.

import { chromium, firefox, webkit } from "playwright";
import { execFile } from "node:child_process";
import { mkdir, open, stat, writeFile } from "node:fs/promises";
import { cpus, release, totalmem } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { serve } from "./serve.mjs";

const run = promisify(execFile);
const here = fileURLToPath(new URL(".", import.meta.url));
// Decimal units: 1 KB = 1000 bytes, 1 MB = 10^6 bytes. So 80 MB is 10 million f64.
const KB = 1000;
const MB = 1000 * 1000;

const args = process.argv.slice(2);
const quick = args.includes("--quick");
const skipMemory = args.includes("--skip-memory");
const browsersArg = args.includes("--browsers")
  ? args[args.indexOf("--browsers") + 1]
  : "chrome,firefox,webkit";
const wanted = browsersArg.split(",");

const sizes = [1 * KB, 64 * KB, 1 * MB, 8 * MB, 80 * MB, 400 * MB];
const fileSizes = [8 * MB, 80 * MB, 400 * MB];

const engines = {
  chrome: { type: chromium, options: { channel: "chrome" } },
  firefox: { type: firefox, options: {} },
  webkit: { type: webkit, options: {} },
};

function log(...a) {
  console.error(new Date().toISOString().slice(11, 19), ...a);
}

/** Test files of f64 values, made once in target/files/ (ignored by jj). */
async function makeFiles() {
  const dir = join(here, "target", "files");
  await mkdir(dir, { recursive: true });
  const paths = [];
  for (const bytes of fileSizes) {
    const path = join(dir, `data-${bytes / MB}MB.bin`);
    const ok = await stat(path).then(
      (s) => s.size === bytes,
      () => false,
    );
    if (!ok) {
      const fh = await open(path, "w");
      const chunk = new Float64Array(MB / 8);
      for (let off = 0; off < bytes; off += MB) {
        for (let i = 0; i < chunk.length; i++) chunk[i] = off / 8 + i;
        await fh.write(new Uint8Array(chunk.buffer));
      }
      await fh.close();
    }
    paths.push(path);
  }
  return paths;
}

/**
 * Resident memory in MB of all child processes of `rootPid`, at any depth, but
 * not of `rootPid` itself (macOS and Linux `ps`). With the root set to this
 * Node process, that is the browser and its helper processes.
 */
async function treeRssMB(rootPid) {
  const { stdout } = await run("ps", ["-A", "-o", "pid=,ppid=,rss="]);
  const rows = stdout
    .trim()
    .split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map();
  for (const [pid, ppid] of rows) {
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  const rss = new Map(rows.map(([pid, , r]) => [pid, r]));
  let total = 0;
  const stack = [...(kids.get(rootPid) ?? [])];
  while (stack.length) {
    const pid = stack.pop();
    total += rss.get(pid) ?? 0;
    stack.push(...(kids.get(pid) ?? []));
  }
  return total / 1024;
}

/** Runs `fn` while sampling memory every 20 ms. Returns the peak and the value at the end. */
async function withPeak(pid, fn) {
  let peak = await treeRssMB(pid);
  const before = peak;
  let stop = false;
  const sampler = (async () => {
    while (!stop) {
      peak = Math.max(peak, await treeRssMB(pid));
      await new Promise((r) => setTimeout(r, 20));
    }
  })();
  const result = await fn();
  await new Promise((r) => setTimeout(r, 200));
  stop = true;
  await sampler;
  const after = await treeRssMB(pid);
  peak = Math.max(peak, after);
  return {
    beforeMB: Math.round(before),
    peakMB: Math.round(peak),
    afterMB: Math.round(after),
    result,
  };
}

async function openPage(browser, url, filePaths) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => log("page error:", e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.benchReady === true);
  if (filePaths) await page.setInputFiles("#files", filePaths);
  const init = await page.evaluate(() => window.bench.init());
  return { context, page, init };
}

async function measureBrowser(name, url, coiUrl, filePaths) {
  const { type, options } = engines[name];
  let browser;
  try {
    browser = await type.launch({ headless: true, ...options });
  } catch (e) {
    log(`${name}: not available (${e.message.split("\n")[0]})`);
    return null;
  }
  const out = { browser: name, version: browser.version() };
  log(`${name} ${out.version}`);
  const { context, page, init } = await openPage(browser, url, filePaths);
  out.userAgent = await page.evaluate(() => navigator.userAgent);
  out.minSampleMs = init.minSampleMs;
  const step = async (label, fn) => {
    log(`${name}: ${label}`);
    const t0 = Date.now();
    try {
      out[label] = await fn();
    } catch (e) {
      out[label] = { error: String(e.message ?? e).split("\n")[0] };
      log(`${name}: ${label} failed: ${out[label].error}`);
    }
    log(`${name}: ${label} done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  };
  await step("env", () => page.evaluate(() => window.bench.env()));
  await step("messaging", () =>
    page.evaluate((a) => window.bench.messaging(a), { sizes, quick }),
  );
  await step("wasmCopies", () =>
    page.evaluate((a) => window.bench.wasmCopies(a), { sizes, quick }),
  );
  await step("e2e", () => page.evaluate((a) => window.bench.e2e(a), { quick }));
  await step("display", () =>
    page.evaluate((a) => window.bench.display(a), { quick }),
  );
  await step("files", () =>
    page.evaluate((a) => window.bench.files(a), { quick }),
  );
  await context.close();

  // Control: the same checks with COOP and COEP sent.
  await step("envWithCoopCoep", async () => {
    const c = await openPage(browser, coiUrl);
    const r = await c.page.evaluate(() => window.bench.env());
    await c.context.close();
    return r;
  });
  await browser.close();
  return out;
}

/**
 * Memory steps in Chrome: the resident memory of the browser and its children
 * between steps. `--js-flags=--expose-gc` lets the steps force a garbage collection.
 */
async function measureMemory(url, filePaths) {
  const browser = await chromium.launch({
    headless: true,
    channel: "chrome",
    args: ["--js-flags=--expose-gc"],
  });
  // Browser.process() is not available for launch(); the browser is a child of this process.
  const pid = process.pid;
  const n = 50_000_000; // 400 MB of f64
  const out = {
    browser: "chrome",
    version: browser.version(),
    arrayMB: (n * 8) / MB,
  };

  // Copy out of wasm memory and transfer to the page.
  {
    const { context, page } = await openPage(browser, url);
    const s = (step) =>
      withPeak(pid, () =>
        page.evaluate((a) => window.bench.memStep(a), { step, n }),
      );
    const steps = [];
    steps.push(["baseline", await withPeak(pid, async () => ({}))]);
    for (const step of [
      "alloc",
      "copyOut",
      "transfer",
      "free",
      "gc",
      "dropMain",
      "alloc",
    ]) {
      log(`memory: ${step}`);
      steps.push([step, await s(step)]);
    }
    out.copyOut = steps.map(([step, r]) => ({ step, ...r }));
    await context.close();
  }

  // Reading a 400 MB file into the worker's wasm memory, each way in a new page.
  out.copyIn = [];
  for (const step of ["readStream", "readArrayBuffer", "mainReadTransfer"]) {
    log(`memory: ${step}`);
    const { context, page } = await openPage(browser, url, filePaths);
    const fileIndex = filePaths.length - 1;
    await page.evaluate(() => window.bench.memStep({ step: "gc" }));
    const r = await withPeak(pid, () =>
      page.evaluate((a) => window.bench.memStep(a), { step, fileIndex }),
    );
    out.copyIn.push({
      step,
      fileMB: fileSizes[fileIndex] / MB,
      ...r,
      increaseMB: r.peakMB - r.beforeMB,
    });
    await context.close();
  }
  await browser.close();
  return out;
}

/** JSON with 2-space indents, but each object without nested objects on one line. */
export function toJson(value) {
  const text = JSON.stringify(value, null, 2);
  return (
    text.replace(
      /\{\n\s+([^{}[\]]*?)\n\s+\}/g,
      (_, body) => `{ ${body.replace(/,\n\s+/g, ", ")} }`,
    ) + "\n"
  );
}

async function machine() {
  const sh = async (cmd, a) =>
    (await run(cmd, a).catch(() => ({ stdout: "" }))).stdout.trim();
  return {
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    memoryGB: Math.round(totalmem() / 2 ** 30),
    os: (await sh("sw_vers", ["-productVersion"])) || release(),
    node: process.version,
    playwright: (
      await import("playwright/package.json", { with: { type: "json" } })
    ).default.version,
  };
}

const filePaths = await makeFiles();
const { server, url } = await serve();
const { server: coiServer, url: coiUrl } = await serve({ coi: true });
const results = {
  date: new Date().toISOString(),
  quick,
  machine: await machine(),
  browsers: [],
};
for (const name of wanted) {
  const r = await measureBrowser(name, url, coiUrl, filePaths);
  if (r) results.browsers.push(r);
}
if (!skipMemory && wanted.includes("chrome"))
  results.memory = await measureMemory(url, filePaths);
server.close();
coiServer.close();

// A quick run is only a smoke test, so its results go to target/ and are not committed.
const outDir = join(here, quick ? "target" : "results");
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, quick ? "results-quick.json" : "results.json");
await writeFile(outPath, toJson(results));
const { summary } = await import("./summary.mjs");
const tables = summary(results);
console.log(tables);
log(`wrote ${outPath}`);
if (!quick) {
  const head =
    "# S3 results\n\nMade by `pnpm run measure` (summary.mjs). The raw numbers are in results.json.\n\n";
  await writeFile(join(outDir, "summary.md"), head + tables + "\n");
  log(`wrote ${join(outDir, "summary.md")}`);
}
