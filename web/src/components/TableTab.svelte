<script lang="ts">
  import { TABLE_PAGE, type Controller } from '../lib/controller.svelte';
  import { formatCount } from '../lib/format';
  import { TABLE_DIMS } from '../lib/urlstate';
  import Icon from './Icon.svelte';

  let { ctrl }: { ctrl: Controller } = $props();
  const t = $derived(ctrl.table);
  const s = $derived(ctrl.s);
  const dimLabel = (d: string): string =>
    ({
      orig: s.view === 'import' ? 'Origin region' : 'Origin',
      dest: s.view === 'export' ? 'Destination region' : 'Destination',
      sctg2: 'Commodity',
      dms_mode: 'Domestic mode',
      trade_type: 'Trade type',
    })[d] ?? d;
  const ALIAS: Record<string, string> = { orig: 'origin', dest: 'destination', sctg2: 'sctg2', dms_mode: 'domestic_mode', trade_type: 'trade_type' };

  function toggle(dim: string) {
    const set = new Set(s.tableDims);
    if (set.has(dim)) set.delete(dim);
    else set.add(dim);
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
  // each measure column carries a bar scaled to that column's largest value, so the table reads as a chart too
  const max = $derived({
    tons_kt: Math.max(1e-9, ...(t?.rows ?? []).map((r) => Number(r.tons_kt) || 0)),
    value_const_musd: Math.max(1e-9, ...(t?.rows ?? []).map((r) => Number(r.value_const_musd) || 0)),
    value_current_musd: Math.max(1e-9, ...(t?.rows ?? []).map((r) => Number(r.value_current_musd) || 0)),
    tmiles_m: Math.max(1e-9, ...(t?.rows ?? []).map((r) => Number(r.tmiles_m) || 0)),
  });
  const COLS = $derived<[keyof typeof max, string][]>([['tons_kt', 'Tons (thousand)'], ['value_const_musd', `Value, constant ${ctrl.benchmarkYear} $ (million)`], ['value_current_musd', 'Value, current $ (million)'], ['tmiles_m', 'Ton-miles (million)']]);
</script>

<div class="stack">
  <div class="card">
    <h3>Columns<small>rows are grouped by the ticked columns</small></h3>
    <div class="chips" role="group" aria-label="Table columns">
      {#each TABLE_DIMS as d}
        <button type="button" class="chip" aria-pressed={s.tableDims.includes(d)} onclick={() => toggle(d)}>{dimLabel(d)}</button>
      {/each}
    </div>
    <p class="help">The measures are always included. Choose fewer columns to see larger totals.</p>
    <button class="btn primary" type="button" onclick={download} disabled={busy || !t}><Icon name="download" size={14} />{busy ? 'Preparing…' : 'Download CSV'}</button>
  </div>

  {#if t}
    <p class="help">
      {formatCount(t.total)} row{t.total === 1 ? '' : 's'} for {ctrl.versionLabel} {s.year}, {s.scenario === 'mid' ? 'mid-range' : `${s.scenario} scenario`} ({ctrl.dataVersionOfYear}), {s.view} view, {s.direction} direction.
      {t.total > TABLE_PAGE ? `Showing the largest ${TABLE_PAGE}. The CSV has every row.` : ''}
      The CSV repeats version, scenario, year, status and dollar basis on every row. n/a means not published, not zero.
    </p>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region must be keyboard-reachable) -->
    <div class="tblscroll" tabindex="0" role="region" aria-label="Flow table">
      <table class="vt">
        <thead>
          <tr>
            {#each t.dims as d}<th scope="col">{dimLabel(d)}</th>{/each}
            {#each COLS as [, label]}<th scope="col" style="text-align:right">{label}</th>{/each}
          </tr>
        </thead>
        <tbody>
          {#each t.rows as r}
            <tr>
              {#each t.dims as d}<td>{r[`${ALIAS[d]}_label`] ?? ''}</td>{/each}
              {#each COLS as [k]}
                <td class="n" title={r[k] == null ? 'Not published' : ''}>{num(r[k])}{#if r[k] != null}<span class="cellbar" style={`width:${(Number(r[k]) / max[k]) * 100}%`}></span>{/if}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <div class="empty shimmer" style="height:200px"><span class="sr-only">Loading</span></div>
  {/if}
</div>
