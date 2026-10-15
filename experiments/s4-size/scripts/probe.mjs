// Checks three things in Chrome that the startup numbers depend on:
//
// 1. Does CDP CPU throttling slow down dedicated workers, or only the main thread?
// 2. Does CDP network throttling apply to fetches from dedicated workers?
// 3. Is Chrome's wasm code cache used on the second visit (HTTP cache and
//    Service Worker cache)? Read from the trace events v8.wasm.cachedModule
//    (code written to the cache) and v8.wasm.moduleCacheHit (code read back).
//
// Usage: node scripts/probe.mjs   (needs `pnpm run build`)

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startServer } from "./serve.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4611;
const server = await startServer(PORT);
const base = `http://127.0.0.1:${PORT}/`;
const out = {};

async function withPage(dir, fn) {
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, channel: "chrome" });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const cdp = await ctx.newCDPSession(page);
    return await fn(page, cdp);
  } finally {
    await ctx.close();
  }
}

// 1 and 2: throttling in workers.
{
  const dir = mkdtempSync(join(tmpdir(), "s4-probe-"));
  out.throttling = await withPage(dir, async (page, cdp) => {
    await page.goto(base + "index.html");
    await page.waitForFunction(() => window.__s4?.done, null, { timeout: 60000 });
    const font = await page.evaluate(() => performance.getEntriesByType("resource").find((r) => r.name.endsWith(".ttf")).name);
    const probe = (fontUrl) => {
      const busy = `let s = 0; for (let i = 0; i < 3e7; i++) s += Math.sqrt(i); s`;
      const fetchIt = `fetch(${JSON.stringify(fontUrl)} + "?" + Math.random(), { cache: "no-store" }).then((r) => r.arrayBuffer())`;
      const timeMain = async () => {
        const t0 = performance.now();
        // eslint-disable-next-line no-eval
        (0, eval)(busy);
        const t1 = performance.now();
        await (0, eval)(fetchIt);
        return { cpu: t1 - t0, fetch: performance.now() - t1 };
      };
      const timeWorker = () =>
        new Promise((resolve) => {
          const src = `onmessage = async () => { const t0 = performance.now(); ${busy}; const t1 = performance.now(); await ${fetchIt}; postMessage({ cpu: t1 - t0, fetch: performance.now() - t1 }); };`;
          const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
          w.onmessage = (e) => resolve(e.data);
          w.postMessage(0);
        });
      return Promise.all([timeMain(), timeWorker()]).then(([main, worker]) => ({ main, worker }));
    };
    const result = {};
    result.none = await page.evaluate(probe, font);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 10e6 / 8, uploadThroughput: 5e6 / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    result.throttled = await page.evaluate(probe, font);
    return result;
  });
  rmSync(dir, { recursive: true, force: true });
}

// 3: wasm code cache.
async function trace(page, cdp, fn) {
  const events = [];
  cdp.on("Tracing.dataCollected", (e) => events.push(...e.value));
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.start", {
    traceConfig: { includedCategories: ["devtools.timeline", "v8.wasm", "disabled-by-default-v8.wasm.detailed"] },
  });
  await fn();
  await cdp.send("Tracing.end");
  await done;
  const counts = {};
  for (const e of events) {
    if (!/wasm/i.test(e.name)) continue;
    const url = (e.args?.data?.url ?? e.args?.url ?? "").split("/").pop();
    const key = url ? `${e.name} ${url.replace(/-[\w-]{8}\.wasm$/, ".wasm")}` : e.name;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

out.codeCache = {};
for (const mode of ["http", "sw"]) {
  for (const use of ["startup", "after-use"]) {
    const dir = mkdtempSync(join(tmpdir(), "s4-probe-"));
    const url = base + "index.html" + (mode === "sw" ? "?sw=1" : "");
    const r = {};
    r.first = await withPage(dir, (page, cdp) =>
      trace(page, cdp, async () => {
        await page.goto(url);
        await page.waitForFunction(() => window.__s4?.done, null, { timeout: 60000 });
        if (use === "after-use") {
          // Run some code so that V8 tiers it up; caching happens after tier-up.
          await page.evaluate(async () => {
            for (let i = 0; i < 3; i++) await window.__s4.exportPng();
          });
        }
        if (mode === "sw") await page.waitForFunction(() => window.__s4.swReady, null, { timeout: 60000 });
        await page.waitForTimeout(5000);
      }),
    );
    r.second = await withPage(dir, (page, cdp) =>
      trace(page, cdp, async () => {
        await page.goto(url);
        await page.waitForFunction(() => window.__s4?.done, null, { timeout: 60000 });
        await page.waitForTimeout(1000);
      }),
    );
    out.codeCache[`${mode} ${use}`] = r;
    rmSync(dir, { recursive: true, force: true });
  }
}

server.close();
const b = await chromium.launch({ channel: "chrome", headless: true });
out.chrome = b.version();
await b.close();
writeFileSync(join(root, "results", "probe.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
