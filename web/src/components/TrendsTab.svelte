<script lang="ts">
  import { modeStackChart, trendChart } from '../lib/charts';
  import type { Controller } from '../lib/controller.svelte';
  import { rawUnit } from '../lib/format';
  import DataTable from './DataTable.svelte';
  import PlotChart from './PlotChart.svelte';

  let { ctrl }: { ctrl: Controller } = $props();
  const t = $derived(ctrl.trends);
  const unit = $derived(rawUnit(ctrl.s.measure));
  let share = $state(true);
  const mid = $derived((t?.points ?? []).filter((p) => p.scenario === 'mid'));
  const singleYear = $derived(mid.length < 2);
  const hasBand = $derived((t?.points ?? []).some((p) => p.scenario === 'high'));
  const otherVersion = $derived(ctrl.allowed.versions.find((v) => v !== ctrl.s.version));
  const fmt = (v: number) => ctrl.fmtMeasure(v);
  const rows = $derived(
    (t?.points ?? []).slice().sort((a, b) => a.year - b.year || a.scenario.localeCompare(b.scenario)).map((p) => [`${p.year}`, p.scenario === 'mid' ? 'mid-range' : p.scenario, p.data_version, fmt(p.v)]),
  );
</script>

<div class="opts">
  <label class="check"><input type="checkbox" checked={ctrl.s.overlayOther} onchange={(e) => ctrl.setOverlayOther(e.currentTarget.checked)} /><span>Also show FAF {otherVersion} as a separate series (different benchmark)</span></label>
</div>

{#if ctrl.s.overlayOther}
  <p class="notice" role="note">
    <strong>Benchmark break.</strong>
    {#each Object.values(ctrl.meta?.versions.products ?? {}).filter((p) => p.kind !== 'history' && !p.experimental) as p, i}{i ? ' and ' : ''}FAF {p.faf_version} ({p.benchmark_year} benchmark){/each}
    use different zone systems, benchmark years and dollar years. Their series are drawn separately and never joined; do not read the gap between them as growth or decline.
  </p>
{/if}

{#if singleYear}
  <p class="notice" role="note">{ctrl.versionLabel} publishes {mid[0]?.year ?? ctrl.s.year} only, so there is no trend yet. Future FAF releases add annual years; the other FAF version's series can be shown beside it above.</p>
{/if}

<h3>{ctrl.s.measure === 'tons' ? 'Tons' : ctrl.s.measure === 'value' ? 'Value' : 'Ton-miles'} by year{ctrl.s.measure === 'value' ? (ctrl.s.dollars === 'const' ? ` (constant ${ctrl.benchmarkYear} dollars)` : ' (current dollars)') : ''}</h3>
{#if t}
  <PlotChart theme={ctrl.theme} label={`Trend of ${ctrl.s.measure} by year for the current filters`} height={320}
    build={(c, w) => trendChart(t.points, t.other, c, w, unit, `FAF ${ctrl.s.version}`)} />
  <p class="key muted">
    <span>&#9670; benchmark year</span> <span>&#9679; final annual estimate</span> <span>&#9675; preliminary estimate</span> <span>&#9650; forecast (dashed line)</span>
    {#if hasBand}<span>shaded band: High and Low scenarios (published FAF forecasts; tons and value only)</span>{/if}
    {#if t.other}<span>&#9633; FAF {t.other.version}</span>{/if}
  </p>
  {#if !hasBand && ctrl.scenarioList.length > 1 && ctrl.s.measure === 'tmiles'}
    <p class="muted">High and Low scenarios are published for tons and value only, so no band is drawn for ton-miles.</p>
  {/if}
  <DataTable caption="Trend values" headers={['Year', 'Scenario', 'Status', ctrl.s.measure === 'tons' ? 'Tons' : ctrl.s.measure === 'value' ? 'Value' : 'Ton-miles']} {rows} />

  <h3>Mode share by year (mid-range, domestic leg)</h3>
  <div class="seg small" role="group" aria-label="Mode chart scale">
    <label><input type="radio" name="modescale" checked={share} onchange={() => (share = true)} /><span>Share of total</span></label>
    <label><input type="radio" name="modescale" checked={!share} onchange={() => (share = false)} /><span>Amount</span></label>
  </div>
  {#if t.modes.length}
    <PlotChart theme={ctrl.theme} label="Mode share by year" height={300} build={(c, w) => modeStackChart(t.modes, c, w, unit, share)} />
    <DataTable caption="Mode by year" headers={['Year', 'Mode', unit]} rows={t.modes.map((m) => [`${m.year}`, m.label, fmt(m.v)])} />
  {:else}<p class="muted">No mode data for these filters.</p>{/if}
{:else}<p class="muted">Loading the all-years data (downloaded once)…</p>{/if}

<style>
  .opts {
    margin: 4px 0 8px;
  }
  h3 {
    margin: 10px 0 2px;
    font-size: 13.5px;
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
