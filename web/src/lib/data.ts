import * as duckdb from '@duckdb/duckdb-wasm';
import duckdbWasmEh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdbWorkerEh from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import type { DimsMeta, ProductMeta, StateMeta, VersionsMeta, ZoneInfo } from './types';

export const DATA_BASE = new URL('data/', document.baseURI).href;

export async function loadJson<T>(path: string): Promise<T> {
  const r = await fetch(DATA_BASE + path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export interface Meta {
  state: StateMeta;
  versions: VersionsMeta;
  dims: DimsMeta;
}

export async function loadMeta(): Promise<Meta> {
  const [state, versions, dims] = await Promise.all([
    loadJson<StateMeta>('meta/state.json'),
    loadJson<VersionsMeta>('meta/versions.json'),
    loadJson<DimsMeta>('meta/dims.json'),
  ]);
  return { state, versions, dims };
}

/** versions.json is keyed by product (faf5, faf6, county, history); the UI is keyed by faf_version. The history series is not a version. */
export function productKey(meta: Meta, version: string): string {
  const hit = Object.entries(meta.versions.products).find(([, p]) => p.faf_version === version && p.kind !== 'history');
  if (!hit) throw new Error(`unknown FAF version ${version}`);
  return hit[0];
}

/** Selectable versions: the FAF releases first (by product key), then the experimental county product. */
export function versionList(meta: Meta): string[] {
  const rank = (p: ProductMeta) => (p.kind === 'county' ? 1 : 0);
  return Object.entries(meta.versions.products)
    .filter(([, p]) => p.kind !== 'history')
    .sort((a, b) => rank(a[1]) - rank(b[1]) || a[0].localeCompare(b[0]))
    .map(([, p]) => p.faf_version);
}

export function versionLabel(meta: Meta, version: string): string {
  const p = meta.versions.products[productKey(meta, version)];
  return p.label ?? `FAF ${p.faf_version}`;
}

export function yearsFor(meta: Meta, version: string, scenario = 'mid'): number[] {
  const p = meta.versions.products[productKey(meta, version)];
  const years = scenario === 'mid' ? p.years : (p.scenarios?.[scenario]?.years ?? {});
  return Object.keys(years).map(Number).sort((a, b) => a - b);
}

/** 'mid' first, then whatever scenarios the version publishes (High and Low for FAF5.7.1). */
export function scenariosFor(meta: Meta, version: string): string[] {
  const p = meta.versions.products[productKey(meta, version)];
  return ['mid', ...Object.keys(p.scenarios ?? {}).sort()];
}

export interface ZoneGeoJSON {
  type: 'FeatureCollection';
  features: { type: 'Feature'; id: string; properties: { zone_id: string; name: string; state_fips: string; type: string; is_state_zone: boolean }; geometry: unknown }[];
}

export async function loadZones(product: string): Promise<ZoneGeoJSON> {
  return loadJson<ZoneGeoJSON>(`geo/${product}_zones.geojson`);
}

export interface Headline {
  faf_version: string;
  year: number;
  flows_total: number;
  tons_kt_total: number;
  flows: [string, string, number][];
}

export const loadHeadline = (product: string) => loadJson<Headline>(`${product}/headline_flows.json`);

/** State totals by scenario and year (unfiltered), in the order tons_kt, value_const_musd, value_current_musd, tmiles_m. null = not published. */
export interface YearTotals {
  faf_version: string;
  columns: string[];
  totals: Record<string, Record<string, (number | null)[]>>;
}
export const loadYearTotals = (product: string) => loadJson<YearTotals>(`${product}/year_totals.json`);

/** Zone anchors (domestic zones for one version) plus the schematic foreign-region anchors, keyed by id. */
export async function loadLocations(meta: Meta, version: string, zones: ZoneGeoJSON): Promise<Map<string, ZoneInfo>> {
  if (meta.versions.products[productKey(meta, version)].kind === 'county') return loadCountyLocations();
  const [centroids, foreign] = await Promise.all([
    loadJson<Record<string, Record<string, [number, number]>>>('geo/zone_centroids.json'),
    loadJson<{ region_id: string; label: string; lon: number; lat: number }[]>('geo/foreign_regions.json'),
  ]);
  const out = new Map<string, ZoneInfo>();
  for (const f of zones.features) {
    const c = centroids[version]?.[f.properties.zone_id];
    if (!c) continue;
    out.set(f.properties.zone_id, {
      id: f.properties.zone_id, name: f.properties.name, state_fips: f.properties.state_fips, type: f.properties.type,
      is_state_zone: f.properties.is_state_zone, lon: c[0], lat: c[1],
    });
  }
  for (const r of foreign) {
    out.set(r.region_id, { id: r.region_id, name: r.label, state_fips: '', type: 'foreign_region', is_state_zone: false, lon: r.lon, lat: r.lat, schematic: true });
  }
  return out;
}

/** County product: counties (Census centers of population), the outside FAF zones its rows end in, and the schematic foreign regions. */
async function loadCountyLocations(): Promise<Map<string, ZoneInfo>> {
  const [locs, foreign] = await Promise.all([
    loadJson<{ id: string; name: string; lon: number; lat: number; type: string; state_fips: string; is_state_zone: boolean }[]>('geo/county_locations.json'),
    loadJson<{ region_id: string; label: string; lon: number; lat: number }[]>('geo/foreign_regions.json'),
  ]);
  const out = new Map<string, ZoneInfo>();
  for (const l of locs) out.set(l.id, { id: l.id, name: l.name, state_fips: l.state_fips, type: l.type, is_state_zone: l.is_state_zone, lon: l.lon, lat: l.lat });
  for (const r of foreign) out.set(r.region_id, { id: r.region_id, name: r.label, state_fips: '', type: 'foreign_region', is_state_zone: false, lon: r.lon, lat: r.lat, schematic: true });
  return out;
}

const num = (v: unknown): number | null => (v == null ? null : typeof v === 'bigint' ? Number(v) : Number(v));

/** DuckDB-WASM, loaded lazily so first paint never waits for it. */
export class Db {
  private conn: duckdb.AsyncDuckDBConnection | null = null;
  private db: duckdb.AsyncDuckDB | null = null;
  private files = new Set<string>();
  private starting: Promise<void> | null = null;

  ready(): Promise<void> {
    this.starting ??= this.start();
    return this.starting;
  }

  private async start(): Promise<void> {
    // Only the EH build is shipped (docs/DECISIONS.md); the type demands `mvp`, which we deliberately omit.
    const bundle = await duckdb.selectBundle({ eh: { mainModule: duckdbWasmEh, mainWorker: duckdbWorkerEh } } as unknown as duckdb.DuckDBBundles);
    const worker = new Worker(bundle.mainWorker!);
    this.db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    this.conn = await this.db.connect();
  }

  /** Register a Parquet file by its path under data/ and return its registered name. */
  async register(path: string): Promise<string> {
    await this.ready();
    const name = path.replace(/[^A-Za-z0-9]+/g, '_') + '.parquet';
    if (!this.files.has(name)) {
      await this.db!.registerFileURL(name, DATA_BASE + path, duckdb.DuckDBDataProtocol.HTTP, false);
      this.files.add(name);
    }
    return name;
  }

  /** SQL source expression for one Parquet file under data/. */
  async file(path: string): Promise<string> {
    return `read_parquet('${await this.register(path)}')`;
  }

  /** Load many Parquet files into one in-memory table (downloaded once; later queries are local). */
  async loadTable(table: string, paths: string[]): Promise<void> {
    const names = await Promise.all(paths.map((p) => this.register(p)));
    // DuckDB-WASM fetches each file with a plain GET (twice per file with caching off; the browser cache absorbs the second on Pages)
    await this.query(`CREATE TABLE IF NOT EXISTS ${table} AS SELECT * FROM read_parquet([${names.map((n) => `'${n}'`).join(', ')}])`);
  }

  async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    await this.ready();
    const res = await this.conn!.query(sql);
    return res.toArray().map((r) => {
      const o = r.toJSON() as Record<string, unknown>;
      for (const k of Object.keys(o)) if (typeof o[k] === 'bigint') o[k] = Number(o[k]);
      return o as T;
    });
  }
}

export { num };
