<script lang="ts">
  import { compareChart, deltaBarsChart, dumbbellChart } from '../lib/charts';
  import type { Controller } from '../lib/controller.svelte';
  import { formatBig, formatPercent, formatShort, percentChange, rawUnit } from '../lib/format';
  import { DIR_VAR, groupVar, modeColor, modeVar } from '../lib/palette';
  import { DIR_LABEL, DIRS, shortMode, STATUS_LABEL, trunc } from '../lib/ui';
  import DataTable from './DataTable.svelte';
  import Icon from './Icon.svelte';
  import PlotChart from './PlotChart.svelte';

  let { ctrl }: { ctrl: Controller } = $props();
  const s = $derived(ctrl.s);
  const cmp = $derived(s.compare);
  const unit = $derived(rawUnit(s.measure));
  const th = $derived(`${ctrl.theme}${ctrl.cb}`);
  const fmt = (v: number) => ctrl.fmtMeasure(v);
  const noun = $derived(s.measure === 'tons' ? 'Tons' : s.measure === 'value' ? 'Value' : 'Ton-miles');

  // ---- series of chosen zones or commodities
  const options = $derived(
    cmp.kind === 'zone'
      ? [...ctrl.locations.values()].filter((l) => l.type !== 'foreign_region').sort((a, b) => a.name.localeCompare(b.name)).map((l) => ({ id: l.id, label: `${l.name}${l.is_state_zone ? ' (in state)' : ''}` }))
      : Object.entries(ctrl.dim.commodity).map(([id, label]) => ({ id, label: `${label} (${id})` })),
  );
  const label = (id: string) => options.find((o) => o.id === id)?.label ?? id;
  let pick = $state('');
  const seriesRows = $derived(ctrl.compareSeries.flatMap((x) => x.points.map((p) => [x.label, `${p.year}`, p.data_version, fmt(p.v)])));

  // ---- two years
  const yc = $derived(ctrl.cmpYears);
  const products = $derived(ctrl.meta!.versions.products[ctrl.product]);
  const SHORT: Record<string, string> = { base: 'benchmark', final: 'final', preliminary: 'prelim.', forecast: 'forecast' };
  const yearOpt = (y: number) => `${y} (${SHORT[products.years[String(y)]] ?? ''})`;
  const tot = (side: 'a' | 'b') => (yc ? yc.directions.reduce((a, d) => a + d[side], 0) : 0);
  const chg = $derived(yc ? percentChange(tot('b'), tot('a')) : null);
  const crossesForecast = $derived(yc ? (products.years[String(yc.a.year)] === 'forecast') !== (products.years[String(yc.b.year)] === 'forecast') : false);
  const dmax = $derived(yc ? Math.max(1e-9, ...yc.directions.flatMap((d) => [d.a, d.b])) : 1);

  // ---- two models
  const models = $derived(ctrl.cmpModels);
  const fmtB = (m: { kpi: { tons_kt: number | null; value_const_musd: number | null } }) => formatBig('tons', m.kpi.tons_kt);
</script>

<div class="stack">
  <div class="seg block" role="radiogroup" aria-label="Comparison type">
    <button type="button" role="radio" aria-checked={s.compareMode === 'series'} onclick={() => ctrl.setCompareMode('series')}>Zones and commodities</button>
    <button type="button" role="radio" aria-checked={s.compareMode === 'years'} aria-disabled={ctrl.timelineYears.length < 2} title={ctrl.timelineYears.length < 2 ? 'Needs more than one year' : ''} onclick={() => (ctrl.timelineYears.length < 2 ? ctrl.toast('This release publishes one year.') : ctrl.setCompareMode('years'))}>Two years</button>
    <button type="button" role="radio" aria-checked={s.compareMode === 'models'} aria-disabled={ctrl.allowed.versions.filter((v) => !ctrl.meta?.versions.products[Object.keys(ctrl.meta.versions.products).find((k) => ctrl.meta!.versions.products[k].faf_version === v)!].experimental).length < 2} onclick={() => ctrl.setCompareMode('models')}>Two models</button>
  </div>

  {#if s.compareMode === 'series'}
    <p class="help">Overlay trends for up to six zones or commodities within {ctrl.versionLabel} (mid-range scenario, all years). The current shipment type, direction, measure and other filters apply. Comparing commodities ignores the commodity filter.</p>
    <div class="card">
      <div class="field-row" style="flex-wrap:wrap">
        <div class="seg sm" role="radiogroup" aria-label="Compare by">
          <button type="button" role="radio" aria-checked={cmp.kind === 'zone'} onclick={() => ctrl.setCompare({ kind: 'zone' })}>Zones</button>
          <button type="button" role="radio" aria-checked={cmp.kind === 'commodity'} onclick={() => ctrl.setCompare({ kind: 'commodity' })}>Commodities</button>
        </div>
        <label class="sr-only" for="cmp-add">Add a {cmp.kind} to compare</label>
        <select id="cmp-add" style="flex:1;min-width:140px" bind:value={pick} onchange={() => { ctrl.addCompare(pick); pick = ''; }} disabled={cmp.ids.length >= 6}>
          <option value="">{cmp.ids.length >= 6 ? 'Six selected' : `Add a ${cmp.kind}…`}</option>
          {#each options.filter((o) => !cmp.ids.includes(o.id)) as o}<option value={o.id}>{o.label}</option>{/each}
        </select>
      </div>
      <ul class="chips" style="list-style:none;margin:0;padding:0" aria-label="Compared items">
        {#each cmp.ids as id}<li class="chip active">{trunc(label(id), 34)}<button type="button" aria-label={`Remove ${label(id)}`} onclick={() => ctrl.removeCompare(id)}><Icon name="x" size={13} /></button></li>{/each}
      </ul>
      {#if cmp.ids.length < 2}<div class="warnbox" role="note"><Icon name="info" /><span>Pick at least two {cmp.kind === 'zone' ? 'zones' : 'commodities'} to compare. A single selection is drawn but cannot be compared.</span></div>{/if}
      {#if ctrl.compareSeries.length}
        <PlotChart theme={th} label={`Trend comparison of ${cmp.kind === 'zone' ? 'zones' : 'commodities'}`} height={320} build={(c, w) => compareChart(ctrl.compareSeries, c, w, unit, s.measure)} />
        <p class="help">&#9670; benchmark year &nbsp; &#9679; final &nbsp; &#9675; preliminary &nbsp; &#9650; forecast (dashed)</p>
        <DataTable caption="Comparison values" headers={['Item', 'Year', 'Status', noun]} rows={seriesRows} />
      {/if}
    </div>

  {:else if s.compareMode === 'years'}
    <div class="card">
      <div class="field-row" style="flex-wrap:wrap">
        <label for="cmp-a" style="font-weight:600">From</label>
        <select id="cmp-a" style="flex:1;min-width:0" value={s.cmpA} onchange={(e) => ctrl.setCompareYears({ cmpA: Number(e.currentTarget.value) })}>
          {#each ctrl.timelineYears as y}<option value={y}>{yearOpt(y)}</option>{/each}
        </select>
        <label for="cmp-b" style="font-weight:600">to</label>
        <select id="cmp-b" style="flex:1;min-width:0" value={s.cmpB} onchange={(e) => ctrl.setCompareYears({ cmpB: Number(e.currentTarget.value) })}>
          {#each ctrl.timelineYears as y}<option value={y}>{yearOpt(y)}</option>{/each}
        </select>
        <button class="btn sm" type="button" aria-label="Swap the two years" onclick={() => ctrl.setCompareYears({ cmpA: s.cmpB, cmpB: s.cmpA })}><Icon name="swap" size={14} /></button>
      </div>
    </div>
    {#if yc}
      {#if tot('a') === 0 && tot('b') === 0}
        <div class="warnbox"><Icon name="info" /><span>This measure is not published for one of the chosen years or scenarios. Nothing is shown in its place.</span></div>
      {:else}
        <div class="insight"><Icon name="spark" /><span>{noun} moved from <b>{formatShort(s.measure, tot('a'))}</b> in {yc.a.year} to <b>{formatShort(s.measure, tot('b'))}</b> in {yc.b.year}{chg == null ? '' : `, ${chg >= 0 ? 'up' : 'down'} ${Math.abs(chg).toFixed(1)}%`}.{crossesForecast ? ' One year is a forecast, so this compares an estimate with a projection.' : ''}</span></div>
        <div class="card">
          <h3>By direction<small>{yc.a.year} vs {yc.b.year}</small></h3>
          {#each DIRS as d}
            {@const row = yc.directions.find((x) => x.dir === d)!}
            {@const c = percentChange(row.b, row.a)}
            <div>
              <div class="lrow static" style="padding:2px 0"><span class="nm"><i class="d" style={`background:${DIR_VAR[d]}`}></i>{DIR_LABEL[d]}</span><span class="vv">{c == null ? '' : `${c >= 0 ? '+' : ''}${c.toFixed(1)}%`}</span></div>
              <div style="display:grid;grid-template-columns:34px 1fr 56px;gap:3px 8px;align-items:center;font-size:11.5px;color:var(--ink-3)">
                <span>{yc.a.year}</span><span style={`height:8px;border-radius:4px;background:color-mix(in srgb, ${DIR_VAR[d]} 38%, transparent);width:${(row.a / dmax) * 100}%`}></span><span class="mono" style="text-align:right">{formatShort(s.measure, row.a)}</span>
                <span>{yc.b.year}</span><span style={`height:8px;border-radius:4px;background:${DIR_VAR[d]};width:${(row.b / dmax) * 100}%`}></span><span class="mono" style="text-align:right">{formatShort(s.measure, row.b)}</span>
              </div>
            </div>
          {/each}
        </div>
        <div class="card">
          <h3>By commodity<small>{yc.a.year} ○ to {yc.b.year} ●</small></h3>
          <PlotChart theme={th} label={`Commodity ${s.measure} in ${yc.a.year} and ${yc.b.year}`} height={300} build={(c, w) => dumbbellChart(yc.commodities, yc.a.year, yc.b.year, c, w, s.measure)} />
          <DataTable caption="Commodity comparison" headers={['Commodity', String(yc.a.year), String(yc.b.year)]} rows={yc.commodities.map((r) => [r.label, fmt(r.a), fmt(r.b)])} />
        </div>
        <div class="card">
          <h3>By mode<small>change, {yc.a.year} to {yc.b.year}</small></h3>
          <PlotChart theme={th} label="Percent change by mode" height={260} build={(c, w) => deltaBarsChart(yc.modes.map((m) => ({ ...m, label: shortMode(m.label) })), c, w, (code) => modeColor(code))} />
          <p class="help">Modes that appear in only one of the two years are left out: a change from nothing is not a percentage.</p>
          <DataTable caption="Mode comparison" headers={['Mode', String(yc.a.year), String(yc.b.year)]} rows={yc.modes.map((r) => [r.label, fmt(r.a), fmt(r.b)])} />
        </div>
      {/if}
    {:else}<div class="card"><div class="empty shimmer" style="height:200px"><span class="sr-only">Loading</span></div></div>{/if}

  {:else}
    <div class="warnbox"><Icon name="alert" /><span><b>Two models, shown side by side.</b> FAF 5.7.1 and FAF 6.0 use different zones, benchmark years and dollar bases. They are never plotted on one axis, and the gap between them is not explained here. Each column has its own scale.</span></div>
    {#if models}
      <p class="help">The year both releases publish ({models[0].year}), with your shipment type, direction, mode and commodity filters applied to both.</p>
      <div class="cmpgrid">
        {#each models as m (m.version)}
          {@const dt = m.balance.inbound + m.balance.outbound + m.balance.within}
          {@const mt = m.modes.reduce((a, r) => a + r.magnitude, 0)}
          <div class="card">
            <h3>{m.label}<small>{m.year}</small></h3>
            <div>
              <div style="font-family:var(--f-display);font-size:32px;line-height:1">{fmtB(m).n}<small style="font:500 12px var(--f-ui);color:var(--ink-3)"> {fmtB(m).u}</small></div>
              <div class="help">{m.kpi.value_const_musd == null ? '' : `${formatBig('value', m.kpi.value_const_musd).n} ${formatBig('value', m.kpi.value_const_musd).u} · constant ${m.benchmarkYear} $`}</div>
            </div>
            <div>
              <div class="help" style="margin-bottom:3px">Direction</div>
              <div class="lrow static" style="padding:0"><span class="tr" style="height:9px;border-radius:99px;gap:2px">{#each DIRS as d}<i title={`${DIR_LABEL[d]} ${formatPercent(dt ? m.balance[d] / dt : 0)}`} style={`width:${dt ? (m.balance[d] / dt) * 100 : 0}%;background:${DIR_VAR[d]}`}></i>{/each}</span></div>
              <div class="help">{DIRS.map((d) => `${formatPercent(dt ? m.balance[d] / dt : 0)} ${d === 'within' ? 'within' : d === 'inbound' ? 'in' : 'out'}`).join(' · ')}</div>
            </div>
            <div>
              <div class="help" style="margin-bottom:3px">Mode</div>
              <div class="lrow static" style="padding:0"><span class="tr" style="height:9px;border-radius:99px;gap:2px">{#each m.modes as r}<i title={`${r.label} ${formatPercent(mt ? r.magnitude / mt : 0)}`} style={`width:${mt ? (r.magnitude / mt) * 100 : 0}%;background:${modeVar(r.code)}`}></i>{/each}</span></div>
              <div class="help">{m.modes.slice(0, 3).map((r) => `${shortMode(r.label)} ${formatPercent(mt ? r.magnitude / mt : 0)}`).join(' · ')}</div>
            </div>
            <div>
              <div class="help" style="margin-bottom:3px">Top commodities</div>
              {#each m.commodities.slice(0, 5) as r, i}
                <div class="lrow static" style="padding:2px 0"><span class="nm"><i class="d" style={`background:${groupVar(i)};border-radius:2px`}></i><span>{trunc(r.label, 22)}</span></span><span class="vv">{formatShort('tons', r.magnitude)}</span><span class="tr"><i style={`width:${(r.magnitude / m.commodities[0].magnitude) * 100}%;background:${groupVar(i)}`}></i></span></div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {:else}<div class="card"><div class="empty shimmer" style="height:240px"><span class="sr-only">Loading</span></div></div>{/if}
  {/if}
</div>
