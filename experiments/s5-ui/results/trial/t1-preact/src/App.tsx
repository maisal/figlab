import { effect } from "@preact/signals";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "preact/hooks";
import { drawPlot } from "./draw";
import { editorExtensions } from "./extensions";
import { hook, renameSeries, setEditorText, setPlot, setSeriesVisible, state } from "./store";
import { COLUMNS, ROW_COUNT, ROW_HEIGHT, cellValues, visibleRange } from "./table";
import { PLOT_STYLES, isPlotStyle, parseLineWidth } from "./types";

window.__store = hook;

function SeriesList() {
  return (
    <ul data-testid="series-list">
      {state.value.series.map((s) => (
        <li key={s.id}>
          <input
            type="checkbox"
            data-testid={`series-visible-${s.id}`}
            aria-label={s.name}
            checked={s.visible}
            onChange={(e) => {
              setSeriesVisible(s.id, e.currentTarget.checked);
            }}
          />
          <input
            type="text"
            data-testid={`series-name-${s.id}`}
            aria-label={`Name of ${s.id}`}
            value={s.name}
            onInput={(e) => {
              renameSeries(s.id, e.currentTarget.value);
            }}
          />
        </li>
      ))}
    </ul>
  );
}

function QuickPlot(props: { onAbout: () => void }) {
  const plot = state.value.plot;
  return (
    <div className="quick-plot">
      <div>
        <label htmlFor="plot-style">Plot style</label>
        <select
          id="plot-style"
          value={plot.style}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (isPlotStyle(v)) setPlot({ style: v });
          }}
        >
          {PLOT_STYLES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="line-width">Line width</label>
        <input
          id="line-width"
          type="number"
          min="0.5"
          max="10"
          step="0.5"
          value={plot.lineWidth}
          onInput={(e) => {
            const v = parseLineWidth(e.currentTarget.value);
            if (v !== null) setPlot({ lineWidth: v });
          }}
        />
      </div>
      <div>
        <input
          id="log-y"
          type="checkbox"
          checked={plot.logY}
          onChange={(e) => {
            setPlot({ logY: e.currentTarget.checked });
          }}
        />
        <label htmlFor="log-y">Log y</label>
      </div>
      <button type="button" onClick={props.onAbout}>
        About
      </button>
    </div>
  );
}

function PlotCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    return effect(() => {
      const { series, plot } = state.value;
      if (ref.current) drawPlot(ref.current, series, plot);
    });
  }, []);
  return <canvas ref={ref} className="plot-canvas" data-testid="plot-canvas" width={600} height={300} />;
}

function Editor() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const view = new EditorView({
      parent,
      doc: state.peek().editorText,
      extensions: [
        ...editorExtensions(),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          const text = u.state.doc.toString();
          if (text !== state.peek().editorText) setEditorText(text);
        }),
      ],
    });
    const stop = effect(() => {
      const text = state.value.editorText;
      const current = view.state.doc.toString();
      if (text !== current) {
        view.dispatch({ changes: { from: 0, to: current.length, insert: text } });
      }
    });
    return () => {
      stop();
      view.destroy();
    };
  }, []);
  return <div className="editor" data-testid="editor" ref={host} />;
}

function Table() {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(296);
  useEffect(() => {
    if (scroller.current) setHeight(scroller.current.clientHeight);
  }, []);
  const { start, end } = visibleRange(scrollTop, height);
  const rows = [];
  for (let i = start; i < end; i++) {
    const cells = cellValues(i);
    rows.push(
      <div
        key={i}
        className="table-row"
        role="row"
        data-testid="table-row"
        data-row-index={i}
        style={{ top: `${String(i * ROW_HEIGHT)}px` }}
      >
        <div role="cell">{cells[0]}</div>
        <div role="cell">{cells[1]}</div>
        <div role="cell">{cells[2]}</div>
      </div>,
    );
  }
  return (
    <div className="table" role="table">
      <div className="table-header" role="row">
        {COLUMNS.map((c) => (
          <div key={c} role="columnheader">
            {c}
          </div>
        ))}
      </div>
      <div
        className="table-scroll"
        data-testid="table-scroll"
        ref={scroller}
        onScroll={(e) => {
          setScrollTop(e.currentTarget.scrollTop);
        }}
      >
        <div className="table-spacer" style={{ height: `${String(ROW_COUNT * ROW_HEIGHT)}px` }}>
          {rows}
        </div>
      </div>
    </div>
  );
}

function AboutDialog(props: { dialogRef: { current: HTMLDialogElement | null } }) {
  return (
    <dialog ref={props.dialogRef} aria-labelledby="about-title">
      <h2 id="about-title">About figlab</h2>
      <p>figlab is a browser app for quick plots.</p>
      <button
        type="button"
        onClick={() => {
          props.dialogRef.current?.close();
        }}
      >
        Close
      </button>
    </dialog>
  );
}

export function App() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return (
    <div className="app">
      <aside className="side-panel">
        <SeriesList />
      </aside>
      <div className="main">
        <QuickPlot
          onAbout={() => {
            dialogRef.current?.showModal();
          }}
        />
        <PlotCanvas />
        <div className="bottom">
          <Editor />
          <Table />
        </div>
      </div>
      <AboutDialog dialogRef={dialogRef} />
    </div>
  );
}
