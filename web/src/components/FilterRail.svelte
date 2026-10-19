<script lang="ts">
  import type { Controller } from '../lib/controller.svelte';
  import { versionLabel } from '../lib/data';
  import { formatCount, formatPercent, rawUnit } from '../lib/format';
  import { BASEMAPS } from '../lib/mapview';
  import { groupVar, modeVar } from '../lib/palette';
  import type { Direction, Market, TruckType, View } from '../lib/types';
  import Icon from './Icon.svelte';

  let { ctrl }: { ctrl: Controller } = $props();
  const s = $derived(ctrl.s);
  const meta = $derived(ctrl.meta!);

  const MEASURES = [['tons', 'Tons'], ['value', 'Value'], ['tmiles', 'Ton-miles']] as const;
  const VIEWS: { v: View; label: string; hint: string }[] = [
    { v: 'total', label: 'All', hint: 'Domestic leg of every shipment: domestic, import and export.' },
    { v: 'domestic', label: 'Domestic', hint: 'U.S. origin to U.S. destination.' },
    { v: 'import', label: 'Import', hint: 'Foreign region to U.S. destination. The entry zone and foreign-leg mode are in the flow details.' },
    { v: 'export', label: 'Export', hint: 'U.S. origin to foreign region. The exit zone is in the flow details.' },
  ];
  const DIRS: { v: Direction; label: string; c: string }[] = [
    { v: 'both', label: 'Both', c: '' },
    { v: 'inbound', label: 'Inbound', c: 'var(--in)' },
    { v: 'outbound', label: 'Outbound', c: 'var(--out)' },
    { v: 'within', label: 'Within', c: 'var(--within)' },
  ];

  // ---- datasets
  const prods = $derived(
    ctrl.allowed.versions.map((v) => {
      const p = meta.versions.products[Object.keys(meta.versions.products).find((k) => meta.versions.products[k].faf_version === v && meta.versions.products[k].kind !== 'history')!];
      const ys = Object.keys(p.years).map(Number).sort((a, b) => a - b);
      const sub = p.experimental ? `Experimental · ${ys[0]} · tons only` : `${p.benchmark_year} benchmark · ${p.benchmark_year} dollars · ${ys.length > 1 ? `${ys[0]}–${ys[ys.length - 1]}` : `${ys[0]} only`}`;
      return { v, name: versionLabel(meta, v), sub, exp: !!p.experimental };
    }),
  );

  // ---- mode and commodity lists: sizes come from the current selection with that filter ignored, so choices show their weight
  const modeCodes = $derived(Object.keys(ctrl.dim.mode).sort());
  const modeMag = $derived(new Map(ctrl.modeShares.map((m) => [m.code, m.magnitude])));
  const modeTotal = $derived(ctrl.modeShares.reduce((a, m) => a + m.magnitude, 0));
  const comMag = $derived(new Map((ctrl.summary?.commodities ?? []).map((c) => [c.code, c.magnitude])));
  const comTotal = $derived((ctrl.summary?.commodities ?? []).reduce((a, c) => a + c.magnitude, 0));
  const groups = $derived((ctrl.dim.commodity_groups ?? meta.dims.commodity_groups).map((g) => ({ ...g, sctg: g.sctg.filter((c) => c in ctrl.dim.commodity) })).filter((g) => g.sctg.length));
  let q = $state('');
  let open = $state<Record<string, boolean>>({});
  const query = $derived(q.trim().toLowerCase());
  const shownGroups = $derived(
    groups
      .map((g) => ({ ...g, codes: g.sctg.filter((c) => !query || ctrl.dim.commodity[c].toLowerCase().includes(query) || g.name.toLowerCase().includes(query)) }))
      .filter((g) => g.codes.length),
  );

  function toggleMode(code: number) {
    const set = new Set(s.modes);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    ctrl.change({ modes: [...set].sort((a, b) => a - b) });
  }
  function toggleCode(code: string) {
    const set = new Set(s.commodities);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    ctrl.change({ commodities: [...set].sort() });
  }
  function toggleGroup(codes: string[]) {
    const set = new Set(s.commodities);
    const all = codes.every((c) => set.has(c));
    for (const c of codes) (all ? set.delete(c) : set.add(c));
    ctrl.change({ commodities: [...set].sort() });
  }
  const groupState = (codes: string[]) => {
    const n = codes.filter((c) => s.commodities.includes(c)).length;
    return n === 0 ? 'false' : n === codes.length ? 'true' : 'mixed';
  };

  const pickable = $derived([...ctrl.locations.values()].filter((l) => l.type !== 'foreign_region').sort((a, b) => Number(b.is_state_zone) - Number(a.is_state_zone) || a.name.localeCompare(b.name)));
  const shownPct = $derived(ctrl.flowTotals.total > 0 ? ctrl.flowTotals.shownSum / ctrl.flowTotals.total : 0);
  let details = $state<Record<string, boolean>>({ mode: true, com: true, map: false, display: false });
</script>

<div class="panel-body" id="controls-body">
  <p class="status" role="status" aria-live="polite">
    {#if ctrl.busy && !ctrl.flowTotals.n}Loading flows…{:else}
      Showing {formatCount(ctrl.flows.length)} of {formatCount(ctrl.flowTotals.n)} flows ({formatPercent(shownPct)} of the total){#if s.selected}, involving {ctrl.name(s.selected)}{/if}.
    {/if}
  </p>
  {#if ctrl.headlineShown}<p class="help">Preview from a precomputed file. The full query engine is loading.</p>{/if}
  {#if ctrl.notice}<div class="warnbox" role="status"><Icon name="info" /><span>{ctrl.notice}</span></div>{/if}
  {#if ctrl.error}<div class="errbox" role="alert"><Icon name="alert" /><span>{ctrl.error}</span></div>{/if}

  <div class="sect" role="radiogroup" aria-label="Dataset">
    <div class="lbl">Dataset</div>
    <div class="cards">
      {#each prods as p (p.v)}
        <button type="button" class="rcard" role="radio" aria-checked={s.version === p.v} onclick={() => ctrl.setVersion(p.v)}>
          <span class="dot"></span><b>{p.name}</b>{#if p.exp}<span class="pill exp">Experimental</span>{:else}<span></span>{/if}
          <span class="sub">{p.sub}</span>
        </button>
      {/each}
    </div>
    <p class="help">{ctrl.experimental ? 'Not directly comparable with any FAF release.' : 'FAF versions use different zones, benchmark years and dollar years. They are never combined.'}</p>
  </div>

  <div class="sect">
    <div class="lbl" id="lbl-measure">Measure<small>{s.measure === 'value' ? (s.dollars === 'const' ? `${ctrl.benchmarkYear} dollars` : 'current dollars') : ''}</small></div>
    <div class="seg block" role="radiogroup" aria-labelledby="lbl-measure">
      {#each MEASURES as [m, label]}
        {@const dis = (m === 'value' && !ctrl.available.value) || (m === 'tmiles' && !ctrl.available.tmiles)}
        <button type="button" role="radio" aria-checked={s.measure === m} aria-disabled={dis} title={dis ? (m === 'value' ? 'Value is not published for this version' : 'Ton-miles are not published for this version, year or scenario') : ''}
          onclick={() => (dis ? ctrl.toast(m === 'value' ? 'Value is not published for this version.' : 'Ton-miles are not published for this version, year or scenario.') : ctrl.change({ measure: m }))}>{label}</button>
      {/each}
    </div>
    {#if s.measure === 'value'}
      <div class="seg block sm" role="radiogroup" aria-label="Dollar basis">
        <button type="button" role="radio" aria-checked={s.dollars === 'const'} onclick={() => ctrl.change({ dollars: 'const' })}>Constant {ctrl.benchmarkYear} $</button>
        <button type="button" role="radio" aria-checked={s.dollars === 'current'} aria-disabled={!ctrl.available.current} title={ctrl.available.current ? '' : 'Current-dollar values are not published for this version or year'}
          onclick={() => (ctrl.available.current ? ctrl.change({ dollars: 'current' }) : ctrl.toast('Current-dollar values are not published for this version or year.'))}>Current $</button>
      </div>
    {/if}
    {#if !ctrl.available.tmiles || !ctrl.available.value}<p class="help">{!ctrl.available.value ? 'Value and ton-miles are' : 'Ton-miles are'} not published for {ctrl.versionLabel} {s.year}{s.scenario !== 'mid' ? ` (${s.scenario} scenario)` : ''}.</p>{/if}
  </div>

  <div class="sect">
    <div class="lbl" id="lbl-view">Shipment type<small>Domestic leg shown</small></div>
    <div class="seg block" role="radiogroup" aria-labelledby="lbl-view">
      {#each VIEWS as v}
        <button type="button" role="radio" aria-checked={s.view === v.v} onclick={() => ctrl.change({ view: v.v })}>{v.label}</button>
      {/each}
    </div>
    <p class="help">{VIEWS.find((v) => v.v === s.view)?.hint}</p>
  </div>

  <div class="sect">
    <div class="lbl" id="lbl-dir">Direction<small>Relative to the state</small></div>
    <div class="seg block tight" role="radiogroup" aria-labelledby="lbl-dir">
      {#each DIRS as d}
        <button type="button" role="radio" aria-checked={s.direction === d.v} onclick={() => ctrl.change({ direction: d.v })}>
          {#if d.c}<i style={`width:7px;height:7px;border-radius:50%;background:${d.c};display:inline-block;flex:none`}></i>{/if}{d.label}
        </button>
      {/each}
    </div>
  </div>

  <details class="sect" bind:open={details.mode}>
    <summary>Mode<small>{s.modes.length ? `${s.modes.length} selected` : 'all'}</small><Icon name="chev" size={15} /></summary>
    <div class="inner">
      <div class="opts scroll-opts" role="group" aria-label="Domestic mode">
        {#each modeCodes as code}
          {@const mag = modeMag.get(code) ?? 0}
          <button type="button" class="opt" role="checkbox" aria-checked={s.modes.includes(Number(code))} style={`--c:${modeVar(code)}`} onclick={() => toggleMode(Number(code))}>
            <span class="cb"></span><span>{ctrl.dim.mode[code]}</span><span class="v">{mag ? formatPercent(modeTotal ? mag / modeTotal : 0) : '—'}</span>
            <span class="bar"><i style={`width:${modeTotal ? (mag / modeTotal) * 100 : 0}%`}></i></span>
          </button>
        {/each}
      </div>
      <p class="help">Mode of the domestic leg. "Multiple modes and mail" and "No domestic mode" are FAF categories, not gaps.</p>
    </div>
  </details>

  <details class="sect" bind:open={details.com}>
    <summary>Commodity<small>{s.commodities.length ? `${s.commodities.length} of ${Object.keys(ctrl.dim.commodity).length}` : 'all'}</small><Icon name="chev" size={15} /></summary>
    <div class="inner">
      <input class="input" type="search" placeholder="Search commodities" aria-label="Search commodities" bind:value={q} />
      <div class="opts scroll-opts" role="group" aria-label="Commodity">
        {#each shownGroups as g, gi (g.slug)}
          <div class="opts">
            <button type="button" class="opt" role="checkbox" aria-checked={groupState(g.sctg)} style={`--c:${groupVar(groups.findIndex((x) => x.slug === g.slug))};font-weight:600`} onclick={() => toggleGroup(g.sctg)}>
              <span class="cb"></span><span>{g.name}</span>
              <span class="v">{comTotal ? formatPercent(g.sctg.reduce((a, c) => a + (comMag.get(c) ?? 0), 0) / comTotal) : '—'}</span>
              <span class="bar"><i style={`width:${comTotal ? (g.sctg.reduce((a, c) => a + (comMag.get(c) ?? 0), 0) / comTotal) * 100 : 0}%`}></i></span>
            </button>
            {#if query || open[g.slug]}
              {#each g.codes as c}
                <button type="button" class="opt sub" role="checkbox" aria-checked={s.commodities.includes(c)} style={`--c:${groupVar(groups.findIndex((x) => x.slug === g.slug))}`} onclick={() => toggleCode(c)}>
                  <span class="cb"></span><span>{ctrl.dim.commodity[c]} <span class="muted">({c})</span></span><span class="v">{comTotal && comMag.get(c) ? formatPercent(comMag.get(c)! / comTotal) : '—'}</span>
                </button>
              {/each}
            {/if}
            {#if !query}
              <button type="button" class="btn sm ghost" style="justify-content:flex-start;margin-left:24px" aria-expanded={!!open[g.slug]} onclick={() => (open[g.slug] = !open[g.slug])}>{open[g.slug] ? 'Hide' : 'Show'} {g.sctg.length} commodit{g.sctg.length === 1 ? 'y' : 'ies'}</button>
            {/if}
          </div>
        {/each}
        {#if !shownGroups.length}<div class="empty">No commodity matches</div>{/if}
      </div>
      <p class="help">{ctrl.experimental ? 'The county product has five commodity groups.' : 'Groups are the 12 FHWA assignment commodity groups.'} Nothing selected means all.</p>
    </div>
  </details>

  <details class="sect" bind:open={details.map}>
    <summary>Map detail<Icon name="chev" size={15} /></summary>
    <div class="inner">
      <div>
        <div class="field-row" style="justify-content:space-between"><label for="topn" style="font-weight:500">Flows drawn</label><span class="mono num">{s.topN}</span></div>
        <input id="topn" type="range" min="5" max="500" step="5" value={s.topN} style={`--p:${((s.topN - 5) / 495) * 100}%`} oninput={(e) => ctrl.change({ topN: Number(e.currentTarget.value) })} aria-describedby="topn-h" />
        <p class="help" id="topn-h">The largest zone pairs for the selection. The headline numbers always include every flow.</p>
      </div>
      <div class="field-row">
        <label for="minflow" style="flex:1;font-weight:500">Hide flows under<br /><span class="help">{rawUnit(s.measure)}</span></label>
        <input id="minflow" type="number" min="0" step="any" value={s.minFlow} onchange={(e) => ctrl.change({ minFlow: Math.max(0, Number(e.currentTarget.value) || 0) })} />
      </div>
      <div>
        <label for="zonepick" style="font-weight:500;display:block;margin-bottom:4px">Isolate flows for a {ctrl.experimental ? 'county or zone' : 'zone'}</label>
        <select id="zonepick" style="width:100%" value={s.selected ?? ''} onchange={(e) => ctrl.select(e.currentTarget.value || null)}>
          <option value="">All flows</option>
          {#each pickable as l}<option value={l.id}>{l.name}{l.is_state_zone ? ' (in state)' : ''}</option>{/each}
        </select>
        <p class="help">The same as clicking a zone on the map. Use it with the keyboard.</p>
      </div>
    </div>
  </details>

  <div class="sect">
    <div class="lbl">Layers</div>
    <div class="switchrow"><label for="ly-flows">OD flow arcs<small>Width shows the measure</small></label><input class="sw-input" type="checkbox" role="switch" id="ly-flows" checked={s.layers.flows} onchange={(e) => ctrl.setLayer('flows', e.currentTarget.checked)} /></div>
    <div class="switchrow"><label for="ly-zones">FAF zones<small>Tinted by the strength of the link to the state</small></label><input class="sw-input" type="checkbox" role="switch" id="ly-zones" checked={s.layers.zones} onchange={(e) => ctrl.setLayer('zones', e.currentTarget.checked)} /></div>
    <div class="switchrow"><label for="ly-net">Truck network<small>FAF5 model, not traffic counts</small></label><input class="sw-input" type="checkbox" role="switch" id="ly-net" checked={s.layers.network} onchange={(e) => ctrl.setLayer('network', e.currentTarget.checked)} /></div>
    {#if s.layers.network}
      <div class="card" style="background:var(--panel-2)">
        <div class="field-row"><label for="ny" style="font-weight:500;flex:1">Model year</label>
          <select id="ny" value={s.net.year} onchange={(e) => ctrl.setNet({ year: Number(e.currentTarget.value) })}>
            {#each ctrl.netYears as y}<option value={y}>{y}{y === 2017 ? ' (benchmark)' : ' (baseline projection)'}</option>{/each}
          </select></div>
        <div>
          <div class="help" id="lbl-nt" style="margin-bottom:4px">Truck type</div>
          <div class="seg block sm" role="radiogroup" aria-labelledby="lbl-nt">
            {#each [['all', 'All'], ['su', 'Single unit'], ['cu', 'Combination']] as [v, l]}
              <button type="button" role="radio" aria-checked={s.net.truck === v} onclick={() => ctrl.setNet({ truck: v as TruckType })}>{l}</button>
            {/each}
          </div>
        </div>
        <div>
          <div class="help" id="lbl-nm" style="margin-bottom:4px">Market</div>
          <div class="seg block sm" role="radiogroup" aria-labelledby="lbl-nm">
            {#each [['total', 'Total'], ['domestic', 'Domestic'], ['import', 'Import'], ['export', 'Export']] as [v, l]}
              <button type="button" role="radio" aria-checked={s.net.market === v} onclick={() => ctrl.setNet({ market: v as Market })}>{l}</button>
            {/each}
          </div>
        </div>
        <div class="switchrow"><label for="ly-cc">Centroid connectors<small>Model access links, not roads</small></label><input class="sw-input" type="checkbox" role="switch" id="ly-cc" checked={s.net.connectors} onchange={(e) => ctrl.setNet({ connectors: e.currentTarget.checked })} /></div>
        <p class="help">Width and color show modeled daily truck trips, both directions, including through traffic. {ctrl.linkCount != null ? `${formatCount(ctrl.linkCount)} links carry modeled flow.` : ''}</p>
      </div>
    {/if}
  </div>

  <details class="sect" bind:open={details.display}>
    <summary>Display<Icon name="chev" size={15} /></summary>
    <div class="inner">
      <div>
        <label for="basemap" style="font-weight:500;display:block;margin-bottom:4px">Basemap</label>
        <select id="basemap" style="width:100%" value={s.basemap ?? ''} onchange={(e) => ctrl.setBasemap(e.currentTarget.value || null)}>
          <option value="">Auto ({ctrl.theme === 'dark' ? 'Dark' : 'Positron'})</option>
          {#each BASEMAPS as b}<option value={b}>{b[0].toUpperCase() + b.slice(1)}</option>{/each}
        </select>
      </div>
      <div class="switchrow"><label for="cb">Color-blind safe palette<small>Blue and orange direction colors</small></label><input class="sw-input" type="checkbox" role="switch" id="cb" checked={ctrl.cb} onchange={(e) => ctrl.setCb(e.currentTarget.checked)} /></div>
    </div>
  </details>

  <div class="sect" style="flex-direction:row;flex-wrap:wrap;gap:8px">
    <button class="btn" type="button" onclick={() => ctrl.fitToFlows()}><Icon name="fit" size={15} />Fit to flows</button>
    <button class="btn" type="button" onclick={() => ctrl.resetFilters()}><Icon name="reset" size={15} />Reset filters</button>
  </div>
</div>

<style>
  .status {
    font-size: 13px;
    padding: 6px 10px;
    background: var(--accent-soft);
    border-radius: var(--r-s);
    margin: 4px 0 8px;
  }
  .errbox,
  .warnbox {
    margin-bottom: 8px;
  }
</style>
