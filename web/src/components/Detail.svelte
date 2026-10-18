<script lang="ts">
  import type { Controller } from '../lib/controller.svelte';
  import { formatCount, formatTons } from '../lib/format';

  let { ctrl }: { ctrl: Controller } = $props();
  const d = $derived(ctrl.detail);

  const LINK_GROUPS: { title: string; cols: string[] }[] = [
    { title: 'Road', cols: ['road_name', 'sign_rte', 'rte_type', 'rte_number', 'road_class', 'road_class_desc', 'f_class', 'facility_type', 'length_mi', 'status'] },
    { title: 'Designations', cols: ['nhs', 'strahnet', 'nhfn', 'truck_access'] },
    { title: 'Capacity', cols: ['ab_lanes', 'ba_lanes', 'speed_limit', 'toll_type'] },
    { title: 'Location', cols: ['country', 'state_abbrev', 'state_fips', 'county_fips', 'faf_zone', 'in_state'] },
  ];
  const TRUCKS: Record<string, string> = { all: 'All trucks', su: 'Single unit', cu: 'Combination' };
  const MARKETS: Record<string, string> = { total: 'total', domestic: 'domestic', import: 'import', export: 'export' };

  function show(v: unknown): string {
    if (v == null || v === '') return 'not recorded';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
    return String(v);
  }
  const loc = (id: string) => ctrl.locations.get(id);
</script>

{#if d}
  <aside class="card detail" aria-label="Details">
    <button class="btn close" type="button" onclick={() => ctrl.closeDetail()} aria-label="Close details">Close</button>

    {#if d.kind === 'zone'}
      {@const z = loc(d.id)}
      <h2>{z?.name ?? d.id}</h2>
      <p class="muted">
        {z?.type === 'foreign_region' ? 'Foreign region' : z?.type === 'county' ? `County ${d.id}` : `FAF zone ${d.id}`}{z?.is_state_zone ? ' (in the state)' : ''}.
        {#if z?.schematic}The map position is schematic, not a real location.{:else if z?.type === 'county'}Drawn at the county's Census 2020 center of population, not a measured location of freight activity.{:else}Drawn at a population-weighted anchor point, not a measured location of freight activity.{/if}
      </p>
      <h3>Top trading partners (current filters)</h3>
      <table>
        <tbody>
          {#each d.partners as p}<tr><td>{p.label}</td><td class="num">{ctrl.fmtMeasure(p.magnitude)}</td></tr>{/each}
          {#if !d.partners.length}<tr><td class="muted">No flows with these filters.</td></tr>{/if}
        </tbody>
      </table>
      <h3>Commodities</h3>
      <table><tbody>{#each d.byCommodity as c}<tr><td>{c.label}</td><td class="num">{ctrl.fmtMeasure(c.magnitude)}</td></tr>{/each}</tbody></table>
      <h3>Domestic modes</h3>
      <table><tbody>{#each d.byMode as c}<tr><td>{c.label}</td><td class="num">{ctrl.fmtMeasure(c.magnitude)}</td></tr>{/each}</tbody></table>
    {:else if d.kind === 'flow'}
      <h2>{ctrl.name(d.originId)} to {ctrl.name(d.destId)}</h2>
      <p class="muted">{ctrl.fmtMeasure(d.count)} in {ctrl.versionLabel} {ctrl.s.year} ({ctrl.dataVersionOfYear}). Domestic leg unless the view is Import or Export.</p>
      <h3>Commodities</h3>
      <table><tbody>{#each d.byCommodity as c}<tr><td>{c.label}</td><td class="num">{ctrl.fmtMeasure(c.magnitude)}</td></tr>{/each}</tbody></table>
      <h3>Domestic modes</h3>
      <table><tbody>{#each d.byMode as c}<tr><td>{c.label}</td><td class="num">{ctrl.fmtMeasure(c.magnitude)}</td></tr>{/each}</tbody></table>
      <h3>Trade type</h3>
      <table><tbody>{#each d.byTrade as c}<tr><td>{c.label}</td><td class="num">{ctrl.fmtMeasure(c.magnitude)}</td></tr>{/each}</tbody></table>
    {:else}
      <h2>Network link {d.id}</h2>
      <p class="notice">FAF5 model assignment (2017 benchmark), not traffic counts, not updated to FAF6. Volumes include through traffic.</p>
      {#each LINK_GROUPS as g}
        <h3>{g.title}</h3>
        <table>
          <tbody>
            {#each g.cols.filter((c) => c in d.attrs) as c}
              <tr><th scope="row" title={d.dictionary[c]?.description}>{d.dictionary[c]?.label ?? c}</th><td>{show(d.attrs[c])}{d.dictionary[c]?.unit ? ` ${d.dictionary[c].unit}` : ''}</td></tr>
            {/each}
          </tbody>
        </table>
      {/each}
      <h3>Modeled truck volumes (both directions)</h3>
      <table>
        <thead><tr><th>Year</th><th>Trucks</th><th>Market</th><th class="num">Trips/day</th><th class="num">Thousand tons/yr</th></tr></thead>
        <tbody>
          {#each d.volumes as v}
            <tr><td>{v.year}</td><td>{TRUCKS[String(v.truck_type)]}</td><td>{MARKETS[String(v.market)]}</td><td class="num">{formatCount(Number(v.tot_trips_day))}</td><td class="num">{formatCount(Number(v.tot_tons_k))}</td></tr>
          {/each}
          {#if !d.volumes.length}<tr><td colspan="5" class="muted">No modeled truck flow on this link.</td></tr>{/if}
        </tbody>
      </table>
      <p class="hint">{d.dictionary.ab_tons_k?.caveat ?? ''}</p>
    {/if}
  </aside>
{/if}
