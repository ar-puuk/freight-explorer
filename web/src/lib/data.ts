import * as duckdb from '@duckdb/duckdb-wasm';
import duckdbWasmEh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdbWorkerEh from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import type { DimsMeta, StateMeta, VersionsMeta, ZoneInfo } from './types';

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

/** versions.json is keyed by product (faf5, faf6); the UI is keyed by faf_version. */
export function productKey(meta: Meta, version: string): string {
  const hit = Object.entries(meta.versions.products).find(([, p]) => p.faf_version === version);
  if (!hit) throw new Error(`unknown FAF version ${version}`);
  return hit[0];
}

export function yearsFor(meta: Meta, version: string): number[] {
  return Object.keys(meta.versions.products[productKey(meta, version)].years).map(Number).sort((a, b) => a - b);
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

/** Zone anchors (domestic zones for one version) plus the schematic foreign-region anchors, keyed by id. */
export async function loadLocations(meta: Meta, version: string, zones: ZoneGeoJSON): Promise<Map<string, ZoneInfo>> {
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

  /** Register a Parquet file by its path under data/ and return the SQL source expression for it. */
  async file(path: string): Promise<string> {
    await this.ready();
    const name = path.replace(/[^A-Za-z0-9]+/g, '_') + '.parquet';
    if (!this.files.has(name)) {
      await this.db!.registerFileURL(name, DATA_BASE + path, duckdb.DuckDBDataProtocol.HTTP, false);
      this.files.add(name);
    }
    return `read_parquet('${name}')`;
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
