// The S5 reference app in Solid (APP-SPEC.md).

import { For, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js";
import { drawPlot } from "./draw";
import { mountEditor } from "./editor";
import { actions, state } from "./store";
import { COLUMNS, ROW_COUNT, ROW_HEIGHT, cellValues, visibleRange } from "./table";
import { PLOT_STYLES, isPlotStyle, parseLineWidth } from "./types";

function SidePanel() {
  return (
    <aside class="side-panel">
      <h2>Series</h2>
      <ul data-testid="series-list">
        <For each={state.series}>
          {(item) => (
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
          )}
        </For>
      </ul>
    </aside>
  );
}

function LineWidthInput() {
  // The text can be invalid while the user types, so it is kept apart from the store.
  const [text, setText] = createSignal(String(untrack(() => state.plot.lineWidth)));
  createEffect(
    on(
      () => state.plot.lineWidth,
      (width) => {
        if (parseLineWidth(untrack(text)) !== width) setText(String(width));
      },
    ),
  );
  return (
    <input
      id="line-width"
      type="number"
      min="0.5"
      max="10"
      step="0.5"
      value={text()}
      onInput={(e) => {
        setText(e.currentTarget.value);
        const width = parseLineWidth(e.currentTarget.value);
        if (width !== null) actions.setPlot({ lineWidth: width });
      }}
    />
  );
}

function QuickPlot(props: { onAbout: () => void }) {
  return (
    <section class="quick-plot">
      <label for="plot-style">Plot style</label>
      <select
        id="plot-style"
        value={state.plot.style}
        onChange={(e) => {
          const value = e.currentTarget.value;
          if (isPlotStyle(value)) actions.setPlot({ style: value });
        }}
      >
        <For each={PLOT_STYLES}>{(s) => <option value={s.value}>{s.label}</option>}</For>
      </select>
      <label for="line-width">Line width</label>
      <LineWidthInput />
      <label for="log-y">Log y</label>
      <input
        id="log-y"
        type="checkbox"
        checked={state.plot.logY}
        onChange={(e) => {
          actions.setPlot({ logY: e.currentTarget.checked });
        }}
      />
      <button type="button" onClick={() => { props.onAbout(); }}>
        About
      </button>
    </section>
  );
}

function PlotCanvas() {
  let canvas!: HTMLCanvasElement;
  // Tracks every field that drawPlot reads, and runs again when one changes.
  createEffect(() => {
    drawPlot(canvas, state.series, state.plot);
  });
  return <canvas ref={canvas} class="plot-canvas" data-testid="plot-canvas" width={600} height={300} />;
}

function Editor() {
  let parent!: HTMLDivElement;
  onMount(() => {
    const editor = mountEditor(parent, state.editorText, (t) => {
      actions.setEditorText(t);
    });
    // Show changes made from outside. setText does nothing if the editor already has the text.
    createEffect(() => {
      editor.setText(state.editorText);
    });
    onCleanup(() => {
      editor.destroy();
    });
  });
  return <div ref={parent} class="editor" data-testid="editor" />;
}

function Table() {
  let scroll!: HTMLDivElement;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [height, setHeight] = createSignal(0);
  onMount(() => {
    const observer = new ResizeObserver(() => {
      setHeight(scroll.clientHeight);
    });
    observer.observe(scroll);
    onCleanup(() => {
      observer.disconnect();
    });
  });
  const indices = createMemo(() => {
    const { start, end } = visibleRange(scrollTop(), height());
    return Array.from({ length: end - start }, (_, k) => start + k);
  });
  return (
    <div class="table" role="table" aria-label="Data">
      <div class="table-header" role="row">
        <For each={COLUMNS}>{(c) => <span role="columnheader">{c}</span>}</For>
      </div>
      <div
        ref={scroll}
        class="table-scroll"
        data-testid="table-scroll"
        role="rowgroup"
        onScroll={(e) => {
          setScrollTop(e.currentTarget.scrollTop);
        }}
      >
        <div class="table-spacer" style={{ height: `${String(ROW_COUNT * ROW_HEIGHT)}px` }}>
          <For each={indices()}>
            {(i) => (
              <div
                class="table-row"
                role="row"
                data-testid="table-row"
                data-row-index={i}
                style={{ top: `${String(i * ROW_HEIGHT)}px` }}
              >
                <For each={cellValues(i)}>{(text) => <span role="cell">{text}</span>}</For>
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
    <>
      <div class="app">
        <SidePanel />
        <main class="main">
          <QuickPlot onAbout={() => { dialog.showModal(); }} />
          <PlotCanvas />
          <div class="bottom">
            <Editor />
            <Table />
          </div>
        </main>
      </div>
      <dialog ref={dialog} aria-labelledby="about-title">
        <h2 id="about-title">About figlab</h2>
        <p>S5 reference app in Solid.</p>
        <button type="button" onClick={() => { dialog.close(); }}>
          Close
        </button>
      </dialog>
    </>
  );
}
