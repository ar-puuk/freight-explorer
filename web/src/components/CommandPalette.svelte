<script lang="ts">
  import type { Controller } from '../lib/controller.svelte';
  import { versionLabel } from '../lib/data';
  import type { Panel } from '../lib/types';
  import { STATUS_LABEL } from '../lib/ui';

  let { ctrl }: { ctrl: Controller } = $props();
  interface Item {
    g: string;
    label: string;
    hint: string;
    run: () => void;
  }
  let q = $state('');
  let sel = $state(0);
  let input = $state<HTMLInputElement>();
  let returnTo: Element | null = null;

  const open = $derived(ctrl.modal === 'palette');
  const items = $derived.by<Item[]>(() => {
    if (!open) return [];
    const m = ctrl.meta!;
    const s = ctrl.s;
    const out: Item[] = [];
    const add = (g: string, label: string, hint: string, run: () => void) => out.push({ g, label, hint, run });
    for (const v of ctrl.allowed.versions) add('Dataset', versionLabel(m, v), v === s.version ? 'current' : '', () => void ctrl.setVersion(v));
    for (const [id, label] of [['tons', 'Tons'], ['value', 'Value'], ['tmiles', 'Ton-miles']] as const) {
      add('Measure', label, s.measure === id ? 'current' : '', () => (id === 'value' && !ctrl.available.value) || (id === 'tmiles' && !ctrl.available.tmiles) ? ctrl.toast(`${label} is not published for this selection.`) : ctrl.change({ measure: id }));
    }
    for (const y of ctrl.timelineYears) add('Year', String(y), STATUS_LABEL[ctrl.experimental ? 'experimental' : m.versions.products[ctrl.product].years[String(y)]] ?? '', () => ctrl.setYear(y));
    for (const sc of ctrl.scenarioList.filter((x) => x !== 'mid')) add('Scenario', `${sc[0].toUpperCase()}${sc.slice(1)} scenario`, 'forecast years', () => ctrl.setScenario(sc));
    const tabs: [Exclude<Panel, 'closed'>, string][] = [['summary', 'Overview'], ['trends', 'Trends'], ['partners', 'Partners'], ['compare', 'Compare'], ['history', 'History'], ['table', 'Data']];
    for (const [id, label] of tabs) if (!ctrl.tabLock(id) && (id !== 'history' || ctrl.historyProduct)) add('Open', `${label} tab`, 'insights', () => (ctrl.narrow && (ctrl.mobR = true), ctrl.setPanel(id)));
    const groups = ctrl.dim.commodity_groups ?? m.dims.commodity_groups;
    for (const g of groups) add('Commodity', g.name, 'filter', () => ctrl.toggleCommodities(g.sctg.filter((c) => c in ctrl.dim.commodity)));
    for (const [code, label] of Object.entries(ctrl.dim.mode)) add('Mode', label, s.modes.includes(Number(code)) ? 'filtering' : 'filter', () => ctrl.toggleMode(Number(code)));
    for (const l of [...ctrl.locations.values()].filter((x) => x.type !== 'foreign_region')) add('Zone', l.name, l.is_state_zone ? 'in the state · focus' : 'focus', () => ctrl.select(l.id));
    add('Layer', 'Toggle truck network', '', () => ctrl.setLayer('network', !s.layers.network));
    add('Layer', 'Toggle zone tint', '', () => ctrl.setLayer('zones', !s.layers.zones));
    add('Action', 'Fit the map to the flows', '', () => ctrl.fitToFlows());
    add('Action', 'Reset all filters', '', () => ctrl.resetFilters());
    add('Action', 'Copy citation', '', () => navigator.clipboard?.writeText(ctrl.citation()).then(() => ctrl.toast('Citation copied'), () => ctrl.toast('Copy is blocked in this browser.')));
    add('Action', 'Open the methodology', '', () => (ctrl.modal = 'method'));
    for (const [v, l] of [['light', 'Light theme'], ['dark', 'Dark theme'], ['system', 'Match system theme']] as const) add('Theme', l, '', () => ctrl.setTheme(v));
    return out;
  });
  const list = $derived.by(() => {
    const t = q.trim().toLowerCase();
    return items.filter((i) => !t || `${i.label} ${i.g}`.toLowerCase().includes(t)).slice(0, 40);
  });

  $effect(() => {
    if (open) {
      returnTo = document.activeElement;
      q = '';
      sel = 0;
      queueMicrotask(() => input?.focus());
    } else if (returnTo instanceof HTMLElement) {
      returnTo.focus();
      returnTo = null;
    }
  });
  $effect(() => {
    void list;
    sel = Math.min(sel, Math.max(0, list.length - 1));
    document.getElementById(`po-${sel}`)?.scrollIntoView({ block: 'nearest' });
  });

  function run(i: number) {
    const it = list[i];
    if (!it) return;
    ctrl.modal = null;
    it.run();
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      sel = Math.min(list.length - 1, sel + 1);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      sel = Math.max(0, sel - 1);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      run(sel);
      e.preventDefault();
    } else if (e.key === 'Tab') e.preventDefault(); // focus stays in the field: the list is driven by the arrow keys
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (Escape closes the dialog; the scrim click is a pointer convenience) -->
  <div class="scrim on" onclick={(e) => e.target === e.currentTarget && (ctrl.modal = null)}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="Search and jump">
      <input class="q" bind:this={input} bind:value={q} role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={list.length ? `po-${sel}` : undefined}
        aria-label="Search and jump" placeholder="Jump to a year, zone, commodity, mode or action" autocomplete="off" oninput={() => (sel = 0)} onkeydown={key} />
      <div class="res" id="palette-list" role="listbox" aria-label="Results">
        {#each list as it, i (it.g + it.label)}
          {#if i === 0 || list[i - 1].g !== it.g}<div class="grp" role="presentation">{it.g}</div>{/if}
          <button type="button" class="it" id={`po-${i}`} role="option" tabindex="-1" aria-selected={i === sel} onclick={() => run(i)}>{it.label}<small>{it.hint}</small></button>
        {/each}
        {#if !list.length}<div class="empty">Nothing matches</div>{/if}
      </div>
      <div class="foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> select</span><span><kbd>Esc</kbd> close</span></div>
    </div>
  </div>
{/if}
