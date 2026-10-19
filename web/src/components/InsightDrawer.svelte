<script lang="ts">
  import type { Controller } from '../lib/controller.svelte';
  import type { Panel } from '../lib/types';
  import Icon from './Icon.svelte';

  let { ctrl }: { ctrl: Controller } = $props();
  // the chart code (Observable Plot and the tab components) is fetched the first time the drawer opens
  let tabs = $state<typeof import('./tabs') | null>(null);
  let loadError = $state(false);
  $effect(() => {
    if (ctrl.rightOpen && !tabs) import('./tabs').then((m) => (tabs = m), () => (loadError = true));
  });

  type Id = Exclude<Panel, 'closed'>;
  const ALL: [Id, string][] = [['summary', 'Overview'], ['trends', 'Trends'], ['partners', 'Partners'], ['compare', 'Compare'], ['history', 'History'], ['table', 'Data']];
  const TABS = $derived(ALL.filter(([id]) => id !== 'history' || ctrl.historyProduct).map(([id, label]) => ({ id, label, lock: ctrl.tabLock(id) })));
  const cur = $derived(ctrl.s.panel === 'closed' ? 'summary' : ctrl.s.panel);

  function onKey(e: KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const open = TABS.filter((t) => !t.lock);
    const at = open.findIndex((t) => t.id === TABS[i].id);
    const next = open[(at + (e.key === 'ArrowRight' ? 1 : open.length - 1)) % open.length];
    e.preventDefault();
    ctrl.setPanel(next.id);
    queueMicrotask(() => document.getElementById(`tab-${next.id}`)?.focus());
  }
  let body: HTMLDivElement;
  // a new tab, flow or zone starts at the top of the drawer
  $effect(() => {
    void cur;
    void ctrl.detail;
    body?.scrollTo({ top: 0 });
  });
</script>

<aside class="panel right" class:open={ctrl.narrow && ctrl.mobR} class:collapsed={!ctrl.narrow && !ctrl.rightOpen} id="insights" aria-label="Insights">
  <div class="panel-head">
    <h2>Insights</h2>
    <span class="spacer"></span>
    <span class="help" aria-live="polite">{ctrl.panelBusy ? 'Updating…' : ''}</span>
    <button class="btn icon ghost" type="button" aria-label="Close insights" onclick={() => (ctrl.narrow ? (ctrl.mobR = false) : ctrl.setPanel('closed'))}><Icon name="x" /></button>
  </div>
  <div class="tabs" role="tablist" aria-label="Insight views">
    {#each TABS as t, i}
      <button type="button" role="tab" id={`tab-${t.id}`} aria-selected={cur === t.id} aria-controls="insights-body" tabindex={cur === t.id ? 0 : -1} aria-disabled={!!t.lock} title={t.lock ?? ''}
        onclick={() => (t.lock ? ctrl.toast(t.lock) : ctrl.setPanel(t.id))} onkeydown={(e) => onKey(e, i)}>{t.label}{#if t.lock}<Icon name="lock" size={12} />{/if}</button>
    {/each}
  </div>
  <div class="panel-body" id="insights-body" role="tabpanel" aria-labelledby={`tab-${cur}`} tabindex="0" bind:this={body}>
    {#if loadError}<div class="errbox" role="alert" style="margin-top:14px"><Icon name="alert" /><span>The chart code could not be loaded. Check your connection and reload.</span></div>
    {:else if !tabs}<div class="stack"><div class="empty shimmer" style="height:120px"><span class="sr-only">Loading charts</span></div></div>
    {:else if cur === 'summary'}<tabs.OverviewTab {ctrl} />
    {:else if cur === 'trends'}<tabs.TrendsTab {ctrl} />
    {:else if cur === 'partners'}<tabs.PartnersTab {ctrl} />
    {:else if cur === 'compare'}<tabs.CompareTab {ctrl} />
    {:else if cur === 'history'}<tabs.HistoryTab {ctrl} />
    {:else}<tabs.TableTab {ctrl} />{/if}
  </div>
</aside>
