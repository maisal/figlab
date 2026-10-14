// Startup of the stand-in app, shared by the three UI variants.
//
// "Usable" (spec.md 13, ADR 0013) means: the UI is painted, the three startup
// wasm modules are instantiated (render on the main thread, compute and
// language service in workers), and the compute worker and the language
// service worker have each answered a first request.
// The bundled font is not part of it. It is measured on its own ("font",
// "usable-font"), because the UI and the command line work without it. On the
// first visit it still shares the network link with the modules.

import { EditorView, basicSetup } from "codemirror";
import initRender, * as render from "../../pkg/app/render/m_render.js";
// The bundled fonts are stored without hinting (ADR 0013).
import arimoUrl from "../../downloads/Arimo-Regular-nohint.ttf?url";

type Marks = Record<string, number>;

interface S4 {
  variant: string;
  marks: Marks;
  workers: Record<string, unknown>;
  resources: unknown[];
  done: boolean;
  swReady: boolean;
  errors: string[];
  exportPdf: () => Promise<Record<string, number>>;
  exportPng: () => Promise<Record<string, number>>;
}

declare global {
  interface Window {
    __s4: S4;
  }
}

const marks: Marks = {};
const s4: S4 = {
  variant: "",
  marks,
  workers: {},
  resources: [],
  done: false,
  swReady: false,
  errors: [],
  exportPdf: () => exportModule("pdf"),
  exportPng: () => exportModule("png"),
};
window.__s4 = s4;
addEventListener("error", (e) => s4.errors.push(String(e.message)));
addEventListener("unhandledrejection", (e) => s4.errors.push(String(e.reason)));

function mark(name: string, t = performance.now()) {
  marks[name] = Math.round(t * 10) / 10;
}
mark("bundle-start");

new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    if (e.name === "first-contentful-paint") mark("fcp", e.startTime);
  }
}).observe({ type: "paint", buffered: true });

/** Starts a worker and resolves with its messages "ready" and "answer". */
function startWorker(name: string, worker: Worker, first: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    worker.onerror = (e) => reject(new Error(`${name}: ${e.message}`));
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      // Worker times are absolute (timeOrigin + now); make them relative to ours.
      const rel = (t: number) => t - performance.timeOrigin;
      if (m.type === "ready") {
        mark(`${name}-script`, rel(m.scriptStart));
        mark(`${name}-ready`, rel(m.at));
        s4.workers[name] = { resources: m.resources };
        worker.postMessage(first);
      } else if (m.type === "answer") {
        mark(`${name}-answer`, rel(m.at));
        (s4.workers[name] as Record<string, unknown>).answer = m.value;
        resolve();
      } else if (m.type === "error") {
        reject(new Error(`${name}: ${m.message}`));
      }
    };
  });
}

let editor: EditorView | undefined;
let fontBytes: Uint8Array | undefined;

/** Called by the UI variant once its DOM exists. */
export async function boot(variant: string, editorParent: HTMLElement) {
  s4.variant = variant;
  mark("ui-built");
  editor = new EditorView({
    doc: "load \"scan01.csv\" into=sample1\nplot sample1.intensity vs sample1.energy\n",
    extensions: [basicSetup],
    parent: editorParent,
  });
  mark("editor-built");
  const painted = new Promise<void>((r) =>
    requestAnimationFrame(() => setTimeout(() => (mark("ui-painted"), r()), 0)),
  );

  const compute = startWorker(
    "compute",
    new Worker(new URL("./compute.worker.ts", import.meta.url), { type: "module" }),
    { cmd: "eval", src: "let x = linspace(0, 10, 1001)\nmean(sin(x) * exp(-x / 5))" },
  );
  const lang = startWorker(
    "lang",
    new Worker(new URL("./lang.worker.ts", import.meta.url), { type: "module" }),
    { cmd: "check", src: "plot y vs x style=markers colr=red" },
  );
  const renderReady = initRender().then(() => mark("render-ready"));
  const font = fetch(arimoUrl)
    .then((r) => r.arrayBuffer())
    .then(async (b) => {
      mark("font-fetched");
      await renderReady;
      fontBytes = new Uint8Array(b);
      if (!render.load_font(fontBytes.slice())) throw new Error("load_font failed");
      mark("font");
      // A first layout with real text, as for the first graph.
      const x = Float64Array.from({ length: 200 }, (_, i) => i / 20);
      const y = x.map((v) => Math.sin(v));
      render.svg(x, y);
      mark("first-layout");
    });

  try {
    await Promise.all([painted, compute, lang, renderReady]);
    mark("usable");
    await font;
    mark("usable-font");
  } catch (e) {
    s4.errors.push(String(e));
  }
  s4.resources = performance
    .getEntriesByType("resource")
    .map((r) => {
      const e = r as PerformanceResourceTiming;
      return {
        name: e.name.split("/").pop(),
        start: Math.round(e.startTime),
        end: Math.round(e.responseEnd),
        transfer: e.transferSize,
        body: e.encodedBodySize,
      };
    });
  s4.done = true;

  if (new URLSearchParams(location.search).has("sw") && "serviceWorker" in navigator) {
    // Register after startup, so precaching does not compete with it.
    await navigator.serviceWorker.register("./sw.js");
    const reg = await navigator.serviceWorker.ready;
    const sw = reg.active;
    if (sw) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("message", (e) => {
          if (e.data === "precached") resolve();
        });
        sw.postMessage("precached?");
      });
    }
    s4.swReady = true;
  }
}

/** Loads an export module on first use, then exports the current figure. */
async function exportModule(kind: "pdf" | "png"): Promise<Record<string, number>> {
  const t0 = performance.now();
  const x = Float64Array.from({ length: 200 }, (_, i) => i / 20);
  const y = x.map((v) => Math.sin(v));
  const draw = render.draw(x, y);
  const texts = "0\n2\n4\n6\n8\n10\n-1.0\n-0.5\n0.0\n0.5\n1.0\nEnergy (meV)\nIntensity (counts)";
  const t1 = performance.now();
  if (kind === "pdf") {
    const mod = await import("../../pkg/app/pdf/m_export_pdf.js");
    const t2 = performance.now();
    await mod.default();
    const t3 = performance.now();
    const out = mod.export_pdf(draw, texts, fontBytes!.slice(), 240, 180);
    const t4 = performance.now();
    return { draw: t1 - t0, importJs: t2 - t1, instantiate: t3 - t2, run: t4 - t3, total: t4 - t0, bytes: out.length };
  }
  const mod = await import("../../pkg/app/png/m_export_png.js");
  const t2 = performance.now();
  await mod.default();
  const t3 = performance.now();
  const out = mod.export_png(draw, 240, 180, 300);
  const t4 = performance.now();
  return { draw: t1 - t0, importJs: t2 - t1, instantiate: t3 - t2, run: t4 - t3, total: t4 - t0, bytes: out.length };
}

export function editorView() {
  return editor;
}
