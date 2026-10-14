<script lang="ts">
  import { COLUMNS, ROW_COUNT, ROW_HEIGHT, cellValues, visibleRange } from "./table";

  let scrollTop = $state(0);
  let height = $state(0);
  const indices = $derived.by(() => {
    const { start, end } = visibleRange(scrollTop, height);
    return Array.from({ length: end - start }, (_, k) => start + k);
  });
</script>

<div class="table" role="table" aria-label="Data">
  <div class="table-header" role="row">
    {#each COLUMNS as column (column)}
      <span role="columnheader">{column}</span>
    {/each}
  </div>
  <div
    class="table-scroll"
    data-testid="table-scroll"
    role="rowgroup"
    bind:clientHeight={height}
    onscroll={(e) => {
      scrollTop = e.currentTarget.scrollTop;
    }}
  >
    <div class="table-spacer" style:height="{ROW_COUNT * ROW_HEIGHT}px">
      {#each indices as i (i)}
        <div class="table-row" role="row" data-testid="table-row" data-row-index={i} style:top="{i * ROW_HEIGHT}px">
          {#each cellValues(i) as text, c (c)}
            <span role="cell">{text}</span>
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>
