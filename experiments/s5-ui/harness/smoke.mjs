// The smoke test of the S5 reference app (APP-SPEC.md section 7).
// It uses only what APP-SPEC.md defines: data-testid attributes, labels,
// roles, the CodeMirror DOM classes, and the `window.__store` hook.
//
// Use: node harness/smoke.mjs <url>   (or import runSmoke from score.mjs)

import { chromium } from "playwright";

export const BEHAVIORS = [
  "loads",
  "series-toggle",
  "series-rename",
  "plot-controls",
  "editor-to-store",
  "store-to-editor",
  "editor-lint",
  "dialog",
  "table-virtual",
  "canvas-stable",
  "no-errors",
];

const INITIAL = {
  series: [1, 2, 3, 4].map((n) => ({ id: `s${n}`, name: `Series ${n}`, visible: true })),
  plot: { style: "line", lineWidth: 1.5, logY: false },
  editorText: "plot s1 s2 style=line\n",
};
const ROW_COUNT = 100_000;
const ROW_HEIGHT = 24;
const MAX_ROWS = 100;

const cells = (i) => [String(i), String(i * 2), String((i * 7919) % 10007)];

class Failure extends Error {}

function check(condition, message) {
  if (!condition) throw new Failure(message);
}

const json = (value) => JSON.stringify(value);

/** Run the smoke test against a served app. Returns [{ id, ok, detail }]. */
export async function runSmoke(url, { headless = true } = {}) {
  const browser = await chromium.launch({ channel: "chrome", headless });
  const errors = [];
  const results = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    page.on("pageerror", (error) => errors.push(`uncaught: ${error.message}`));
    page.on("console", (message) => {
      // The browser asks for /favicon.ico by itself. The app does not have to serve it.
      if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) {
        errors.push(`console.error: ${message.text()}`);
      }
    });

    // Helpers that use only the spec.
    const state = () => page.evaluate(() => window.__store.getState());
    const call = (name, ...args) =>
      page.evaluate(([n, a]) => {
        window.__store[n](...a);
      }, [name, args]);
    const canvasInfo = () =>
      page.evaluate(() => {
        const c = document.querySelector('[data-testid="plot-canvas"]');
        return c ? { count: Number(c.dataset.drawCount ?? 0), drawn: c.dataset.drawnSeries ?? null } : null;
      });
    const editorText = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="editor"] .cm-content .cm-line')]
          .map((line) => line.textContent)
          .join("\n"),
      );
    /** Poll `get` until `test` is true. Throws with the last value. */
    async function until(what, get, test, timeout = 2000) {
      const end = Date.now() + timeout;
      let value;
      for (;;) {
        value = await get();
        if (test(value)) return value;
        if (Date.now() > end) throw new Failure(`${what}: got ${json(value).slice(0, 300)}`);
        await page.waitForTimeout(25);
      }
    }
    /** Run `action` and check that the canvas was drawn again. */
    const drawFailures = [];
    async function expectDraw(what, action) {
      const before = (await canvasInfo())?.count ?? 0;
      await action();
      try {
        await until(`canvas drawn after ${what}`, canvasInfo, (c) => c !== null && c.count > before);
      } catch (e) {
        drawFailures.push(e.message);
        throw e;
      }
    }

    /**
     * Run `action` and record it if the canvas was drawn again. drawPlot reads
     * only the series and the plot settings, so editor text and table scrolling
     * must not draw (APP-SPEC.md section 6). canvas-stable reports these.
     */
    const extraDraws = [];
    async function expectNoDraw(what, action) {
      const before = (await canvasInfo())?.count ?? 0;
      await action();
      await page.waitForTimeout(150);
      const after = (await canvasInfo())?.count ?? 0;
      if (after !== before) extraDraws.push(`${what} (draw count ${before} -> ${after})`);
    }

    async function behavior(id, body) {
      try {
        await body();
        results.push({ id, ok: true, detail: "" });
      } catch (e) {
        const detail = e instanceof Failure ? e.message : String(e.message ?? e).split("\n")[0];
        results.push({ id, ok: false, detail });
      }
    }

    await page.goto(url);

    await behavior("loads", async () => {
      await page.waitForFunction(() => window.__store !== undefined, null, { timeout: 10000 });
      const s = await state();
      check(json(s) === json(INITIAL), `initial state is ${json(s)}`);
      const copyIsSafe = await page.evaluate(() => {
        const copy = window.__store.getState();
        copy.series[0].name = "changed";
        copy.plot.lineWidth = 9;
        const after = window.__store.getState();
        return after.series[0].name === "Series 1" && after.plot.lineWidth === 1.5;
      });
      check(copyIsSafe, "changing the result of getState() changed the store");
      await page.getByTestId("series-list").waitFor();
      for (const { id } of INITIAL.series) {
        check((await page.getByTestId(`series-visible-${id}`).count()) === 1, `no series-visible-${id}`);
        check((await page.getByTestId(`series-name-${id}`).count()) === 1, `no series-name-${id}`);
      }
      await page.locator('[data-testid="editor"] .cm-content').waitFor();
      await until("editor shows the initial text", editorText, (t) => t === INITIAL.editorText);
      const canvas = page.getByTestId("plot-canvas");
      check((await canvas.count()) === 1, "no single plot-canvas");
      check((await canvas.getAttribute("width")) === "600", "canvas width is not 600");
      check((await canvas.getAttribute("height")) === "300", "canvas height is not 300");
      await until("canvas drawn with all series", canvasInfo, (c) => c?.count >= 1 && c.drawn === "s1,s2,s3,s4");
      check((await page.getByTestId("table-scroll").count()) === 1, "no table-scroll");
      check((await page.getByRole("button", { name: "About", exact: true }).count()) === 1, "no About button");
      // Remember the canvas element to check later that it was never re-created.
      await page.evaluate(() => {
        window.__smokeCanvas = document.querySelector('[data-testid="plot-canvas"]');
      });
    });

    await behavior("series-toggle", async () => {
      const box = page.getByTestId("series-visible-s2");
      check(await box.isChecked(), "s2 is not checked at the start");
      await expectDraw("unchecking s2", () => box.uncheck());
      await until("s2 hidden in the store", state, (s) => s.series[1].visible === false);
      await until("canvas without s2", canvasInfo, (c) => c.drawn === "s1,s3,s4");
      await expectDraw("checking s2", () => box.check());
      await until("s2 shown in the store", state, (s) => s.series[1].visible === true);
      await until("canvas with s2", canvasInfo, (c) => c.drawn === "s1,s2,s3,s4");
      // From the store to the UI.
      await expectDraw("setSeriesVisible(s3, false)", () => call("setSeriesVisible", "s3", false));
      await until("s3 checkbox unchecked", () => page.getByTestId("series-visible-s3").isChecked(), (v) => v === false);
      await until("canvas without s3", canvasInfo, (c) => c.drawn === "s1,s2,s4");
      await call("setSeriesVisible", "s3", true);
      await until("s3 checkbox checked", () => page.getByTestId("series-visible-s3").isChecked(), (v) => v === true);
    });

    await behavior("series-rename", async () => {
      const input = page.getByTestId("series-name-s1");
      check((await page.getByLabel("Name of s1", { exact: true }).count()) === 1, 'no input labelled "Name of s1"');
      check((await input.inputValue()) === "Series 1", "the s1 input does not show Series 1");
      await input.fill("Alpha");
      await input.press("Enter");
      await until("s1 renamed in the store", state, (s) => s.series[0].name === "Alpha");
      await until(
        'checkbox named "Alpha"',
        () => page.getByRole("checkbox", { name: "Alpha", exact: true }).count(),
        (n) => n === 1,
      );
      await call("renameSeries", "s1", "Beta");
      await until("s1 input shows Beta", () => input.inputValue(), (v) => v === "Beta");
      check(json((await state()).series[0]) === json({ id: "s1", name: "Beta", visible: true }), "s1 is wrong");
    });

    await behavior("plot-controls", async () => {
      const style = page.getByLabel("Plot style", { exact: true });
      const width = page.getByLabel("Line width", { exact: true });
      const logY = page.getByLabel("Log y", { exact: true });
      check((await style.inputValue()) === "line", "Plot style does not show line");
      check(Number(await width.inputValue()) === 1.5, "Line width does not show 1.5");
      check(!(await logY.isChecked()), "Log y is checked at the start");
      await expectDraw("Plot style", () => style.selectOption("markers"));
      await until("plot.style is markers", state, (s) => s.plot.style === "markers");
      await expectDraw("Line width", () => width.fill("2.5"));
      await until("plot.lineWidth is 2.5", state, (s) => s.plot.lineWidth === 2.5);
      await width.fill("20");
      await page.waitForTimeout(150);
      check((await state()).plot.lineWidth === 2.5, "an out-of-range line width changed the store");
      await expectDraw("Log y", () => logY.check());
      await until("plot.logY is true", state, (s) => s.plot.logY === true);
      // From the store to the UI.
      await expectDraw("setPlot", () => call("setPlot", { style: "both", lineWidth: 4, logY: false }));
      await until("Plot style shows both", () => style.inputValue(), (v) => v === "both");
      await until("Line width shows 4", () => width.inputValue(), (v) => Number(v) === 4);
      await until("Log y unchecked", () => logY.isChecked(), (v) => v === false);
      check(json((await state()).plot) === json({ style: "both", lineWidth: 4, logY: false }), "plot is wrong");
    });

    const content = page.locator('[data-testid="editor"] .cm-content');

    await behavior("editor-to-store", () => expectNoDraw("typing in the editor", async () => {
      await content.click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("plot x y", { delay: 15 });
      await until("editorText after typing", state, (s) => s.editorText === "plot x y");
      check((await editorText()) === "plot x y", `editor shows ${json(await editorText())}`);
      await page.keyboard.press("Enter");
      await page.keyboard.type("let k = 42", { delay: 15 });
      await until("editorText after a second line", state, (s) => s.editorText === "plot x y\nlet k = 42");
      check((await editorText()) === "plot x y\nlet k = 42", `editor shows ${json(await editorText())}`);
    }));

    // Limit: a write-back of identical text by the editor cannot be seen here,
    // because UI changes do not go through window.__store. The test checks only
    // that the store keeps the text and that the cursor does not jump.
    await behavior("store-to-editor", () => expectNoDraw("setEditorText and typing", async () => {
      await call("setEditorText", "let a = 1\nplot a\n");
      await until("editor shows the text set in the store", editorText, (t) => t === "let a = 1\nplot a\n");
      await page.waitForTimeout(200);
      check((await state()).editorText === "let a = 1\nplot a\n", "the store changed after setEditorText");
      // Typing still works after a change from outside.
      await content.click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type("fit a", { delay: 15 });
      await until("editorText after typing", state, (s) => s.editorText === "let a = 1\nplot a\nfit a");
      check((await editorText()) === "let a = 1\nplot a\nfit a", `editor shows ${json(await editorText())}`);
      // Typing in the middle of the text: the cursor must not jump when the store follows.
      await page.keyboard.press("Home");
      await page.keyboard.type("re", { delay: 15 });
      await until("editorText after typing in the middle", state, (s) => s.editorText === "let a = 1\nplot a\nrefit a");
      check((await editorText()) === "let a = 1\nplot a\nrefit a", `editor shows ${json(await editorText())}`);
      // A second change from outside, after typing.
      await call("setEditorText", "plot b\n");
      await until("editor shows plot b", editorText, (t) => t === "plot b\n");
      await page.waitForTimeout(100);
      check((await state()).editorText === "plot b\n", "the store changed after the second setEditorText");
    }));

    await behavior("editor-lint", async () => {
      await call("setEditorText", "plot bad\n");
      await until(
        "a lint error mark on bad",
        () => page.evaluate(() => [...document.querySelectorAll('[data-testid="editor"] .cm-lintRange-error')].map((e) => e.textContent).join("")),
        (t) => t === "bad",
        3000,
      );
      await call("setEditorText", "plot good\n");
      await until(
        "no lint error mark",
        () => page.locator('[data-testid="editor"] .cm-lintRange-error').count(),
        (n) => n === 0,
        3000,
      );
    });

    await behavior("dialog", async () => {
      const dialog = page.getByRole("dialog", { name: "About figlab" });
      check(!(await dialog.isVisible()), "the dialog is open at the start");
      const about = page.getByRole("button", { name: "About", exact: true });
      await about.click();
      await dialog.waitFor({ state: "visible" });
      const modal = await dialog.evaluate((el) => el.matches(":modal") || el.getAttribute("aria-modal") === "true");
      check(modal, "the dialog is not modal");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" }).catch(() => {
        throw new Failure("Escape did not close the dialog");
      });
      await about.click();
      await dialog.waitFor({ state: "visible" }).catch(() => {
        throw new Failure("the dialog did not open again after Escape");
      });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await dialog.waitFor({ state: "hidden" }).catch(() => {
        throw new Failure("Close did not close the dialog");
      });
    });

    await behavior("table-virtual", async () => {
      const scroll = page.getByTestId("table-scroll");
      const info = (target) =>
        scroll.evaluate((el, target) => {
          const box = el.getBoundingClientRect();
          const rows = [...el.querySelectorAll('[data-testid="table-row"]')];
          const row = el.querySelector(`[data-testid="table-row"][data-row-index="${target}"]`);
          const r = row?.getBoundingClientRect();
          return {
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            scrollTop: el.scrollTop,
            count: rows.length,
            indices: rows.map((x) => Number(x.getAttribute("data-row-index"))),
            row: row
              ? {
                  top: r.top - box.top - el.clientTop,
                  bottom: box.top + el.clientTop + el.clientHeight - r.bottom,
                  height: r.height,
                  cells: [...row.children].map((c) => c.textContent.trim()),
                }
              : null,
          };
        }, target);
      /** Check that the rows from `first` to the last visible row are all rendered. */
      const covers = (t, first) => {
        const visible = Math.ceil(t.clientHeight / ROW_HEIGHT);
        const last = Math.min(ROW_COUNT - 1, first + visible - 1);
        const set = new Set(t.indices);
        for (let i = first; i <= last; i++) if (!set.has(i)) return false;
        return true;
      };
      let t = await until("rows rendered", () => info(0), (v) => v.count > 0 && v.row !== null);
      check(t.clientHeight >= 200 && t.clientHeight <= 600, `table-scroll height is ${t.clientHeight}`);
      check(Math.abs(t.scrollHeight - ROW_COUNT * ROW_HEIGHT) <= 1, `scroll height is ${t.scrollHeight}`);
      check(t.count <= MAX_ROWS, `${t.count} rows in the DOM`);
      check(json(t.row.cells) === json(cells(0)), `row 0 cells are ${json(t.row.cells)}`);
      check(Math.abs(t.row.height - ROW_HEIGHT) <= 0.5, `row height is ${t.row.height}`);
      check(covers(t, 0), "visible rows at the top are missing");

      await expectNoDraw("scrolling the table", () =>
        scroll.evaluate((el) => {
          el.scrollTop = 50000 * 24;
        }),
      );
      t = await until(
        "row 50000 at the top after scrolling",
        () => info(50000),
        (v) => v.row !== null && Math.abs(v.row.top) <= 1.5 && covers(v, 50000),
      );
      check(t.count <= MAX_ROWS, `${t.count} rows in the DOM after scrolling`);
      check(json(t.row.cells) === json(cells(50000)), `row 50000 cells are ${json(t.row.cells)}`);

      await scroll.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      t = await until(
        "row 99999 at the bottom after scrolling to the end",
        () => info(ROW_COUNT - 1),
        (v) => v.row !== null && Math.abs(v.row.bottom) <= 1.5,
      );
      check(t.count <= MAX_ROWS, `${t.count} rows in the DOM at the end`);
      check(json(t.row.cells) === json(cells(ROW_COUNT - 1)), `row 99999 cells are ${json(t.row.cells)}`);
      const first = ROW_COUNT - Math.ceil(t.clientHeight / ROW_HEIGHT);
      check(covers(t, first), "visible rows at the end are missing");
    });

    await behavior("canvas-stable", async () => {
      const same = await page.evaluate(() => {
        const now = document.querySelector('[data-testid="plot-canvas"]');
        return window.__smokeCanvas !== undefined && now === window.__smokeCanvas && now.isConnected;
      });
      check(same, "the canvas element was re-created or removed");
      check(drawFailures.length === 0, `not drawn again: ${drawFailures.join("; ")}`);
      check(extraDraws.length === 0, `drawn again without a change to series or plot: ${extraDraws.join("; ")}`);
    });

    await behavior("no-errors", async () => {
      check(errors.length === 0, errors.slice(0, 3).join(" | "));
    });

    await context.close();
  } finally {
    await browser.close();
  }
  return results;
}

/** Print one line per behavior. Returns true if all passed. */
export function printResults(results) {
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.id}${r.ok ? "" : `: ${r.detail}`}`);
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${results.length} behaviors passed`);
  return passed === results.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2];
  if (!url) {
    console.error("use: node harness/smoke.mjs <url>");
    process.exit(2);
  }
  const ok = printResults(await runSmoke(url));
  process.exit(ok ? 0 : 1);
}
