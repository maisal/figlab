// The S5 reference app in React 19 (APP-SPEC.md).

import { useEffect, useRef, useState } from "react";
import { drawPlot } from "./draw";
import { mountEditor, type EditorHandle } from "./editor";
import { actions, getState, useAppState } from "./store";
import { COLUMNS, ROW_COUNT, ROW_HEIGHT, cellValues, visibleRange } from "./table";
import { PLOT_STYLES, isPlotStyle, parseLineWidth, type Series } from "./types";

function SeriesItem({ series }: { series: Series }) {
  return (
    <li>
      <input
        type="checkbox"
        data-testid={`series-visible-${series.id}`}
        aria-label={series.name}
        checked={series.visible}
        onChange={(e) => {
          actions.setSeriesVisible(series.id, e.currentTarget.checked);
        }}
      />
      <input
        type="text"
        data-testid={`series-name-${series.id}`}
        aria-label={`Name of ${series.id}`}
        value={series.name}
        onChange={(e) => {
          actions.renameSeries(series.id, e.currentTarget.value);
        }}
      />
    </li>
  );
}

function SidePanel() {
  const series = useAppState((s) => s.series);
  return (
    <aside className="side-panel">
      <h2>Series</h2>
      <ul data-testid="series-list">
        {series.map((s) => (
          <SeriesItem key={s.id} series={s} />
        ))}
      </ul>
    </aside>
  );
}

function LineWidthInput({ value }: { value: number }) {
  // The text can be invalid while the user types, so it is kept apart from the store.
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    if (parseLineWidth(text) !== value) setText(String(value));
  }
  return (
    <input
      id="line-width"
      type="number"
      min="0.5"
      max="10"
      step="0.5"
      value={text}
      onChange={(e) => {
        setText(e.currentTarget.value);
        const parsed = parseLineWidth(e.currentTarget.value);
        if (parsed !== null) actions.setPlot({ lineWidth: parsed });
      }}
    />
  );
}

function QuickPlot({ onAbout }: { onAbout: () => void }) {
  const plot = useAppState((s) => s.plot);
  return (
    <section className="quick-plot">
      <label htmlFor="plot-style">Plot style</label>
      <select
        id="plot-style"
        value={plot.style}
        onChange={(e) => {
          const value = e.currentTarget.value;
          if (isPlotStyle(value)) actions.setPlot({ style: value });
        }}
      >
        {PLOT_STYLES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <label htmlFor="line-width">Line width</label>
      <LineWidthInput value={plot.lineWidth} />
      <label htmlFor="log-y">Log y</label>
      <input
        id="log-y"
        type="checkbox"
        checked={plot.logY}
        onChange={(e) => {
          actions.setPlot({ logY: e.currentTarget.checked });
        }}
      />
      <button type="button" onClick={onAbout}>
        About
      </button>
    </section>
  );
}

function PlotCanvas() {
  const series = useAppState((s) => s.series);
  const plot = useAppState((s) => s.plot);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawPlot(ref.current, series, plot);
  }, [series, plot]);
  return <canvas ref={ref} className="plot-canvas" data-testid="plot-canvas" width={600} height={300} />;
}

function Editor() {
  const text = useAppState((s) => s.editorText);
  const parent = useRef<HTMLDivElement>(null);
  const handle = useRef<EditorHandle | null>(null);
  // Mount once. In StrictMode (development) React mounts, destroys, and mounts again.
  useEffect(() => {
    if (!parent.current) return;
    const editor = mountEditor(parent.current, getState().editorText, (t) => {
      actions.setEditorText(t);
    });
    handle.current = editor;
    return () => {
      editor.destroy();
      handle.current = null;
    };
  }, []);
  // Show changes made from outside. setText does nothing if the editor already has the text.
  useEffect(() => {
    handle.current?.setText(text);
  }, [text]);
  return <div ref={parent} className="editor" data-testid="editor" />;
}

function Table() {
  const scroll = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setHeight(el.clientHeight);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);
  const { start, end } = visibleRange(scrollTop, height);
  const rows = [];
  for (let i = start; i < end; i++) {
    rows.push(
      <div key={i} className="table-row" role="row" data-testid="table-row" data-row-index={i} style={{ top: i * ROW_HEIGHT }}>
        {cellValues(i).map((text, c) => (
          <span key={c} role="cell">
            {text}
          </span>
        ))}
      </div>,
    );
  }
  return (
    <div className="table" role="table" aria-label="Data">
      <div className="table-header" role="row">
        {COLUMNS.map((c) => (
          <span key={c} role="columnheader">
            {c}
          </span>
        ))}
      </div>
      <div
        ref={scroll}
        className="table-scroll"
        data-testid="table-scroll"
        role="rowgroup"
        onScroll={(e) => {
          setScrollTop(e.currentTarget.scrollTop);
        }}
      >
        <div className="table-spacer" style={{ height: ROW_COUNT * ROW_HEIGHT }}>
          {rows}
        </div>
      </div>
    </div>
  );
}

export function App() {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <div className="app">
        <SidePanel />
        <main className="main">
          <QuickPlot onAbout={() => dialog.current?.showModal()} />
          <PlotCanvas />
          <div className="bottom">
            <Editor />
            <Table />
          </div>
        </main>
      </div>
      <dialog ref={dialog} aria-labelledby="about-title">
        <h2 id="about-title">About figlab</h2>
        <p>S5 reference app in React.</p>
        <button type="button" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </dialog>
    </>
  );
}
