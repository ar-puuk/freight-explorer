<script lang="ts">
  /** Accessible text alternative for a chart: the plotted numbers as a table. */
  let { caption, headers, rows }: { caption: string; headers: string[]; rows: (string | number)[][] } = $props();
</script>

<details class="alt">
  <summary>Data table: {caption}</summary>
  <div class="scroll">
    <table>
      <caption class="sr-only">{caption}</caption>
      <thead><tr>{#each headers as h, i}<th class:num={i > 0} scope="col">{h}</th>{/each}</tr></thead>
      <tbody>
        {#each rows as r}<tr>{#each r as c, i}<td class:num={i > 0}>{c}</td>{/each}</tr>{/each}
        {#if !rows.length}<tr><td colspan={headers.length} class="muted">No data for these filters.</td></tr>{/if}
      </tbody>
    </table>
  </div>
</details>

<style>
  .alt {
    margin: 4px 0 14px;
    padding: 0 8px;
    font-size: 12.5px;
  }
  .scroll {
    max-height: 220px;
    overflow: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    text-align: left;
    padding: 2px 8px 2px 0;
    border-bottom: 1px solid var(--border);
  }
  .num {
    text-align: right;
    white-space: nowrap;
  }
</style>
