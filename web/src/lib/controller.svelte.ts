import { exportFileName, tableToCsv } from './csv';
import { formatMeasure } from './format';
import { Db, loadHeadline, loadLocations, loadMeta, loadZones, productKey, scenariosFor, versionLabel, versionList, yearsFor, type Meta, type ZoneGeoJSON } from './data';
import { MapView, type FlowmapPick } from './mapview';
import {
  balanceSql, breakdownSql, compareSql, flowsSql, flowTotalsSql, heatmapSql, kpiSql, measureColumn, modeSharesSql, modeTrendSql,
  historyCommoditiesSql, historyModeSql, historyPartnersSql, historyTrendSql, pairBreakdownSql, partnersSql, TABLE_DIM_SQL, tableSql, trendSql, type FlowFilter,
} from './sql';
import { applyTheme, defaultBasemap, onSystemThemeChange, resolveTheme, type ResolvedTheme } from './theme';
import type { AppState, FlowRow, ZoneInfo } from './types';
import { decode, encode, type Allowed } from './urlstate';

export interface Kpis {
  tons_kt: number | null;
  value_const_musd: number | null;
  value_current_musd: number | null;
  tmiles_m: number | null;
  rows: number;
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
}
export interface CompareSeries {
  item: string;
  label: string;
  points: { year: number; v: number; data_version: string }[];
}
export interface Summary {
  partners: Breakdown[];
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
  balance = $state<{ inbound: number; outbound: number; within: number } | null>(null);
  modeShares = $state<Breakdown[]>([]);
  available = $state({ tmiles: true, current: true, value: true });
  notice = $state<string | null>(null);
  detail = $state<Detail | null>(null);
  hover = $state<{ x: number; y: number; lines: string[] } | null>(null);
  linkCount = $state<number | null>(null);
  headlineShown = $state(false);

  // charts drawer
  summary = $state<Summary | null>(null);
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
      commodities: [], modes: [], topN: 50, minFlow: 0, selected: null,
      layers: { flows: true, network: false, zones: true }, net: { year: netYears[0], truck: 'all', market: 'total', connectors: false },
      basemap: null, theme: 'system', cam: null,
      panel: 'closed', compare: { kind: 'zone', ids: [] }, overlayOther: false, historyOverlay: false, tableDims: ['orig', 'dest', 'sctg2'],
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
    if (this.experimental) return ['summary', 'table'];
    return ['summary', 'trends', 'compare', ...(this.historyProduct ? (['history'] as const) : []), 'table'];
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
    return { view: s.view, direction: s.direction, commodities: s.commodities, modes: s.modes, measure: s.measure, dollars: s.dollars };
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
        onLinkClick: (props) => void this.showLink(Number(props.id)),
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
        const rows: FlowRow[] = h.flows.map(([origin, dest, count]) => ({ origin, dest, count }));
        this.flows = rows;
        this.flowTotals = { n: h.flows_total, total: h.tons_kt_total, shownSum: rows.reduce((a, r) => a + r.count, 0) };
        this.headlineShown = true;
        this.view.setFlows([...this.locations.values()], rows);
      }
    }
    this.applyLayers();
    void this.refresh();
  }

  private isDefaultView(): boolean {
    const d = this.defaults;
    const s = this.s;
    return s.version === d.version && s.scenario === 'mid' && s.year === d.year && s.view === 'total' && s.direction === 'both' && s.measure === 'tons' && !s.commodities.length && !s.modes.length && !s.selected && s.topN === 50 && s.minFlow === 0;
  }

  private async loadVersionGeometry(): Promise<void> {
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
      const [rows, tot, kpi, bal, modes] = await Promise.all([
        this.db.query<{ origin: string; dest: string; magnitude: number }>(flowsSql(src, f, this.stateZones, s.topN, s.minFlow, sel)),
        this.db.query<{ n: number; total: number }>(flowTotalsSql(src, f, this.stateZones, s.minFlow, sel)),
        this.db.query<Kpis>(kpiSql(src, f, this.stateZones)),
        this.db.query<{ dir: 'inbound' | 'outbound' | 'within'; magnitude: number }>(balanceSql(src, f, this.stateZones)),
        this.db.query<{ code: number; magnitude: number }>(modeSharesSql(src, f, this.stateZones)),
      ]);
      if (id !== this.reqId) return;
      const flows: FlowRow[] = rows.map((r) => ({ origin: String(r.origin), dest: String(r.dest), count: r.magnitude }));
      this.flows = flows;
      this.flowTotals = { n: tot[0].n, total: tot[0].total, shownSum: flows.reduce((a, r) => a + r.count, 0) };
      this.kpis = kpi[0];
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
    this.detail = null;
    this.notice = null;
    this.stateZones = m.state.zones[version];
    this.trends = null;
    this.history = null;
    this.compareSeries = [];
    if (this.s.panel !== 'closed' && !this.tabs.includes(this.s.panel)) this.s.panel = 'summary';
    this.headlineShown = false;
    await this.loadVersionGeometry();
    void this.refresh();
  }

  /** High and Low exist for forecast years only; switching to one from an annual year moves to its first forecast year. */
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
    Object.assign(this.s, { view: d.view, direction: d.direction, measure: d.measure, dollars: d.dollars, commodities: [], modes: [], topN: d.topN, minFlow: d.minFlow, selected: null });
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
      this.hover = null;
      return;
    }
    if (p.kind === 'location' && p.id) {
      const loc = this.locations.get(p.id);
      this.hover = { x: p.x, y: p.y, lines: [loc?.name ?? p.id, loc?.schematic ? 'Foreign region (schematic position)' : ''].filter(Boolean) };
    } else if (p.kind === 'flow') {
      this.hover = { x: p.x, y: p.y, lines: [`${this.name(p.originId!)} to ${this.name(p.destId!)}`, `${this.fmtMeasure(p.count ?? 0)}`] };
    }
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
    const [partners, commodities, heat] = await Promise.all([
      this.db.query<{ code: string; magnitude: number }>(partnersSql(src, f, this.stateZones, 10)),
      this.db.query<{ code: string; magnitude: number }>(breakdownSql(src, f, this.stateZones, 'sctg2', null, 10)),
      this.db.query<{ commodity: string; mode: number; v: number }>(heatmapSql(src, f, this.stateZones)),
    ]);
    if (id !== this.panelReq) return;
    this.summary = {
      partners: partners.map((r) => ({ code: String(r.code), label: this.name(String(r.code)), magnitude: r.magnitude })),
      commodities: commodities.map((r) => ({ code: String(r.code), label: this.label('sctg2', String(r.code)), magnitude: r.magnitude })),
      modes: this.modeShares,
      heat: heat.map((r) => ({ commodity: String(r.commodity), mode: String(r.mode), v: r.v })),
    };
  }

  private async loadTrends(id: number): Promise<void> {
    const f = this.filter;
    const tbl = await this.allYears(this.s.version);
    const [points, modes] = await Promise.all([
      this.db.query<TrendPoint>(trendSql(tbl, f, this.stateZones)),
      this.db.query<{ year: number; code: number; v: number }>(modeTrendSql(tbl, f, this.stateZones)),
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
    this.trends = { points, modes: modes.map((r) => ({ year: r.year, code: String(r.code), label: this.label('dms_mode', String(r.code)), v: r.v })), other };
  }

  private async loadCompare(id: number): Promise<void> {
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
}

