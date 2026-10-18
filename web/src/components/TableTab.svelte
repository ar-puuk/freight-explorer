<script lang="ts">
  import { TABLE_PAGE, type Controller } from '../lib/controller.svelte';
  import { formatCount } from '../lib/format';
  import { TABLE_DIMS } from '../lib/urlstate';

  let { ctrl }: { ctrl: Controller } = $props();
  const t = $derived(ctrl.table);
  const dimLabel = (d: string): string =>
    ({
      orig: ctrl.s.view === 'import' ? 'Origin region' : 'Origin',
      dest: ctrl.s.view === 'export' ? 'Destination region' : 'Destination',
      sctg2: 'Commodity',
      dms_mode: 'Domestic mode',
      trade_type: 'Trade type',
    })[d] ?? d;
  const ALIAS: Record<string, string> = { orig: 'origin', dest: 'destination', sctg2: 'sctg2', dms_mode: 'domestic_mode', trade_type: 'trade_type' };

  function toggle(dim: string, on: boolean) {
    const set = new Set(ctrl.s.tableDims);
    if (on) set.add(dim);
    else set.delete(dim);
    ctrl.setTableDims(TABLE_DIMS.filter((d) => set.has(d)));
  }
  const num = (v: unknown, digits = 1) => (v == null ? 'n/a' : Number(v).toLocaleString('en-US', { maximumFractionDigits: digits }));
  let busy = $state(false);
  async function download() {
    busy = true;
    try {
      await ctrl.exportCsv();
    } finally {
      busy = false;
    }
  }
</script>

<fieldset class="cols">
  <legend>Columns (rows are grouped by the ticked columns; measures are always included)</legend>
  {#each TABLE_DIMS as d}
    <label class="check"><input type="checkbox" checked={ctrl.s.tableDims.includes(d)} onchange={(e) => toggle(d, e.currentTarget.checked)} /><span>{dimLabel(d)}</span></label>
  {/each}
  <button class="btn primary" type="button" onclick={download} disabled={busy || !t}>{busy ? 'Preparing…' : 'Download CSV'}</button>
</fieldset>

{#if t}
  <p class="muted">
    {formatCount(t.total)} row{t.total === 1 ? '' : 's'} for {ctrl.versionLabel} {ctrl.s.year}, {ctrl.s.scenario === 'mid' ? 'mid-range' : `${ctrl.s.scenario} scenario`} ({ctrl.dataVersionOfYear}), {ctrl.s.view} view, {ctrl.s.direction} direction.
    {t.total > TABLE_PAGE ? `Showing the largest ${TABLE_PAGE}; the CSV has every row.` : ''}
    The CSV repeats version, scenario, year, status and dollar basis on every row. n/a means not published, not zero.
  </p>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region must be keyboard-reachable) -->
  <div class="scroll" tabindex="0" role="region" aria-label="Flow table">
    <table>
      <thead>
        <tr>
          {#each t.dims as d}<th scope="col">{dimLabel(d)}</th>{/each}
          <th scope="col" class="num">Tons (thousand)</th>
          <th scope="col" class="num">Value, constant {ctrl.benchmarkYear} $ (million)</th>
          <th scope="col" class="num">Value, current $ (million)</th>
          <th scope="col" class="num">Ton-miles (million)</th>
        </tr>
      </thead>
      <tbody>
        {#each t.rows as r}
          <tr>
            {#each t.dims as d}<td>{r[`${ALIAS[d]}_label`] ?? ''}</td>{/each}
            <td class="num">{num(r.tons_kt)}</td>
            <td class="num">{num(r.value_const_musd)}</td>
            <td class="num">{num(r.value_current_musd)}</td>
            <td class="num">{num(r.tmiles_m)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else}<p class="muted">Loading…</p>{/if}

<style>
  .cols {
    border: 0;
    padding: 0;
    margin: 0 0 8px;
    display: flex;
    gap: 6px 16px;
    flex-wrap: wrap;
    align-items: center;
  }
  .cols legend {
    font-weight: 650;
    margin-bottom: 4px;
  }
  .scroll {
    max-height: 300px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 12.5px;
  }
  th,
  td {
    padding: 3px 10px;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  th {
    position: sticky;
    top: 0;
    background: var(--surface-2);
  }
  .num {
    text-align: right;
    white-space: nowrap;
  }
</style>
