<script lang="ts">
  import { COLUMNS, ROW_COUNT, ROW_HEIGHT, cellValues, visibleRange } from "./table";

  let scrollTop = $state(0);
  let viewportHeight = $state(296);

  const range = $derived(visibleRange(scrollTop, viewportHeight));
  const rows = $derived(Array.from({ length: range.end - range.start }, (_, k) => range.start + k));
</script>

<div class="table" role="table" aria-label="Data">
  <div class="table-header" role="row">
    {#each COLUMNS as c (c)}
      <div role="columnheader">{c}</div>
    {/each}
  </div>
  <div
    class="table-scroll"
    data-testid="table-scroll"
    bind:clientHeight={viewportHeight}
    onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
  >
    <div class="table-spacer" style:height="{ROW_COUNT * ROW_HEIGHT}px">
      {#each rows as i (i)}
        <div
          class="table-row"
          role="row"
          data-testid="table-row"
          data-row-index={i}
          style:top="{i * ROW_HEIGHT}px"
        >
          {#each cellValues(i) as v, j (j)}
            <div role="cell">{v}</div>
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>
