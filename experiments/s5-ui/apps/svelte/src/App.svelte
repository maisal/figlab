<script lang="ts">
  import { untrack } from "svelte";
  import DataTable from "./DataTable.svelte";
  import Editor from "./Editor.svelte";
  import PlotCanvas from "./PlotCanvas.svelte";
  import { app } from "./store.svelte";
  import { PLOT_STYLES, parseLineWidth } from "./types";

  let dialog: HTMLDialogElement;

  // The text can be invalid while the user types, so it is kept apart from the store.
  let widthText = $state(String(app.plot.lineWidth));
  $effect(() => {
    const width = app.plot.lineWidth;
    if (parseLineWidth(untrack(() => widthText)) !== width) widthText = String(width);
  });
</script>

<div class="app">
  <aside class="side-panel">
    <h2>Series</h2>
    <ul data-testid="series-list">
      {#each app.series as series (series.id)}
        <li>
          <input
            type="checkbox"
            data-testid="series-visible-{series.id}"
            aria-label={series.name}
            bind:checked={series.visible}
          />
          <input
            type="text"
            data-testid="series-name-{series.id}"
            aria-label="Name of {series.id}"
            bind:value={series.name}
          />
        </li>
      {/each}
    </ul>
  </aside>
  <main class="main">
    <section class="quick-plot">
      <label for="plot-style">Plot style</label>
      <select id="plot-style" bind:value={app.plot.style}>
        {#each PLOT_STYLES as style (style.value)}
          <option value={style.value}>{style.label}</option>
        {/each}
      </select>
      <label for="line-width">Line width</label>
      <input
        id="line-width"
        type="number"
        min="0.5"
        max="10"
        step="0.5"
        value={widthText}
        oninput={(e) => {
          widthText = e.currentTarget.value;
          const width = parseLineWidth(widthText);
          if (width !== null) app.plot.lineWidth = width;
        }}
      />
      <label for="log-y">Log y</label>
      <input id="log-y" type="checkbox" bind:checked={app.plot.logY} />
      <button type="button" onclick={() => { dialog.showModal(); }}>About</button>
    </section>
    <PlotCanvas />
    <div class="bottom">
      <Editor />
      <DataTable />
    </div>
  </main>
</div>

<dialog bind:this={dialog} aria-labelledby="about-title">
  <h2 id="about-title">About figlab</h2>
  <p>S5 reference app in Svelte.</p>
  <button type="button" onclick={() => { dialog.close(); }}>Close</button>
</dialog>
