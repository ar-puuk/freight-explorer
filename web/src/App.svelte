<script lang="ts">
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { onMount } from 'svelte';
  import CommandPalette from './components/CommandPalette.svelte';
  import Dialogs from './components/Dialogs.svelte';
  import FilterRail from './components/FilterRail.svelte';
  import HeadlineBand from './components/HeadlineBand.svelte';
  import Icon from './components/Icon.svelte';
  import InsightDrawer from './components/InsightDrawer.svelte';
  import MapOverlays from './components/MapOverlays.svelte';
  import QueryBar from './components/QueryBar.svelte';
  import Sprite from './components/Sprite.svelte';
  import TimelineDock from './components/TimelineDock.svelte';
  import TopBar from './components/TopBar.svelte';
  import { Controller } from './lib/controller.svelte';

  const ctrl = new Controller();
  let ready = $state(false);
  let mapEl: HTMLDivElement;
  let fatal = $state<string | null>(null);

  onMount(() => {
    const mq = matchMedia('(max-width: 1099px)');
    const sync = () => (ctrl.narrow = mq.matches);
    sync();
    mq.addEventListener('change', sync);
    (async () => {
      try {
        await ctrl.init();
        // test hook: only when opted in from the browser console / test runner
        if (localStorage.getItem('faf-debug')) (window as unknown as { __faf: Controller }).__faf = ctrl;
        ready = true;
        await Promise.resolve();
        await ctrl.mountMap(mapEl);
      } catch (e) {
        console.error('startup failed', e);
        fatal = e instanceof Error ? e.message : String(e);
      }
    })();
    return () => mq.removeEventListener('change', sync);
  });

  // keep the address bar in sync with the state (replaceState: no history spam)
  $effect(() => {
    if (!ready) return;
    const q = ctrl.url();
    history.replaceState(null, '', `${location.pathname}${q}${location.hash}`);
  });

  const typing = (t: EventTarget | null) => t instanceof HTMLElement && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable);

  function onKey(e: KeyboardEvent) {
    if (!ready) return;
    if (e.key === 'Escape') {
      if (ctrl.modal) ctrl.modal = null;
      else if (ctrl.narrow && (ctrl.mobL || ctrl.mobR)) ctrl.closeSheets();
      else if (ctrl.s.selected || ctrl.detail || ctrl.s.partner) {
        ctrl.s.partner = null;
        ctrl.closeDetail();
        if (!ctrl.s.selected) void ctrl.refresh();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      ctrl.modal = ctrl.modal === 'palette' ? null : 'palette';
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || ctrl.modal || typing(e.target)) return;
    const k = e.key;
    if (k === '/') {
      e.preventDefault();
      ctrl.modal = 'palette';
    } else if (k === '?') ctrl.modal = 'help';
    else if (k === '[') ctrl.stepYear(-1);
    else if (k === ']') ctrl.stepYear(1);
    else if (k === ' ' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLAnchorElement)) {
      e.preventDefault();
      ctrl.togglePlay();
    } else if (k === '1') ctrl.change({ measure: 'tons' });
    else if (k === '2' && ctrl.available.value) ctrl.change({ measure: 'value' });
    else if (k === '3' && ctrl.available.tmiles) ctrl.change({ measure: 'tmiles' });
    else if (k.toLowerCase() === 'f') ctrl.togglePanel('L');
    else if (k.toLowerCase() === 'i') ctrl.togglePanel('R');
  }
</script>

<svelte:window onkeydown={onKey} />

<Sprite />
<a class="skip" href="#controls">Skip to filters</a>
<a class="skip" href="#map">Skip to map</a>

<div class="app">
  {#if ready}
    <TopBar {ctrl} />
  {:else}
    <header class="top"><h1 class="brand"><span class="t">Freight Explorer</span></h1>{#if fatal}<span class="error" role="alert">{fatal}</span>{/if}</header>
  {/if}

  <div class="workspace">
    {#if ctrl.narrow && (ctrl.mobL || ctrl.mobR)}<button type="button" class="sheet-scrim" aria-label="Close the panel" onclick={() => ctrl.closeSheets()}></button>{/if}

    <aside class="panel left" class:open={ctrl.narrow && ctrl.mobL} class:collapsed={!ctrl.narrow && !ctrl.panelL} id="controls" aria-label="Filters and layers" tabindex="-1">
      <div class="panel-head"><h2>Filters</h2><span class="spacer"></span><button class="btn icon ghost" type="button" aria-label="Close filters" onclick={() => (ctrl.mobL = false)}><Icon name="x" /></button></div>
      {#if ready}<FilterRail {ctrl} />
      {:else if fatal}<div class="panel-body"><p class="error" role="alert">{fatal}</p></div>
      {:else}<div class="panel-body"><p class="muted">Loading…</p></div>{/if}
    </aside>

    <main class="stage" class:experimental={ready && ctrl.experimental}>
      {#if ready}<QueryBar {ctrl} /><HeadlineBand {ctrl} />{/if}
      <div class="mapwrap">
        <div class="map" id="map" bind:this={mapEl} role="application" aria-label="Freight flow map. The largest flows are listed in text in the Insights panel, and every number is in the Data tab." aria-describedby="flow-summary"></div>
        {#if ready}
          <ul class="sr-only" id="flow-summary" aria-label="Largest flows on the map">
            {#each ctrl.flows.slice(0, 10) as f}<li>{ctrl.name(f.origin)} to {ctrl.name(f.dest)}: {ctrl.fmtMeasure(f.count)}</li>{/each}
          </ul>
          <MapOverlays {ctrl} />
        {/if}
      </div>
      {#if ready}<TimelineDock {ctrl} />{/if}
    </main>

    {#if ready}<InsightDrawer {ctrl} />{/if}
  </div>
</div>

{#if ready}
  <CommandPalette {ctrl} />
  <Dialogs {ctrl} />
  <div class="toast" class:on={!!ctrl.toastMsg} role="status" aria-live="polite">{ctrl.toastMsg ?? ''}</div>
{/if}

<style>
  .sheet-scrim {
    position: absolute;
    inset: 0;
    z-index: 4;
    border: 0;
    background: rgba(8, 12, 18, 0.4);
  }
  @media (min-width: 1100px) {
    .sheet-scrim {
      display: none;
    }
  }
</style>
