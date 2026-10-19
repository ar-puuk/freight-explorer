<script lang="ts">
  import type { Controller } from '../lib/controller.svelte';
  import { formatCount } from '../lib/format';
  import { DIR_LABEL, STATUS_LABEL, STATUS_PILL, VIEW_LABEL } from '../lib/ui';
  import Icon from './Icon.svelte';

  let { ctrl }: { ctrl: Controller } = $props();
  const s = $derived(ctrl.s);
  const status = $derived(ctrl.experimental ? 'experimental' : ctrl.dataVersionOfYear);
  const measureText = $derived(s.measure === 'tons' ? 'tons moved' : s.measure === 'value' ? 'value of goods moved' : 'ton-miles');
  const dirText = $derived(s.direction === 'both' ? 'in every direction' : s.direction === 'within' ? 'within the state' : s.direction);
  const scen = $derived(s.scenario === 'mid' ? 'mid-range' : s.scenario);

  interface Chip {
    key: string;
    text: string;
    clear: () => void;
  }
  const chips = $derived.by<Chip[]>(() => {
    const out: Chip[] = [];
    if (s.selected) out.push({ key: 'sel', text: `Focus: ${ctrl.name(s.selected)}`, clear: () => ctrl.select(null) });
    if (s.partner) out.push({ key: 'pt', text: `Partner: ${ctrl.partnerLabel(s.partner)}`, clear: () => ctrl.setPartner(null) });
    if (s.view !== 'total') out.push({ key: 'view', text: VIEW_LABEL[s.view][0].toUpperCase() + VIEW_LABEL[s.view].slice(1), clear: () => ctrl.change({ view: 'total' }) });
    if (s.direction !== 'both') out.push({ key: 'dir', text: s.direction === 'within' ? DIR_LABEL.within : DIR_LABEL[s.direction], clear: () => ctrl.change({ direction: 'both' }) });
    for (const m of s.modes) out.push({ key: `m${m}`, text: ctrl.dim.mode[String(m)] ?? String(m), clear: () => ctrl.change({ modes: s.modes.filter((x) => x !== m) }) });
    if (s.commodities.length > 3) out.push({ key: 'coms', text: `${s.commodities.length} commodities`, clear: () => ctrl.change({ commodities: [] }) });
    else for (const c of s.commodities) out.push({ key: `c${c}`, text: ctrl.dim.commodity[c] ?? c, clear: () => ctrl.change({ commodities: s.commodities.filter((x) => x !== c) }) });
    if (s.minFlow) out.push({ key: 'min', text: `Over ${formatCount(s.minFlow)}`, clear: () => ctrl.change({ minFlow: 0 }) });
    return out;
  });
</script>

<div class="qrow">
  <button class="btn sm" type="button" aria-pressed={ctrl.leftOpen} aria-controls="controls" onclick={() => ctrl.togglePanel('L')}><Icon name="filter" size={14} />Filters</button>
  <div class="query" role="status" aria-live="polite">
    <div class="sentence">
      <span>Showing <b>{measureText}</b> {dirText} in <b>{s.year}</b></span>
      <span class={`pill ${STATUS_PILL[status] ?? 'base'}`}>{STATUS_LABEL[status] ?? status}{s.year >= 2030 && s.scenario !== 'mid' ? ` · ${scen}` : s.scenario === 'mid' && status === 'forecast' ? ' · mid-range' : ''}</span>
      <span>· {ctrl.versionLabel}</span>
    </div>
    <div class="chips" style="margin-left:auto">
      {#each chips as c (c.key)}
        <span class="chip active">{c.text}<button type="button" aria-label={`Remove filter ${c.text}`} onclick={c.clear}><Icon name="x" size={13} /></button></span>
      {/each}
      {#if chips.length > 1}<button class="btn sm ghost" type="button" onclick={() => ctrl.resetFilters()}>Reset all</button>{/if}
    </div>
  </div>
  <button class="btn sm" type="button" aria-pressed={ctrl.rightOpen} aria-controls="insights" onclick={() => ctrl.togglePanel('R')}><Icon name="chart" size={14} />Insights</button>
</div>
