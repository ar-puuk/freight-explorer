<script lang="ts">
  import type { PartnerRow } from '../lib/controller.svelte';
  import { formatShort } from '../lib/format';
  import { groupVar } from '../lib/palette';
  import { trunc } from '../lib/ui';
  import type { Measure } from '../lib/types';

  /** Inbound on the left, outbound on the right, the partner in the middle, bars stacked by commodity group. */
  let {
    rows, groups, measure, selected, label, onpick,
  }: {
    rows: PartnerRow[];
    groups: { name: string; sctg: string[] }[];
    measure: Measure;
    selected: string | null;
    label: (code: string) => string;
    onpick: (code: string) => void;
  } = $props();

  let W = $state(400);
  const groupOf = $derived(new Map(groups.flatMap((g, i) => g.sctg.map((c) => [c, i] as const))));
  interface P {
    k: string;
    inb: number[];
    out: number[];
    ti: number;
    to: number;
  }
  const partners = $derived.by<P[]>(() => {
    const by = new Map<string, P>();
    for (const r of rows) {
      const p = by.get(r.partner) ?? { k: r.partner, inb: new Array(groups.length).fill(0), out: new Array(groups.length).fill(0), ti: 0, to: 0 };
      const gi = groupOf.get(r.code) ?? groups.length - 1;
      if (r.dir === 'inbound') {
        p.inb[gi] += r.v;
        p.ti += r.v;
      } else {
        p.out[gi] += r.v;
        p.to += r.v;
      }
      by.set(r.partner, p);
    }
    return [...by.values()].sort((a, b) => b.ti + b.to - (a.ti + a.to));
  });
  const mx = $derived(Math.max(1e-9, ...partners.map((p) => Math.max(p.ti, p.to))));
  const CL = 108;
  const PAD = 48;
  const side = $derived(Math.max(40, (W - CL - PAD * 2) / 2));
  const RH = 25;
  const height = $derived(partners.length * RH + 26);
  const key = (e: KeyboardEvent, k: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onpick(k);
    }
  };
  const segs = (arr: number[], dir: 'in' | 'out') => {
    let acc = 0;
    return arr.flatMap((v, gi) => {
      if (!v) return [];
      const w = (v / mx) * side;
      const x = dir === 'in' ? PAD + side - acc - w : PAD + side + CL + acc;
      acc += w;
      return [{ gi, v, x, w }];
    });
  };
  const extent = (arr: number[]) => arr.reduce((a, v) => a + v, 0) / mx * side;
</script>

<div class="chartbox" bind:clientWidth={W}>
  {#if partners.length}
    <svg width={W} {height} viewBox={`0 0 ${W} ${height}`} role="group" aria-label="Partners by direction and commodity">
      {#each partners as p, i (p.k)}
        {@const y0 = 22 + i * RH}
        {@const sel = selected === p.k}
        <g tabindex="0" role="button" aria-pressed={sel} aria-label={`${label(p.k)}, inbound ${formatShort(measure, p.ti)}, outbound ${formatShort(measure, p.to)}`} data-partner={p.k} style="cursor:pointer;outline:none" onclick={() => onpick(p.k)} onkeydown={(e) => key(e, p.k)}>
          <rect x="0" y={y0 - 2} width={W} height={RH - 2} rx="6" fill={sel ? 'var(--accent)' : 'transparent'} opacity={sel ? 0.14 : 1} class="row" />
          {#each segs(p.inb, 'in') as s}<rect x={s.x} y={y0 + 2} width={Math.max(0.6, s.w)} height={RH - 10} fill={groupVar(s.gi)} opacity="0.92"><title>{label(p.k)} · inbound · {groups[s.gi]?.name}: {formatShort(measure, s.v)}</title></rect>{/each}
          {#each segs(p.out, 'out') as s}<rect x={s.x} y={y0 + 2} width={Math.max(0.6, s.w)} height={RH - 10} fill={groupVar(s.gi)} opacity="0.92"><title>{label(p.k)} · outbound · {groups[s.gi]?.name}: {formatShort(measure, s.v)}</title></rect>{/each}
        </g>
      {/each}
      <g aria-hidden="true" pointer-events="none" fill="var(--ink-2)">
        <text x={PAD + side} y="12" text-anchor="end" font-size="11" font-weight="600" fill="var(--ink-3)">← Inbound</text>
        <text x={PAD + side + CL + 8} y="12" font-size="11" font-weight="600" fill="var(--ink-3)">Outbound →</text>
        {#each partners as p, i (p.k)}
          {@const y0 = 22 + i * RH}
          {#if p.ti}<text x={PAD + side - extent(p.inb) - 4} y={y0 + 13} text-anchor="end" font-size="10.5" font-family="IBM Plex Mono, monospace">{formatShort(measure, p.ti)}</text>{/if}
          {#if p.to}<text x={PAD + side + CL + extent(p.out) + 4} y={y0 + 13} font-size="10.5" font-family="IBM Plex Mono, monospace">{formatShort(measure, p.to)}</text>{/if}
          <text x={PAD + side + CL / 2 + 4} y={y0 + 13} text-anchor="middle" font-size="12" font-weight={selected === p.k ? 700 : 550} fill="var(--ink)">{trunc(label(p.k), 15)}</text>
        {/each}
      </g>
    </svg>
    <div class="legendrow" style="margin-top:8px">
      {#each groups as g, i}<span><i style={`background:${groupVar(i)}`}></i>{trunc(g.name, 20)}</span>{/each}
    </div>
  {:else}
    <div class="empty">No partner flows for these filters. Flows within the state have no partner.</div>
  {/if}
</div>

<style>
  g[role='button']:focus-visible .row {
    stroke: var(--accent);
    stroke-width: 2;
    fill: var(--accent);
    opacity: 0.12;
  }
</style>
