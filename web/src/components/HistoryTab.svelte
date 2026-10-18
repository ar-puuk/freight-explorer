<script lang="ts">
  import { historyTotalsChart, modeStackChart, snapshotLinesChart } from '../lib/charts';
  import type { Controller } from '../lib/controller.svelte';
  import { rawUnit } from '../lib/format';
  import DataTable from './DataTable.svelte';
  import PlotChart from './PlotChart.svelte';

  let { ctrl }: { ctrl: Controller } = $props();
  const h = $derived(ctrl.history);
  const unit = $derived(rawUnit(ctrl.s.measure));
  const fmt = (v: number) => ctrl.fmtMeasure(v);
  let share = $state(true);
  const noun = $derived(ctrl.s.measure === 'tons' ? 'Tons' : ctrl.s.measure === 'value' ? 'Value' : 'Ton-miles');
  const hp = $derived(ctrl.historyProduct);
  const years = $derived(h?.years ?? []);
  const span = $derived(years.length ? `${years[0]} to ${years[years.length - 1]}` : '');
  const dollarNote = $derived(ctrl.s.measure === 'value' ? (ctrl.s.dollars === 'const' ? ` (constant ${hp?.benchmark_year} dollars)` : ' (current dollars)') : '');
</script>

<p class="notice" role="note">
  <strong>Historical state-level series, FAF5 reprocessed.</strong>
  {years.length ? years.join(', ') : 'Four'} only (five-year snapshots, not an annual series), published for states, not for FAF zones, and rebuilt with FAF5 methods and data sources
  so it is more consistent with the FAF5 series. Values are in {hp?.benchmark_year} dollars. BTS has said the history will be rebuilt on the FAF6 benchmark in a later release.
  The state, direction, commodity and mode filters on the left apply; the zone-level map does not.
</p>

<div class="opts">
  <label class="check"><input type="checkbox" checked={ctrl.s.historyOverlay} onchange={(e) => ctrl.setHistoryOverlay(e.currentTarget.checked)} /><span>Also show the {h?.faf5Label ?? ctrl.versionLabel} annual estimates for reference (separate series)</span></label>
</div>

{#if h}
  <h3>{noun}, {span}{dollarNote}</h3>
  {#if h.totals.length}
    <PlotChart theme={ctrl.theme} label={`Historical state-level ${ctrl.s.measure} by snapshot year`} height={300}
      build={(c, w) => historyTotalsChart(h.totals, h.faf5, h.faf5Label, c, w, unit)} />
    <p class="key muted"><span>+ historical snapshot (dotted line, FAF5 reprocessed)</span>{#if h.faf5}<span>&#9679; {h.faf5Label} annual estimate; &#9675; preliminary</span>{/if}</p>
    <DataTable caption="Historical totals" headers={['Year', noun]} rows={[...h.totals.map((t) => [`${t.year} (history)`, fmt(t.v)]), ...(h.faf5 ?? []).map((p) => [`${p.year} (${h.faf5Label}, ${p.data_version})`, fmt(p.v)])]} />
  {:else}<p class="muted">No historical flows with these filters.</p>{/if}

  <h3>Mode share by snapshot year</h3>
  <div class="seg small" role="group" aria-label="History mode chart scale">
    <label><input type="radio" name="histscale" checked={share} onchange={() => (share = true)} /><span>Share of total</span></label>
    <label><input type="radio" name="histscale" checked={!share} onchange={() => (share = false)} /><span>Amount</span></label>
  </div>
  {#if h.modes.length}
    <PlotChart theme={ctrl.theme} label="Historical mode share by year" height={300} build={(c, w) => modeStackChart(h.modes, c, w, unit, share)} />
    <DataTable caption="Historical mode by year" headers={['Year', 'Mode', unit]} rows={h.modes.map((m) => [`${m.year}`, m.label, fmt(m.v)])} />
  {/if}

  <h3>Largest {ctrl.s.view === 'import' ? 'origin regions' : ctrl.s.view === 'export' ? 'destination regions' : 'partner states'} over the snapshot years</h3>
  {#if h.partners.length}
    <PlotChart theme={ctrl.theme} label="Largest partners across the historical snapshot years" height={300} build={(c, w) => snapshotLinesChart(h.partners, c, w, unit)} />
    <DataTable caption="Partners by year" headers={['Partner', 'Year', unit]} rows={h.partners.flatMap((s) => s.points.map((p) => [s.label, `${p.year}`, fmt(p.v)]))} />
  {:else}<p class="muted">No partner flows with these filters (within-state flows have no partner).</p>{/if}

  <h3>Largest commodities over the snapshot years</h3>
  {#if h.commodities.length}
    <PlotChart theme={ctrl.theme} label="Largest commodities across the historical snapshot years" height={300} build={(c, w) => snapshotLinesChart(h.commodities, c, w, unit)} />
    <DataTable caption="Commodities by year" headers={['Commodity', 'Year', unit]} rows={h.commodities.flatMap((s) => s.points.map((p) => [s.label, `${p.year}`, fmt(p.v)]))} />
  {/if}
{:else}<p class="muted">Loading the historical series…</p>{/if}

<style>
  h3 {
    margin: 10px 0 2px;
    font-size: 13.5px;
  }
  .opts {
    margin: 4px 0 8px;
  }
  .key span {
    margin-right: 14px;
    white-space: nowrap;
  }
  .key {
    font-size: 12.5px;
    margin: 2px 0 6px;
  }
  .seg.small {
    margin: 4px 0;
  }
</style>
