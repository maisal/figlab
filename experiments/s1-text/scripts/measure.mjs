// Browser measurements of S1 with Playwright (headless). For each browser and
// device pixel ratio: compares glyph drawing with fillText, and times layout,
// draw data, drawing, and PDF writing in wasm. Timing numbers are preliminary when
// other jobs run on the machine.
//
// Usage: pnpm run measure            (Chrome, plus Firefox and WebKit if installed)
//        BROWSERS=chrome pnpm run measure
// Needs: scripts/fetch-fonts.sh, scripts/build-wasm.sh, the `outputs` bin, and
// scripts/check-pdf.sh first.
// Output: results/browser.json, images in dist/images/ (two of them also in results/)
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "playwright";
import { serve } from "./serve.mjs";

const REPS = Number(process.env.REPS ?? 100);
const want = (process.env.BROWSERS ?? "chrome,firefox,webkit").split(",");
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/`;
const kinds = {
  chrome: () => chromium.launch({ channel: "chrome", headless: true }),
  firefox: () => firefox.launch({ headless: true }),
  webkit: () => webkit.launch({ headless: true }),
};
const png = (url) => Buffer.from(url.split(",")[1], "base64");
// All images go to dist/images/. Two small ones are also kept in results/.
await mkdir("dist/images", { recursive: true });
const KEEP = ["compare-chrome-dpr2.png", "fallback-sheet-dpr1.png"];
const save = async (file, url) => {
  await writeFile(`dist/images/${file}`, png(url));
  if (KEEP.includes(file)) await writeFile(`results/${file}`, png(url));
};
const result = { reps: REPS, browsers: {} };

for (const name of want) {
  let browser;
  try {
    browser = await kinds[name]();
  } catch (e) {
    console.log(`${name}: not available (${String(e).split("\n")[0]})`);
    continue;
  }
  const r = { version: browser.version(), dpr: {} };
  for (const dpr of [1, 2]) {
    const ctx = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.waitForFunction(() => window.s1ready !== undefined, null, { timeout: 60000 });
    const ready = await page.evaluate(() => window.s1ready);
    if (ready !== true) throw new Error(`${name}: ${ready}`);
    const cmp = await page.evaluate(() => window.s1api.compare(1));
    await save(`compare-${name}-dpr${dpr}.png`, cmp.png);
    delete cmp.png;
    const adv = cmp.runs.map((x) => Math.abs(x.advanceDiffPt));
    const cdx = cmp.runs.filter((x) => x.centroidDx !== null).map((x) => Math.abs(x.centroidDx));
    const cdy = cmp.runs.filter((x) => x.centroidDy !== null).map((x) => Math.abs(x.centroidDy));
    cmp.summary = {
      maxAdvanceDiffPt: Math.max(...adv),
      maxCentroidDxDevicePx: Math.max(...cdx),
      maxCentroidDyDevicePx: Math.max(...cdy),
      meanCentroidDxDevicePx: cdx.reduce((a, b) => a + b, 0) / cdx.length,
    };
    if (name === "chrome") {
      const img = await page.evaluate(() => window.s1api.images(1));
      await save(`fallback-sheet-dpr${dpr}.png`, img.sheet);
      await save(`fallback-sheet-browser-dpr${dpr}.png`, img.sheetBrowser);
      await save(`sample-page-glyphs-dpr${dpr}.png`, img.page);
    }
    if (name === "chrome" && dpr === 2) {
      // Canvas glyphs versus the PDFs rendered by Ghostscript at the same scale.
      r.pdf = {};
      for (const f of ["krilla-noto", "pdfwriter-noto", "krilla-noto-768", "pdfwriter-noto-768"]) {
        const c = await page.evaluate((u) => window.s1api.compare(1, u), `/dist/pdf-render/${f}.png`);
        await save(`compare-canvas-vs-${f}.png`, c.png);
        delete c.png;
        const dx = c.runs.filter((x) => x.centroidDx !== null).map((x) => Math.abs(x.centroidDx));
        const dy = c.runs.filter((x) => x.centroidDy !== null).map((x) => Math.abs(x.centroidDy));
        c.summary = { maxCentroidDxDevicePx: Math.max(...dx), maxCentroidDyDevicePx: Math.max(...dy) };
        r.pdf[f] = c;
        console.log(`chrome canvas vs ${f} (gs): max centroid dx ${c.summary.maxCentroidDxDevicePx.toFixed(3)} px, dy ${c.summary.maxCentroidDyDevicePx.toFixed(3)} px, mean |ink diff| ${c.pixels.meanAbsDiff.toFixed(1)}`);
      }
    }
    const bench = {};
    for (const [label, id] of [["rustybuzz", 0], ["harfrust", 1]]) {
      bench[label] = await page.evaluate(([id, reps]) => window.s1api.bench(200, id, reps), [id, REPS]);
    }
    r.dpr[dpr] = { compare: cmp, bench };
    const b = bench.harfrust;
    console.log(
      `${name} ${r.version} dpr ${dpr}: max advance diff ${cmp.summary.maxAdvanceDiffPt.toFixed(4)} pt, ` +
        `max centroid dx ${cmp.summary.maxCentroidDxDevicePx.toFixed(3)} px, dy ${cmp.summary.maxCentroidDyDevicePx.toFixed(3)} px, ` +
        `mean |ink diff| ${cmp.pixels.meanAbsDiff.toFixed(1)}`,
    );
    console.log(
      `  200 labels (harfrust): layout ${b.layoutOnly.median.toFixed(2)} ms, +draw data ${b.layoutAndDrawData.median.toFixed(2)} ms ` +
        `(${b.drawDataBytes} B), draw cold ${b.drawCold.median.toFixed(2)} ms, cached ${b.drawCachedPaths.median.toFixed(2)} ms, ` +
        `cached+flush ${b.drawCachedPathsFlush.median.toFixed(2)} ms, fillText+flush ${b.fillTextFlush.median.toFixed(2)} ms, ` +
        `pdf krilla ${b.pdfKrilla.median.toFixed(2)} ms, pdf-writer ${b.pdfWriter.median.toFixed(2)} ms`,
    );
    await ctx.close();
  }
  result.browsers[name] = r;
  await browser.close();
}
server.close();
// Numbers rounded to 4 decimals to keep the file small.
const round = (k, v) => (typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v);
await writeFile("results/browser.json", JSON.stringify(result, round, 1) + "\n");
