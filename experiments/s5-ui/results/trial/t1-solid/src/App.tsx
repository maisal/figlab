import { createEffect, createSignal, For, onCleanup, onMount } from "solid-js";
import { EditorView } from "codemirror";
import { Annotation } from "@codemirror/state";
import { drawPlot } from "./draw";
import { editorExtensions } from "./extensions";
import { COLUMNS, cellValues, ROW_COUNT, ROW_HEIGHT, visibleRange } from "./table";
import { installHook, renameSeries, setEditorText, setPlot, setSeriesVisible, state } from "./store";
import { isPlotStyle, parseLineWidth, PLOT_STYLES } from "./types";

installHook();

const external = Annotation.define<boolean>();

function SidePanel() {
  return (
    <aside class="side-panel">
      <ul data-testid="series-list">
        <For each={state.series}>
          {(s) => (
            <li>
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
          )}
        </For>
      </ul>
    </aside>
  );
}

function QuickPlot(props: { onAbout: () => void }) {
  return (
    <div class="quick-plot">
      <label for="plot-style">Plot style</label>
      <select
        id="plot-style"
          value={state.plot.style}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (isPlotStyle(v)) setPlot({ style: v });
          }}
        >
          <For each={PLOT_STYLES}>
            {(o) => (
              <option value={o.value} selected={state.plot.style === o.value}>
                {o.label}
              </option>
            )}
          </For>
      </select>
      <label for="line-width">Line width</label>
      <input
        id="line-width"
          type="number"
          min="0.5"
          max="10"
          step="0.5"
          value={state.plot.lineWidth}
          onInput={(e) => {
            const w = parseLineWidth(e.currentTarget.value);
            if (w !== null) setPlot({ lineWidth: w });
          }}
      />
      <label for="log-y">Log y</label>
      <input
        id="log-y"
          type="checkbox"
          checked={state.plot.logY}
          onChange={(e) => {
            setPlot({ logY: e.currentTarget.checked });
          }}
      />
      <button
        type="button"
        onClick={() => {
          props.onAbout();
        }}
      >
        About
      </button>
    </div>
  );
}

function PlotCanvas() {
  let canvas!: HTMLCanvasElement;
  createEffect(() => {
    drawPlot(canvas, state.series, state.plot);
  });
  return <canvas ref={canvas} class="plot-canvas" data-testid="plot-canvas" width="600" height="300" />;
}

function Editor() {
  let host!: HTMLDivElement;
  onMount(() => {
    const view = new EditorView({
      doc: state.editorText,
      extensions: [
        ...editorExtensions(),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((t) => t.annotation(external))) {
            setEditorText(u.state.doc.toString());
          }
        }),
      ],
      parent: host,
    });
    createEffect(() => {
      const text = state.editorText;
      const current = view.state.doc.toString();
      if (text !== current) {
        view.dispatch({
          changes: { from: 0, to: current.length, insert: text },
          annotations: external.of(true),
        });
      }
    });
    onCleanup(() => {
      view.destroy();
    });
  });
  return <div ref={host} class="editor" data-testid="editor" />;
}

function Table() {
  const [scrollTop, setScrollTop] = createSignal(0);
  const [height, setHeight] = createSignal(296);
  let scroller!: HTMLDivElement;
  onMount(() => {
    setHeight(scroller.clientHeight);
  });
  const rows = () => {
    const { start, end } = visibleRange(scrollTop(), height());
    const out: number[] = [];
    for (let i = start; i < end; i++) out.push(i);
    return out;
  };
  return (
    <div class="table" role="table">
      <div class="table-header" role="row">
        <For each={COLUMNS}>{(c) => <div role="columnheader">{c}</div>}</For>
      </div>
      <div
        ref={scroller}
        class="table-scroll"
        data-testid="table-scroll"
        onScroll={(e) => {
          setScrollTop(e.currentTarget.scrollTop);
        }}
      >
        <div class="table-spacer" style={{ height: `${String(ROW_COUNT * ROW_HEIGHT)}px` }}>
          <For each={rows()}>
            {(i) => (
              <div
                class="table-row"
                role="row"
                data-testid="table-row"
                data-row-index={i}
                style={{ top: `${String(i * ROW_HEIGHT)}px` }}
              >
                <For each={cellValues(i)}>{(v) => <div role="cell">{v}</div>}</For>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

export function App() {
  let dialog!: HTMLDialogElement;
  return (
    <div class="app">
      <SidePanel />
      <div class="main">
        <QuickPlot
          onAbout={() => {
            dialog.showModal();
          }}
        />
        <PlotCanvas />
        <div class="bottom">
          <Editor />
          <Table />
        </div>
      </div>
      <dialog ref={dialog} aria-labelledby="about-title">
        <h2 id="about-title">About figlab</h2>
        <p>figlab quick plot demo.</p>
        <button
          type="button"
          onClick={() => {
            dialog.close();
          }}
        >
          Close
        </button>
      </dialog>
    </div>
  );
}
