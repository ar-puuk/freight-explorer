import { exportFileName, tableToCsv } from './csv';
import { formatMeasure } from './format';
import { Db, loadHeadline, loadLocations, loadMeta, loadYearTotals, loadZones, productKey, scenariosFor, versionLabel, versionList, yearsFor, type Meta, type YearTotals, type ZoneGeoJSON } from './data';
import { MapView, type FlowmapPick } from './mapview';
import {
  balanceSql, breakdownSql, commodityTrendSql, compareSql, compareYearsSql, directionTrendSql, flowsSql, flowTotalsSql, heatmapSql, kpiSql, measureColumn, modeSharesSql, modeTrendSql,
  historyCommoditiesSql, historyModeSql, historyPartnersSql, historyTrendSql, pairBreakdownSql, partnerBreakdownSql, TABLE_DIM_SQL, tableSql, trendSql, zoneTotalsSql, type FlowFilter,
} from './sql';
import { applyTheme, defaultBasemap, onSystemThemeChange, resolveTheme, type ResolvedTheme } from './theme';
import type { AppState, Dir, FlowRow, ZoneInfo } from './types';
import { decode, encode, type Allowed } from './urlstate';

export interface Kpis {
  tons_kt: number | null;
  value_const_musd: number | null;
  value_current_musd: number | null;
  tmiles_m: number | null;
  rows: number;
}
export interface HoverChart {
  title: string;
  rows: { label: string; v: number; text: string }[];
}

export interface Breakdown {
  code: string;
  label: string;
  magnitude: number;
}
export type Detail =
  | { kind: 'zone'; id: string; byCommodity: Breakdown[]; byMode: Breakdown[]; partners: { id: string; label: string; magnitude: number }[] }
  | { kind: 'flow'; originId: string; destId: string; count: number; byCommodity: Breakdown[]; byMode: Breakdown[]; byTrade: Breakdown[] }
  | { kind: 'link'; id: number; attrs: Record<string, unknown>; volumes: Record<string, unknown>[]; dictionary: Record<string, { label: string; description: string; unit: string | null; caveat: string | null }> };

export interface TrendPoint {
  scenario: string;
  year: number;
  data_version: string;
  v: number;
}
export interface OtherSeries {
  version: string;
  benchmarkYear: number;
  points: TrendPoint[];
}
export interface Trends {
  points: TrendPoint[]; // this version, all scenarios
  modes: { year: number; code: string; label: string; v: number }[];
  other: OtherSeries | null;
  directions: { scenario: string; year: number; data_version: string; dir: 'inbound' | 'outbound' | 'within'; v: number }[];
  commodities: { year: number; code: string; label: string; v: number }[];
}
export interface PartnerRow {
  partner: string;
  dir: 'inbound' | 'outbound';
  code: string; // SCTG commodity
  v: number;
}
export interface YearsCompare {
  a: { year: number; scenario: string };
  b: { year: number; scenario: string };
  commodities: { code: string; label: string; a: number; b: number }[];
  modes: { code: string; label: string; a: number; b: number }[];
  directions: { dir: 'inbound' | 'outbound' | 'within'; a: number; b: number }[];
}
export interface ModelPanel {
  version: string;
  label: string;
  year: number;
  benchmarkYear: number;
  kpi: Kpis;
  balance: { inbound: number; outbound: number; within: number };
  modes: Breakdown[];
  commodities: Breakdown[];
}
export interface CompareSeries {
  item: string;
  label: string;
  points: { year: number; v: number; data_version: string }[];
}
export interface Summary {
  commodities: Breakdown[];
  modes: Breakdown[];
  heat: { commodity: string; mode: string; v: number }[];
}
export interface HistorySeries {
  code: string;
  label: string;
  points: { year: number; v: number }[];
}
export interface History {
  totals: { year: number; v: number }[];
  faf5: TrendPoint[] | null; // FAF5 annual estimates for reference, when asked for
  faf5Label: string;
  modes: { year: number; code: string; label: string; v: number }[];
  partners: HistorySeries[];
  commodities: HistorySeries[];
  years: number[];
}
export interface TableResult {
  rows: Record<string, unknown>[];
  dims: string[];
  total: number;
}

const NET_YEARS_FALLBACK = [2017, 2022, 2050];
export const TABLE_PAGE = 200;
const EXPORT_MAX = 250_000;

export class Controller {
  meta = $state<Meta | null>(null);
  s = $state<AppState>(undefined as unknown as AppState);
  defaults!: AppState;
  theme = $state<ResolvedTheme>('light');
  error = $state<string | null>(null);
  dbState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  busy = $state(false);

  // results
  flows = $state<FlowRow[]>([]);
  flowTotals = $state({ n: 0, total: 0, shownSum: 0 });
  kpis = $state<Kpis | null>(null);
  kpiPrev = $state<{ year: number; kpi: Kpis } | null>(null); // the previous published year under the same filters, for the change line
  balance = $state<{ inbound: number; outbound: number; within: number } | null>(null);
  modeShares = $state<Breakdown[]>([]);
  available = $state({ tmiles: true, current: true, value: true });
  notice = $state<string | null>(null);
  detail = $state<Detail | null>(null);
  hover = $state<{ x: number; y: number; lines: string[]; zone?: boolean; key?: string; charts?: HoverChart[] } | null>(null);
  linkCount = $state<number | null>(null);
  headlineShown = $state(false);

  // workspace chrome (not part of the URL)
  narrow = $state(false);
  panelL = $state(true);
  panelR = $state(true);
  mobL = $state(false);
  mobR = $state(false);
  legendOpen = $state(typeof innerHeight === 'number' ? innerHeight >= 860 : true); // collapsed on short screens so the legend never crowds the map
  cb = $state(false);
  modal = $state<'help' | 'method' | 'palette' | null>(null);
  toastMsg = $state<string | null>(null);
  playing = $state(false);
  yearTotals = $state<YearTotals | null>(null);
  scaleSamples = $state<{ magnitude: number; thickness: number }[]>([]); // arc width legend, read from the flow layers' own scale
  mapTick = $state(0); // bumps while the map moves, so labels pinned to map positions follow it
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private playTimer: ReturnType<typeof setInterval> | undefined;

  // charts drawer
  summary = $state<Summary | null>(null);
  partners = $state<PartnerRow[] | null>(null);
  cmpYears = $state<YearsCompare | null>(null);
  cmpModels = $state<ModelPanel[] | null>(null);
  trends = $state<Trends | null>(null);
  history = $state<History | null>(null);
  compareSeries = $state<CompareSeries[]>([]);
  table = $state<TableResult | null>(null);
  panelBusy = $state(false);
  private panelReq = 0;
  private tables = new Set<string>();

  locations = $state.raw(new Map<string, ZoneInfo>()); // replaced (not mutated) when a version loads, so lists derived from it update
  private zones: ZoneGeoJSON | null = null;
  private view: MapView | null = null;
  private db = new Db();
  private stateZones: string[] = [];
  private reqId = 0;
  private netReq = 0;
  private cameraTimer: ReturnType<typeof setTimeout> | undefined;
  private moveRaf = 0;

  // ---- startup
  async init(): Promise<void> {
    this.meta = await loadMeta();
    const m = this.meta;
    const versions = versionList(m);
    // the first FAF release (by product key) is the default; the county product and the history series are never the default
    const first = m.versions.products[productKey(m, versions[0])];
    const netYears = m.versions.network ? Object.keys(m.versions.network.years).map(Number).sort((a, b) => a - b) : NET_YEARS_FALLBACK;
    this.defaults = {
      version: first.faf_version, scenario: 'mid', year: first.default_year, view: 'total', direction: 'both', measure: 'tons', dollars: 'const',
      commodities: [], modes: [], topN: 50, minFlow: 0, selected: null, partner: null,
      layers: { flows: true, network: false, zones: true }, net: { year: netYears[0], truck: 'all', market: 'total', connectors: false },
      basemap: null, theme: 'system', cam: null,
      panel: 'summary', compare: { kind: 'zone', ids: [] }, overlayOther: false, historyOverlay: false, tableDims: ['orig', 'dest', 'sctg2'],
      compareMode: 'series', cmpA: yearsFor(m, first.faf_version, 'mid')[0] ?? first.default_year, cmpB: first.default_year,
    };
    this.allowed = {
      versions,
      scenarios: (v) => scenariosFor(m, v),
      years: (v, sc) => yearsFor(m, v, sc),
      defaultYear: (v) => m.versions.products[productKey(m, v)].default_year,
      netYears,
    };
    this.s = decode(location.search, this.defaults, this.allowed);
    this.stateZones = m.state.zones[this.s.version];
    if (this.s.panel !== 'closed' && !this.tabs.includes(this.s.panel)) this.s.panel = 'summary';
    this.updateTheme();
    onSystemThemeChange(() => {
      if (this.s.theme === 'system') this.updateTheme();
    });
    try {
      this.cb = localStorage.getItem('faf-cb') === '1';
    } catch {
      /* storage blocked: the default palette is used */
    }
    this.applyPalette();
    document.title = m.state.site_title;
  }
  allowed!: Allowed;

  get product(): string {
    return productKey(this.meta!, this.s.version);
  }
  /** 0 when the product has no benchmark year (the experimental county product); callers only print it for dollar values. */
  get benchmarkYear(): number {
    return this.meta!.versions.products[this.product].benchmark_year ?? 0;
  }
  get versionLabel(): string {
    return versionLabel(this.meta!, this.s.version);
  }
  get experimental(): boolean {
    return !!this.meta!.versions.products[this.product].experimental;
  }
  get historyProduct() {
    return Object.values(this.meta!.versions.products).find((p) => p.kind === 'history') ?? null;
  }
  /** The county product has one year and no value or ton-miles, so trends, compare and history do not apply to it. */
  get tabs(): Exclude<AppState['panel'], 'closed'>[] {
    if (this.experimental) return ['summary', 'partners', 'table'];
    return ['summary', 'trends', 'partners', 'compare', ...(this.historyProduct ? (['history'] as const) : []), 'table'];
  }
  /** The FAF releases that can be compared side by side: not the experimental county product or the history series. */
  get flowVersions(): string[] {
    const m = this.meta!;
    return this.allowed.versions.filter((v) => !m.versions.products[productKey(m, v)].experimental);
  }

  toggleMode(code: number): void {
    const set = new Set(this.s.modes);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    this.change({ modes: [...set].sort((a, b) => a - b) });
  }

  /** Select all of these commodity codes, or clear them when they are all selected already (a group toggle). */
  toggleCommodities(codes: string[]): void {
    const set = new Set(this.s.commodities);
    const all = codes.length > 0 && codes.every((c) => set.has(c));
    for (const c of codes) (all ? set.delete(c) : set.add(c));
    this.change({ commodities: [...set].sort() });
  }

  /** Why a tab is unavailable for the current dataset, or null when it works. */
  tabLock(id: Exclude<AppState['panel'], 'closed'>): string | null {
    if (this.tabs.includes(id)) return null;
    if (this.experimental) return 'The county estimates have one year and tons only, so this view does not apply.';
    return 'Not available for this dataset.';
  }
  get yearList(): number[] {
    return yearsFor(this.meta!, this.s.version, this.s.scenario);
  }
  get scenarioList(): string[] {
    return scenariosFor(this.meta!, this.s.version);
  }
  get dataVersionOfYear(): string {
    const p = this.meta!.versions.products[this.product];
    return (this.s.scenario === 'mid' ? p.years : (p.scenarios?.[this.s.scenario]?.years ?? {}))[String(this.s.year)];
  }
  get dim() {
    return this.meta!.dims.versions[this.s.version];
  }
  get netYears(): number[] {
    return this.allowed.netYears;
  }
  get filter(): FlowFilter {
    const s = this.s;
    return { view: s.view, direction: s.direction, commodities: s.commodities, modes: s.modes, measure: s.measure, dollars: s.dollars, partner: s.partner };
  }
  get basemapName(): string {
    return this.s.basemap ?? defaultBasemap(this.theme);
  }
  name(id: string): string {
    return this.locations.get(id)?.name ?? id;
  }

  // ---- theme
  updateTheme(): void {
    this.theme = resolveTheme(this.s.theme);
    applyTheme(this.theme);
    this.view?.setTheme(this.theme);
    this.view?.setBasemap(this.basemapName);
  }

  // ---- map + first paint
  async mountMap(el: HTMLElement): Promise<void> {
    const m = this.meta!;
    const cam = this.s.cam;
    this.view = new MapView(el, {
      style: this.basemapName,
      theme: this.theme,
      center: cam ? [cam[0], cam[1]] : m.state.center,
      zoom: cam ? cam[2] : m.state.zoom,
      callbacks: {
        onBasemapFailed: () => (this.notice = 'The basemap could not be loaded, so flows are drawn on a plain background. Choose a basemap again to retry.'),
        onFlowHover: (p) => this.onFlowHover(p),
        onFlowClick: (p) => this.onFlowClick(p),
        onZoneClick: (id) => this.select(id),
        onLinkHover: (props, x, y) => this.onLinkHover(props, x, y),
        onZoneHover: (id, x, y) => this.onZoneHover(id, x, y),
        onLinkClick: (props) => void this.showLink(Number(props.id)),
        onScale: (samples) => (this.scaleSamples = samples),
        onMove: () => {
          if (!this.moveRaf) this.moveRaf = requestAnimationFrame(() => ((this.moveRaf = 0), this.mapTick++));
        },
        onMoveEnd: (c) => {
          clearTimeout(this.cameraTimer);
          this.cameraTimer = setTimeout(() => (this.s.cam = c), 400);
        },
      },
    });
    this.view.setNetworkSource(new URL(m.state.network_pmtiles, new URL('data/', document.baseURI)).href);
    await this.loadVersionGeometry();
    // first paint: precomputed headline flows, valid only for the default view
    if (this.isDefaultView()) {
      const h = await loadHeadline(this.product);
      if (h.year === this.s.year) {
        const rows: FlowRow[] = h.flows.map(([origin, dest, count]) => ({ origin, dest, count, dir: this.flowDir(origin, dest) }));
        this.flows = rows;
        this.flowTotals = { n: h.flows_total, total: h.tons_kt_total, shownSum: rows.reduce((a, r) => a + r.count, 0) };
        this.headlineShown = true;
        this.view.setFlows([...this.locations.values()], rows);
      }
    }
    this.applyLayers();
    void this.refresh();
  }

  /** Direction of an arc relative to the state, for its color. In the import and export views an arc runs to or from a foreign region, so it is inbound or outbound by definition. */
  private flowDir(origin: string, dest: string): Dir {
    if (this.s.view === 'import') return 'inbound';
    if (this.s.view === 'export') return 'outbound';
    const st = this.stateZones;
    const a = st.includes(origin);
    const b = st.includes(dest);
    return a && b ? 'within' : b ? 'inbound' : 'outbound';
  }

  private isDefaultView(): boolean {
    const d = this.defaults;
    const s = this.s;
    return s.version === d.version && s.scenario === 'mid' && s.year === d.year && s.view === 'total' && s.direction === 'both' && s.measure === 'tons' && !s.commodities.length && !s.modes.length && !s.selected && !s.partner && s.topN === 50 && s.minFlow === 0;
  }

  private async loadVersionGeometry(): Promise<void> {
    this.yearTotals = null;
    // the sparkline is optional; the county product has one year and publishes no totals file
    if (this.meta!.versions.products[this.product].kind !== 'county') loadYearTotals(this.product).then((t) => (this.yearTotals = t), () => (this.yearTotals = null));
    this.zones = await loadZones(this.product);
    this.locations = await loadLocations(this.meta!, this.s.version, this.zones);
    this.stateZones = this.meta!.state.zones[this.s.version];
    this.view!.setZones(this.zones);
  }

  private applyLayers(): void {
    const v = this.view!;
    v.setZonesVisible(this.s.layers.zones);
    v.setFlowsVisible(this.s.layers.flows);
    void this.refreshNetwork();
  }

  // ---- queries
  async refresh(): Promise<void> {
    const id = ++this.reqId;
    this.hoverCache.clear();
    const s = this.s;
    this.busy = true;
    try {
      if (this.dbState === 'idle') {
        this.dbState = 'loading';
        await this.db.ready();
        this.dbState = 'ready';
      }
      const src = await this.db.file(`${this.product}/flows/${s.scenario}/${s.year}.parquet`);
      // which measures exist for this version/year (NULL sums mean "not published")
      const avail = (await this.db.query<Kpis>(kpiSql(src, { ...this.filter, view: 'total', direction: 'both', commodities: [], modes: [] }, this.stateZones)))[0];
      if (id !== this.reqId) return;
      this.available = { tmiles: avail.tmiles_m != null, current: avail.value_current_musd != null, value: avail.value_const_musd != null };
      this.fixUnavailable();
      const f = this.filter;
      const sel = s.selected;
      const years = this.yearList;
      const pi = years.indexOf(s.year);
      const py = pi > 0 ? years[pi - 1] : null;
      const prevSrc = py != null ? await this.db.file(`${this.product}/flows/${s.scenario}/${py}.parquet`) : null;
      const [rows, tot, kpi, bal, modes, zt, prev] = await Promise.all([
        this.db.query<{ origin: string; dest: string; magnitude: number }>(flowsSql(src, f, this.stateZones, s.topN, s.minFlow, sel)),
        this.db.query<{ n: number; total: number }>(flowTotalsSql(src, f, this.stateZones, s.minFlow, sel)),
        this.db.query<Kpis>(kpiSql(src, f, this.stateZones)),
        this.db.query<{ dir: 'inbound' | 'outbound' | 'within'; magnitude: number }>(balanceSql(src, f, this.stateZones)),
        this.db.query<{ code: number; magnitude: number }>(modeSharesSql(src, { ...f, modes: [] }, this.stateZones)),
        this.db.query<{ id: string; v: number }>(zoneTotalsSql(src, f, this.stateZones)),
        prevSrc ? this.db.query<Kpis>(kpiSql(prevSrc, f, this.stateZones)) : Promise.resolve([] as Kpis[]),
      ]);
      if (id !== this.reqId) return;
      const flows: FlowRow[] = rows.map((r) => ({ origin: String(r.origin), dest: String(r.dest), count: r.magnitude, dir: this.flowDir(String(r.origin), String(r.dest)) }));
      const zmax = Math.max(1, ...zt.map((z) => z.v));
      this.zoneTotals = new Map(zt.map((z) => [String(z.id), z.v]));
      this.view?.setZoneShading(new Map(zt.map((z) => [String(z.id), Math.sqrt(z.v / zmax)])));
      this.flows = flows;
      this.flowTotals = { n: tot[0].n, total: tot[0].total, shownSum: flows.reduce((a, r) => a + r.count, 0) };
      this.kpis = kpi[0];
      this.kpiPrev = prev.length && py != null ? { year: py, kpi: prev[0] } : null;
      const b = { inbound: 0, outbound: 0, within: 0 };
      for (const r of bal) b[r.dir] = r.magnitude ?? 0;
      this.balance = b;
      this.modeShares = modes.map((r) => ({ code: String(r.code), label: this.dim.mode[String(r.code)] ?? String(r.code), magnitude: r.magnitude }));
      this.headlineShown = false;
      this.view?.setFlows([...this.locations.values()], flows);
      if (this.detail?.kind === 'zone') void this.showZone(this.detail.id);
      void this.loadPanel();
      this.error = null;
    } catch (e) {
      if (id === this.reqId) {
        this.error = `Could not load flow data: ${e instanceof Error ? e.message : String(e)}`;
        this.dbState = this.dbState === 'ready' ? 'ready' : 'error';
      }
    } finally {
      if (id === this.reqId) this.busy = false;
    }
  }

  private fixUnavailable(): void {
    const s = this.s;
    if (s.measure === 'tmiles' && !this.available.tmiles) {
      s.measure = 'tons';
      this.notice = 'Ton-miles are not published for this version or year; showing tons.';
    } else if (s.measure === 'value' && !this.available.value) {
      s.measure = 'tons';
      this.notice = 'Value is not published for this version; showing tons.';
    } else if (s.measure === 'value' && s.dollars === 'current' && !this.available.current) {
      s.dollars = 'const';
      this.notice = 'Current-dollar values are not published for this version or year; showing constant dollars.';
    }
  }

  async refreshNetwork(): Promise<void> {
    const v = this.view;
    if (!v) return;
    const s = this.s;
    v.setNetwork({ visible: s.layers.network, connectors: s.net.connectors });
    if (!s.layers.network) return;
    const id = ++this.netReq;
    try {
      const src = await this.db.file(`network/link_flows/${s.net.year}.parquet`);
      const rows = await this.db.query<{ link_id: number; v: number }>(
        `SELECT link_id, tot_trips_day AS v FROM ${src} WHERE truck_type = '${s.net.truck}' AND market = '${s.net.market}' AND commodity_group = 'all' AND tot_trips_day > 0`,
      );
      if (id !== this.netReq) return;
      this.linkCount = rows.length;
      v.setNetwork({ visible: true, connectors: s.net.connectors, values: new Map(rows.map((r) => [Number(r.link_id), Number(r.v)])) });
    } catch (e) {
      if (id === this.netReq) this.error = `Could not load network flows: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // ---- actions (every control calls one of these)
  change(patch: Partial<AppState>): void {
    Object.assign(this.s, patch);
    void this.refresh();
  }

  async setVersion(version: string): Promise<void> {
    const m = this.meta!;
    this.s.version = version;
    this.s.scenario = 'mid';
    this.s.year = this.allowed.defaultYear(version);
    this.s.compare.ids = [];
    // commodity and mode codes differ between the FAF releases and the county product, so filters do not carry over
    this.s.commodities = [];
    this.s.modes = [];
    this.s.selected = null;
    this.s.partner = null;
    this.stopPlay();
    const ys = yearsFor(m, version, 'mid');
    this.s.cmpA = ys[0] ?? this.s.year;
    this.s.cmpB = this.s.year;
    this.detail = null;
    this.notice = null;
    this.stateZones = m.state.zones[version];
    this.trends = null;
    this.history = null;
    this.cmpYears = null;
    this.cmpModels = null;
    this.partners = null;
    this.compareSeries = [];
    if (this.s.panel !== 'closed' && !this.tabs.includes(this.s.panel)) this.s.panel = 'summary';
    this.headlineShown = false;
    await this.loadVersionGeometry();
    void this.refresh();
  }

  /** High and Low exist for forecast years only; switching to one from an annual year moves to its first forecast year (the timeline disables the control there, the command search can still ask for it). */
  setScenario(sc: string): void {
    const years = yearsFor(this.meta!, this.s.version, sc);
    this.s.scenario = sc;
    if (!years.includes(this.s.year)) {
      this.s.year = years.find((y) => y >= this.s.year) ?? years[0];
      this.notice = `${sc[0].toUpperCase() + sc.slice(1)} scenario is published for forecast years only; showing ${this.s.year}.`;
    } else {
      this.notice = null;
    }
    void this.refresh();
  }

  setLayer(key: 'flows' | 'network' | 'zones', on: boolean): void {
    this.s.layers[key] = on;
    this.applyLayers();
  }

  setNet(patch: Partial<AppState['net']>): void {
    Object.assign(this.s.net, patch);
    void this.refreshNetwork();
  }

  setTheme(pref: AppState['theme']): void {
    this.s.theme = pref;
    this.updateTheme();
  }

  setBasemap(name: string | null): void {
    this.s.basemap = name;
    this.view?.setBasemap(this.basemapName);
  }

  mapZoom(d: number): void {
    this.view?.zoomBy(d);
  }

  mapHome(): void {
    this.view?.goHome();
  }

  /** Screen position of a location inside the map, or null before the map exists. Depends on mapTick, so callers re-run as the map moves. */
  screenOf(id: string): { x: number; y: number } | null {
    void this.mapTick;
    const l = this.locations.get(id);
    if (!l || !this.view) return null;
    return this.view.project(l.lon, l.lat);
  }

  get mapSize(): { w: number; h: number } {
    void this.mapTick;
    return this.view?.size ?? { w: 0, h: 0 };
  }

  fitToFlows(): void {
    const ids = new Set<string>();
    for (const f of this.flows) {
      ids.add(f.origin);
      ids.add(f.dest);
    }
    this.view?.fitTo([...ids]);
  }

  resetFilters(): void {
    const d = this.defaults;
    const v = this.s.version;
    Object.assign(this.s, { view: d.view, direction: d.direction, measure: d.measure, dollars: d.dollars, commodities: [], modes: [], topN: d.topN, minFlow: d.minFlow, selected: null, partner: null });
    this.detail = null;
    this.notice = null;
    if (v) void this.refresh();
  }

  url(): string {
    return encode(this.s, this.defaults, this.allowed.defaultYear, (v, sc) => yearsFor(this.meta!, v, sc)[0] ?? 0);
  }

  // ---- selection / detail
  select(id: string | null): void {
    if (id === this.s.selected) id = null;
    this.s.selected = id;
    if (!id) {
      this.detail = null;
    } else {
      void this.showZone(id);
    }
    void this.refresh();
  }

  private async breakdown(column: 'sctg2' | 'dms_mode' | 'trade_type', selected: string | null, pair?: [string, string], limit = 8): Promise<Breakdown[]> {
    const src = await this.db.file(`${this.product}/flows/${this.s.scenario}/${this.s.year}.parquet`);
    const sql = pair ? pairBreakdownSql(src, this.filter, this.stateZones, column, pair[0], pair[1], limit) : breakdownSql(src, this.filter, this.stateZones, column, selected, limit);
    const rows = await this.db.query<{ code: string | number; magnitude: number }>(sql);
    const labels = column === 'sctg2' ? this.dim.commodity : column === 'dms_mode' ? this.dim.mode : this.dim.trade_type;
    return rows.map((r) => ({ code: String(r.code), label: labels[String(r.code)] ?? String(r.code), magnitude: r.magnitude }));
  }

  async showZone(id: string): Promise<void> {
    const src = await this.db.file(`${this.product}/flows/${this.s.scenario}/${this.s.year}.parquet`);
    const [byCommodity, byMode, partnerRows] = await Promise.all([
      this.breakdown('sctg2', id),
      this.breakdown('dms_mode', id),
      this.db.query<{ origin: string; dest: string; magnitude: number }>(flowsSql(src, this.filter, this.stateZones, 12, 0, id)),
    ]);
    if (this.s.selected !== id) return;
    const partners = partnerRows.map((r) => {
      const o = String(r.origin);
      const d = String(r.dest);
      const label = o === id && d === id ? `Within ${this.name(id)}` : o === id ? `To ${this.name(d)}` : `From ${this.name(o)}`;
      return { id: o === id ? d : o, label, magnitude: r.magnitude };
    });
    this.detail = { kind: 'zone', id, byCommodity, byMode, partners };
  }

  private onFlowClick(p: FlowmapPick): void {
    if (p.kind === 'location' && p.id) return this.select(p.id);
    if (p.kind === 'flow' && p.originId && p.destId) void this.showFlow(p.originId, p.destId, p.count ?? 0);
  }

  async showFlow(originId: string, destId: string, count: number): Promise<void> {
    const [byCommodity, byMode, byTrade] = await Promise.all([
      this.breakdown('sctg2', null, [originId, destId]),
      this.breakdown('dms_mode', null, [originId, destId]),
      this.breakdown('trade_type', null, [originId, destId]),
    ]);
    this.detail = { kind: 'flow', originId, destId, count, byCommodity, byMode, byTrade };
  }

  private onFlowHover(p: FlowmapPick | null): void {
    if (!p) {
      if (!this.hover?.zone) this.hover = null; // a miss on the flow layers must not wipe a zone tooltip
      return;
    }
    if (p.kind === 'location' && p.id) {
      const loc = this.locations.get(p.id);
      const id = p.id;
      this.showHover(p.x, p.y, [loc?.name ?? id, loc?.schematic ? 'Foreign region (schematic position)' : '', 'Click to open the zone'].filter(Boolean), `loc:${id}`, () => this.zoneCharts(id));
    } else if (p.kind === 'flow') {
      const [o, d] = [p.originId!, p.destId!];
      this.showHover(p.x, p.y, [`${this.name(o)} to ${this.name(d)}`, `${this.fmtMeasure(p.count ?? 0)}`, 'Click to open the flow'], `flow:${o}>${d}`, () => this.pairCharts(o, d));
    }
  }

  private hoverCache = new Map<string, HoverChart[]>();
  private hoverTimer: ReturnType<typeof setTimeout> | undefined;

  /** Show the tooltip now; the mini charts follow once the pointer has rested for a moment (a query per pixel moved would flood the engine). */
  private showHover(x: number, y: number, lines: string[], key: string, charts: () => Promise<HoverChart[]>, zone = false): void {
    const same = this.hover?.key === key;
    this.hover = { x, y, lines, zone, key, charts: same ? this.hover?.charts : undefined };
    if (same) return;
    clearTimeout(this.hoverTimer);
    const ck = `${this.product}|${this.s.year}|${this.s.scenario}|${this.s.measure}|${this.reqId}|${key}`;
    const cached = this.hoverCache.get(ck);
    if (cached) {
      this.hover.charts = cached;
      return;
    }
    this.hoverTimer = setTimeout(async () => {
      try {
        const c = await charts();
        this.hoverCache.set(ck, c);
        if (this.hover?.key === key) this.hover = { ...this.hover, charts: c };
      } catch {
        /* the plain tooltip stays */
      }
    }, 140);
  }

  private toChart(title: string, rows: Breakdown[], n = 4): HoverChart {
    return { title, rows: rows.slice(0, n).map((r) => ({ label: r.label, v: r.magnitude, text: this.fmtMeasure(r.magnitude) })) };
  }

  private async zoneCharts(id: string): Promise<HoverChart[]> {
    const [com, mode] = await Promise.all([this.breakdown('sctg2', id, undefined, 4), this.breakdown('dms_mode', id, undefined, 3)]);
    return [this.toChart('Top commodities', com), this.toChart('By mode', mode, 3)];
  }

  private async pairCharts(o: string, d: string): Promise<HoverChart[]> {
    const [com, mode] = await Promise.all([this.breakdown('sctg2', null, [o, d], 4), this.breakdown('dms_mode', null, [o, d], 3)]);
    return [this.toChart('Top commodities', com), this.toChart('By mode', mode, 3)];
  }

  private zoneTotals = new Map<string, number>();

  private onZoneHover(id: string | null, x: number, y: number): void {
    if (!id) {
      if (this.hover?.zone) this.hover = null;
      return;
    }
    if (this.hover && !this.hover.zone) return; // a flow, node or link tooltip is showing
    const v = this.zoneTotals.get(id);
    const inState = this.stateZones.includes(id);
    const line = inState ? 'Inside the state' : v != null ? `${this.fmtMeasure(v)} touching the state` : 'No flow with the state in this view';
    this.showHover(x, y, [this.name(id), line, 'Click to open the zone'], `zone:${id}`, () => this.zoneCharts(id), true);
  }

  private onLinkHover(props: Record<string, unknown> | null, x: number, y: number): void {
    if (!props) {
      if (this.hover && this.hover.lines[0]?.startsWith('Link ')) this.hover = null;
      return;
    }
    this.hover = { x, y, lines: [`Link ${props.id}`, 'Click for attributes and model volumes'] };
  }

  async showLink(id: number): Promise<void> {
    if (!Number.isInteger(id)) return;
    const [attrSrc, dictSrc] = await Promise.all([this.db.file('network/link_attrs.parquet'), this.db.file('meta/dictionary.parquet')]);
    const volumes: Record<string, unknown>[] = [];
    for (const y of this.netYears) {
      const src = await this.db.file(`network/link_flows/${y}.parquet`);
      volumes.push(...(await this.db.query(`SELECT year, truck_type, market, tot_trips_day, tot_tons_k FROM ${src} WHERE link_id = ${id} AND commodity_group = 'all' ORDER BY truck_type, market`)));
    }
    const attrs = (await this.db.query(`SELECT * FROM ${attrSrc} WHERE link_id = ${id}`))[0] ?? {};
    const dict: Record<string, { label: string; description: string; unit: string | null; caveat: string | null }> = {};
    for (const r of await this.db.query<{ column_name: string; label: string; description: string; unit: string | null; caveat: string | null }>(
      `SELECT column_name, label, description, unit, caveat FROM ${dictSrc} WHERE table_name IN ('network_links', 'network_link_flows')`,
    )) {
      dict[r.column_name] = r;
    }
    this.detail = { kind: 'link', id, attrs, volumes, dictionary: dict };
  }

  closeDetail(): void {
    this.detail = null;
    if (this.s.selected) {
      this.s.selected = null;
      void this.refresh();
    }
  }

  // ---- charts drawer ---------------------------------------------------------------------------------------------
  setPanel(p: AppState['panel']): void {
    if (p !== 'closed' && !this.tabs.includes(p)) return;
    this.s.panel = p;
    if (p !== 'closed') void this.loadPanel();
  }

  /** (Re)load whatever the open tab needs. Called when the tab or any filter changes. */
  async loadPanel(): Promise<void> {
    const p = this.s.panel;
    if (p === 'closed' || this.dbState === 'idle') return;
    const id = ++this.panelReq;
    this.panelBusy = true;
    try {
      if (p === 'summary') await this.loadSummary(id);
      else if (p === 'trends') await this.loadTrends(id);
      else if (p === 'partners') await this.loadPartners(id);
      else if (p === 'compare') await this.loadCompare(id);
      else if (p === 'history') await this.loadHistory(id);
      else await this.loadTable(id);
    } catch (e) {
      if (id === this.panelReq) this.error = `Could not load chart data: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      if (id === this.panelReq) this.panelBusy = false;
    }
  }

  /** All years and scenarios of one FAF version in one in-memory table, downloaded once. */
  private async allYears(version: string): Promise<string> {
    const m = this.meta!;
    const key = productKey(m, version);
    const table = `t_${key}`;
    if (!this.tables.has(table)) {
      const p = m.versions.products[key];
      const paths = Object.keys(p.years).map((y) => `${key}/flows/${p.scenario}/${y}.parquet`);
      for (const [sc, v] of Object.entries(p.scenarios ?? {})) for (const y of Object.keys(v.years)) paths.push(`${key}/flows/${sc}/${y}.parquet`);
      await this.db.loadTable(table, paths);
      this.tables.add(table);
    }
    return table;
  }

  private label(kind: 'sctg2' | 'dms_mode' | 'trade_type', code: string): string {
    const d = kind === 'sctg2' ? this.dim.commodity : kind === 'dms_mode' ? this.dim.mode : this.dim.trade_type;
    return d[code] ?? code;
  }

  private async loadSummary(id: number): Promise<void> {
    const src = await this.db.file(`${this.product}/flows/${this.s.scenario}/${this.s.year}.parquet`);
    const f = this.filter;
    const [commodities, heat] = await Promise.all([
      this.db.query<{ code: string; magnitude: number }>(breakdownSql(src, { ...f, commodities: [] }, this.stateZones, 'sctg2', null, 80)),
      this.db.query<{ commodity: string; mode: number; v: number }>(heatmapSql(src, f, this.stateZones)),
    ]);
    if (id !== this.panelReq) return;
    this.summary = {
      commodities: commodities.map((r) => ({ code: String(r.code), label: this.label('sctg2', String(r.code)), magnitude: r.magnitude })),
      modes: this.modeShares,
      heat: heat.map((r) => ({ commodity: String(r.commodity), mode: String(r.mode), v: r.v })),
    };
  }

  private async loadTrends(id: number): Promise<void> {
    const f = this.filter;
    const tbl = await this.allYears(this.s.version);
    const [points, modes, directions, commodities] = await Promise.all([
      this.db.query<TrendPoint>(trendSql(tbl, f, this.stateZones)),
      this.db.query<{ year: number; code: number; v: number }>(modeTrendSql(tbl, f, this.stateZones)),
      this.db.query<Trends['directions'][number]>(directionTrendSql(tbl, f, this.stateZones)),
      this.db.query<{ year: number; code: string; v: number }>(commodityTrendSql(tbl, f, this.stateZones)),
    ]);
    let other: OtherSeries | null = null;
    if (this.s.overlayOther) {
      const ov = this.allowed.versions.find((v) => v !== this.s.version && !this.meta!.versions.products[productKey(this.meta!, v)].experimental);
      if (ov) {
        const otbl = await this.allYears(ov);
        const rows = await this.db.query<TrendPoint>(trendSql(otbl, f, this.meta!.state.zones[ov]));
        other = { version: ov, benchmarkYear: this.meta!.versions.products[productKey(this.meta!, ov)].benchmark_year ?? 0, points: rows.filter((r) => r.scenario === 'mid') };
      }
    }
    if (id !== this.panelReq) return;
    this.trends = {
      points, other, directions,
      modes: modes.map((r) => ({ year: r.year, code: String(r.code), label: this.label('dms_mode', String(r.code)), v: r.v })),
      commodities: commodities.map((r) => ({ year: r.year, code: String(r.code), label: this.label('sctg2', String(r.code)), v: r.v })),
    };
  }

  /** The largest partner states (regions in import and export), split by direction and commodity. */
  private async loadPartners(id: number): Promise<void> {
    const src = await this.db.file(`${this.product}/flows/${this.s.scenario}/${this.s.year}.parquet`);
    const rows = await this.db.query<PartnerRow>(partnerBreakdownSql(src, this.filter, this.stateZones, 14));
    if (id !== this.panelReq) return;
    this.partners = rows.map((r) => ({ partner: String(r.partner), dir: r.dir, code: String(r.code), v: r.v }));
  }

  partnerLabel(code: string): string {
    return this.meta!.dims.states[code] ?? this.dim.foreign[code] ?? code;
  }

  setPartner(code: string | null): void {
    this.s.partner = this.s.partner === code ? null : code;
    this.detail = null;
    void this.refresh();
  }

  private async loadCompare(id: number): Promise<void> {
    if (this.s.compareMode === 'years') return this.loadCompareYears(id);
    if (this.s.compareMode === 'models') return this.loadCompareModels(id);
    const { kind, ids } = this.s.compare;
    if (!ids.length) {
      this.compareSeries = [];
      return;
    }
    const tbl = await this.allYears(this.s.version);
    const rows = await this.db.query<{ item: string; year: number; data_version: string; v: number }>(compareSql(tbl, this.filter, this.stateZones, kind, ids));
    if (id !== this.panelReq) return;
    this.compareSeries = ids.map((item) => ({
      item,
      label: kind === 'zone' ? this.name(item) : this.label('sctg2', item),
      points: rows.filter((r) => String(r.item) === item).map((r) => ({ year: r.year, v: r.v, data_version: r.data_version })),
    }));
  }

  /** Two (year, scenario) pairs of the current version side by side: commodity, mode and direction. */
  private async loadCompareYears(id: number): Promise<void> {
    const years = this.yearList;
    const a = { year: years.includes(this.s.cmpA) ? this.s.cmpA : years[0], scenario: this.scenarioFor(this.s.cmpA) };
    const b = { year: years.includes(this.s.cmpB) ? this.s.cmpB : years[years.length - 1], scenario: this.scenarioFor(this.s.cmpB) };
    const tbl = await this.allYears(this.s.version);
    const f = this.filter;
    const [com, mode, dir] = await Promise.all([
      this.db.query<{ side: 'a' | 'b'; code: string; v: number }>(compareYearsSql(tbl, f, this.stateZones, 'sctg2', a, b)),
      this.db.query<{ side: 'a' | 'b'; code: number; v: number }>(compareYearsSql(tbl, f, this.stateZones, 'dms_mode', a, b)),
      this.db.query<Trends['directions'][number]>(directionTrendSql(tbl, f, this.stateZones)),
    ]);
    if (id !== this.panelReq) return;
    const pair = <T extends { side: 'a' | 'b'; code: string | number; v: number }>(rows: T[], label: (c: string) => string) => {
      const by = new Map<string, { code: string; label: string; a: number; b: number }>();
      for (const r of rows) {
        const code = String(r.code);
        const o = by.get(code) ?? { code, label: label(code), a: 0, b: 0 };
        o[r.side] = r.v ?? 0;
        by.set(code, o);
      }
      return [...by.values()];
    };
    const pick = (y: { year: number; scenario: string }, d: string) => dir.find((r) => r.year === y.year && r.scenario === y.scenario && r.dir === d)?.v ?? 0;
    this.cmpYears = {
      a, b,
      commodities: pair(com, (c) => this.label('sctg2', c)),
      modes: pair(mode, (c) => this.label('dms_mode', c)),
      directions: (['inbound', 'outbound', 'within'] as const).map((d) => ({ dir: d, a: pick(a, d), b: pick(b, d) })),
    };
  }

  /** High and Low exist for forecast years only; any other year is read from the mid-range series. */
  scenarioFor(year: number): string {
    const sc = this.s.scenario;
    return sc !== 'mid' && yearsFor(this.meta!, this.s.version, sc).includes(year) ? sc : 'mid';
  }

  /** The FAF releases that publish the same year, side by side (never joined into one series). Uses the filters of the current view. */
  private async loadCompareModels(id: number): Promise<void> {
    const m = this.meta!;
    const versions = this.flowVersions;
    const common = versions.map((v) => yearsFor(m, v, 'mid').filter((y) => m.versions.products[productKey(m, v)].years[String(y)] !== 'forecast')).reduce((a, b) => a.filter((y) => b.includes(y)));
    const year = Math.max(...common);
    const f = this.filter;
    const panels: ModelPanel[] = [];
    for (const v of versions) {
      const key = productKey(m, v);
      const zones = m.state.zones[v];
      const src = await this.db.file(`${key}/flows/mid/${year}.parquet`);
      const d = m.dims.versions[v];
      const [kpi, bal, modes, coms] = await Promise.all([
        this.db.query<Kpis>(kpiSql(src, f, zones)),
        this.db.query<{ dir: 'inbound' | 'outbound' | 'within'; magnitude: number }>(balanceSql(src, f, zones)),
        this.db.query<{ code: number; magnitude: number }>(modeSharesSql(src, f, zones)),
        this.db.query<{ code: string; magnitude: number }>(breakdownSql(src, { ...f, commodities: [] }, zones, 'sctg2', null, 6)),
      ]);
      const b = { inbound: 0, outbound: 0, within: 0 };
      for (const r of bal) b[r.dir] = r.magnitude ?? 0;
      panels.push({
        version: v, label: versionLabel(m, v), year, benchmarkYear: m.versions.products[key].benchmark_year ?? 0, kpi: kpi[0], balance: b,
        modes: modes.map((r) => ({ code: String(r.code), label: d.mode[String(r.code)] ?? String(r.code), magnitude: r.magnitude })),
        commodities: coms.map((r) => ({ code: String(r.code), label: d.commodity[String(r.code)] ?? String(r.code), magnitude: r.magnitude })),
      });
    }
    if (id !== this.panelReq) return;
    this.cmpModels = panels;
  }

  setCompareMode(mode: AppState['compareMode']): void {
    this.s.compareMode = mode;
    void this.loadPanel();
  }

  setCompareYears(patch: { cmpA?: number; cmpB?: number }): void {
    Object.assign(this.s, patch);
    void this.loadPanel();
  }

  /** FAF5 reprocessed history: state level only, four years (1997, 2002, 2007, 2012), 2017 dollars. Loaded as one small in-memory table. */
  private async loadHistory(id: number): Promise<void> {
    const hp = this.historyProduct;
    if (!hp) return;
    const m = this.meta!;
    const years = Object.keys(hp.years).map(Number).sort((a, b) => a - b);
    await this.db.loadTable('t_history', years.map((y) => `history/state_flows/${hp.scenario}/${y}.parquet`));
    const f = this.filter;
    const fips = m.state.fips;
    const [totals, modes, partners, commodities] = await Promise.all([
      this.db.query<{ year: number; v: number }>(historyTrendSql('t_history', f, fips)),
      this.db.query<{ year: number; code: number; v: number }>(historyModeSql('t_history', f, fips)),
      this.db.query<{ year: number; code: string; v: number }>(historyPartnersSql('t_history', f, fips, 6)),
      this.db.query<{ year: number; code: string; v: number }>(historyCommoditiesSql('t_history', f, fips, 6)),
    ]);
    const d = m.dims.versions[hp.faf_version];
    const series = (rows: { year: number; code: string | number; v: number }[], label: (c: string) => string): HistorySeries[] => {
      const by = new Map<string, HistorySeries>();
      for (const r of rows) {
        const code = String(r.code);
        if (!by.has(code)) by.set(code, { code, label: label(code), points: [] });
        by.get(code)!.points.push({ year: r.year, v: r.v });
      }
      return [...by.values()];
    };
    let faf5: TrendPoint[] | null = null;
    if (this.s.historyOverlay) {
      const tbl = await this.allYears(hp.faf_version);
      const rows = await this.db.query<TrendPoint>(trendSql(tbl, f, m.state.zones[hp.faf_version]));
      faf5 = rows.filter((r) => r.scenario === 'mid' && r.data_version !== 'forecast');
    }
    if (id !== this.panelReq) return;
    this.history = {
      totals, faf5, faf5Label: versionLabel(m, hp.faf_version), years,
      modes: modes.map((r) => ({ year: r.year, code: String(r.code), label: d.mode[String(r.code)] ?? String(r.code), v: r.v })),
      partners: series(partners, (c) => (m.dims.states[c] ?? d.foreign[c] ?? c)),
      commodities: series(commodities, (c) => d.commodity[c] ?? c),
    };
  }

  setHistoryOverlay(on: boolean): void {
    this.s.historyOverlay = on;
    void this.loadPanel();
  }

  setCompare(patch: Partial<AppState['compare']>): void {
    if (patch.kind && patch.kind !== this.s.compare.kind) this.s.compare.ids = [];
    Object.assign(this.s.compare, patch);
    void this.loadPanel();
  }

  addCompare(item: string): void {
    const ids = this.s.compare.ids;
    if (!item || ids.includes(item) || ids.length >= 6) return;
    this.setCompare({ ids: [...ids, item] });
  }

  removeCompare(item: string): void {
    this.setCompare({ ids: this.s.compare.ids.filter((i) => i !== item) });
  }

  setOverlayOther(on: boolean): void {
    this.s.overlayOther = on;
    void this.loadPanel();
  }

  private decorateRows(rows: Record<string, unknown>[], dims: string[]): Record<string, unknown>[] {
    const aliases = dims.map((d) => TABLE_DIM_SQL[d](this.s.view).alias);
    return rows.map((r) => {
      const o = { ...r };
      for (const a of aliases) {
        const raw = r[a];
        if (raw == null) continue;
        const code = String(raw);
        o[`${a}_label`] = a === 'origin' || a === 'destination' ? this.name(code) : a === 'sctg2' ? this.label('sctg2', code) : a === 'domestic_mode' ? this.label('dms_mode', code) : this.label('trade_type', code);
      }
      return o;
    });
  }

  private async loadTable(id: number): Promise<void> {
    const src = await this.db.file(`${this.product}/flows/${this.s.scenario}/${this.s.year}.parquet`);
    const dims = this.s.tableDims;
    const [rows, count] = await Promise.all([
      this.db.query(tableSql(src, this.filter, this.stateZones, dims, TABLE_PAGE)),
      this.db.query<{ n: number }>(`SELECT count(*)::INTEGER AS n FROM (${tableSql(src, this.filter, this.stateZones, dims, null)})`),
    ]);
    if (id !== this.panelReq) return;
    this.table = { rows: this.decorateRows(rows, dims), dims, total: count[0].n };
  }

  setTableDims(dims: string[]): void {
    this.s.tableDims = dims;
    void this.loadPanel();
  }

  /** CSV of the whole filtered table (not just the visible page), with version, scenario, year, status and dollar basis on every row. */
  async exportCsv(): Promise<void> {
    const src = await this.db.file(`${this.product}/flows/${this.s.scenario}/${this.s.year}.parquet`);
    const dims = this.s.tableDims;
    const rows = this.decorateRows(await this.db.query(tableSql(src, this.filter, this.stateZones, dims, EXPORT_MAX)), dims);
    const aliases = dims.map((d) => TABLE_DIM_SQL[d](this.s.view).alias);
    const dimHeaders = aliases.flatMap((a) => [a, `${a}_label`]);
    const keys = dimHeaders;
    const meta = {
      faf_version: this.s.version, scenario: this.s.scenario, year: this.s.year, data_version: this.dataVersionOfYear,
      view: this.s.view, direction: this.s.direction,
      dollar_basis: !this.available.value ? 'not applicable (tons only)' : this.s.dollars === 'const' ? `constant ${this.benchmarkYear} dollars` : 'current dollars',
    };
    const csv = tableToCsv(meta, dimHeaders, rows as Record<string, string | number | null>[], keys);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName(meta);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- formatting helpers bound to the current state
  fmtMeasure(v: number | null | undefined): string {
    return formatMeasure(this.s.measure, v, this.s.dollars, this.benchmarkYear);
  }
  get measureColumn(): string {
    return measureColumn(this.s.measure, this.s.dollars);
  }

  // ---- workspace chrome
  get leftOpen(): boolean {
    return this.narrow ? this.mobL : this.panelL;
  }
  /** The insight drawer is open on wide screens while a tab is selected (kept in the URL); on narrow screens it is a sheet. */
  get rightOpen(): boolean {
    return this.narrow ? this.mobR : this.s.panel !== 'closed';
  }
  togglePanel(which: 'L' | 'R'): void {
    if (this.narrow) {
      if (which === 'L') {
        this.mobL = !this.mobL;
        if (this.mobL) this.mobR = false;
      } else {
        this.mobR = !this.mobR;
        if (this.mobR) {
          this.mobL = false;
          if (this.s.panel === 'closed') this.s.panel = 'summary';
          void this.loadPanel();
        }
      }
    } else if (which === 'L') this.panelL = !this.panelL;
    else this.setPanel(this.s.panel === 'closed' ? 'summary' : 'closed');
  }
  closeSheets(): void {
    this.mobL = false;
    this.mobR = false;
  }

  /** Value of the selected measure at a year for the sparkline: the state total for the whole release, never filtered. null = not published. */
  sparkValue(year: number): number | null {
    const t = this.yearTotals?.totals;
    if (!t) return null;
    const sc = this.s.scenario !== 'mid' && t[this.s.scenario]?.[String(year)] ? this.s.scenario : 'mid';
    const row = t[sc]?.[String(year)];
    if (!row) return null;
    const i = this.s.measure === 'tons' ? 0 : this.s.measure === 'tmiles' ? 3 : this.s.dollars === 'current' ? 2 : 1;
    return row[i] ?? null;
  }

  toast(msg: string): void {
    this.toastMsg = msg;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toastMsg = null), 2400);
  }

  applyPalette(): void {
    if (this.cb) document.documentElement.dataset.cb = '1';
    else delete document.documentElement.dataset.cb;
    this.view?.setTheme(this.theme);
  }

  setCb(on: boolean): void {
    this.cb = on;
    try {
      localStorage.setItem('faf-cb', on ? '1' : '0');
    } catch {
      /* storage blocked */
    }
    this.applyPalette();
  }

  /** Every year the release publishes (mid-range series): the timeline's ticks. High and Low apply to forecast years only. */
  get timelineYears(): number[] {
    return yearsFor(this.meta!, this.s.version, 'mid');
  }

  /** Select a year; ignored for years the release does not publish. A High or Low scenario falls back to mid-range outside its forecast years. */
  setYear(y: number): void {
    if (!this.timelineYears.includes(y) || y === this.s.year) return;
    const patch: Partial<AppState> = { year: y };
    if (this.s.scenario !== 'mid' && !yearsFor(this.meta!, this.s.version, this.s.scenario).includes(y)) patch.scenario = 'mid';
    this.change(patch);
  }

  stepYear(d: number): void {
    const ys = this.timelineYears;
    const i = ys.indexOf(this.s.year);
    this.setYear(ys[Math.min(ys.length - 1, Math.max(0, i + d))]);
  }

  /** Whether the High and Low scenarios mean anything for the selected year. */
  get scenarioApplies(): boolean {
    return this.dataVersionOfYear === 'forecast' && this.scenarioList.length > 1;
  }

  stopPlay(): void {
    this.playing = false;
    clearInterval(this.playTimer);
  }

  /** Steps through the years the release publishes, skipping the gap (no interpolation), then stops. */
  togglePlay(): void {
    if (this.playing) return this.stopPlay();
    const ys = this.timelineYears;
    if (ys.length < 2) return;
    this.playing = true;
    if (this.s.year === ys[ys.length - 1]) this.setYear(ys[0]);
    this.playTimer = setInterval(() => {
      const list = this.timelineYears;
      const i = list.indexOf(this.s.year);
      if (i < 0 || i >= list.length - 1) return this.stopPlay();
      this.setYear(list[i + 1]);
    }, 1400);
  }

  /** A citable sentence for the current view, with release, units, dollar basis and status. */
  citation(): string {
    const k = this.kpis;
    const v = this.s.measure === 'tons' ? k?.tons_kt : this.s.measure === 'tmiles' ? k?.tmiles_m : this.s.dollars === 'current' ? k?.value_current_musd : k?.value_const_musd;
    const p = this.meta!.versions.products[this.product];
    const state = this.meta!.state.name;
    const unit = this.s.measure === 'tons' ? 'tons' : this.s.measure === 'value' ? 'value' : 'ton-miles';
    const basis = this.s.measure === 'value' ? ` Dollars: ${this.s.dollars === 'const' ? `constant ${this.benchmarkYear}` : 'current'}.` : '';
    return `${state} ${unit}, ${this.s.year} (${this.dataVersionOfYear}${this.s.scenario !== 'mid' ? `, ${this.s.scenario} scenario` : ''}): ${this.fmtMeasure(v)}. Source: ${p.release}; BTS, FHWA and Oak Ridge National Laboratory. Modeled estimates, not counts.${basis}`;
  }
}

