// Entry of the S5 reference app (APP-SPEC.md), plain TypeScript and the DOM.
import "./styles.css";
import { EditorView } from "codemirror";
import { drawPlot } from "./draw";
import { editorExtensions } from "./extensions";
import { createStore, type Store } from "./store";
import { COLUMNS, ROW_COUNT, ROW_HEIGHT, cellValues, visibleRange } from "./table";
import { PLOT_STYLES, isPlotStyle, parseLineWidth } from "./types";

type Props = Record<string, string>;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

/** Each mount function returns a cleanup function. */
type Cleanup = () => void;

function mountSidePanel(host: HTMLElement, store: Store): Cleanup {
  const list = el("ul", { "data-testid": "series-list" });
  const rows = new Map<string, { box: HTMLInputElement; name: HTMLInputElement; label: HTMLLabelElement }>();

  for (const s of store.get().series) {
    const box = el("input", { type: "checkbox", "data-testid": `series-visible-${s.id}` });
    const label = el("label", {}, box);
    const name = el("input", { type: "text", "data-testid": `series-name-${s.id}`, "aria-label": `Name of ${s.id}` });
    box.addEventListener("click", () => {
      store.setSeriesVisible(s.id, box.checked);
    });
    name.addEventListener("input", () => {
      store.renameSeries(s.id, name.value);
    });
    name.addEventListener("change", () => {
      store.renameSeries(s.id, name.value);
    });
    list.append(el("li", {}, label, name));
    rows.set(s.id, { box, name, label });
  }

  function render(): void {
    for (const s of store.get().series) {
      const r = rows.get(s.id);
      if (!r) continue;
      r.box.checked = s.visible;
      r.box.setAttribute("aria-label", s.name);
      if (r.name.value !== s.name) r.name.value = s.name;
    }
  }
  render();
  host.append(el("h2", {}, "Series"), list);
  return store.subscribe((state, prev) => {
    if (state.series !== prev.series) render();
  });
}

function mountQuickPlot(host: HTMLElement, store: Store, dialog: HTMLDialogElement): Cleanup {
  const select = el("select", { id: "plot-style" });
  for (const s of PLOT_STYLES) select.append(el("option", { value: s.value }, s.label));
  const width = el("input", { id: "line-width", type: "number", min: "0.5", max: "10", step: "0.5" });
  const logY = el("input", { id: "log-y", type: "checkbox" });
  const about = el("button", { type: "button" }, "About");

  select.addEventListener("change", () => {
    if (isPlotStyle(select.value)) store.setPlot({ style: select.value });
  });
  width.addEventListener("input", () => {
    const v = parseLineWidth(width.value);
    if (v !== null) store.setPlot({ lineWidth: v });
  });
  logY.addEventListener("change", () => {
    store.setPlot({ logY: logY.checked });
  });
  about.addEventListener("click", () => {
    if (!dialog.open) dialog.showModal();
  });

  function render(): void {
    const { plot } = store.get();
    if (select.value !== plot.style) select.value = plot.style;
    if (parseLineWidth(width.value) !== plot.lineWidth) width.value = String(plot.lineWidth);
    logY.checked = plot.logY;
  }
  render();

  host.append(
    el("div", {}, el("label", { for: "plot-style" }, "Plot style"), " ", select),
    el("div", {}, el("label", { for: "line-width" }, "Line width"), " ", width),
    el("div", {}, el("label", { for: "log-y" }, "Log y"), " ", logY),
    about,
  );
  return store.subscribe((state, prev) => {
    if (state.plot !== prev.plot) render();
  });
}

function createDialog(): HTMLDialogElement {
  const title = el("h2", { id: "about-title" }, "About figlab");
  const close = el("button", { type: "button" }, "Close");
  const dialog = el("dialog", { "aria-labelledby": "about-title" }, title, el("p", {}, "figlab S5 reference app."), close);
  close.addEventListener("click", () => {
    dialog.close();
  });
  return dialog;
}

function mountCanvas(host: HTMLElement, store: Store): Cleanup {
  const canvas = el("canvas", { class: "plot-canvas", "data-testid": "plot-canvas", width: "600", height: "300" });
  host.append(canvas);
  const draw = (): void => {
    const { series, plot } = store.get();
    drawPlot(canvas, series, plot);
  };
  draw();
  return store.subscribe((state, prev) => {
    if (state.series !== prev.series || state.plot !== prev.plot) draw();
  });
}

function mountEditor(host: HTMLElement, store: Store): Cleanup {
  const view = new EditorView({
    doc: store.get().editorText,
    extensions: [
      editorExtensions(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) store.setEditorText(update.state.doc.toString());
      }),
    ],
    parent: host,
  });
  const unsubscribe = store.subscribe((state) => {
    const current = view.state.doc.toString();
    if (current !== state.editorText) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: state.editorText } });
    }
  });
  return () => {
    unsubscribe();
    view.destroy();
  };
}

function mountTable(host: HTMLElement): Cleanup {
  const header = el("div", { class: "table-header", role: "row" });
  for (const c of COLUMNS) header.append(el("div", { role: "columnheader" }, c));
  const spacer = el("div", { class: "table-spacer" });
  spacer.style.height = `${String(ROW_COUNT * ROW_HEIGHT)}px`;
  const scroll = el("div", { class: "table-scroll", "data-testid": "table-scroll" }, spacer);
  const table = el("div", { class: "table", role: "table" }, header, scroll);
  host.append(table);

  let start = -1;
  let end = -1;
  let frame = 0;

  function render(): void {
    frame = 0;
    const range = visibleRange(scroll.scrollTop, scroll.clientHeight);
    if (range.start === start && range.end === end) return;
    start = range.start;
    end = range.end;
    const rows: HTMLElement[] = [];
    for (let i = range.start; i < range.end; i++) {
      const row = el("div", { class: "table-row", role: "row", "data-testid": "table-row", "data-row-index": String(i) });
      row.style.top = `${String(i * ROW_HEIGHT)}px`;
      for (const text of cellValues(i)) row.append(el("div", { role: "cell" }, text));
      rows.push(row);
    }
    spacer.replaceChildren(...rows);
  }
  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(render);
  };
  scroll.addEventListener("scroll", schedule);
  render();
  return () => {
    scroll.removeEventListener("scroll", schedule);
    if (frame !== 0) cancelAnimationFrame(frame);
  };
}

function mountApp(host: HTMLElement): Cleanup {
  const store = createStore();
  window.__store = store;

  const root = el("div", { class: "app" });
  const side = el("aside", { class: "side-panel" });
  const main = el("div", { class: "main" });
  const quick = el("section", { class: "quick-plot" });
  const bottom = el("div", { class: "bottom" });
  const editorHost = el("div", { class: "editor", "data-testid": "editor" });
  const tableHost = el("div", {});
  const dialog = createDialog();

  bottom.append(editorHost, tableHost);
  main.append(quick, el("div", { class: "canvas-wrap" }), bottom);
  root.append(side, main, dialog);
  host.append(root);

  const canvasWrap = main.querySelector<HTMLElement>(".canvas-wrap");
  if (!canvasWrap) throw new Error("canvas wrapper missing");

  const cleanups = [
    mountSidePanel(side, store),
    mountQuickPlot(quick, store, dialog),
    mountCanvas(canvasWrap, store),
    mountEditor(editorHost, store),
    mountTable(tableHost),
  ];
  return () => {
    for (const c of cleanups) c();
    root.remove();
  };
}

const app = document.querySelector<HTMLElement>("#app");
if (app) mountApp(app);
