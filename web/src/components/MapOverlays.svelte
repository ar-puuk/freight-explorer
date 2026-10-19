<script lang="ts">
  import type { Controller } from '../lib/controller.svelte';
  import { formatShort } from '../lib/format';
  import { DIR_LABEL, DIRS } from '../lib/ui';
  import Icon from './Icon.svelte';

  let { ctrl }: { ctrl: Controller } = $props();
  const s = $derived(ctrl.s);
  // the flow layers report their own width scale; zero is not a width worth drawing
  const sizes = $derived(ctrl.scaleSamples.filter((z) => z.magnitude > 0).slice(-3));
  const dirVar = { inbound: 'var(--in)', outbound: 'var(--out)', within: 'var(--within)' } as const;

  // ---- edge labels: partners outside the visible map get a chip on the edge, pointing at them, so zooming never hides a top partner
  interface Beacon {
    key: string;
    x: number;
    y: number;
    angle: number;
    text: string;
    id: string;
    dir: 'inbound' | 'outbound' | 'within';
    w: number;
  }
  const beacons = $derived.by<Beacon[]>(() => {
    const { w, h } = ctrl.mapSize;
    if (!w || !s.layers.flows) return [];
    const free = { x0: 14, y0: 14, x1: w - 64, y1: h - 40 };
    const out: Beacon[] = [];
    for (const f of ctrl.flows.slice(0, 16)) {
      const lo = ctrl.locations.get(f.origin);
      const ld = ctrl.locations.get(f.dest);
      if (!lo || !ld || f.origin === f.dest) continue;
      const far = lo.is_state_zone ? ld : lo;
      const near = lo.is_state_zone ? lo : ld;
      if (far.is_state_zone) continue; // within the state: both ends are state zones
      const fp = ctrl.screenOf(far.id);
      const np = ctrl.screenOf(near.id);
      if (!fp || !np) continue;
      if (fp.x >= 6 && fp.x <= w - 6 && fp.y >= 6 && fp.y <= h - 6) continue;
      const dx = fp.x - np.x;
      const dy = fp.y - np.y;
      let k = Infinity;
      if (dx > 0) k = Math.min(k, (free.x1 - np.x) / dx);
      if (dx < 0) k = Math.min(k, (free.x0 - np.x) / dx);
      if (dy > 0) k = Math.min(k, (free.y1 - np.y) / dy);
      if (dy < 0) k = Math.min(k, (free.y0 - np.y) / dy);
      if (!Number.isFinite(k) || k <= 0) continue;
      const text = `${far.name} · ${formatShort(s.measure, f.count)}`;
      const bw = text.length * 6.4 + 38;
      const bx = Math.min(Math.max(np.x + dx * k - (dx > 0 ? bw : 0), 8), w - bw - 60);
      const by = Math.min(Math.max(np.y + dy * k - 11, 8), h - 62);
      if (out.some((b) => !(bx + bw < b.x || bx > b.x + b.w || by + 24 < b.y || by > b.y + 24))) continue;
      out.push({ key: `${f.origin}>${f.dest}`, x: bx, y: by, angle: (Math.atan2(dy, dx) * 180) / Math.PI, text, id: far.id, dir: f.dir ?? 'inbound', w: bw });
      if (out.length >= 8) break;
    }
    return out;
  });

  const noteHtml = $derived.by(() => {
    if (ctrl.experimental) return { cls: 'exp', icon: 'flask', text: 'County-level estimates for 2022 (BTS), tons only, built from FAF5.6.1 and allocated to counties with public indicator data. Not FAF6, not directly comparable with the FAF releases, and not measured county flows.', strong: 'Experimental.' };
    if (s.layers.network) return { cls: '', icon: 'info', strong: `FAF5 model assignment (${s.net.year === 2017 ? '2017 benchmark' : `${s.net.year} baseline projection`}).`, text: `Not traffic counts; not updated to FAF6.${s.version !== ctrl.defaults.version ? ` The network is a FAF5 product even while ${ctrl.versionLabel} flows are shown.` : ''}` };
    return { cls: '', icon: 'info', strong: 'Modeled estimates, not counts.', text: `The map draws the largest ${ctrl.flows.length} zone pairs. The headline numbers include every flow.` };
  });
</script>

<div class="float tools" role="group" aria-label="Map controls">
  <button class="btn" type="button" aria-label="Zoom in" onclick={() => ctrl.mapZoom(1)}><Icon name="plus" size={17} /></button>
  <button class="btn" type="button" aria-label="Zoom out" onclick={() => ctrl.mapZoom(-1)}><Icon name="minus" size={17} /></button>
  <hr />
  <button class="btn" type="button" aria-label="Fit the map to the flows" title="Fit to flows" onclick={() => ctrl.fitToFlows()}><Icon name="fit" size={17} /></button>
  <button class="btn" type="button" aria-label="Reset the map view" title="Reset the view" onclick={() => ctrl.mapHome()}><Icon name="home" size={17} /></button>
</div>

{#each beacons as b (b.key)}
  <button type="button" class="beacon" style={`left:${b.x}px;top:${b.y}px;border-color:${dirVar[b.dir]}`} onclick={() => ctrl.select(b.id)} aria-label={`${b.text}. Off screen. Press to isolate its flows.`}>
    <svg width="12" height="12" viewBox="-6 -6 12 12" aria-hidden="true" style={`transform:rotate(${b.angle}deg);color:${dirVar[b.dir]}`}><path d="M5 0 L-3 -4 L-3 4 Z" fill="currentColor" /></svg>{b.text}
  </button>
{/each}

<div class={`float legend ${ctrl.legendOpen ? '' : 'shut'}`} aria-label="Legend">
  <div class="lh"><span>Legend</span><button type="button" aria-expanded={ctrl.legendOpen} aria-label={ctrl.legendOpen ? 'Collapse legend' : 'Expand legend'} onclick={() => (ctrl.legendOpen = !ctrl.legendOpen)}><Icon name="chev" size={14} /></button></div>
  {#if ctrl.legendOpen}
    {#if s.layers.flows}
      <div class="row">
        {#each DIRS as d}<span style="display:inline-flex;align-items:center;gap:5px"><i class="arrow" style={`background:linear-gradient(90deg, color-mix(in srgb, ${dirVar[d]} 25%, transparent), ${dirVar[d]})`}></i>{DIR_LABEL[d]}</span>{/each}
      </div>
      <div class="row" style="gap:10px;flex-wrap:nowrap;white-space:nowrap">
        <span>Width = <b>{s.measure === 'tons' ? 'tons' : s.measure === 'value' ? 'value' : 'ton-miles'}</b></span>
        {#each sizes as z}<span style="display:inline-flex;align-items:center;gap:4px"><i style={`display:block;width:16px;height:${Math.max(2, z.thickness).toFixed(1)}px;background:var(--ink-3);border-radius:2px;opacity:.8`}></i><span class="mono" style="font-size:10.5px">{formatShort(s.measure, z.magnitude)}</span></span>{/each}
      </div>
      <div class="row"><span>Circles: zone totals. Foreign regions are schematic positions.</span></div>
    {/if}
    {#if s.layers.zones}<div class="row"><span style="width:20px;height:8px;border-radius:3px;background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 8%,transparent),color-mix(in srgb,var(--accent) 38%,transparent))"></span><span>Zone tint = strength of the link to the state</span></div>{/if}
    {#if s.layers.network}<div class="row"><span class="ramp"></span><span>Modeled truck trips per day. Grey: no modeled flow.</span></div>{/if}
  {/if}
</div>

<div class={`float floatnote ${noteHtml.cls}`} role="note"><Icon name={noteHtml.icon} size={16} /><span><b style="color:var(--ink)">{noteHtml.strong}</b> {noteHtml.text}</span></div>

{#if ctrl.hover}
  <div class="tip" style={`left:${Math.min(ctrl.hover.x + 14, Math.max(0, ctrl.mapSize.w - 290))}px;top:${Math.min(ctrl.hover.y + 14, Math.max(0, ctrl.mapSize.h - (ctrl.hover.charts ? 270 : 120)))}px`} role="status">
    {#each ctrl.hover.lines as l, i}<div class={i === 0 ? 't' : i === ctrl.hover.lines.length - 1 && ctrl.hover.key ? 'hint' : 'r'}>{l}</div>{/each}
    {#if ctrl.hover.charts}
      {#each ctrl.hover.charts as ch}
        {#if ch.rows.length}
          {@const mx = Math.max(...ch.rows.map((r) => r.v), 1)}
          <div class="mini" aria-hidden="true">
            <div class="mh">{ch.title}</div>
            {#each ch.rows as r}
              <div class="mr"><span class="ml">{r.label}</span><span class="mv">{r.text}</span><i style={`width:${Math.max(2, (r.v / mx) * 100).toFixed(1)}%`}></i></div>
            {/each}
          </div>
        {/if}
      {/each}
    {/if}
  </div>
{/if}

<style>
  .beacon {
    position: absolute;
    z-index: 4;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 10px 0 7px;
    border-radius: 12px;
    border: 1.5px solid;
    background: color-mix(in srgb, var(--panel) 94%, transparent);
    font-size: 11.5px;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: var(--shadow);
  }
</style>
