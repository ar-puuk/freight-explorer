<script lang="ts">
  import { onMount } from 'svelte';

  interface Product {
    kind?: string;
    experimental?: boolean;
    label?: string;
    faf_version: string;
    benchmark_year: number | null;
    release: string;
    years: Record<string, string>;
    scenarios?: Record<string, { years: Record<string, string> }>;
    rows: Record<string, number>;
    zones?: number | null;
    sources?: Record<string, { url: string; sha256: string; bytes: number }>;
    adjacent_states?: string[];
  }
  interface Versions {
    products: Record<string, Product>;
    network: { release: string; links_in_clip: number; links_in_state: number; buffer_km: number; years: Record<string, { rows: number; links_with_flow: number }> } | null;
  }
  interface StateMeta { name: string; site_title: string; zones: Record<string, string[]> }

  const base = new URL('data/', document.baseURI).href;
  let versions = $state<Versions | null>(null);
  let stateMeta = $state<StateMeta | null>(null);
  let failed = $state(false);

  onMount(() => {
    Promise.all([fetch(base + 'meta/versions.json').then((r) => r.json()), fetch(base + 'meta/state.json').then((r) => r.json())]).then(
      ([v, s]) => ((versions = v), (stateMeta = s), (document.title = `Methodology and data: ${s.site_title}`)),
      () => (failed = true),
    );
  });

  const products = $derived(Object.entries(versions?.products ?? {}).sort((a, b) => a[0].localeCompare(b[0])));
  const nameOf = (p: Product) => p.label ?? (p.kind === 'history' ? `FAF ${p.faf_version} reprocessed history` : `FAF ${p.faf_version}`);
  function summarize(years: Record<string, string>): string {
    const by: Record<string, string[]> = {};
    for (const [y, s] of Object.entries(years)) (by[s] ??= []).push(y);
    const order = ['base', 'historical', 'final', 'preliminary', 'forecast', 'experimental'];
    return Object.entries(by).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([s, ys]) => `${s}: ${ys.length > 4 ? `${ys[0]}-${ys[ys.length - 1]} (${ys.length} years)` : ys.join(', ')}`).join('; ');
  }
  const short = (h: string) => h.slice(0, 12);
  const mb = (n: number) => `${(n / 1e6).toFixed(n > 1e7 ? 0 : 1)} MB`;
</script>

<a class="skip" href="#content">Skip to the text</a>
<header class="top">
  <h1 class="brand">
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><rect width="26" height="26" rx="7" fill="var(--ink)" /><path d="M5 19c4 0 7-4 8-10M21 19c-4 0-7-4-8-10M13 21V9" fill="none" stroke="var(--bg)" stroke-width="2" stroke-linecap="round" /><circle cx="13" cy="8" r="2.4" fill="var(--bg)" /></svg>
    <span>Methodology and data</span>
  </h1>
  <span class="spacer"></span>
  <a class="btn" href="./">Back to the map</a>
</header>

<div class="doc">
  <nav aria-label="On this page" class="toc">
    <strong>On this page</strong>
    <ol>
      <li><a href="#what">What this is</a></li>
      <li><a href="#sources">Sources and release versions</a></li>
      <li><a href="#years">Years, status and forecasts</a></li>
      <li><a href="#benchmark">FAF5 and FAF6 are different</a></li>
      <li><a href="#flows">What a flow is</a></li>
      <li><a href="#units">Units and dollars</a></li>
      <li><a href="#geography">Geography</a></li>
      <li><a href="#network">Truck network</a></li>
      <li><a href="#scenarios">High and Low scenarios</a></li>
      <li><a href="#history">State history</a></li>
      <li><a href="#county">County estimates</a></li>
      <li><a href="#limits">Limits of FAF</a></li>
      <li><a href="#citations">Citations and originals</a></li>
      <li><a href="#credits">Credits and license</a></li>
    </ol>
  </nav>

  <main id="content" tabindex="-1">
    <section id="what">
      <h2>What this is</h2>
      <p>
        {stateMeta?.site_title ?? 'This site'} lets you look at the public Freight Analysis Framework (FAF) data for one state at a time: commodity flows by origin, destination, commodity,
        mode and year, plus the FAF zone geography and the FAF5 truck network. FAF is published by the Bureau of Transportation Statistics (BTS) and the Federal Highway Administration (FHWA),
        with Oak Ridge National Laboratory (ORNL) producing the data. The files are large and awkward; this site only reshapes them. It does not change a number.
      </p>
      <p>
        The site shows data and caveats. It does not rank places, score "performance", forecast beyond the forecast scenarios FAF itself publishes, present modeled values as measured counts,
        or imply accuracy at local scale. FAF flows and link volumes are model estimates.
      </p>
    </section>

    <section id="sources">
      <h2>Sources and release versions</h2>
      {#if failed}
        <p class="error" role="alert">The release information could not be loaded.</p>
      {:else if !versions}
        <p class="muted">Loading release information…</p>
      {:else}
        <p>Everything below was read from the real source files and is regenerated by the build, so it always describes what is on this site. Source file fingerprints are the first 12 characters of each file's SHA-256.</p>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrollable region must be keyboard-reachable) -->
        <div class="scroll" tabindex="0" role="region" aria-label="Data products and release versions">
          <table>
            <thead><tr><th scope="col">Product</th><th scope="col">Release</th><th scope="col">Years and status</th><th scope="col">Source files</th></tr></thead>
            <tbody>
              {#each products as [key, p]}
                <tr>
                  <th scope="row">{nameOf(p)}{#if p.experimental} <strong>(experimental)</strong>{/if}</th>
                  <td>{p.release}</td>
                  <td>
                    {summarize(p.years)}
                    {#if p.scenarios}<br />High and Low scenarios: {Object.values(p.scenarios)[0] ? Object.keys(Object.values(p.scenarios)[0].years).join(', ') : ''}{/if}
                  </td>
                  <td>
                    {#each Object.entries(p.sources ?? {}) as [role, s]}
                      <div><a href={s.url}>{role.replace('_', ' ')}</a> <span class="muted">({mb(s.bytes)}, {short(s.sha256)})</span></div>
                    {/each}
                    {#if !p.sources || !Object.keys(p.sources).length}<span class="muted">see data-raw/manifest.json in the repository</span>{/if}
                  </td>
                </tr>
              {/each}
              {#if versions.network}
                <tr>
                  <th scope="row">FAF5 truck network and flow assignments</th>
                  <td>{versions.network.release}</td>
                  <td>Model years {Object.keys(versions.network.years).join(', ')}</td>
                  <td>{versions.network.links_in_clip.toLocaleString('en-US')} links within {versions.network.buffer_km} km of the state ({versions.network.links_in_state.toLocaleString('en-US')} in the state); fingerprints in the repository manifest</td>
                </tr>
              {/if}
            </tbody>
          </table>
        </div>
      {/if}
      <p>
        Only the flows that touch the state are kept: every origin-destination record where the domestic origin or the domestic destination is a zone in the state (within-state, inbound, outbound,
        and foreign imports and exports whose U.S. entry or exit zone is in the state). The other end can be anywhere in the country or a foreign region. The national matrix is not published here.
        The state's own zones are derived from the zone lookup (the first two characters of a FAF zone id are the state FIPS code); nothing about the state is typed into the code.
      </p>
      <p>
        <a href="https://github.com/ar-puuk/freight-explorer/blob/main/data-raw/manifest.json">The raw-file manifest</a> lists each downloaded file's URL, release, size and SHA-256.
        The column-level data dictionary (labels, units, first and last year, caveats for every column) is
        <a href={`${base}meta/dictionary.parquet`}>dictionary.parquet</a>.
      </p>
    </section>

    <section id="years">
      <h2>Years, status and forecasts</h2>
      <ul>
        <li><strong>base</strong>: the benchmark year of a FAF release (the Commodity Flow Survey year the release is built on).</li>
        <li><strong>final</strong>: a final annual estimate. <strong>preliminary</strong>: a preliminary annual estimate that BTS has said may be revised. <strong>forecast</strong>: a model forecast.</li>
        <li>This status comes from the <a href="https://www.bts.gov/faf/versions">BTS version history</a>, not from the data files. For FAF5.7.1 it lists final annual estimates for 2018 to 2023 and preliminary estimates for 2024. FAF5 publishes forecasts for 2030, 2035, 2040, 2045 and 2050 only: <strong>nothing is published for 2025 to 2029</strong>, and charts show that gap instead of connecting across it.</li>
        <li>FAF6.0 has a single year (2022). BTS has said it plans to add later years, ton-miles and rebuilt history in later FAF6 releases; when it does, the pipeline picks them up and this page changes with them.</li>
        <li>A value shown as "not published" is missing in the source. It is never treated as zero.</li>
      </ul>
    </section>

    <section id="benchmark">
      <h2>FAF5 and FAF6 are different</h2>
      <p>The two releases are kept apart everywhere on this site and are never drawn as one line:</p>
      <ul>
        <li><strong>Benchmark year:</strong> FAF5 is built on the 2017 Commodity Flow Survey (CFS), FAF6 on the 2022 CFS.</li>
        <li><strong>Zone system:</strong> FAF5 has 132 domestic zones and FAF6 has 134, with definitions based on each survey's geography. Zone ids are specific to a release: the same id can describe a different area, and some ids exist in only one release.</li>
        <li><strong>Dollars:</strong> FAF5 constant-dollar values are in 2017 dollars (stated in the FAF5 User Guide). FAF6's constant dollars are 2022 dollars according to its release notes; this project did not independently verify that.</li>
        <li><strong>Magnitudes differ.</strong> For example, the state's 2022 domestic tonnage is far higher in FAF6.0 than in FAF5.7.1 even though national tonnage is nearly the same. That difference is a feature of the two releases, not growth. The trend chart's overlay draws the other release as a separate series with a "benchmark break" notice for this reason.</li>
      </ul>
    </section>

    <section id="flows">
      <h2>What a flow is</h2>
      <ul>
        <li>A FAF record is an annual flow between an origin and a destination, for one commodity (SCTG 2-digit code; there are 42 codes and no code 42), one domestic mode, and one trade type (domestic, import, export).</li>
        <li><strong>Imports and exports describe the domestic leg.</strong> For an import, the "domestic origin" is the U.S. zone of entry and the foreign origin is a separate field. For an export, the "domestic destination" is the U.S. zone of exit. The map's Import view draws foreign region to U.S. destination, and the Export view draws U.S. origin to foreign region; the entry or exit zone and the foreign-leg mode are in the detail panel and the table.</li>
        <li><strong>Do not add the foreign leg to totals.</strong> The "Total" view is the domestic leg of every shipment (domestic, import and export together). Adding the foreign legs on top would count the same tons twice.</li>
        <li><strong>Direction</strong> (inbound, outbound, within) is defined on the domestic leg relative to the state. "Within" means both ends are zones in the state; inbound and outbound totals leave "within" out.</li>
        <li><strong>Modes.</strong> Truck (including customer pick-up), rail, water, air (including truck-air), multiple modes and mail, pipeline, other and unknown, and "no domestic mode". "Multiple modes and mail" is a FAF category for shipments that use more than one mode; it is not missing data. "No domestic mode" marks flows with no domestic movement; it is also a FAF category.</li>
        <li><strong>Commodities not in the survey are modeled.</strong> According to BTS, about 70 percent of FAF flows by value come directly from the CFS; the rest (for example some foreign trade, agriculture and energy flows) is modeled from other sources.</li>
        <li><strong>Zone anchors and foreign regions are drawing aids.</strong> Arcs run between anchor points: for each zone, the population-weighted point of the Census 2020 county centers of population inside it (falling back to the most populous county center, or a point on the surface). That is not where freight activity happens. FAF has no geometry for foreign regions, so the eight regions sit at schematic positions outside the country, marked as such. Arcs are not routes.</li>
      </ul>
    </section>

    <section id="units">
      <h2>Units and dollars</h2>
      <ul>
        <li><strong>Tons:</strong> thousand tons (the tables say "thousand tons"; large numbers are shown as million or billion tons).</li>
        <li><strong>Value:</strong> million dollars. <em>Constant</em> dollars are in the release's benchmark-year dollars and can be compared within a release; <em>current</em> dollars are nominal for each year. Current-dollar values are published for FAF5 annual years 2018 to 2024 only (not 2017, not forecasts, not FAF6.0, not the scenarios).</li>
        <li><strong>Ton-miles:</strong> million ton-miles. Published for FAF5 (including forecasts) and the historical series; not published in FAF6.0 or the scenarios.</li>
        <li>Every number on the map says which release, year, status and dollar basis it is, and the CSV export repeats them on every row.</li>
      </ul>
    </section>

    <section id="geography">
      <h2>Geography</h2>
      <p>
        FAF zones are metropolitan areas (built from Census CFS areas) plus a remainder-of-state zone per state; some states are a single zone. Zone shapes are the Census CFS-based shapefiles published with each release,
        simplified (about 500 m) for the web. Census 2020 centers of population and 2022 cartographic county boundaries (1:500,000) are used for anchors and the county view.
      </p>
    </section>

    <section id="network">
      <h2>Truck network</h2>
      <ul>
        <li>The network layer is the <strong>FAF5 model highway network</strong> with the <strong>FAF5 truck flow assignments</strong> for 2017 (benchmark), 2022 and 2050 (baseline projections). The assignments are model output from the FAF5.3 era (2022): they have not been updated for FAF5.7.1 or FAF6, and the "2022" and "2050" assignments are projections, not counts.</li>
        <li><strong>They are not traffic counts</strong> and are not comparable with HPMS or AADT counts. Never read a link's value as a measured volume.</li>
        <li>Link volumes include <strong>through traffic</strong>: trucks that neither start nor end in the state, which the origin-destination tables cannot show. That is why the layer exists.</li>
        <li>Volumes are annual thousand tons and <em>daily</em> truck trips, in each link direction (AB, BA) and both, by truck type (single unit, combination unit, all) and market (domestic, import, export, total), with 12 commodity groups defined by FHWA.</li>
        <li>Centroid connectors (road class 50) are model access links, not roads. They are hidden by default and can be turned on. Links without a modeled flow are drawn muted grey.</li>
      </ul>
    </section>

    <section id="scenarios">
      <h2>High and Low scenarios</h2>
      <p>
        FAF5.7.1 publishes High and Low forecast scenarios for 2030 to 2050 beside the mid-range forecast. They are BTS's published scenarios, not predictions made by this site. They have tons and value only (no ton-miles, no current dollars),
        and in aggregate they bracket the mid-range forecast (checked on every build). In the trend chart the shaded band runs from Low to High.
      </p>
    </section>

    <section id="history">
      <h2>State history</h2>
      <p>
        FAF5-methodology reprocessed history for 1997, 2002, 2007 and 2012 is published at state level only, built with the FAF5 methods and data sources to give a more consistent time series than the older FAF releases.
        It is five-year snapshots, not an annual series, in 2017 dollars. BTS has said the historical years will be rebuilt on the FAF6 benchmark in a later release. It is shown in its own tab, labeled as such, and any FAF5 annual series shown beside it is a separate series behind a divider.
      </p>
    </section>

    <section id="county">
      <h2>County estimates (experimental)</h2>
      <ul>
        <li>BTS's experimental county-level product is based on FAF5.6.1 flows for 2022 and allocates FAF zone flows to counties using public indicator data (see the BTS technical report). It is tons only (thousand tons), with five commodity groups and its own mode codes (2 rail, 3 water, 5 multiple modes and mail, 6 pipeline, 11 truck and air; FAF modes 7 and 8 are not in it).</li>
        <li>Each state file has county-level flows for the state and its adjacent states and FAF-zone flows for everywhere else. This site keeps the rows that touch the state. On every build it checks that these rows reproduce the FAF5.7.1 2022 domestic tonnage for the state, mode by mode; they do. Import and export totals differ slightly from FAF5.7.1 for reasons not established here.</li>
        <li><strong>It is an estimate, not measured county flows,</strong> and it is never combined with FAF6 or any other FAF numbers.</li>
        <li>The disaggregation factors BTS published with it are also included in the data folder (<code>county/factors.parquet</code>) but are not used by the map.</li>
      </ul>
    </section>

    <section id="limits">
      <h2>Limits of FAF</h2>
      <p>From BTS's FAQ and the FAF documentation:</p>
      <ul>
        <li>FAF is not tailored to a region, may lack the granularity for local-scale analysis, does not capture local roads fully, may not have enough commodity detail for some analyses, and may not reflect local growth scenarios.</li>
        <li>"Within" means within a state or zone; "from" and "to" summaries leave within-zone moves out.</li>
        <li>Releases differ in benchmark year, zone system and dollar basis (see above).</li>
        <li>Preliminary and forecast values can be revised.</li>
      </ul>
    </section>

    <section id="citations">
      <h2>Citations and originals</h2>
      <ul>
        <li>FAF6: <a href="https://doi.org/10.21949/fhgm-g335">doi.org/10.21949/fhgm-g335</a></li>
        <li>FAF5, 2017 to 2050: <a href="https://doi.org/10.21949/1529116">doi.org/10.21949/1529116</a></li>
        <li>FAF5 reprocessed history: <a href="https://doi.org/10.21949/1529108">doi.org/10.21949/1529108</a></li>
        <li><a href="https://www.bts.gov/faf">BTS Freight Analysis Framework</a>, <a href="https://www.bts.gov/faf/versions">version history</a>, <a href="https://www.bts.gov/faf/faqs">FAQs</a>, <a href="https://www.bts.gov/faf/county">experimental county-level estimates</a></li>
        <li><a href="https://faf.ornl.gov/faf5/">ORNL FAF5 data and documentation</a> (user guide, metadata, downloads)</li>
        <li><a href="https://ops.fhwa.dot.gov/freight/freight_analysis/faf/">FHWA FAF page</a> (network and truck flow assignments)</li>
        <li><a href="https://www.census.gov/programs-surveys/cfs/technical-documentation/geographies.html">Census CFS geographies</a>, <a href="https://www.census.gov/geographies/reference-files/time-series/geo/centers-population.html">centers of population</a>, <a href="https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html">cartographic boundary files</a></li>
      </ul>
      <p>If you use these numbers, cite the original FAF source, not this site.</p>
    </section>

    <section id="credits">
      <h2>Credits and license</h2>
      <p>
        Data: Bureau of Transportation Statistics, Federal Highway Administration, Oak Ridge National Laboratory (Freight Analysis Framework), and the U.S. Census Bureau. These are U.S. government public data.
        Basemap: <a href="https://openfreemap.org">OpenFreeMap</a>, © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors.
        The code is open source (MIT license) at <a href="https://github.com/ar-puuk/freight-explorer">github.com/ar-puuk/freight-explorer</a>, where you can report problems and see exactly how every file is built.
      </p>
    </section>
  </main>
</div>

<style>
  .doc {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 32px;
    max-width: 1100px;
    margin: 0 auto;
    padding: 18px 20px 60px;
  }
  .toc {
    position: sticky;
    top: 12px;
    align-self: start;
    font-size: 13.5px;
  }
  .toc ol {
    margin: 6px 0 0;
    padding-left: 18px;
  }
  .toc a {
    display: inline-block;
    min-height: 24px;
    line-height: 24px;
  }
  main {
    min-width: 0;
    max-width: 78ch;
  }
  main:focus {
    outline: none;
  }
  h2 {
    font-size: 22px;
    letter-spacing: -0.01em;
    margin: 32px 0 8px;
    padding-top: 4px;
    scroll-margin-top: 16px;
  }
  section:first-child h2 {
    margin-top: 0;
  }
  ul,
  ol {
    padding-left: 20px;
  }
  li {
    margin: 4px 0;
  }
  a {
    color: var(--accent);
  }
  .scroll {
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin: 8px 0 12px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 13px;
  }
  th,
  td {
    text-align: left;
    vertical-align: top;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
  }
  thead th {
    background: var(--surface-2);
  }
  code {
    background: var(--surface-2);
    padding: 1px 5px;
    border-radius: 4px;
  }
  @media (max-width: 860px) {
    .doc {
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .toc {
      position: static;
    }
  }
</style>
