// The S5 reference app in Preact with signals (APP-SPEC.md).

import { effect, useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { drawPlot } from "./draw";
import { mountEditor } from "./editor";
import { actions, editorText, plot, series } from "./store";
import { COLUMNS, ROW_COUNT, ROW_HEIGHT, cellValues, visibleRange } from "./table";
import { PLOT_STYLES, isPlotStyle, parseLineWidth, type Series } from "./types";

function SeriesItem({ item }: { item: Series }) {
  return (
    <li>
      <input
        type="checkbox"
        data-testid={`series-visible-${item.id}`}
        aria-label={item.name}
        checked={item.visible}
        onChange={(e) => {
          actions.setSeriesVisible(item.id, e.currentTarget.checked);
        }}
      />
      <input
        type="text"
        data-testid={`series-name-${item.id}`}
        aria-label={`Name of ${item.id}`}
        value={item.name}
        onInput={(e) => {
          actions.renameSeries(item.id, e.currentTarget.value);
        }}
      />
    </li>
  );
}

function SidePanel() {
  return (
    <aside className="side-panel">
      <h2>Series</h2>
      <ul data-testid="series-list">
        {series.value.map((s) => (
          <SeriesItem key={s.id} item={s} />
        ))}
      </ul>
    </aside>
  );
}

function LineWidthInput() {
  // The text can be invalid while the user types, so it is kept apart from the store.
  const text = useSignal(String(plot.peek().lineWidth));
  useSignalEffect(() => {
    const width = plot.value.lineWidth;
    if (parseLineWidth(text.peek()) !== width) text.value = String(width);
  });
  return (
    <input
      id="line-width"
      type="number"
      min="0.5"
      max="10"
      step="0.5"
      value={text}
      onInput={(e) => {
        text.value = e.currentTarget.value;
        const width = parseLineWidth(e.currentTarget.value);
        if (width !== null) actions.setPlot({ lineWidth: width });
      }}
    />
  );
}

function QuickPlot({ onAbout }: { onAbout: () => void }) {
  const { style, logY } = plot.value;
  return (
    <section className="quick-plot">
      <label htmlFor="plot-style">Plot style</label>
      <select
        id="plot-style"
        value={style}
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
      <LineWidthInput />
      <label htmlFor="log-y">Log y</label>
      <input
        id="log-y"
        type="checkbox"
        checked={logY}
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
  const ref = useRef<HTMLCanvasElement>(null);
  // Runs again when series or plot change. The component itself does not re-render.
  useSignalEffect(() => {
    const s = series.value;
    const p = plot.value;
    if (ref.current) drawPlot(ref.current, s, p);
  });
  return <canvas ref={ref} className="plot-canvas" data-testid="plot-canvas" width={600} height={300} />;
}

function Editor() {
  const parent = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!parent.current) return;
    const editor = mountEditor(parent.current, editorText.peek(), (t) => {
      editorText.value = t;
    });
    // Show changes made from outside. setText does nothing if the editor already has the text.
    const stop = effect(() => {
      editor.setText(editorText.value);
    });
    return () => {
      stop();
      editor.destroy();
    };
  }, []);
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
        <p>S5 reference app in Preact.</p>
        <button type="button" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </dialog>
    </>
  );
}
