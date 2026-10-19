<script lang="ts">
  import { commodityHeatChart, directionChart, modeStackChart, trendChart } from '../lib/charts';
  import type { Controller } from '../lib/controller.svelte';
  import { rawUnit } from '../lib/format';
  import { DIR_LABEL } from '../lib/ui';
  import DataTable from './DataTable.svelte';
  import Icon from './Icon.svelte';
  import PlotChart from './PlotChart.svelte';

  let { ctrl }: { ctrl: Controller } = $props();
  const t = $derived(ctrl.trends);
  const s = $derived(ctrl.s);
  const unit = $derived(rawUnit(s.measure));
  let share = $state(true);
  const mid = $derived((t?.points ?? []).filter((p) => p.scenario === 'mid'));
  const singleYear = $derived(mid.length < 2);
  const hasBand = $derived((t?.points ?? []).some((p) => p.scenario === 'high'));
  const otherVersion = $derived(ctrl.allowed.versions.find((v) => v !== s.version));
  const fmt = (v: number) => ctrl.fmtMeasure(v);
  const noun = $derived(s.measure === 'tons' ? 'Tons' : s.measure === 'value' ? 'Value' : 'Ton-miles');
  const th = $derived(`${ctrl.theme}${ctrl.cb}`);
  const rows = $derived((t?.points ?? []).slice().sort((a, b) => a.year - b.year || a.scenario.localeCompare(b.scenario)).map((p) => [`${p.year}`, p.scenario === 'mid' ? 'mid-range' : p.scenario, p.data_version, fmt(p.v)]));
</script>

<div class="stack">
  <div class="insight">
    <Icon name="spark" />
    <span>Each chart shows {noun.toLowerCase()} for the filters you set. Hatching marks years the release publishes nothing for. That is missing data, not zero. Forecast bars follow the scenario on the timeline, and the whiskers show the published High and Low. Click a bar to jump to that year.</span>
  </div>

  {#if singleYear && t}
    <div class="warnbox"><Icon name="info" /><span>{ctrl.versionLabel} publishes {mid[0]?.year ?? s.year} only, so there is no trend yet. Future FAF releases add annual years. The other FAF version's series can be drawn beside it below.</span></div>
  {/if}

  <div class="switchrow">
    <label for="ov">Also show FAF {otherVersion} as a separate series<small>Different benchmark. Never joined to this one.</small></label>
    <input class="sw-input" type="checkbox" role="switch" id="ov" checked={s.overlayOther} onchange={(e) => ctrl.setOverlayOther(e.currentTarget.checked)} />
  </div>
  {#if s.overlayOther}
    <div class="warnbox" role="note">
      <Icon name="alert" />
      <span><b>Benchmark break.</b>
        {#each Object.values(ctrl.meta?.versions.products ?? {}).filter((p) => p.kind !== 'history' && !p.experimental) as p, i}{i ? ' and ' : ''}FAF {p.faf_version} ({p.benchmark_year} benchmark){/each}
        use different zone systems, benchmark years and dollar years. Their series are drawn separately and never joined. Do not read the gap between them as growth or decline.</span>
    </div>
  {/if}

  {#if t}
    <div class="card">
      <h3>{noun} by year<small>{s.measure === 'value' ? (s.dollars === 'const' ? `constant ${ctrl.benchmarkYear} dollars` : 'current dollars') : unit}</small></h3>
      <PlotChart theme={th} label={`Trend of ${s.measure} by year for the current filters`} height={320} build={(c, w) => trendChart(t.points, t.other, c, w, unit, `FAF ${s.version}`, s.measure)} onband={undefined} />
      <p class="help">&#9670; benchmark year &nbsp; &#9679; final estimate &nbsp; &#9675; preliminary &nbsp; &#9650; forecast (dashed){#if hasBand}&nbsp; shaded band: High and Low scenarios (tons and value only){/if}{#if t.other}&nbsp; &#9633; FAF {t.other.version}{/if}</p>
      {#if !hasBand && ctrl.scenarioList.length > 1 && s.measure === 'tmiles'}<p class="help">High and Low scenarios are published for tons and value only, so no band is drawn for ton-miles.</p>{/if}
      <DataTable caption="Trend values" headers={['Year', 'Scenario', 'Status', noun]} {rows} />
    </div>

    <div class="card">
      <h3>Direction over time<small>{noun.toLowerCase()}</small></h3>
      {#if t.directions.length}
        <PlotChart theme={th} label="Inbound, outbound and within-state flows by year" height={250} onband={(y) => ctrl.setYear(Number(y))}
          build={(c, w) => directionChart(t.directions, s.scenario, s.year, c, w, s.measure, (d) => DIR_LABEL[d as 'inbound'])} />
        <div class="legendrow"><span><i style="background:var(--in)"></i>Inbound</span><span><i style="background:var(--out)"></i>Outbound</span><span><i style="background:var(--within)"></i>Within state</span></div>
        <DataTable caption="Direction by year" headers={['Year', 'Direction', noun]} rows={t.directions.filter((d) => d.scenario === 'mid').map((d) => [`${d.year}`, d.dir, fmt(d.v)])} />
      {:else}<div class="empty">Not published for these filters.</div>{/if}
    </div>

    <div class="card">
      <h3>Mode share by year<small>mid-range, domestic leg</small></h3>
      <div class="seg sm block" role="radiogroup" aria-label="Mode chart scale">
        <button type="button" role="radio" aria-checked={share} onclick={() => (share = true)}>Share of total</button>
        <button type="button" role="radio" aria-checked={!share} onclick={() => (share = false)}>Amount</button>
      </div>
      {#if t.modes.length}
        <PlotChart theme={th} label="Mode share by year" height={300} build={(c, w) => modeStackChart(t.modes, c, w, unit, share, s.measure)} />
        <DataTable caption="Mode by year" headers={['Year', 'Mode', unit]} rows={t.modes.map((m) => [`${m.year}`, m.label, fmt(m.v)])} />
      {:else}<div class="empty">No mode data for these filters.</div>{/if}
    </div>

    <div class="card">
      <h3>Commodity by year<small>darker is more</small></h3>
      {#if t.commodities.length}
        <PlotChart theme={th} label="Largest commodities by year, as a heatmap" height={340} onband={(y) => ctrl.setYear(Number(y))}
          build={(c, w) => commodityHeatChart(t.commodities, s.year, c, w, s.measure)} />
        <p class="help">The 14 largest commodities over all years. Empty cells are combinations with no flow, or years the release does not publish.</p>
        <DataTable caption="Commodity by year" headers={['Year', 'Commodity', noun]} rows={t.commodities.map((r) => [`${r.year}`, r.label, fmt(r.v)])} />
      {:else}<div class="empty">No commodity data for these filters.</div>{/if}
    </div>
  {:else}
    <div class="card"><div class="empty shimmer" style="height:240px">Loading the all-years data (downloaded once)…</div></div>
  {/if}
</div>
