<script module lang="ts">
export interface TreeItem {
  key: string;
  label: string;
  v: number;
  text: string; // value as written
  color: string; // CSS color
  selected: boolean;
}
</script>

<script lang="ts">
  import { formatPercent } from '../lib/format';
  import { trunc } from '../lib/ui';

  let { items, onpick, label, height = 210 }: { items: TreeItem[]; onpick: (key: string) => void; label: string; height?: number } = $props();
  let W = $state(380);
  const total = $derived(items.reduce((a, b) => a + b.v, 0));
  const anySel = $derived(items.some((i) => i.selected));

  interface Cell extends TreeItem {
    x: number;
    y: number;
    w: number;
    h: number;
  }
  /** Squarified treemap (Bruls, Huizing and van Wijk): rows are laid along the shorter side while the worst aspect ratio improves. */
  function layout(list: TreeItem[], w: number, h: number): Cell[] {
    const data = list.filter((i) => i.v > 0).sort((a, b) => b.v - a.v);
    const sum = data.reduce((a, b) => a + b.v, 0);
    if (!sum || w < 20) return [];
    const out: Cell[] = [];
    let rest = data.map((d) => ({ ...d, area: (d.v / sum) * w * h }));
    let r = { x: 0, y: 0, w, h };
    const worst = (row: { area: number }[], side: number) => {
      const s = row.reduce((a, b) => a + b.area, 0);
      const mx = Math.max(...row.map((x) => x.area));
      const mn = Math.min(...row.map((x) => x.area));
      return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
    };
    while (rest.length) {
      const side = Math.min(r.w, r.h);
      let row: typeof rest = [];
      let best = Infinity;
      for (const item of rest) {
        const next = [...row, item];
        const wo = worst(next, side);
        if (row.length && wo > best) break;
        row = next;
        best = wo;
      }
      const s = row.reduce((a, b) => a + b.area, 0);
      if (r.w >= r.h) {
        const rw = s / r.h;
        let y = r.y;
        for (const it of row) {
          const hh = it.area / rw;
          out.push({ ...it, x: r.x, y, w: rw, h: hh });
          y += hh;
        }
        r = { x: r.x + rw, y: r.y, w: r.w - rw, h: r.h };
      } else {
        const rh = s / r.w;
        let x = r.x;
        for (const it of row) {
          const ww = it.area / rh;
          out.push({ ...it, x, y: r.y, w: ww, h: rh });
          x += ww;
        }
        r = { x: r.x, y: r.y + rh, w: r.w, h: r.h - rh };
      }
      rest = rest.slice(row.length);
    }
    return out;
  }
  const cells = $derived(layout(items, W, height));
  const keydown = (e: KeyboardEvent, k: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onpick(k);
    }
  };
</script>

<div class="chartbox" bind:clientWidth={W}>
  {#if cells.length}
    <svg width={W} {height} viewBox={`0 0 ${W} ${height}`} role="group" aria-label={label}>
      {#each cells as c (c.key)}
        {@const dim = anySel && !c.selected}
        <g tabindex="0" role="button" aria-pressed={c.selected} aria-label={`${c.label}, ${c.text}, ${formatPercent(total ? c.v / total : 0)}`} style="cursor:pointer;outline:none" onclick={() => onpick(c.key)} onkeydown={(e) => keydown(e, c.key)}>
          <rect x={c.x + 1} y={c.y + 1} width={Math.max(0, c.w - 2)} height={Math.max(0, c.h - 2)} rx="5" fill={c.color} opacity={dim ? 0.28 : 0.92} stroke={c.selected ? 'var(--ink)' : 'none'} stroke-width="2.5"><title>{c.label}: {c.text} ({formatPercent(total ? c.v / total : 0)})</title></rect>
        </g>
      {/each}
      <g aria-hidden="true" pointer-events="none">
        {#each cells as c (c.key)}
          {#if c.w > 74 && c.h > 36}
            <text x={c.x + 7} y={c.y + 17} font-size="11.5" font-weight="650" fill="#fff" style="paint-order:stroke;stroke:rgba(0,0,0,.3);stroke-width:2.5px">{trunc(c.label, Math.max(8, Math.floor(c.w / 7)))}</text>
            <text x={c.x + 7} y={c.y + 32} font-size="11" fill="#fff" font-family="IBM Plex Mono, monospace" style="paint-order:stroke;stroke:rgba(0,0,0,.3);stroke-width:2.5px">{c.text} · {formatPercent(total ? c.v / total : 0)}</text>
          {/if}
        {/each}
      </g>
    </svg>
  {:else}
    <div class="empty">No data for these filters.</div>
  {/if}
</div>

<style>
  g[role='button']:focus-visible rect {
    stroke: var(--ink);
    stroke-width: 3;
  }
</style>
