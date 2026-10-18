<script lang="ts">
  import type { Controller } from '../lib/controller.svelte';
  import { formatCount, formatPercent, rawUnit } from '../lib/format';
  import type { Direction, Market, TruckType, View } from '../lib/types';

  let { ctrl }: { ctrl: Controller } = $props();

  const s = $derived(ctrl.s);
  const meta = $derived(ctrl.meta!);
  const years = $derived(ctrl.yearList);
  const yearIdx = $derived(Math.max(0, years.indexOf(s.year)));
  const versions = $derived(Object.values(meta.versions.products).map((p) => p.faf_version));

  const STATUS: Record<string, string> = {
    base: 'benchmark year',
    final: 'final annual estimate',
    preliminary: 'preliminary annual estimate',
    forecast: 'forecast (mid-range scenario)',
  };
  const VIEWS: { v: View; label: string; hint: string }[] = [
    { v: 'total', label: 'Total', hint: 'Domestic leg of every shipment: domestic, import and export.' },
    { v: 'domestic', label: 'Domestic', hint: 'U.S. origin to U.S. destination.' },
    { v: 'import', label: 'Import', hint: 'Foreign region to U.S. destination. The entry zone and foreign-leg mode are in the detail panel.' },
    { v: 'export', label: 'Export', hint: 'U.S. origin to foreign region. The exit zone is in the detail panel.' },
  ];
  const DIRS: { v: Direction; label: string }[] = [
    { v: 'both', label: 'Both' },
    { v: 'inbound', label: 'Inbound' },
    { v: 'outbound', label: 'Outbound' },
    { v: 'within', label: 'Within' },
  ];

  const sctgLabel = (code: string) => ctrl.dim.commodity[code] ?? code;
  const groups = $derived(meta.dims.commodity_groups.map((g) => ({ ...g, sctg: g.sctg.filter((c) => c in ctrl.dim.commodity) })).filter((g) => g.sctg.length));
  const modeCodes = $derived(Object.keys(ctrl.dim.mode).sort());

  function toggleCommodity(code: string, on: boolean) {
    const set = new Set(s.commodities);
    if (on) set.add(code);
    else set.delete(code);
    ctrl.change({ commodities: [...set].sort() });
  }
  function toggleGroup(codes: string[], on: boolean) {
    const set = new Set(s.commodities);
    for (const c of codes) (on ? set.add(c) : set.delete(c));
    ctrl.change({ commodities: [...set].sort() });
  }
  function toggleMode(code: number, on: boolean) {
    const set = new Set(s.modes);
    if (on) set.add(code);
    else set.delete(code);
    ctrl.change({ modes: [...set].sort((a, b) => a - b) });
  }
  function indeterminate(node: HTMLInputElement, value: boolean) {
    node.indeterminate = value;
    return { update: (v: boolean) => (node.indeterminate = v) };
  }

  const shownPct = $derived(ctrl.flowTotals.total > 0 ? ctrl.flowTotals.shownSum / ctrl.flowTotals.total : 0);
  let copied = $state(false);
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      /* clipboard unavailable: the address bar already holds the link */
    }
  }
</script>

<section aria-label="Data version and year">
  <fieldset class="field">
    <legend>FAF version</legend>
    <div class="seg">
      {#each versions as v}
        <label><input type="radio" name="version" value={v} checked={s.version === v} onchange={() => ctrl.setVersion(v)} /><span>FAF {v}</span></label>
      {/each}
    </div>
    <span class="hint">{ctrl.benchmarkYear} benchmark. FAF5 and FAF6 use different zones, benchmark years and dollar years: not directly comparable.</span>
  </fieldset>

  <div class="field">
    <label class="label" for="year">Year: <strong>{s.year}</strong> <span class="muted">({STATUS[ctrl.dataVersionOfYear] ?? ctrl.dataVersionOfYear})</span></label>
    <input id="year" type="range" min="0" max={Math.max(0, years.length - 1)} step="1" value={yearIdx} disabled={years.length < 2}
      oninput={(e) => ctrl.change({ year: years[Number(e.currentTarget.value)] })} aria-valuetext={`${s.year}, ${STATUS[ctrl.dataVersionOfYear]}`} />
    {#if years.length < 2}
      <span class="hint">This release has {s.year} only. Other years arrive with future FAF releases.</span>
    {:else}
      <span class="hint">{years[0]} to {years[years.length - 1]}. Annual estimates and forecast years are labeled; a gap in the years means the release publishes nothing for them.</span>
    {/if}
  </div>

  <fieldset class="field">
    <legend>Scenario</legend>
    <div class="seg">
      {#each ['mid', 'high', 'low'] as sc}
        {@const have = ctrl.scenarioList.includes(sc)}
        <label title={have ? '' : `FAF ${s.version} publishes no ${sc} scenario`}>
          <input type="radio" name="scenario" checked={s.scenario === sc} disabled={!have} onchange={() => ctrl.setScenario(sc)} /><span>{sc === 'mid' ? 'Mid-range' : sc === 'high' ? 'High' : 'Low'}</span>
        </label>
      {/each}
    </div>
    <span class="hint">
      {#if ctrl.scenarioList.length > 1}High and Low are published FAF forecast scenarios for forecast years only, with tons and value but no ton-miles or current dollars.
      {:else}FAF {s.version} publishes no High or Low scenario.{/if}
    </span>
  </fieldset>
</section>

<section aria-label="Flow filters">
  <fieldset class="field">
    <legend>Flow view</legend>
    <div class="seg">
      {#each VIEWS as v}
        <label><input type="radio" name="view" value={v.v} checked={s.view === v.v} onchange={() => ctrl.change({ view: v.v })} /><span>{v.label}</span></label>
      {/each}
    </div>
    <span class="hint">{VIEWS.find((v) => v.v === s.view)?.hint}</span>
  </fieldset>

  <fieldset class="field">
    <legend>Direction</legend>
    <div class="seg">
      {#each DIRS as d}
        <label><input type="radio" name="direction" value={d.v} checked={s.direction === d.v} onchange={() => ctrl.change({ direction: d.v })} /><span>{d.label}</span></label>
      {/each}
    </div>
    <span class="hint">Relative to the state, on the domestic leg of each shipment.</span>
  </fieldset>

  <fieldset class="field">
    <legend>Measure</legend>
    <div class="seg">
      <label><input type="radio" name="measure" checked={s.measure === 'tons'} onchange={() => ctrl.change({ measure: 'tons' })} /><span>Tons</span></label>
      <label><input type="radio" name="measure" checked={s.measure === 'value'} onchange={() => ctrl.change({ measure: 'value' })} /><span>Value</span></label>
      <label title={ctrl.available.tmiles ? '' : 'Ton-miles are not published for this version or year'}>
        <input type="radio" name="measure" checked={s.measure === 'tmiles'} disabled={!ctrl.available.tmiles} onchange={() => ctrl.change({ measure: 'tmiles' })} /><span>Ton-miles</span>
      </label>
    </div>
    {#if !ctrl.available.tmiles}<span class="hint">Ton-miles are not published for FAF {s.version} {s.year}.</span>{/if}
  </fieldset>

  {#if s.measure === 'value'}
    <fieldset class="field">
      <legend>Dollar basis</legend>
      <div class="seg">
        <label><input type="radio" name="dollars" checked={s.dollars === 'const'} onchange={() => ctrl.change({ dollars: 'const' })} /><span>Constant {ctrl.benchmarkYear} $</span></label>
        <label title={ctrl.available.current ? '' : 'Current-dollar values are not published for this version or year'}>
          <input type="radio" name="dollars" checked={s.dollars === 'current'} disabled={!ctrl.available.current} onchange={() => ctrl.change({ dollars: 'current' })} /><span>Current $</span>
        </label>
      </div>
      {#if !ctrl.available.current}<span class="hint">Current-dollar values are not published for FAF {s.version} {s.year}.</span>{/if}
    </fieldset>
  {/if}

  <details>
    <summary>Commodity {s.commodities.length ? `(${s.commodities.length} of ${Object.keys(ctrl.dim.commodity).length})` : '(all)'}</summary>
    {#each groups as g}
      {@const n = g.sctg.filter((c) => s.commodities.includes(c)).length}
      <div class="group">
        <label class="check">
          <input type="checkbox" checked={n === g.sctg.length} use:indeterminate={n > 0 && n < g.sctg.length} onchange={(e) => toggleGroup(g.sctg, e.currentTarget.checked)} />
          <span>{g.name}</span>
        </label>
        <ul>
          {#each g.sctg as c}
            <li><label class="check"><input type="checkbox" checked={s.commodities.includes(c)} onchange={(e) => toggleCommodity(c, e.currentTarget.checked)} /><span>{sctgLabel(c)} <span class="muted">({c})</span></span></label></li>
          {/each}
        </ul>
      </div>
    {/each}
    <button class="btn" type="button" onclick={() => ctrl.change({ commodities: [] })} disabled={!s.commodities.length}>All commodities</button>
    <span class="hint">Groups are the 12 FHWA assignment commodity groups. Nothing selected means all.</span>
  </details>

  <details>
    <summary>Domestic mode {s.modes.length ? `(${s.modes.length} of ${modeCodes.length})` : '(all)'}</summary>
    {#each modeCodes as m}
      <label class="check"><input type="checkbox" checked={s.modes.includes(Number(m))} onchange={(e) => toggleMode(Number(m), e.currentTarget.checked)} /><span>{ctrl.dim.mode[m]}</span></label>
    {/each}
    <button class="btn" type="button" onclick={() => ctrl.change({ modes: [] })} disabled={!s.modes.length}>All modes</button>
    <span class="hint">Mode of the domestic leg. "Multiple modes and mail" and "No domestic mode" are FAF categories, not gaps.</span>
  </details>
</section>

<section aria-label="Display">
  <div class="field">
    <label class="label" for="topn">Show top <strong>{s.topN}</strong> flows</label>
    <input id="topn" type="range" min="5" max="500" step="5" value={s.topN} oninput={(e) => ctrl.change({ topN: Number(e.currentTarget.value) })} />
  </div>
  <div class="field">
    <label class="label" for="minflow">Minimum flow ({rawUnit(s.measure)})</label>
    <input id="minflow" type="number" min="0" step="any" value={s.minFlow} onchange={(e) => ctrl.change({ minFlow: Math.max(0, Number(e.currentTarget.value) || 0) })} />
  </div>
  <p class="status" role="status" aria-live="polite">
    {#if ctrl.busy && !ctrl.flowTotals.n}Loading flows…{:else}
      Showing {formatCount(ctrl.flows.length)} of {formatCount(ctrl.flowTotals.n)} flows ({formatPercent(shownPct)} of the total)
      {#if s.selected}involving {ctrl.name(s.selected)}{/if}
    {/if}
  </p>
  {#if ctrl.headlineShown}<p class="hint">Preview from a precomputed file; the full query engine is loading.</p>{/if}
  {#if ctrl.notice}<p class="notice" role="status">{ctrl.notice}</p>{/if}
  {#if ctrl.error}<p class="error" role="alert">{ctrl.error}</p>{/if}
</section>

<section aria-label="Layers">
  <fieldset class="field">
    <legend>Layers</legend>
    <label class="check"><input type="checkbox" checked={s.layers.flows} onchange={(e) => ctrl.setLayer('flows', e.currentTarget.checked)} /><span>OD flows</span></label>
    <label class="check"><input type="checkbox" checked={s.layers.zones} onchange={(e) => ctrl.setLayer('zones', e.currentTarget.checked)} /><span>FAF zones</span></label>
    <label class="check"><input type="checkbox" checked={s.layers.network} onchange={(e) => ctrl.setLayer('network', e.currentTarget.checked)} /><span>Truck network (FAF5 model)</span></label>
  </fieldset>

  {#if s.layers.network}
    <fieldset class="field">
      <legend>Truck network flows</legend>
      <div class="field">
        <label class="label" for="ny">Model year</label>
        <select id="ny" value={s.net.year} onchange={(e) => ctrl.setNet({ year: Number(e.currentTarget.value) })}>
          {#each ctrl.netYears as y}<option value={y}>{y}{y === 2017 ? ' (benchmark)' : ' (baseline projection)'}</option>{/each}
        </select>
      </div>
      <div class="field">
        <span class="label">Truck type</span>
        <div class="seg">
          {#each [['all', 'All'], ['su', 'Single unit'], ['cu', 'Combination']] as [v, l]}
            <label><input type="radio" name="nt" checked={s.net.truck === v} onchange={() => ctrl.setNet({ truck: v as TruckType })} /><span>{l}</span></label>
          {/each}
        </div>
      </div>
      <div class="field">
        <span class="label">Market</span>
        <div class="seg">
          {#each [['total', 'Total'], ['domestic', 'Domestic'], ['import', 'Import'], ['export', 'Export']] as [v, l]}
            <label><input type="radio" name="nm" checked={s.net.market === v} onchange={() => ctrl.setNet({ market: v as Market })} /><span>{l}</span></label>
          {/each}
        </div>
      </div>
      <label class="check"><input type="checkbox" checked={s.net.connectors} onchange={(e) => ctrl.setNet({ connectors: e.currentTarget.checked })} /><span>Show centroid connectors (model access links, not roads)</span></label>
      <span class="hint">Width and color show modeled daily truck trips, both directions. Includes through traffic. {ctrl.linkCount != null ? `${formatCount(ctrl.linkCount)} links carry modeled flow.` : ''}</span>
    </fieldset>
  {/if}
</section>

<div class="field" style="display: flex; gap: 8px; flex-wrap: wrap">
  <button class="btn" type="button" onclick={() => ctrl.fitToFlows()}>Fit map to flows</button>
  <button class="btn" type="button" onclick={() => ctrl.resetFilters()}>Reset filters</button>
  <button class="btn" type="button" onclick={copyLink}>{copied ? 'Link copied' : 'Copy link'}</button>
</div>
