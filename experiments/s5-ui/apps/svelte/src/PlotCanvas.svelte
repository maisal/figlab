<script lang="ts">
  import { drawPlot } from "./draw";
  import { app } from "./store.svelte";

  let canvas: HTMLCanvasElement;

  // Tracks every field that drawPlot reads, and runs again when one changes.
  $effect(() => {
    drawPlot(canvas, app.series, app.plot);
  });
</script>

<canvas bind:this={canvas} class="plot-canvas" data-testid="plot-canvas" width="600" height="300"></canvas>
