// Entry of the S5 reference app without a framework (APP-SPEC.md).
import "./styles.css";
import { h } from "./dom";
import { drawPlot } from "./draw";
import { mountEditor } from "./editor";
import { actions, store } from "./store";
import { COLUMNS, ROW_COUNT, ROW_HEIGHT, cellValues, visibleRange } from "./table";
import { PLOT_STYLES, isPlotStyle, parseLineWidth, type Series } from "./types";

window.__store = actions;

function seriesItem(series: Series): HTMLLIElement {
  const checkbox = h("input", {
    attrs: { type: "checkbox", "data-testid": `series-visible-${series.id}`, "aria-label": series.name },
    props: { checked: series.visible },
    on: { change: () => { actions.setSeriesVisible(series.id, checkbox.checked); } },
  });
  const name = h("input", {
    attrs: { type: "text", "data-testid": `series-name-${series.id}`, "aria-label": `Name of ${series.id}` },
    props: { value: series.name },
    on: { change: () => { actions.renameSeries(series.id, name.value); } },
  });
  store.subscribe((state) => {
    const s = state.series.find((x) => x.id === series.id);
    if (!s) return;
    checkbox.checked = s.visible;
    checkbox.setAttribute("aria-label", s.name);
    if (name.value !== s.name) name.value = s.name;
  });
  return h("li", {}, checkbox, name);
}

function sidePanel(): HTMLElement {
  const list = h("ul", { attrs: { "data-testid": "series-list" } }, ...store.get().series.map(seriesItem));
  return h("aside", { className: "side-panel" }, h("h2", {}, "Series"), list);
}

function aboutDialog(): HTMLDialogElement {
  const dialog = h(
    "dialog",
    { attrs: { "aria-labelledby": "about-title" } },
    h("h2", { attrs: { id: "about-title" } }, "About figlab"),
    h("p", {}, "S5 reference app without a framework."),
  );
  dialog.append(h("button", { attrs: { type: "button" }, on: { click: () => { dialog.close(); } } }, "Close"));
  return dialog;
}

function quickPlot(dialog: HTMLDialogElement): HTMLElement {
  const style = h(
    "select",
    {
      attrs: { id: "plot-style" },
      on: { change: () => { if (isPlotStyle(style.value)) actions.setPlot({ style: style.value }); } },
    },
    ...PLOT_STYLES.map((s) => h("option", { props: { value: s.value } }, s.label)),
  );
  const width = h("input", {
    attrs: { id: "line-width", type: "number", min: "0.5", max: "10", step: "0.5" },
    on: {
      input: () => {
        const value = parseLineWidth(width.value);
        if (value !== null) actions.setPlot({ lineWidth: value });
      },
    },
  });
  const logY = h("input", {
    attrs: { id: "log-y", type: "checkbox" },
    on: { change: () => { actions.setPlot({ logY: logY.checked }); } },
  });
  const show = () => {
    const { plot } = store.get();
    style.value = plot.style;
    if (parseLineWidth(width.value) !== plot.lineWidth) width.value = String(plot.lineWidth);
    logY.checked = plot.logY;
  };
  show();
  store.subscribe((state, previous) => {
    if (state.plot !== previous.plot) show();
  });
  return h(
    "section",
    { className: "quick-plot" },
    h("label", { attrs: { for: "plot-style" } }, "Plot style"),
    style,
    h("label", { attrs: { for: "line-width" } }, "Line width"),
    width,
    h("label", { attrs: { for: "log-y" } }, "Log y"),
    logY,
    h("button", { attrs: { type: "button" }, on: { click: () => { dialog.showModal(); } } }, "About"),
  );
}

function plotCanvas(): HTMLCanvasElement {
  const canvas = h("canvas", {
    className: "plot-canvas",
    attrs: { "data-testid": "plot-canvas", width: "600", height: "300" },
  });
  const draw = () => {
    const { series, plot } = store.get();
    drawPlot(canvas, series, plot);
  };
  draw();
  store.subscribe((state, previous) => {
    if (state.series !== previous.series || state.plot !== previous.plot) draw();
  });
  return canvas;
}

function editor(): HTMLElement {
  const parent = h("div", { className: "editor", attrs: { "data-testid": "editor" } });
  const handle = mountEditor(parent, store.get().editorText, (text) => { actions.setEditorText(text); });
  store.subscribe((state) => { handle.setText(state.editorText); });
  return parent;
}

function table(): HTMLElement {
  const spacer = h("div", { className: "table-spacer", attrs: { style: `height: ${String(ROW_COUNT * ROW_HEIGHT)}px` } });
  const scroll = h("div", { className: "table-scroll", attrs: { "data-testid": "table-scroll", role: "rowgroup" } }, spacer);
  let shown = { start: -1, end: -1 };
  const render = () => {
    const range = visibleRange(scroll.scrollTop, scroll.clientHeight);
    if (range.start === shown.start && range.end === shown.end) return;
    shown = range;
    const rows: HTMLElement[] = [];
    for (let i = range.start; i < range.end; i++) {
      rows.push(
        h(
          "div",
          {
            className: "table-row",
            attrs: { role: "row", "data-testid": "table-row", "data-row-index": String(i), style: `top: ${String(i * ROW_HEIGHT)}px` },
          },
          ...cellValues(i).map((text) => h("span", { attrs: { role: "cell" } }, text)),
        ),
      );
    }
    spacer.replaceChildren(...rows);
  };
  let frame = 0;
  scroll.addEventListener("scroll", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  });
  requestAnimationFrame(render);
  const header = h("div", { className: "table-header", attrs: { role: "row" } }, ...COLUMNS.map((c) => h("span", { attrs: { role: "columnheader" } }, c)));
  return h("div", { className: "table", attrs: { role: "table", "aria-label": "Data" } }, header, scroll);
}

const app = document.querySelector<HTMLElement>("#app");
if (app) {
  const dialog = aboutDialog();
  app.append(
    h(
      "div",
      { className: "app" },
      sidePanel(),
      h("main", { className: "main" }, quickPlot(dialog), plotCanvas(), h("div", { className: "bottom" }, editor(), table())),
    ),
    dialog,
  );
}
