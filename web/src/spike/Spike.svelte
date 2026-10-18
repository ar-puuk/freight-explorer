<script lang="ts">
  import { onMount } from 'svelte';
  import * as maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
  import { Protocol } from 'pmtiles';
  import { MapboxOverlay } from '@deck.gl/mapbox';
  import { FlowmapLayer } from '@flowmap.gl/layers';
  import * as duckdb from '@duckdb/duckdb-wasm';
  import duckdbWasmEh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
  import duckdbWorkerEh from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

  const STYLES: Record<string, string> = {
    positron: 'https://tiles.openfreemap.org/styles/positron',
    dark: 'https://tiles.openfreemap.org/styles/dark',
    liberty: 'https://tiles.openfreemap.org/styles/liberty',
    bright: 'https://tiles.openfreemap.org/styles/bright',
    fiord: 'https://tiles.openfreemap.org/styles/fiord',
  };
  const DATA = new URL('data/_spike/', location.href).href;

  let el: HTMLDivElement;
  let log = $state<string[]>([]);
  let styleName = $state('positron');
  let map: maplibregl.Map;
  let overlay: MapboxOverlay;
  let flowData: { locations: any[]; flows: any[] };
  let linkRows: { link_id: number; tot_trips: number }[] = [];
  const spike = (): any => (window as any).__spike;
  const say = (m: string) => {
    log.push(m);
    spike().log = [...log];
  };

  function flowLayer() {
    return new FlowmapLayer({
      id: 'flowmap',
      data: flowData,
      opacity: 0.9,
      pickable: true,
      darkMode: styleName === 'dark',
      colorScheme: 'Teal',
      clusteringEnabled: false,
      getLocationId: (l: any) => l.zone_id,
      getLocationName: (l: any) => l.zname,
      getLocationLat: (l: any) => l.lat,
      getLocationLon: (l: any) => l.lon,
      getFlowOriginId: (f: any) => f.origin,
      getFlowDestId: (f: any) => f.dest,
      getFlowMagnitude: (f: any) => f.count,
    } as any);
  }

  function applyLinkFlows() {
    for (const r of linkRows) {
      map.setFeatureState({ source: 'net', sourceLayer: 'faf5_links', id: r.link_id }, { trips: r.tot_trips });
    }
  }

  function addNetwork() {
    if (!map.getSource('net')) {
      map.addSource('net', { type: 'vector', url: 'pmtiles://' + DATA + 'ut_net_z3_12.pmtiles', promoteId: 'id' });
    }
    if (!map.getLayer('net-lines')) {
      map.addLayer({
        id: 'net-lines',
        type: 'line',
        source: 'net',
        'source-layer': 'faf5_links',
        paint: {
          'line-color': ['case', ['>', ['coalesce', ['feature-state', 'trips'], 0], 0], '#d94801', '#999999'],
          'line-width': ['interpolate', ['linear'], ['sqrt', ['coalesce', ['feature-state', 'trips'], 0]], 0, 0.4, 70, 5],
          'line-opacity': 0.85,
        },
      });
    }
    applyLinkFlows();
  }

  async function startDuckDb() {
    const bundle = await duckdb.selectBundle({
      eh: { mainModule: duckdbWasmEh, mainWorker: duckdbWorkerEh },
    });
    const worker = new Worker(bundle.mainWorker!);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    const conn = await db.connect();
    const t0 = performance.now();
    await db.registerFileURL('f5_2022.parquet', DATA + 'ut_f5_2022.parquet', duckdb.DuckDBDataProtocol.HTTP, false);
    const r = await conn.query(
      "select trade_type, count(*)::int n, round(sum(tons)) t from 'f5_2022.parquet' group by 1 order by 1",
    );
    say('duckdb range query ms=' + Math.round(performance.now() - t0) + ' rows=' + JSON.stringify(r.toArray().map((x: any) => x.toJSON())));
    await db.registerFileURL('links.parquet', DATA + 'ut_link_flows_2017_total.parquet', duckdb.DuckDBDataProtocol.HTTP, false);
    const lr = await conn.query("select link_id::int link_id, tot_trips::double tot_trips from 'links.parquet'");
    linkRows = lr.toArray().map((x: any) => ({ link_id: x.link_id, tot_trips: x.tot_trips }));
    say('link flow rows loaded: ' + linkRows.length);
    if (map.getSource('net')) applyLinkFlows();
    await db.registerFileURL('all.parquet', DATA + 'ut_f5_all.parquet', duckdb.DuckDBDataProtocol.HTTP, false);
    spike().q = async (sql: string) => (await conn.query(sql)).toArray().map((x: any) => x.toJSON());
    spike().duckdb = true;
  }

  function setStyle(name: string) {
    styleName = name;
    spike().styleLoads = 0;
    map.setStyle(STYLES[name]);
  }

  onMount(async () => {
    (window as any).__spike = { log: [], styleLoads: 0, setStyle };
    maplibregl.setWorkerUrl(maplibreWorkerUrl);
    maplibregl.addProtocol('pmtiles', new Protocol().tile);
    const [zones, flows] = await Promise.all([
      fetch(DATA + 'zones6_pts.json').then((r) => r.json()),
      fetch(DATA + 'flows200.json').then((r) => r.json()),
    ]);
    flowData = { locations: zones, flows };
    map = new maplibregl.Map({ container: el, style: STYLES[styleName], center: [-111.65, 39.32], zoom: 5.2 });
    overlay = new MapboxOverlay({ interleaved: false, layers: [flowLayer()] });
    map.addControl(overlay as any);
    map.on('style.load', () => {
      spike().styleLoads++;
      addNetwork();
      overlay.setProps({ layers: [flowLayer()] });
      say('style.load ' + styleName);
    });
    spike().map = map;
    spike().overlay = overlay;
    startDuckDb().catch((e) => say('duckdb ERROR ' + e));
  });
</script>

<div class="bar">
  {#each Object.keys(STYLES) as s}
    <button class:on={s === styleName} onclick={() => setStyle(s)}>{s}</button>
  {/each}
</div>
<div class="map" bind:this={el}></div>
<pre class="log">{log.join('\n')}</pre>

<style>
  :global(body) {
    margin: 0;
    font: 13px system-ui;
  }
  .map {
    position: absolute;
    inset: 0;
  }
  .bar {
    position: absolute;
    z-index: 2;
    top: 8px;
    left: 8px;
    display: flex;
    gap: 4px;
  }
  .bar button.on {
    font-weight: 700;
  }
  .log {
    position: absolute;
    z-index: 2;
    bottom: 8px;
    left: 8px;
    max-width: 60vw;
    margin: 0;
    padding: 6px;
    background: #fffc;
    font-size: 11px;
    white-space: pre-wrap;
  }
</style>
