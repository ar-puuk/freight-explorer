<script lang="ts">
  import type { ChartColors } from '../lib/palette';
  import { readColors } from '../lib/palette';

  /** Build the chart element for the current data. Anything reactive read inside `build` re-runs the chart. */
  let { build, theme, label, height = 260, onband }: { build: (colors: ChartColors, width: number) => Element; theme: string; label: string; height?: number; onband?: (domainValue: string) => void } = $props();

  let host: HTMLDivElement;
  let width = $state(520);

  $effect(() => {
    const el = host;
    const ro = new ResizeObserver(() => (width = Math.max(260, Math.floor(el.clientWidth))));
    ro.observe(el);
    width = Math.max(260, Math.floor(el.clientWidth));
    return () => ro.disconnect();
  });

  $effect(() => {
    void theme; // redraw when the theme changes so colors follow the tokens
    const colors = readColors();
    const chart = build(colors, width);
    // Plot labels every mark group ("bar", "line"); inside a role=img figure those are presentational and axe rejects them
    for (const n of chart.querySelectorAll('[aria-label]')) n.removeAttribute('aria-label');
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', label);
    if (onband) {
      // clicking a band of the x axis (a year) reports its domain value
      const svg = chart as unknown as SVGSVGElement & { scale: (n: string) => { domain: string[]; range: [number, number] } | undefined };
      (chart as SVGElement).style.cursor = 'pointer';
      chart.addEventListener('click', (e) => {
        const sx = svg.scale('x');
        if (!sx) return;
        const r = (chart as SVGElement).getBoundingClientRect();
        const step = (sx.range[1] - sx.range[0]) / sx.domain.length;
        const i = Math.floor(((e as MouseEvent).clientX - r.left - sx.range[0]) / step);
        if (i >= 0 && i < sx.domain.length && sx.domain[i] !== 'gap') onband(sx.domain[i]);
      });
    }
    host.replaceChildren(chart);
  });
</script>

<div bind:this={host} class="plot" style={`min-height:${height}px`}></div>

<style>
  .plot {
    width: 100%;
    overflow: hidden;
  }
  .plot :global(svg) {
    max-width: 100%;
    height: auto;
    background: transparent;
  }
</style>
