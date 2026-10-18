export type View = 'total' | 'domestic' | 'import' | 'export';
export type Direction = 'both' | 'inbound' | 'outbound' | 'within';
export type Measure = 'tons' | 'value' | 'tmiles';
export type Dollars = 'const' | 'current';
export type TruckType = 'all' | 'su' | 'cu';
export type Market = 'total' | 'domestic' | 'import' | 'export';
export type ThemePref = 'system' | 'light' | 'dark';
export type Panel = 'closed' | 'summary' | 'trends' | 'compare' | 'table';
export type CompareKind = 'zone' | 'commodity';

export interface AppState {
  version: string; // faf_version, e.g. "5.7.1"
  scenario: string; // "mid" (high/low arrive in a later phase)
  year: number;
  view: View;
  direction: Direction;
  measure: Measure;
  dollars: Dollars;
  commodities: string[]; // SCTG2 codes; empty = all
  modes: number[]; // domestic mode codes; empty = all
  topN: number;
  minFlow: number; // in the raw unit of the measure
  selected: string | null; // zone id or foreign region id
  layers: { flows: boolean; network: boolean; zones: boolean };
  net: { year: number; truck: TruckType; market: Market; connectors: boolean };
  basemap: string | null; // null = follow theme default
  theme: ThemePref;
  cam: [number, number, number] | null; // lon, lat, zoom
  panel: Panel; // charts drawer tab, or closed
  compare: { kind: CompareKind; ids: string[] };
  overlayOther: boolean; // trend chart: also draw the other FAF version (separate series, never connected)
  tableDims: string[]; // table view group-by columns
}

export interface StateMeta {
  name: string;
  abbrev: string;
  fips: string;
  slug: string;
  bbox: [number, number, number, number];
  center: [number, number];
  zoom: number;
  site_title: string;
  zones: Record<string, string[]>; // faf_version -> state zone ids
  network_pmtiles: string;
}

export interface ProductMeta {
  faf_version: string;
  benchmark_year: number;
  release: string;
  scenario: string;
  years: Record<string, 'base' | 'final' | 'preliminary' | 'forecast'>;
  default_year: number;
  scenarios?: Record<string, { years: Record<string, 'forecast'> }>; // high / low, forecast years only
}

export interface VersionsMeta {
  products: Record<string, ProductMeta>; // keyed faf5 / faf6
  network: { years: Record<string, { rows: number; links_with_flow: number }>; links_in_clip: number } | null;
}

export interface DimsMeta {
  versions: Record<
    string,
    { commodity: Record<string, string>; mode: Record<string, string>; trade_type: Record<string, string>; foreign: Record<string, string>; dist_band: Record<string, string> }
  >;
  commodity_groups: { name: string; slug: string; sctg: string[] }[];
}

export interface ZoneInfo {
  id: string;
  name: string;
  state_fips: string;
  type: string;
  is_state_zone: boolean;
  lon: number;
  lat: number;
  schematic?: boolean;
}

export interface FlowRow {
  origin: string;
  dest: string;
  count: number;
}
