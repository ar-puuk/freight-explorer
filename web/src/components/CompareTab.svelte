<script lang="ts">
  import { compareChart } from '../lib/charts';
  import type { Controller } from '../lib/controller.svelte';
  import { rawUnit } from '../lib/format';
  import DataTable from './DataTable.svelte';
  import PlotChart from './PlotChart.svelte';

  let { ctrl }: { ctrl: Controller } = $props();
  const cmp = $derived(ctrl.s.compare);
  const unit = $derived(rawUnit(ctrl.s.measure));
  const fmt = (v: number) => ctrl.fmtMeasure(v);

  const options = $derived(
    cmp.kind === 'zone'
      ? [...ctrl.locations.values()].filter((l) => l.type !== 'foreign_region').sort((a, b) => a.name.localeCompare(b.name)).map((l) => ({ id: l.id, label: `${l.name}${l.is_state_zone ? ' (in state)' : ''}` }))
      : Object.entries(ctrl.dim.commodity).map(([id, label]) => ({ id, label: `${label} (${id})` })),
  );
  const label = (id: string) => options.find((o) => o.id === id)?.label ?? id;
  let pick = $state('');
  const rows = $derived(ctrl.compareSeries.flatMap((s) => s.points.map((p) => [s.label, `${p.year}`, p.data_version, fmt(p.v)])));
</script>

<p class="muted">Overlay trends for up to six zones or commodities within FAF {ctrl.s.version} (mid-range scenario, all years). The current view, direction, measure and other filters apply; comparing commodities ignores the commodity filter.</p>

<div class="row">
  <div class="seg" role="group" aria-label="Compare by">
    <label><input type="radio" name="cmpkind" checked={cmp.kind === 'zone'} onchange={() => ctrl.setCompare({ kind: 'zone' })} /><span>Zones</span></label>
    <label><input type="radio" name="cmpkind" checked={cmp.kind === 'commodity'} onchange={() => ctrl.setCompare({ kind: 'commodity' })} /><span>Commodities</span></label>
  </div>
  <label>Add
    <select bind:value={pick} onchange={() => { ctrl.addCompare(pick); pick = ''; }} aria-label={`Add a ${cmp.kind} to compare`} disabled={cmp.ids.length >= 6}>
      <option value="">{cmp.ids.length >= 6 ? 'Six selected' : `Choose a ${cmp.kind}…`}</option>
      {#each options.filter((o) => !cmp.ids.includes(o.id)) as o}<option value={o.id}>{o.label}</option>{/each}
    </select>
  </label>
</div>

<ul class="chips" aria-label="Compared items">
  {#each cmp.ids as id}
    <li><span>{label(id)}</span> <button class="btn" type="button" onclick={() => ctrl.removeCompare(id)} aria-label={`Remove ${label(id)}`}>&times;</button></li>
  {/each}
</ul>

{#if cmp.ids.length < 2}
  <p class="notice" role="note">Pick at least two {cmp.kind === 'zone' ? 'zones' : 'commodities'} to compare. A single selection is drawn but cannot be compared.</p>
{/if}
{#if ctrl.compareSeries.length}
  <PlotChart theme={ctrl.theme} label={`Trend comparison of ${cmp.kind === 'zone' ? 'zones' : 'commodities'}`} height={320} build={(c, w) => compareChart(ctrl.compareSeries, c, w, unit)} />
  <p class="muted key"><span>&#9670; benchmark year</span> <span>&#9679; final</span> <span>&#9675; preliminary</span> <span>&#9650; forecast (dashed)</span></p>
  <DataTable caption="Comparison values" headers={['Item', 'Year', 'Status', ctrl.s.measure === 'tons' ? 'Tons' : ctrl.s.measure === 'value' ? 'Value' : 'Ton-miles']} {rows} />
{/if}

<style>
  .row {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    align-items: center;
    margin: 8px 0;
  }
  .chips {
    list-style: none;
    margin: 4px 0 8px;
    padding: 0;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .chips li {
    background: var(--accent-soft);
    border-radius: 999px;
    padding: 2px 4px 2px 10px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .chips .btn {
    padding: 0 8px;
    border-radius: 999px;
  }
  .key span {
    margin-right: 14px;
    white-space: nowrap;
  }
</style>
