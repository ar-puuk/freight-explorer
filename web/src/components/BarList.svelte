<script module lang="ts">
export interface BarItem {
  key: string;
  label: string;
  v: number;
  text: string; // the value as written
  color?: string; // CSS color for the bar and dot
  dot?: boolean;
  selected?: boolean;
}
</script>

<script lang="ts">
  /** A list of labelled values with a proportional bar under each: the visual replacement for a two-column table. */
  let { items, onpick, label }: { items: BarItem[]; onpick?: (key: string) => void; label?: string } = $props();
  const max = $derived(Math.max(1e-9, ...items.map((i) => i.v)));
</script>

<div class="ledger" role={label ? 'group' : undefined} aria-label={label}>
  {#each items as it (it.key)}
    {#if onpick}
      <button type="button" class="lrow" class:hl={it.selected} aria-pressed={it.selected} onclick={() => onpick(it.key)}>
        <span class="nm">{#if it.dot}<i class="d" style={`background:${it.color ?? 'var(--ink-3)'}`}></i>{/if}<span title={it.label}>{it.label}</span></span>
        <span class="vv">{it.text}</span>
        <span class="tr"><i style={`width:${(it.v / max) * 100}%;background:${it.color ?? 'var(--ink-3)'}`}></i></span>
      </button>
    {:else}
      <div class="lrow static">
        <span class="nm">{#if it.dot}<i class="d" style={`background:${it.color ?? 'var(--ink-3)'}`}></i>{/if}<span title={it.label}>{it.label}</span></span>
        <span class="vv">{it.text}</span>
        <span class="tr"><i style={`width:${(it.v / max) * 100}%;background:${it.color ?? 'var(--ink-3)'}`}></i></span>
      </div>
    {/if}
  {/each}
  {#if !items.length}<div class="empty">No flows with these filters.</div>{/if}
</div>
