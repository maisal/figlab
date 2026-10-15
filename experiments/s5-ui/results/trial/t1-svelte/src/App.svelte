<script lang="ts">
  import { drawPlot } from "./draw";
  import { PLOT_STYLES, isPlotStyle, parseLineWidth } from "./types";
  import { renameSeries, setPlot, setSeriesVisible, store } from "./store.svelte";
  import Editor from "./Editor.svelte";
  import Table from "./Table.svelte";

  let canvas: HTMLCanvasElement | undefined = $state();
  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (canvas) drawPlot(canvas, store.series, store.plot);
  });
</script>

<div class="app">
  <aside class="side-panel">
    <ul data-testid="series-list">
      {#each store.series as s (s.id)}
        <li>
          <input
            type="checkbox"
            data-testid="series-visible-{s.id}"
            aria-label={s.name}
            checked={s.visible}
            onchange={(e) => {
              setSeriesVisible(s.id, e.currentTarget.checked);
            }}
          />
          <input
            type="text"
            data-testid="series-name-{s.id}"
            aria-label="Name of {s.id}"
            value={s.name}
            oninput={(e) => {
              renameSeries(s.id, e.currentTarget.value);
            }}
          />
        </li>
      {/each}
    </ul>
  </aside>
  <div class="main">
    <div class="quick-plot">
      <label for="plot-style">Plot style</label>
      <select
          id="plot-style"
          value={store.plot.style}
          onchange={(e) => {
            const v = e.currentTarget.value;
            if (isPlotStyle(v)) setPlot({ style: v });
          }}
        >
          {#each PLOT_STYLES as o (o.value)}
            <option value={o.value}>{o.label}</option>
          {/each}
      </select>
      <label for="line-width">Line width</label>
      <input
          id="line-width"
          type="number"
          min="0.5"
          max="10"
          step="0.5"
          value={store.plot.lineWidth}
          oninput={(e) => {
            const w = parseLineWidth(e.currentTarget.value);
            if (w !== null) setPlot({ lineWidth: w });
          }}
      />
      <label for="log-y">Log y</label>
      <input
          id="log-y"
          type="checkbox"
          checked={store.plot.logY}
          onchange={(e) => {
            setPlot({ logY: e.currentTarget.checked });
          }}
      />
      <button type="button" onclick={() => dialog?.showModal()}>About</button>
    </div>
    <canvas class="plot-canvas" data-testid="plot-canvas" width="600" height="300" bind:this={canvas}></canvas>
    <div class="bottom">
      <Editor />
      <Table />
    </div>
  </div>
</div>

<dialog bind:this={dialog} aria-labelledby="about-title">
  <h2 id="about-title">About figlab</h2>
  <p>A small plotting demo.</p>
  <button type="button" onclick={() => dialog?.close()}>Close</button>
</dialog>
