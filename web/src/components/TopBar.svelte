<script lang="ts">
  import type { Controller } from '../lib/controller.svelte';
  import type { ThemePref } from '../lib/types';
  import Icon from './Icon.svelte';

  let { ctrl }: { ctrl: Controller } = $props();

  const THEMES: { v: ThemePref; label: string; icon: string }[] = [
    { v: 'system', label: 'Match system theme', icon: 'monitor' },
    { v: 'light', label: 'Light theme', icon: 'sun' },
    { v: 'dark', label: 'Dark theme', icon: 'moon' },
  ];

  async function copy(text: string, msg: string) {
    try {
      await navigator.clipboard.writeText(text);
      ctrl.toast(msg);
    } catch {
      ctrl.toast('Copy is blocked in this browser. Select the address bar text instead.');
    }
  }
</script>

<header class="top">
  <h1 class="brand">
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><rect width="26" height="26" rx="7" fill="var(--ink)" /><path d="M5 19c4 0 7-4 8-10M21 19c-4 0-7-4-8-10M13 21V9" fill="none" stroke="var(--bg)" stroke-width="2" stroke-linecap="round" /><circle cx="13" cy="8" r="2.4" fill="var(--bg)" /></svg>
    <span class="t">Freight Explorer</span>
  </h1>
  <label class="statepick">
    <span class="sr-only">State</span>
    <select aria-label="State" disabled={true} title="States come from config/states/<name>.yml. Only one state is built here.">
      <option>{ctrl.meta?.state.name}</option>
    </select>
  </label>
  <span class="spacer"></span>
  <button class="btn" type="button" onclick={() => (ctrl.modal = 'palette')}>
    <Icon name="search" size={15} /><span class="hs">Search and jump</span> <kbd class="hs">Ctrl K</kbd>
  </button>
  <a class="btn ghost hide-s" href={`methodology.html${ctrl.s.theme !== 'system' ? `?theme=${ctrl.s.theme}` : ''}`}><Icon name="book" size={15} />Methodology</a>
  <button class="btn ghost icon hide-s" type="button" aria-label="Copy a link to this view" title="Copy link to this view" onclick={() => copy(location.href, 'Link copied')}><Icon name="link" /></button>
  <button class="btn ghost icon hide-s" type="button" aria-label="Copy a citation for this view" title="Copy a citation for this view" onclick={() => copy(ctrl.citation(), 'Citation copied')}><Icon name="copy" /></button>
  <div class="seg sm" role="radiogroup" aria-label="Theme">
    {#each THEMES as t}
      <button type="button" role="radio" aria-checked={ctrl.s.theme === t.v} aria-label={t.label} title={t.label} onclick={() => ctrl.setTheme(t.v)}><Icon name={t.icon} size={15} /></button>
    {/each}
  </div>
  <button class="btn ghost icon hide-s" type="button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onclick={() => (ctrl.modal = 'help')}><Icon name="help" /></button>
</header>

<style>
  .statepick select {
    appearance: none;
    border: 0;
    background: transparent;
    font-weight: 600;
    height: 30px;
    padding: 0 4px 0 0;
    width: auto;
    min-width: 3.5em;
  }
</style>
