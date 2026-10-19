<script lang="ts">
  import { historyTotalsChart, modeStackChart, snapshotLinesChart } from '../lib/charts';
  import type { Controller } from '../lib/controller.svelte';
  import { rawUnit } from '../lib/format';
  import DataTable from './DataTable.svelte';
  import Icon from './Icon.svelte';
  import PlotChart from './PlotChart.svelte';

  let { ctrl }: { ctrl: Controller } = $props();
  const h = $derived(ctrl.history);
  const s = $derived(ctrl.s);
  const unit = $derived(rawUnit(s.measure));
  const fmt = (v: number) => ctrl.fmtMeasure(v);
  let share = $state(true);
  const noun = $derived(s.measure === 'tons' ? 'Tons' : s.measure === 'value' ? 'Value' : 'Ton-miles');
  const hp = $derived(ctrl.historyProduct);
  const years = $derived(h?.years ?? []);
  const span = $derived(years.length ? `${years[0]} to ${years[years.length - 1]}` : '');
  const dollarNote = $derived(s.measure === 'value' ? (s.dollars === 'const' ? ` (constant ${hp?.benchmark_year} dollars)` : ' (current dollars)') : '');
  const th = $derived(`${ctrl.theme}${ctrl.cb}`);
</script>

<div class="stack">
  <div class="warnbox" role="note">
    <Icon name="info" />
    <span><b>Historical state-level series, FAF5 reprocessed.</b>
      {years.length ? years.join(', ') : 'Four'} only (five-year snapshots, not an annual series), published for states, not for FAF zones, and rebuilt with FAF5 methods and data sources so it is more consistent with the FAF5 series.
      Values are in {hp?.benchmark_year} dollars. BTS has said the history will be rebuilt on the FAF6 benchmark in a later release. The shipment type, direction, commodity, mode and partner filters apply. The zone-level map does not.</span>
  </div>

  <div class="switchrow">
    <label for="ho">Also show the {h?.faf5Label ?? ctrl.versionLabel} annual estimates for reference<small>A separate, labeled series. Never joined to the history.</small></label>
    <input class="sw-input" type="checkbox" role="switch" id="ho" checked={s.historyOverlay} onchange={(e) => ctrl.setHistoryOverlay(e.currentTarget.checked)} />
  </div>

  {#if h}
    <div class="card">
      <h3>{noun}, {span}<small>{dollarNote.replace(/[()]/g, '').trim()}</small></h3>
      {#if h.totals.length}
        <PlotChart theme={th} label={`Historical state-level ${s.measure} by snapshot year`} height={300} build={(c, w) => historyTotalsChart(h.totals, h.faf5, h.faf5Label, c, w, unit, s.measure)} />
        <p class="help">+ historical snapshot (dotted line, FAF5 reprocessed){#if h.faf5}&nbsp; &#9679; {h.faf5Label} annual estimate; &#9675; preliminary{/if}</p>
        <DataTable caption="Historical totals" headers={['Year', noun]} rows={[...h.totals.map((t) => [`${t.year} (history)`, fmt(t.v)]), ...(h.faf5 ?? []).map((p) => [`${p.year} (${h.faf5Label}, ${p.data_version})`, fmt(p.v)])]} />
      {:else}<div class="empty">No historical flows with these filters.</div>{/if}
    </div>

    <div class="card">
      <h3>Mode share by snapshot year</h3>
      <div class="seg sm block" role="radiogroup" aria-label="History mode chart scale">
        <button type="button" role="radio" aria-checked={share} onclick={() => (share = true)}>Share of total</button>
        <button type="button" role="radio" aria-checked={!share} onclick={() => (share = false)}>Amount</button>
      </div>
      {#if h.modes.length}
        <PlotChart theme={th} label="Historical mode share by year" height={300} build={(c, w) => modeStackChart(h.modes, c, w, unit, share, s.measure)} />
        <DataTable caption="Historical mode by year" headers={['Year', 'Mode', unit]} rows={h.modes.map((m) => [`${m.year}`, m.label, fmt(m.v)])} />
      {:else}<div class="empty">No mode data for these filters.</div>{/if}
    </div>

    <div class="card">
      <h3>Largest {s.view === 'import' ? 'origin regions' : s.view === 'export' ? 'destination regions' : 'partner states'}<small>over the snapshot years</small></h3>
      {#if h.partners.length}
        <PlotChart theme={th} label="Largest partners across the historical snapshot years" height={300} build={(c, w) => snapshotLinesChart(h.partners, c, w, unit, s.measure)} />
        <DataTable caption="Partners by year" headers={['Partner', 'Year', unit]} rows={h.partners.flatMap((x) => x.points.map((p) => [x.label, `${p.year}`, fmt(p.v)]))} />
      {:else}<div class="empty">No partner flows with these filters (within-state flows have no partner).</div>{/if}
    </div>

    <div class="card">
      <h3>Largest commodities<small>over the snapshot years</small></h3>
      {#if h.commodities.length}
        <PlotChart theme={th} label="Largest commodities across the historical snapshot years" height={300} build={(c, w) => snapshotLinesChart(h.commodities, c, w, unit, s.measure)} />
        <DataTable caption="Commodities by year" headers={['Commodity', 'Year', unit]} rows={h.commodities.flatMap((x) => x.points.map((p) => [x.label, `${p.year}`, fmt(p.v)]))} />
      {/if}
    </div>
  {:else}
    <div class="card"><div class="empty shimmer" style="height:240px"><span class="sr-only">Loading the historical series</span></div></div>
  {/if}
</div>
