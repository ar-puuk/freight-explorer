<script lang="ts">
  import type { Controller } from '../lib/controller.svelte';
  import { formatBig, percentChange } from '../lib/format';

  let { ctrl }: { ctrl: Controller } = $props();
  const k = $derived(ctrl.kpis);
  const p = $derived(ctrl.kpiPrev?.kpi ?? null);
  const cur = $derived(ctrl.s.dollars === 'current');
  const val = (x: typeof k) => (x ? (cur ? x.value_current_musd : x.value_const_musd) : null);
  const vpt = (x: typeof k) => (x && val(x) != null && x.tons_kt ? (val(x)! / x.tons_kt) * 1000 : null);
  const why = $derived(
    ctrl.experimental ? 'Not published for county estimates' : ctrl.s.scenario !== 'mid' ? 'Not published for the high and low scenarios' : 'Not published for this release or year',
  );
  const basis = $derived(ctrl.experimental ? '' : cur ? 'current $' : `${ctrl.benchmarkYear} $`);

  interface Cell {
    key: string;
    label: string;
    big: { n: string; u: string };
    cur: number | null;
    prev: number | null;
    note?: string;
  }
  const cells = $derived.by<Cell[]>(() => {
    if (!k) return [];
    const vpv = vpt(k);
    return [
      { key: 'tons', label: 'Tons moved', big: formatBig('tons', k.tons_kt), cur: k.tons_kt, prev: p?.tons_kt ?? null },
      { key: 'value', label: basis ? `Value · ${basis}` : 'Value', big: formatBig('value', val(k)), cur: val(k), prev: val(p) },
      { key: 'tmiles', label: 'Ton-miles', big: formatBig('tmiles', k.tmiles_m), cur: k.tmiles_m, prev: p?.tmiles_m ?? null },
      { key: 'vpt', label: 'Value per ton', big: vpv == null ? { n: 'n/a', u: '' } : { n: `$${Math.round(vpv).toLocaleString('en-US')}`, u: 'per ton' }, cur: vpv, prev: vpt(p) },
    ];
  });
  function delta(c: Cell): string | null {
    const d = percentChange(c.cur, c.prev);
    if (d == null) return null;
    return `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}%`;
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region must be keyboard-reachable) -->
<div class="kband" role="region" tabindex="0" aria-label="Headline numbers for the current selection">
  {#if k}
    {#each cells as c (c.key)}
      {@const na = c.cur == null}
      <div class="kpi" class:na>
        <span class="k">{c.label}</span>
        <span class="big">{c.big.n}{#if c.big.u}<small>{c.big.u}</small>{/if}</span>
        <span class="sub">
          {#if na}{c.key === 'vpt' ? (ctrl.experimental ? 'No value in this product' : 'Needs value and tons') : why}
          {:else if delta(c)}<span class="delta">{delta(c)}</span><span>vs {ctrl.kpiPrev?.year}</span>{#if c.note}<span>· {c.note}</span>{/if}
          {:else}<span>{c.note || (ctrl.yearList[0] === ctrl.s.year ? 'First year in this release' : '')}</span>{/if}
        </span>
      </div>
    {/each}
  {:else}
    {#each ['Tons moved', 'Value', 'Ton-miles', 'Value per ton'] as l}
      <div class="kpi"><span class="k">{l}</span><span class="big shimmer" style="width:7ch">000</span><span class="sub">&nbsp;</span></div>
    {/each}
  {/if}
</div>
