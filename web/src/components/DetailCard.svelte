<script lang="ts">
  import type { Breakdown, Controller } from '../lib/controller.svelte';
  import { formatCount, formatPercent, formatShort } from '../lib/format';
  import { DIR_VAR, groupVar, modeVar } from '../lib/palette';
  import { DIR_LABEL, shortMode } from '../lib/ui';
  import BarList from './BarList.svelte';
  import Icon from './Icon.svelte';

  let { ctrl }: { ctrl: Controller } = $props();
  const d = $derived(ctrl.detail);
  const meta = $derived(ctrl.meta!);
  const groups = $derived(ctrl.dim.commodity_groups ?? meta.dims.commodity_groups);
  const groupIdx = (code: string) => Math.max(0, groups.findIndex((g) => g.sctg.includes(code)));
  const fmt = (v: number) => ctrl.fmtMeasure(v);
  const loc = (id: string) => ctrl.locations.get(id);

  const LINK_GROUPS: { title: string; cols: string[] }[] = [
    { title: 'Road', cols: ['road_name', 'sign_rte', 'rte_type', 'rte_number', 'road_class', 'road_class_desc', 'f_class', 'facility_type', 'length_mi', 'status'] },
    { title: 'Designations', cols: ['nhs', 'strahnet', 'nhfn', 'truck_access'] },
    { title: 'Capacity', cols: ['ab_lanes', 'ba_lanes', 'speed_limit', 'toll_type'] },
    { title: 'Location', cols: ['country', 'state_abbrev', 'state_fips', 'county_fips', 'faf_zone', 'in_state'] },
  ];
  const TRUCKS: Record<string, string> = { all: 'All trucks', su: 'Single unit', cu: 'Combination' };
  function show(v: unknown): string {
    if (v == null || v === '') return 'not recorded';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
    return String(v);
  }
  const modeItems = (rows: Breakdown[]) => rows.map((r) => ({ key: r.code, label: shortMode(r.label), v: r.magnitude, text: fmt(r.magnitude), color: modeVar(r.code), dot: true }));
  const comItems = (rows: Breakdown[]) => rows.map((r) => ({ key: r.code, label: r.label, v: r.magnitude, text: fmt(r.magnitude), color: groupVar(groupIdx(r.code)), dot: true }));
  const total = (rows: Breakdown[]) => rows.reduce((a, r) => a + r.magnitude, 0);
</script>

{#if d}
  <div class="card" role="region" aria-label="Details" style={d.kind === 'flow' ? 'border-color:var(--ink-3)' : d.kind === 'zone' ? 'border-color:var(--accent)' : ''}>
    <h3>
      <span>
        {#if d.kind === 'zone'}{loc(d.id)?.name ?? d.id}
        {:else if d.kind === 'flow'}{ctrl.name(d.originId)} to {ctrl.name(d.destId)}
        {:else}Network link {d.id}{/if}
      </span>
      <button class="btn sm ghost" type="button" aria-label="Close details" onclick={() => ctrl.closeDetail()}><Icon name="x" size={14} /></button>
    </h3>

    {#if d.kind === 'zone'}
      {@const z = loc(d.id)}
      <p class="help">
        {z?.type === 'foreign_region' ? 'Foreign region' : z?.type === 'county' ? `County ${d.id}` : `FAF zone ${d.id}`}{z?.is_state_zone ? ' (in the state)' : ''}.
        {#if z?.schematic}The map position is schematic, not a real location.{:else if z?.type === 'county'}Drawn at the county's Census 2020 center of population, not a measured location of freight activity.{:else}Drawn at a population-weighted anchor point, not a measured location of freight activity.{/if}
      </p>
      <h4>Top trading partners (current filters)</h4>
      <BarList items={d.partners.map((p) => ({ key: p.id + p.label, label: p.label, v: p.magnitude, text: fmt(p.magnitude), color: 'var(--accent)' }))} onpick={undefined} />
      <h4>Commodities</h4>
      <BarList items={comItems(d.byCommodity)} />
      <h4>Domestic modes</h4>
      <BarList items={modeItems(d.byMode)} />
    {:else if d.kind === 'flow'}
      {@const mt = total(d.byMode)}
      <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap"><span style="font-family:var(--f-display);font-size:34px;line-height:1">{fmt(d.count)}</span></div>
      <p class="help">{ctrl.versionLabel} {ctrl.s.year} ({ctrl.dataVersionOfYear}). Domestic leg unless the view is Import or Export.</p>
      <div>
        <h4 style="margin-bottom:4px">By mode</h4>
        <div class="lrow static" style="padding:0"><span class="tr" style="height:10px;border-radius:99px;gap:2px">{#each d.byMode as m}<i title={`${m.label} ${formatPercent(mt ? m.magnitude / mt : 0)}`} style={`width:${mt ? (m.magnitude / mt) * 100 : 0}%;background:${modeVar(m.code)}`}></i>{/each}</span></div>
        <div class="legendrow" style="margin-top:6px">{#each d.byMode as m}<span><i style={`background:${modeVar(m.code)}`}></i>{shortMode(m.label)} {formatPercent(mt ? m.magnitude / mt : 0)}</span>{/each}</div>
      </div>
      <h4>Commodities</h4>
      <BarList items={comItems(d.byCommodity)} />
      <h4>Trade type</h4>
      <BarList items={d.byTrade.map((r) => ({ key: r.code, label: r.label.replace(/ \(.*\)/, ''), v: r.magnitude, text: fmt(r.magnitude), color: 'var(--ink-3)' }))} />
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn sm" type="button" onclick={() => ctrl.select(d.originId)}>Focus {ctrl.name(d.originId)}</button>
        <button class="btn sm" type="button" onclick={() => ctrl.select(d.destId)}>Focus {ctrl.name(d.destId)}</button>
      </div>
    {:else}
      <p class="link-note">FAF5 model assignment (2017 benchmark), not traffic counts, not updated to FAF6. Volumes include through traffic.</p>
      {#each LINK_GROUPS as g}
        <h4>{g.title}</h4>
        <table class="detail-table">
          <tbody>
            {#each g.cols.filter((c) => c in d.attrs) as c}
              <tr><th scope="row" title={d.dictionary[c]?.description}>{d.dictionary[c]?.label ?? c}</th><td>{show(d.attrs[c])}{d.dictionary[c]?.unit ? ` ${d.dictionary[c].unit}` : ''}</td></tr>
            {/each}
          </tbody>
        </table>
      {/each}
      <h4>Modeled truck volumes (both directions)</h4>
      <table class="detail-table">
        <thead><tr><th>Year</th><th>Trucks</th><th>Market</th><th class="num">Trips/day</th><th class="num">kt/yr</th></tr></thead>
        <tbody>
          {#each d.volumes as v}
            <tr><td>{v.year}</td><td>{TRUCKS[String(v.truck_type)]}</td><td>{v.market}</td><td class="num">{formatCount(Number(v.tot_trips_day))}</td><td class="num">{formatCount(Number(v.tot_tons_k))}</td></tr>
          {/each}
          {#if !d.volumes.length}<tr><td colspan="5" class="muted">No modeled truck flow on this link.</td></tr>{/if}
        </tbody>
      </table>
      <p class="help">{d.dictionary.ab_tons_k?.caveat ?? ''}</p>
    {/if}
  </div>
{/if}
