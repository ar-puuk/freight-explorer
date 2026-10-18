<script lang="ts">
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { onMount } from 'svelte';
  import Controls from './components/Controls.svelte';
  import Detail from './components/Detail.svelte';
  import Kpis from './components/Kpis.svelte';
  import { Controller } from './lib/controller.svelte';
  import { BASEMAPS } from './lib/mapview';

  const ctrl = new Controller();
  let ready = $state(false);
  let mapEl: HTMLDivElement;
  let sheetOpen = $state(false);
  let fatal = $state<string | null>(null);

  onMount(() => {
    (async () => {
      try {
        await ctrl.init();
        // test hook: only when opted in from the browser console / test runner
        if (localStorage.getItem('faf-debug')) (window as unknown as { __faf: Controller }).__faf = ctrl;
        ready = true;
        await Promise.resolve();
        await ctrl.mountMap(mapEl);
      } catch (e) {
        fatal = e instanceof Error ? e.message : String(e);
      }
    })();
  });

  // keep the address bar in sync with the state (replaceState: no history spam)
  $effect(() => {
    if (!ready) return;
    const q = ctrl.url();
    history.replaceState(null, '', `${location.pathname}${q}${location.hash}`);
  });

  const netBadge = $derived(ctrl.s?.layers.network);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && ready && ctrl.closeDetail()} />

<div class="app">
  <header class="top">
    <h1>{ready ? ctrl.meta?.state.site_title : 'Freight Explorer'}</h1>
    {#if ready}
      <button class="btn sheet-toggle" type="button" aria-expanded={sheetOpen} onclick={() => (sheetOpen = !sheetOpen)}>{sheetOpen ? 'Hide' : 'Show'} filters</button>
      <span class="spacer"></span>
      <label>Basemap
        <select value={ctrl.s.basemap ?? ''} onchange={(e) => ctrl.setBasemap(e.currentTarget.value || null)} aria-label="Basemap">
          <option value="">Auto ({ctrl.theme === 'dark' ? 'Dark' : 'Positron'})</option>
          {#each BASEMAPS as b}<option value={b}>{b[0].toUpperCase() + b.slice(1)}</option>{/each}
        </select>
      </label>
      <label>Theme
        <select value={ctrl.s.theme} onchange={(e) => ctrl.setTheme(e.currentTarget.value as 'system' | 'light' | 'dark')} aria-label="Theme">
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
    {/if}
  </header>

  <aside class="side" class:open={sheetOpen} aria-label="Controls">
    {#if ready}<Controls {ctrl} />{:else if fatal}<p class="error" role="alert">{fatal}</p>{:else}<p class="muted">Loading…</p>{/if}
  </aside>

  <main class="stage">
    <div class="map" bind:this={mapEl} role="application" aria-label="Freight flow map"></div>
    {#if ready}
      <Kpis {ctrl} />
      <Detail {ctrl} />

      {#if ctrl.hover}
        <div class="card tooltip" style={`left:${ctrl.hover.x + 14}px;top:${ctrl.hover.y + 14}px`}>
          {#each ctrl.hover.lines as l, i}<div style={i === 0 ? 'font-weight:650' : ''}>{l}</div>{/each}
        </div>
      {/if}

      <div class="card legend" aria-label="Legend">
        {#if ctrl.s.layers.flows}<div>Arc width: {ctrl.s.measure === 'tons' ? 'tons' : ctrl.s.measure === 'value' ? 'value' : 'ton-miles'}. Circles: zone totals. Foreign regions are schematic positions.</div>{/if}
        {#if netBadge}<div style="margin-top: 4px"><span class="ramp" aria-hidden="true"></span> modeled truck trips per day. Grey: no modeled truck flow.</div>{/if}
      </div>

      {#if netBadge}
        <div class="card badge" role="note">
          <strong>FAF5 model assignment ({ctrl.s.net.year === 2017 ? '2017 benchmark' : `${ctrl.s.net.year} baseline projection`}).</strong> Not traffic counts; not updated to FAF6.
          {#if ctrl.s.version !== '5.7.1'}Network is FAF5-based even while FAF {ctrl.s.version} flows are shown.{/if}
        </div>
      {/if}

      <div class="footer">
        <span>
          FAF {ctrl.s.version}, {ctrl.benchmarkYear} benchmark; values in {ctrl.benchmarkYear} dollars unless "current" is chosen. Modeled estimates, not counts. Not comparable with the other FAF version.
          Sources: BTS, FHWA, ORNL, U.S. Census Bureau. Basemap: OpenFreeMap, OpenStreetMap.
        </span>
      </div>
    {/if}
  </main>
</div>
