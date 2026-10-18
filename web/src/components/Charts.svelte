<script lang="ts">
  import type { Controller } from '../lib/controller.svelte';
  import type { Panel } from '../lib/types';
  import CompareTab from './CompareTab.svelte';
  import HistoryTab from './HistoryTab.svelte';
  import SummaryTab from './SummaryTab.svelte';
  import TableTab from './TableTab.svelte';
  import TrendsTab from './TrendsTab.svelte';

  let { ctrl }: { ctrl: Controller } = $props();
  const LABELS: Record<Exclude<Panel, 'closed'>, string> = { summary: 'Summary', trends: 'Trends', compare: 'Compare', history: 'History', table: 'Table and CSV' };
  const TABS = $derived(ctrl.tabs.map((id) => ({ id, label: LABELS[id] })));

  function onKey(e: KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    ctrl.setPanel(next.id);
    queueMicrotask(() => document.getElementById(`tab-${next.id}`)?.focus());
  }
</script>

{#if ctrl.s.panel !== 'closed'}
  <section class="card drawer" aria-label="Charts and tables">
    <div class="head">
      <div role="tablist" aria-label="Chart views" class="tabs">
        {#each TABS as t, i}
          <button role="tab" id={`tab-${t.id}`} aria-selected={ctrl.s.panel === t.id} aria-controls="panel-body" tabindex={ctrl.s.panel === t.id ? 0 : -1}
            class:on={ctrl.s.panel === t.id} onclick={() => ctrl.setPanel(t.id)} onkeydown={(e) => onKey(e, i)}>{t.label}</button>
        {/each}
      </div>
      <span class="muted busy" aria-live="polite">{ctrl.panelBusy ? 'Updating…' : ''}</span>
      <button class="btn" type="button" onclick={() => ctrl.setPanel('closed')} aria-label="Close charts">Close</button>
    </div>
    <div class="body" id="panel-body" role="tabpanel" aria-labelledby={`tab-${ctrl.s.panel}`}>
      {#if ctrl.s.panel === 'summary'}<SummaryTab {ctrl} />
      {:else if ctrl.s.panel === 'trends'}<TrendsTab {ctrl} />
      {:else if ctrl.s.panel === 'compare'}<CompareTab {ctrl} />
      {:else if ctrl.s.panel === 'history'}<HistoryTab {ctrl} />
      {:else}<TableTab {ctrl} />{/if}
    </div>
  </section>
{/if}

<style>
  .drawer {
    position: absolute;
    z-index: 5;
    left: 10px;
    right: 10px;
    bottom: 10px;
    height: min(52%, 520px);
    min-height: 260px;
    display: flex;
    flex-direction: column;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
  }
  .tabs {
    display: flex;
    gap: 4px;
    flex: 1;
    flex-wrap: wrap;
  }
  .tabs button {
    background: transparent;
    border: 0;
    border-bottom: 3px solid transparent;
    padding: 6px 10px;
    cursor: pointer;
    font-weight: 600;
  }
  .tabs button.on {
    border-bottom-color: var(--accent);
    color: var(--accent);
  }
  .body {
    overflow: auto;
    padding: 6px 14px 12px;
    flex: 1;
    min-height: 0;
  }
  .busy {
    font-size: 12.5px;
  }
  @media (max-width: 860px) {
    .drawer {
      height: 62%;
    }
  }
</style>
