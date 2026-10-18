<script lang="ts">
  import { barChart, heatmapChart } from '../lib/charts';
  import type { Controller } from '../lib/controller.svelte';
  import { formatCount, formatPercent, rawUnit } from '../lib/format';
  import { modeColor } from '../lib/palette';
  import DataTable from './DataTable.svelte';
  import PlotChart from './PlotChart.svelte';

  let { ctrl }: { ctrl: Controller } = $props();
  const sum = $derived(ctrl.summary);
  const unit = $derived(rawUnit(ctrl.s.measure));
  const bal = $derived(ctrl.balance);
  const total = $derived(bal ? bal.inbound + bal.outbound + bal.within : 0);
  const per = (x: number) => formatPercent(total ? x / total : 0);
  const fmt = (v: number) => ctrl.fmtMeasure(v);
  const partnerTitle = $derived(ctrl.s.view === 'import' ? 'Top origin regions' : ctrl.s.view === 'export' ? 'Top destination regions' : 'Top trade partners');
</script>

<div class="grid">
  <section>
    <h3>Within, inbound and outbound</h3>
    {#if bal && total > 0}
      <p class="muted">Shares of the current {ctrl.s.measure === 'tons' ? 'tonnage' : ctrl.s.measure === 'value' ? 'value' : 'ton-miles'}, ignoring the direction filter. "Within" is flow between the state's own zones.</p>
      <table class="shares">
        <tbody>
          <tr><th scope="row">Within the state</th><td class="num">{per(bal.within)}</td><td class="num">{fmt(bal.within)}</td></tr>
          <tr><th scope="row">Inbound</th><td class="num">{per(bal.inbound)}</td><td class="num">{fmt(bal.inbound)}</td></tr>
          <tr><th scope="row">Outbound</th><td class="num">{per(bal.outbound)}</td><td class="num">{fmt(bal.outbound)}</td></tr>
        </tbody>
      </table>
    {:else}<p class="muted">No flows with these filters.</p>{/if}
  </section>

  <section>
    <h3>{partnerTitle}</h3>
    {#if sum}
      <PlotChart theme={ctrl.theme} label={`${partnerTitle}, top 10`} build={(c, w) => barChart(sum.partners.map((p) => ({ label: p.label, v: p.magnitude })), c, w, unit)} height={100} />
      <DataTable caption={partnerTitle} headers={['Partner', unit]} rows={sum.partners.map((p) => [p.label, fmt(p.magnitude)])} />
    {/if}
  </section>

  <section>
    <h3>Top commodities</h3>
    {#if sum}
      <PlotChart theme={ctrl.theme} label="Top commodities" build={(c, w) => barChart(sum.commodities.map((p) => ({ label: p.label, v: p.magnitude })), c, w, unit)} height={100} />
      <DataTable caption="Top commodities" headers={['Commodity', unit]} rows={sum.commodities.map((p) => [p.label, fmt(p.magnitude)])} />
    {/if}
  </section>

  <section>
    <h3>Mode mix (domestic leg)</h3>
    {#if sum}
      <PlotChart theme={ctrl.theme} label="Mode mix" build={(c, w) => barChart(sum.modes.map((p) => ({ label: p.label, v: p.magnitude })), c, w, unit, (r) => modeColor(sum.modes.find((m) => m.label === r.label)?.code ?? 1))} height={100} />
      <DataTable caption="Mode mix" headers={['Mode', unit]} rows={sum.modes.map((p) => [p.label, fmt(p.magnitude)])} />
    {/if}
  </section>

  <section class="wide">
    <h3>Commodity by mode</h3>
    {#if sum}
      <PlotChart theme={ctrl.theme} label="Commodity by mode heatmap" height={200}
        build={(c, w) => heatmapChart(sum.heat.map((h) => ({ commodity: ctrl.dim.commodity[h.commodity] ?? h.commodity, mode: ctrl.dim.mode[h.mode] ?? h.mode, v: h.v })), c, w, unit)} />
      <DataTable caption="Commodity by mode (largest 14 commodities are drawn; all cells listed here)" headers={['Commodity', 'Mode', unit]}
        rows={sum.heat.slice().sort((a, b) => b.v - a.v).slice(0, 200).map((h) => [ctrl.dim.commodity[h.commodity] ?? h.commodity, ctrl.dim.mode[h.mode] ?? h.mode, fmt(h.v)])} />
    {/if}
  </section>
</div>
<p class="muted note">Numbers describe the current filters for {ctrl.versionLabel} {ctrl.s.year} ({ctrl.s.scenario === 'mid' ? 'mid-range' : `${ctrl.s.scenario} scenario`}). {formatCount(ctrl.flowTotals.n)} origin-destination pairs match.</p>

<style>
  .grid {
    display: grid;
    gap: 6px 22px;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  }
  .wide {
    grid-column: 1 / -1;
  }
  h3 {
    margin: 8px 0 2px;
    font-size: 13.5px;
  }
  .shares {
    border-collapse: collapse;
  }
  .shares th,
  .shares td {
    text-align: left;
    padding: 3px 14px 3px 0;
  }
  .num {
    text-align: right;
  }
  .note {
    font-size: 12.5px;
  }
</style>
