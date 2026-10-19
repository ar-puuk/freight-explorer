<script lang="ts">
  import type { Controller } from '../lib/controller.svelte';

  let { ctrl }: { ctrl: Controller } = $props();
  let box = $state<HTMLDivElement>();
  let returnTo: Element | null = null;
  const open = $derived(ctrl.modal === 'help' || ctrl.modal === 'method');

  $effect(() => {
    if (open) {
      returnTo = document.activeElement;
      queueMicrotask(() => box?.querySelector<HTMLElement>('button, a')?.focus());
    } else if (returnTo instanceof HTMLElement) {
      returnTo.focus();
      returnTo = null;
    }
  });

  // keep keyboard focus inside the dialog
  function trap(e: KeyboardEvent) {
    if (e.key !== 'Tab' || !box) return;
    const f = [...box.querySelectorAll<HTMLElement>('button, a[href], input, select')].filter((x) => !(x as HTMLButtonElement).disabled);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) {
      e.preventDefault();
      f[f.length - 1].focus();
    } else if (!e.shiftKey && i === f.length - 1) {
      e.preventDefault();
      f[0].focus();
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (Escape closes the dialog; the scrim click is a pointer convenience) -->
  <div class="scrim on" onclick={(e) => e.target === e.currentTarget && (ctrl.modal = null)} onkeydown={trap}>
    <div class="modal pad" role="dialog" aria-modal="true" aria-labelledby="dlg-title" bind:this={box}>
      {#if ctrl.modal === 'help'}
        <h2 id="dlg-title">Keyboard shortcuts</h2>
        <div class="keys">
          <span><kbd>Ctrl</kbd> <kbd>K</kbd> or <kbd>/</kbd></span><span>Search and jump to any year, zone, commodity, mode or action</span>
          <kbd>[</kbd><span>Previous year. <kbd>]</kbd> next year</span>
          <kbd>Space</kbd><span>Play or pause through the years</span>
          <span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></span><span>Tons, value, ton-miles</span>
          <kbd>F</kbd><span>Show or hide the filters</span>
          <kbd>I</kbd><span>Show or hide the insights</span>
          <span><kbd>Arrows</kbd></span><span>Pan the map when it has focus. <kbd>+</kbd> <kbd>-</kbd> zoom</span>
          <kbd>Esc</kbd><span>Clear a focus or partner filter, or close a panel or dialog</span>
          <kbd>?</kbd><span>This list</span>
        </div>
      {:else}
        <h2 id="dlg-title">Methodology, in short</h2>
        <p class="help" style="font-size:13.5px">The full page lists every source, release and caveat. These are the points that change how a number should be read.</p>
        <div class="keys" style="grid-template-columns:130px 1fr">
          <b>What a flow is</b><span>A modeled shipment estimate between two FAF zones, with a commodity and a mode. Not a traffic count.</span>
          <b>Dollars</b><span>FAF5 constant dollars are 2017 dollars (FAF5 User Guide). FAF6 constant dollars are 2022 dollars according to its release notes; this project did not verify that independently.</span>
          <b>Years</b><span>2017 is the benchmark. 2018 to 2023 are final, 2024 is preliminary, 2030 to 2050 are forecasts. 2025 to 2029 are not published.</span>
          <b>Two models</b><span>FAF5 and FAF6 use different zones and bases. They are shown side by side and never combined into one line.</span>
          <b>Truck network</b><span>A FAF5 model assignment for 2017, 2022 and 2050, not updated to FAF6, and not traffic counts.</span>
          <b>County estimates</b><span>Experimental, tons only, disaggregated by BTS from FAF5 zones.</span>
        </div>
        <a class="btn" href={`methodology.html${ctrl.s.theme !== 'system' ? `?theme=${ctrl.s.theme}` : ''}`} style="align-self:flex-start">Open the full methodology page</a>
      {/if}
      <button class="btn primary" type="button" style="align-self:flex-start" onclick={() => (ctrl.modal = null)}>Close</button>
    </div>
  </div>
{/if}
