import type { AppState, CompareKind, Direction, Dollars, Market, Measure, Panel, ThemePref, TruckType, View } from './types';

const VIEWS: View[] = ['total', 'domestic', 'import', 'export'];
const DIRECTIONS: Direction[] = ['both', 'inbound', 'outbound', 'within'];
const MEASURES: Measure[] = ['tons', 'value', 'tmiles'];
const DOLLARS: Dollars[] = ['const', 'current'];
const TRUCKS: TruckType[] = ['all', 'su', 'cu'];
const MARKETS: Market[] = ['total', 'domestic', 'import', 'export'];
const THEMES: ThemePref[] = ['system', 'light', 'dark'];
const BASEMAPS = ['liberty', 'bright', 'positron', 'dark', 'fiord'];
const PANELS: Panel[] = ['closed', 'summary', 'trends', 'compare', 'history', 'table'];
const COMPARE_KINDS: CompareKind[] = ['zone', 'commodity'];
export const TABLE_DIMS = ['orig', 'dest', 'sctg2', 'dms_mode', 'trade_type'];

export interface Allowed {
  versions: string[];
  scenarios: (version: string) => string[]; // always starts with 'mid'
  years: (version: string, scenario: string) => number[];
  defaultYear: (version: string) => number;
  netYears: number[];
}

const pick = <T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T => (raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback);

/** Table dimensions come back in their canonical order whatever order the URL lists them in. */
function pickDims(raw: string | null, fallback: string[]): string[] {
  const chosen = (raw ?? '').split(',');
  const dims = TABLE_DIMS.filter((d) => chosen.includes(d));
  return dims.length ? dims : fallback;
}

function num(raw: string | null, fallback: number, lo: number, hi: number): number {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function list(raw: string | null, rx: RegExp): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').filter((s) => rx.test(s)))].sort();
}

/** Parse a query string into a full state. Anything missing or invalid falls back to `defaults`. */
export function decode(search: string, defaults: AppState, allowed: Allowed): AppState {
  const q = new URLSearchParams(search);
  const version = pick(q.get('v'), allowed.versions, defaults.version);
  const scenario = pick(q.get('sc'), allowed.scenarios(version), 'mid');
  const years = allowed.years(version, scenario);
  const dyear = scenario === 'mid' ? allowed.defaultYear(version) : years[0];
  const yq = Number(q.get('y'));
  const layers = q.get('l');
  const cam = q.get('c')?.split(',').map(Number);
  return {
    version,
    scenario,
    year: years.includes(yq) ? yq : dyear,
    view: pick(q.get('view'), VIEWS, defaults.view),
    direction: pick(q.get('dir'), DIRECTIONS, defaults.direction),
    measure: pick(q.get('m'), MEASURES, defaults.measure),
    dollars: pick(q.get('usd'), DOLLARS, defaults.dollars),
    commodities: list(q.get('com'), /^\d{2}$/),
    modes: list(q.get('mode'), /^[1-8]$/).map(Number),
    topN: Math.round(num(q.get('top'), defaults.topN, 5, 500)),
    minFlow: num(q.get('min'), defaults.minFlow, 0, 1e9),
    selected: /^\d{3}$/.test(q.get('sel') ?? '') ? q.get('sel') : null,
    layers: layers == null ? defaults.layers : { flows: layers.includes('f'), network: layers.includes('n'), zones: layers.includes('z') },
    net: {
      year: allowed.netYears.includes(Number(q.get('ny'))) ? Number(q.get('ny')) : defaults.net.year,
      truck: pick(q.get('nt'), TRUCKS, defaults.net.truck),
      market: pick(q.get('nm'), MARKETS, defaults.net.market),
      connectors: q.get('cc') === '1',
    },
    basemap: q.get('bm') && BASEMAPS.includes(q.get('bm')!) ? q.get('bm') : null,
    theme: pick(q.get('theme'), THEMES, defaults.theme),
    cam: cam && cam.length === 3 && cam.every(Number.isFinite) ? [cam[0], cam[1], cam[2]] : null,
    panel: pick(q.get('panel'), PANELS, defaults.panel),
    compare: {
      kind: pick(q.get('ck'), COMPARE_KINDS, defaults.compare.kind),
      ids: list(q.get('ci'), /^\d{2,3}$/).slice(0, 6),
    },
    overlayOther: q.get('ov') === '1',
    historyOverlay: q.get('ho') === '1',
    tableDims: pickDims(q.get('td'), defaults.tableDims),
  };
}

/** Only values that differ from the defaults are written, so default views have clean URLs. */
export function encode(s: AppState, d: AppState, defaultYear: (version: string) => number, firstScenarioYear: (version: string, scenario: string) => number = () => 0): string {
  const q = new URLSearchParams();
  const set = (k: string, v: string | number | null | undefined, dv?: string | number | null) => {
    if (v != null && v !== '' && v !== dv) q.set(k, String(v));
  };
  set('v', s.version, d.version);
  set('sc', s.scenario, 'mid');
  set('y', s.year, s.scenario === 'mid' ? defaultYear(s.version) : firstScenarioYear(s.version, s.scenario));
  set('view', s.view, d.view);
  set('dir', s.direction, d.direction);
  set('m', s.measure, d.measure);
  set('usd', s.dollars, d.dollars);
  if (s.commodities.length) q.set('com', [...s.commodities].sort().join(','));
  if (s.modes.length) q.set('mode', [...s.modes].sort((a, b) => a - b).join(','));
  set('top', s.topN, d.topN);
  set('min', s.minFlow, d.minFlow);
  set('sel', s.selected);
  const lay = `${s.layers.flows ? 'f' : ''}${s.layers.network ? 'n' : ''}${s.layers.zones ? 'z' : ''}`;
  const dlay = `${d.layers.flows ? 'f' : ''}${d.layers.network ? 'n' : ''}${d.layers.zones ? 'z' : ''}`;
  if (lay !== dlay) q.set('l', lay);
  set('ny', s.net.year, d.net.year);
  set('nt', s.net.truck, d.net.truck);
  set('nm', s.net.market, d.net.market);
  if (s.net.connectors) q.set('cc', '1');
  set('bm', s.basemap);
  set('theme', s.theme, d.theme);
  if (s.cam) q.set('c', s.cam.map((n, i) => n.toFixed(i === 2 ? 2 : 4)).join(','));
  set('panel', s.panel, d.panel);
  if (s.compare.ids.length) {
    q.set('ck', s.compare.kind);
    q.set('ci', [...s.compare.ids].sort().join(','));
  } else set('ck', s.compare.kind, d.compare.kind);
  if (s.overlayOther) q.set('ov', '1');
  if (s.historyOverlay) q.set('ho', '1');
  if (s.tableDims.join() !== d.tableDims.join()) q.set('td', s.tableDims.join(','));
  const out = q.toString();
  return out ? `?${out}` : '';
}
