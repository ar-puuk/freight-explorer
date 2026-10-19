<script lang="ts">
  /** Accessible text alternative for a chart: the plotted numbers as a table. Collapsed by default so charts lead. */
  let { caption, headers, rows }: { caption: string; headers: string[]; rows: (string | number)[][] } = $props();
</script>

<details class="alt">
  <summary>Exact values: {caption}</summary>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region must be keyboard-reachable) -->
  <div class="scroll" tabindex="0" role="region" aria-label={caption}>
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
