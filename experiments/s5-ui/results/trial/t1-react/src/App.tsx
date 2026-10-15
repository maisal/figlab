import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, UIEvent } from "react";
import { EditorView } from "@codemirror/view";
import { Annotation } from "@codemirror/state";
import { drawPlot } from "./draw";
import { editorExtensions } from "./extensions";
import { COLUMNS, ROW_COUNT, ROW_HEIGHT, cellValues, visibleRange } from "./table";
import { PLOT_STYLES, isPlotStyle, parseLineWidth } from "./types";
import { getSnapshot, renameSeries, setEditorText, setPlot, setSeriesVisible, useStore } from "./store";

const fromStore = Annotation.define<boolean>();

function SidePanel() {
  const { series } = useStore();
  return (
    <aside className="side-panel">
      <ul data-testid="series-list">
        {series.map((s) => (
          <li key={s.id}>
            <input
              type="checkbox"
              data-testid={`series-visible-${s.id}`}
              aria-label={s.name}
              checked={s.visible}
              onChange={(e) => {
                setSeriesVisible(s.id, e.target.checked);
              }}
            />
            <input
              type="text"
              data-testid={`series-name-${s.id}`}
              aria-label={`Name of ${s.id}`}
              value={s.name}
              onChange={(e) => {
                renameSeries(s.id, e.target.value);
              }}
            />
          </li>
        ))}
      </ul>
    </aside>
  );
}

function QuickPlot({ onAbout }: { onAbout: () => void }) {
  const { plot } = useStore();
  const [draft, setDraft] = useState<string | null>(null);
  const shownWidth = draft !== null && parseLineWidth(draft) === plot.lineWidth ? draft : String(plot.lineWidth);
  const styleId = useId();
  const widthId = useId();
  const logId = useId();

  const onWidth = (e: ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value);
    const value = parseLineWidth(e.target.value);
    if (value !== null) setPlot({ lineWidth: value });
  };

  return (
    <section className="quick-plot">
      <label htmlFor={styleId}>Plot style</label>
      <select
        id={styleId}
        value={plot.style}
        onChange={(e) => {
          if (isPlotStyle(e.target.value)) setPlot({ style: e.target.value });
        }}
      >
        {PLOT_STYLES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <label htmlFor={widthId}>Line width</label>
      <input id={widthId} type="number" min="0.5" max="10" step="0.5" value={shownWidth} onChange={onWidth} />
      <label htmlFor={logId}>Log y</label>
      <input
        id={logId}
        type="checkbox"
        checked={plot.logY}
        onChange={(e) => {
          setPlot({ logY: e.target.checked });
        }}
      />
      <button type="button" onClick={onAbout}>
        About
      </button>
    </section>
  );
}

function PlotCanvas() {
  const { series, plot } = useStore();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawPlot(ref.current, series, plot);
  }, [series, plot]);
  return <canvas ref={ref} className="plot-canvas" data-testid="plot-canvas" width={600} height={300} />;
}

function Editor() {
  const { editorText } = useStore();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      doc: getSnapshot().editorText,
      extensions: [
        editorExtensions(),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((t) => t.annotation(fromStore))) {
            setEditorText(u.state.doc.toString());
          }
        }),
      ],
      parent: host.current,
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current !== editorText) {
      v.dispatch({
        changes: { from: 0, to: current.length, insert: editorText },
        annotations: fromStore.of(true),
      });
    }
  }, [editorText]);

  return <div ref={host} className="editor" data-testid="editor" />;
}

function Table() {
  const [scroll, setScroll] = useState({ top: 0, height: 296 });
  const { start, end } = visibleRange(scroll.top, scroll.height);
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight });
  };
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
        style={{ top: i * ROW_HEIGHT }}
      >
        {cells.map((c, j) => (
          <span key={j} role="cell">
            {c}
          </span>
        ))}
      </div>,
    );
  }
  return (
    <div className="table" role="table">
      <div className="table-header" role="row">
        {COLUMNS.map((c) => (
          <span key={c} role="columnheader">
            {c}
          </span>
        ))}
      </div>
      <div className="table-scroll" data-testid="table-scroll" onScroll={onScroll}>
        <div className="table-spacer" style={{ height: ROW_COUNT * ROW_HEIGHT }}>
          {rows}
        </div>
      </div>
    </div>
  );
}

function AboutDialog({ ref }: { ref: React.Ref<HTMLDialogElement> }) {
  const titleId = useId();
  return (
    <dialog ref={ref} aria-labelledby={titleId}>
      <h2 id={titleId}>About figlab</h2>
      <p>figlab is a tool for quick plots and publication figures.</p>
      <form method="dialog">
        <button type="submit">Close</button>
      </form>
    </dialog>
  );
}

export function App() {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <div className="app">
      <SidePanel />
      <div className="main">
        <QuickPlot
          onAbout={() => {
            dialog.current?.showModal();
          }}
        />
        <PlotCanvas />
        <div className="bottom">
          <Editor />
          <Table />
        </div>
      </div>
      <AboutDialog ref={dialog} />
    </div>
  );
}
