<script lang="ts">
  import type { Controller } from '../lib/controller.svelte';
  import { STATUS_LABEL, STATUS_PILL, STATUS_TICK, timelineColumns } from '../lib/ui';
  import Icon from './Icon.svelte';

  let { ctrl }: { ctrl: Controller } = $props();
  const s = $derived(ctrl.s);
  const cols = $derived(timelineColumns(ctrl.timelineYears));
  const products = $derived(ctrl.meta!.versions.products[ctrl.product]);
  const statusOf = (y: number): string => (ctrl.experimental ? 'experimental' : (products.years[String(y)] ?? 'final'));
  const status = $derived(statusOf(s.year));
  const single = $derived(ctrl.timelineYears.length < 2);

  const NOTE: Record<string, string> = {
    base: 'Benchmark year the other years are scaled from.',
    final: 'Final annual estimate.',
    preliminary: 'Preliminary estimate. It may be revised.',
    forecast: 'Forecast, not observed. High and Low scenarios are published for tons and value only.',
    experimental: 'County estimates are published for 2022 only.',
  };
  const note = $derived(single && !ctrl.experimental ? `This release publishes ${s.year} only. Other years arrive with future FAF releases.` : NOTE[status]);

  // ---- sparkline of the state total for the selected measure (unfiltered), drawn at every published year
  let W = $state(640);
  const H = 38;
  const vals = $derived(cols.map((c) => (c.kind === 'year' ? ctrl.sparkValue(c.year!) : null)));
  const vmax = $derived(Math.max(1, ...vals.filter((v): v is number => v != null)));
  const colW = $derived(W / Math.max(1, cols.length));
  const px = (i: number) => (i + 0.5) * colW;
  const py = (v: number) => H - 4 - (v / vmax) * (H - 10);

  interface Seg {
    pts: [number, number][];
    dashed: boolean;
  }
  const segs = $derived.by<Seg[]>(() => {
    const out: Seg[] = [];
    let cur: Seg | null = null;
    cols.forEach((c, i) => {
      const v = vals[i];
      if (c.kind === 'gap' || v == null) {
        cur = null; // a gap, or a year with no published value, breaks the line: nothing is drawn through missing data
        return;
      }
      const dashed = statusOf(c.year!) === 'forecast';
      if (!cur || cur.dashed !== dashed) {
        cur = { pts: [], dashed };
        out.push(cur);
      }
      cur.pts.push([px(i), py(v)]);
    });
    return out;
  });
  const line = (pts: [number, number][]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');

  // ---- scrubbing with the pointer
  let down = false;
  let inner: HTMLDivElement;
  function scrub(e: PointerEvent) {
    const r = inner.getBoundingClientRect();
    const c = cols[Math.min(cols.length - 1, Math.max(0, Math.floor((e.clientX - r.left) / (r.width / cols.length))))];
    if (c?.kind === 'year') ctrl.setYear(c.year!);
  }
  function key(e: KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    ctrl.stepYear(e.key === 'ArrowRight' ? 1 : -1);
    queueMicrotask(() => document.getElementById(`tick-${ctrl.s.year}`)?.focus());
  }
  const SCEN: [string, string][] = [['low', 'Low'], ['mid', 'Mid-range'], ['high', 'High']];
</script>

<div class="dock" id="timeline">
  <div class="dock-top">
    <button class="btn icon" type="button" aria-label={ctrl.playing ? 'Pause' : 'Play through the years'} aria-disabled={single} disabled={single} onclick={() => ctrl.togglePlay()}><Icon name={ctrl.playing ? 'pause' : 'play'} size={15} /></button>
    <div class="title"><span class="y num">{s.year}</span><span class={`pill ${STATUS_PILL[status] ?? 'base'}`}>{STATUS_LABEL[status]}</span></div>
    <div class="note">{note}</div>
    <div class="seg sm" role="radiogroup" aria-label="Forecast scenario">
      {#each SCEN as [sc, label]}
        {@const have = ctrl.scenarioList.includes(sc)}
        {@const dis = !have || !ctrl.scenarioApplies}
        <button type="button" role="radio" aria-checked={s.scenario === sc} aria-disabled={dis}
          title={!have ? `${ctrl.versionLabel} publishes no ${sc} scenario` : !ctrl.scenarioApplies ? 'Scenarios exist for forecast years only' : ''}
          onclick={() => (dis ? ctrl.toast(!have ? `${ctrl.versionLabel} publishes no ${sc} scenario.` : 'High and Low scenarios exist for forecast years only.') : ctrl.setScenario(sc))}>{label}</button>
      {/each}
    </div>
  </div>
  <div class="tl">
    <!-- svelte-ignore a11y_no_static_element_interactions (scrubbing is a pointer shortcut; every tick is also a keyboard-operable radio) -->
    <div class="tl-inner" bind:this={inner} bind:clientWidth={W} style={`min-width:${Math.max(360, cols.length * 46)}px`}
      onpointerdown={(e) => { if (e.pointerType === 'mouse' && (e.target as HTMLElement).closest('.ticks')) { down = true; scrub(e); } }}
      onpointermove={(e) => down && e.buttons && scrub(e)} onpointerup={() => (down = false)} onpointerleave={() => (down = false)}>
      <svg class="spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {#each segs as sg}
          {#if sg.pts.length > 1}
            <path d={`${line(sg.pts)}L${sg.pts[sg.pts.length - 1][0]} ${H}L${sg.pts[0][0]} ${H}Z`} fill="var(--accent)" opacity={sg.dashed ? 0.07 : 0.12} />
            <path d={line(sg.pts)} fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-dasharray={sg.dashed ? '3 3' : undefined} />
          {/if}
          {#each sg.pts as p}<circle cx={p[0]} cy={p[1]} r="2.2" fill="var(--panel)" stroke="var(--accent)" stroke-width="1.3" />{/each}
        {/each}
      </svg>
      <div class="ticks" role="radiogroup" aria-label="Year" style={`grid-template-columns:repeat(${cols.length},1fr)`}>
        {#each cols as c}
          {#if c.kind === 'gap'}
            <div class="tick gap" title={`No annual estimates are published for ${c.label.replace('–', ' to 20')}`}>{c.label}</div>
          {:else}
            {@const st = statusOf(c.year!)}
            <button type="button" id={`tick-${c.year}`} class={`tick ${st === 'forecast' ? 'fc' : st === 'preliminary' ? 'pre' : ''}`} role="radio" aria-checked={c.year === s.year}
              tabindex={c.year === s.year ? 0 : -1} aria-label={`${c.year}, ${STATUS_LABEL[st]}`} onclick={() => ctrl.setYear(c.year!)} onkeydown={key}>
              {c.year}<span class="st">{STATUS_TICK[st] ?? ''}</span>
            </button>
          {/if}
        {/each}
      </div>
      <div class="zones-band" style={`grid-template-columns:repeat(${cols.length},1fr)`} aria-hidden="true">
        {#each cols as c}<i class={c.kind === 'gap' ? '' : statusOf(c.year!) === 'forecast' ? 'fc' : statusOf(c.year!) === 'preliminary' ? 'pre' : statusOf(c.year!) === 'base' ? 'base' : 'final'}></i>{/each}
      </div>
    </div>
  </div>
</div>
