<script lang="ts">
  import type { Controller } from '../lib/controller.svelte';
  import { formatShort } from '../lib/format';
  import Butterfly from './Butterfly.svelte';
  import DataTable from './DataTable.svelte';
  import Icon from './Icon.svelte';

  let { ctrl }: { ctrl: Controller } = $props();
  const s = $derived(ctrl.s);
  const rows = $derived(ctrl.partners);
  const groups = $derived((ctrl.dim.commodity_groups ?? ctrl.meta!.dims.commodity_groups).map((g) => ({ ...g, sctg: g.sctg.filter((c) => c in ctrl.dim.commodity) })).filter((g) => g.sctg.length));
  const region = $derived(s.view === 'import' || s.view === 'export');
  const noun = $derived(region ? 'regions' : 'states');
  const sums = $derived.by(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.partner, (m.get(r.partner) ?? 0) + r.v);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  });
</script>

<div class="stack">
  <div class="insight">
    <Icon name="spark" />
    <span>Where freight comes from (left) and goes to (right) across the 14 largest partner {noun}, split by commodity. Click a {region ? 'region' : 'state'} to keep only its flows on the map and in every view.</span>
  </div>
  {#if s.partner}
    <div class="warnbox"><Icon name="info" /><span>Showing flows with {ctrl.partnerLabel(s.partner)} only. <button class="btn sm" type="button" onclick={() => ctrl.setPartner(null)}>Show all partners</button></span></div>
  {/if}
  <div class="card">
    <h3>Partner {noun}<small>{s.measure === 'tons' ? 'tons' : s.measure === 'value' ? 'value' : 'ton-miles'}, {s.year}</small></h3>
    {#if rows}
      <Butterfly {rows} {groups} measure={s.measure} selected={s.partner} label={(c) => ctrl.partnerLabel(c)} onpick={(c) => ctrl.setPartner(c)} />
      <p class="help">Bars follow the shipment type, direction, mode and commodity filters. The partner filter itself is not applied, so you can switch between partners.</p>
      <DataTable caption="Partners" headers={['Partner', 'Direction', 'Commodity', 'Amount']} rows={rows.map((r) => [ctrl.partnerLabel(r.partner), r.dir, ctrl.dim.commodity[r.code] ?? r.code, ctrl.fmtMeasure(r.v)])} />
    {:else}
      <div class="empty shimmer" style="height:240px"><span class="sr-only">Loading partners</span></div>
    {/if}
  </div>
  {#if rows && sums.length}
    <p class="help">Largest: {sums.slice(0, 3).map(([k, v]) => `${ctrl.partnerLabel(k)} ${formatShort(s.measure, v)}`).join(', ')}.</p>
  {/if}
</div>
