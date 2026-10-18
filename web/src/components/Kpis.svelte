<script lang="ts">
  import type { Controller } from '../lib/controller.svelte';
  import { formatPercent, formatTonMiles, formatTons, formatValue, formatValuePerTon } from '../lib/format';
  import { modeColor } from '../lib/palette';

  let { ctrl }: { ctrl: Controller } = $props();

  const k = $derived(ctrl.kpis);
  const value = $derived(k ? (ctrl.s.dollars === 'current' ? k.value_current_musd : k.value_const_musd) : null);
  const bal = $derived(ctrl.balance);
  const balTotal = $derived(bal ? bal.inbound + bal.outbound + bal.within : 0);

  // the mode palette is shared with the charts; segments are also named in the title and the text line, so color is never the only channel
  const modeTotal = $derived(ctrl.modeShares.reduce((a, m) => a + m.magnitude, 0));
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region must be keyboard-reachable) -->
<div class="kpis" role="region" tabindex="0" aria-label="Headline numbers for the current selection">
  {#if k}
    <div class="card kpi"><div class="k">Tons</div><div class="v">{formatTons(k.tons_kt)}</div></div>
    <div class="card kpi"><div class="k">Value</div><div class="v">{formatValue(value, ctrl.s.dollars, ctrl.benchmarkYear)}</div></div>
    <div class="card kpi"><div class="k">Ton-miles</div><div class="v">{formatTonMiles(k.tmiles_m)}</div></div>
    <div class="card kpi"><div class="k">Value per ton</div><div class="v">{formatValuePerTon(ctrl.s.dollars === 'current' ? k.value_current_musd : k.value_const_musd, k.tons_kt)}</div></div>
    <div class="card kpi" style="min-width: 200px">
      <div class="k">Inbound / outbound / within ({ctrl.s.measure === 'tons' ? 'tons' : ctrl.s.measure === 'value' ? 'value' : 'ton-miles'})</div>
      {#if bal && balTotal > 0}
        <div class="bar" role="img" aria-label={`Inbound ${formatPercent(bal.inbound / balTotal)}, outbound ${formatPercent(bal.outbound / balTotal)}, within ${formatPercent(bal.within / balTotal)}`}>
          <i style={`width:${(bal.inbound / balTotal) * 100}%;background:#1f6f8b`}></i><i style={`width:${(bal.outbound / balTotal) * 100}%;background:#c2410c`}></i><i style={`width:${(bal.within / balTotal) * 100}%;background:#6b7280`}></i>
        </div>
        <div class="k">In {formatPercent(bal.inbound / balTotal)} · Out {formatPercent(bal.outbound / balTotal)} · Within {formatPercent(bal.within / balTotal)}</div>
      {:else}<div class="v">n/a</div>{/if}
    </div>
    <div class="card kpi" style="min-width: 220px">
      <div class="k">Mode share (domestic leg)</div>
      {#if modeTotal > 0}
        <div class="bar" role="img" aria-label={ctrl.modeShares.map((m) => `${m.label} ${formatPercent(m.magnitude / modeTotal)}`).join(', ')}>
          {#each ctrl.modeShares as m, i}<i title={`${m.label} ${formatPercent(m.magnitude / modeTotal)}`} style={`width:${(m.magnitude / modeTotal) * 100}%;background:${modeColor(m.code)}`}></i>{/each}
        </div>
        <div class="k">{ctrl.modeShares.slice(0, 3).map((m) => `${m.label.replace(/ \(.*\)/, '')} ${formatPercent(m.magnitude / modeTotal)}`).join(' · ')}</div>
      {:else}<div class="v">n/a</div>{/if}
    </div>
  {:else}
    <div class="card kpi"><div class="k">Headline numbers</div><div class="v">Loading…</div></div>
  {/if}
</div>
