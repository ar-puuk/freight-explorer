<script lang="ts">
  import { heatmapChart } from '../lib/charts';
  import type { Controller } from '../lib/controller.svelte';
  import { formatBig, formatPercent, formatShort } from '../lib/format';
  import { DIR_VAR, groupVar, modeVar } from '../lib/palette';
  import { DIR_LABEL, DIRS, shortMode } from '../lib/ui';
  import BarList from './BarList.svelte';
  import DataTable from './DataTable.svelte';
  import DetailCard from './DetailCard.svelte';
  import Icon from './Icon.svelte';
  import PlotChart from './PlotChart.svelte';
  import Treemap from './Treemap.svelte';

  let { ctrl }: { ctrl: Controller } = $props();
  const s = $derived(ctrl.s);
  const bal = $derived(ctrl.balance);
  const total = $derived(bal ? bal.inbound + bal.outbound + bal.within : 0);
  const sum = $derived(ctrl.summary);
  const unit = $derived(s.measure === 'tons' ? 'thousand tons' : s.measure === 'value' ? 'million dollars' : 'million ton-miles');
  const fmt = (v: number) => ctrl.fmtMeasure(v);
  const modeTotal = $derived(ctrl.modeShares.reduce((a, m) => a + m.magnitude, 0));
  const groups = $derived((ctrl.dim.commodity_groups ?? ctrl.meta!.dims.commodity_groups).map((g) => ({ ...g, sctg: g.sctg.filter((c) => c in ctrl.dim.commodity) })).filter((g) => g.sctg.length));

  const sentence = $derived.by(() => {
    if (!bal || !total) return s.measure === 'tmiles' && !ctrl.available.tmiles ? 'Ton-miles are not published for this selection. Choose tons or value to see the totals.' : 'No flows match these filters.';
    const big = formatBig(s.measure, total);
    const top = ctrl.modeShares[0];
    const p = (x: number) => formatPercent(x / total);
    return `In ${s.year}, ${big.n} ${big.u} ${s.measure === 'value' ? 'of goods ' : ''}moved: ${p(bal.inbound)} inbound, ${p(bal.outbound)} outbound and ${p(bal.within)} within the state.${top && modeTotal ? ` ${shortMode(top.label)} carries ${formatPercent(top.magnitude / modeTotal)}.` : ''}`;
  });

  // treemap of the commodity groups: sized by the selection with the commodity filter ignored, selected when all of a group's codes are
  const treeItems = $derived(
    groups.map((g, i) => {
      const v = (sum?.commodities ?? []).filter((c) => g.sctg.includes(c.code)).reduce((a, c) => a + c.magnitude, 0);
      return { key: g.slug, label: g.name, v, text: formatShort(s.measure, v), color: groupVar(i), selected: g.sctg.every((c) => s.commodities.includes(c)) };
    }),
  );
  const flowItems = $derived(
    ctrl.flows.slice(0, 10).map((f) => ({
      key: `${f.origin}>${f.dest}`, label: `${ctrl.name(f.origin)} → ${ctrl.name(f.dest)}`, v: f.count, text: formatShort(s.measure, f.count),
      color: DIR_VAR[f.dir ?? 'inbound'], dot: true, selected: ctrl.detail?.kind === 'flow' && ctrl.detail.originId === f.origin && ctrl.detail.destId === f.dest,
    })),
  );
  const pickFlow = (key: string) => {
    const f = ctrl.flows.find((x) => `${x.origin}>${x.dest}` === key);
    if (f) void ctrl.showFlow(f.origin, f.dest, f.count);
  };
  const solo = (d: 'inbound' | 'outbound' | 'within') => ctrl.change({ direction: s.direction === d ? 'both' : d });
  const status = $derived(ctrl.experimental ? 'experimental' : ctrl.dataVersionOfYear);
  const p = $derived(ctrl.meta!.versions.products[ctrl.product]);
</script>

<div class="stack">
  <div class="insight"><Icon name="spark" /><span>{sentence}</span></div>

  <DetailCard {ctrl} />

  <div class="card">
    <h3>Direction<small>{s.measure === 'tons' ? 'tons' : s.measure === 'value' ? 'value' : 'ton-miles'} · click to filter</small></h3>
    {#if bal && total > 0}
      <div class="lrow static" style="padding:0"><span class="tr" style="height:12px;border-radius:99px;gap:2px">{#each DIRS as d}<i style={`width:${(bal[d] / total) * 100}%;background:${DIR_VAR[d]}`}></i>{/each}</span></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        {#each DIRS as d}
          <button type="button" class="lrow" class:hl={s.direction === d} aria-pressed={s.direction === d} style="grid-template-columns:1fr;padding:6px 8px" onclick={() => solo(d)}>
            <span class="nm"><i class="d" style={`background:${DIR_VAR[d]}`}></i>{DIR_LABEL[d]}</span>
            <span style="font-family:var(--f-display);font-size:24px;line-height:1.1">{formatShort(s.measure, bal[d])}</span>
            <span class="vv">{formatPercent(bal[d] / total)} of total</span>
          </button>
        {/each}
      </div>
    {:else}<div class="empty">Not published or no flows for these filters.</div>{/if}
  </div>

  <div class="card">
    <h3>Mode<small>click to filter</small></h3>
    <div class="modes">
      {#each ctrl.modeShares as m (m.code)}
        <button type="button" class="mode" style={`--c:${modeVar(m.code)}`} aria-pressed={s.modes.includes(Number(m.code))} onclick={() => ctrl.toggleMode(Number(m.code))}>
          <span class="n"><i></i>{shortMode(m.label)}</span>
          <span class="v">{formatShort(s.measure, m.magnitude)}<small>{formatPercent(modeTotal ? m.magnitude / modeTotal : 0)}</small></span>
          <span class="mbar"><i style={`width:${modeTotal ? (m.magnitude / modeTotal) * 100 : 0}%`}></i></span>
        </button>
      {/each}
      {#if !ctrl.modeShares.length}<div class="empty" style="grid-column:1/-1">No mode data for these filters.</div>{/if}
    </div>
  </div>

  <div class="card">
    <h3>Commodity<small>area = {s.measure === 'tons' ? 'tons' : s.measure === 'value' ? 'value' : 'ton-miles'} · click to filter</small></h3>
    {#if sum}
      <Treemap items={treeItems} label="Commodity groups" onpick={(k) => ctrl.toggleCommodities(groups.find((g) => g.slug === k)?.sctg ?? [])} />
    {:else}<div class="empty shimmer" style="height:180px"></div>{/if}
  </div>

  <div class="card">
    <h3>Largest flows<small>{ctrl.flowTotals.n.toLocaleString('en-US')} match · click for details</small></h3>
    <BarList items={flowItems} onpick={pickFlow} label="Largest flows" />
  </div>

  <div class="card">
    <h3>Commodity by mode<small>{unit}</small></h3>
    {#if sum}
      <PlotChart theme={`${ctrl.theme}${ctrl.cb}`} label="Commodity by mode heatmap" height={200}
        build={(c, w) => heatmapChart(sum.heat.map((h) => ({ commodity: ctrl.dim.commodity[h.commodity] ?? h.commodity, mode: shortMode(ctrl.dim.mode[h.mode] ?? h.mode), v: h.v })), c, w, unit)} />
      <DataTable caption="Commodity by mode (the largest 14 commodities are drawn; all cells are listed here)" headers={['Commodity', 'Mode', unit]}
        rows={sum.heat.slice().sort((a, b) => b.v - a.v).slice(0, 200).map((h) => [ctrl.dim.commodity[h.commodity] ?? h.commodity, ctrl.dim.mode[h.mode] ?? h.mode, fmt(h.v)])} />
    {/if}
  </div>

  <div class="card" style="background:var(--panel-2)">
    <h3>Data passport<small>what every number rests on</small></h3>
    <div style="display:grid;grid-template-columns:84px 1fr;gap:6px 12px;font-size:12.5px">
      <span class="muted">Release</span><span>{p.release}</span>
      <span class="muted">Units</span><span>{ctrl.experimental ? 'thousand tons' : 'thousand tons, million dollars, million ton-miles'}</span>
      <span class="muted">Dollars</span><span>{ctrl.experimental ? 'not published (tons only)' : s.dollars === 'const' ? `constant ${ctrl.benchmarkYear} dollars` : 'current dollars'}</span>
      <span class="muted">Status</span><span>{ctrl.experimental ? 'Experimental' : status}{s.scenario !== 'mid' ? `, ${s.scenario} scenario` : ''}</span>
      <span class="muted">Nature</span><span>Modeled estimates, not counts. Sources: BTS, FHWA, ORNL, U.S. Census Bureau. Basemap: OpenFreeMap, OpenStreetMap.</span>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <a class="btn sm" href={`methodology.html${s.theme !== 'system' ? `?theme=${s.theme}` : ''}`}>Read the methodology</a>
      <button class="btn sm" type="button" onclick={() => navigator.clipboard?.writeText(ctrl.citation()).then(() => ctrl.toast('Citation copied'), () => ctrl.toast('Copy is blocked in this browser.'))}><Icon name="copy" size={13} />Copy citation</button>
    </div>
  </div>
</div>
