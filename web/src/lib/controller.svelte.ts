import { formatMeasure } from './format';
import { Db, loadHeadline, loadLocations, loadMeta, loadZones, productKey, yearsFor, type Meta, type ZoneGeoJSON } from './data';
import { MapView, type FlowmapPick } from './mapview';
import { balanceSql, breakdownSql, flowsSql, flowTotalsSql, kpiSql, measureColumn, modeSharesSql, pairBreakdownSql, type FlowFilter } from './sql';
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

const NET_YEARS_FALLBACK = [2017, 2022, 2050];

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
  available = $state({ tmiles: true, current: true });
  notice = $state<string | null>(null);
  detail = $state<Detail | null>(null);
  hover = $state<{ x: number; y: number; lines: string[] } | null>(null);
  linkCount = $state<number | null>(null);
  headlineShown = $state(false);

  locations = new Map<string, ZoneInfo>();
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
    const versions = Object.values(m.versions.products).map((p) => p.faf_version);
    const first = Object.values(m.versions.products).find((p) => p.faf_version === '5.7.1') ?? Object.values(m.versions.products)[0];
    const netYears = m.versions.network ? Object.keys(m.versions.network.years).map(Number).sort((a, b) => a - b) : NET_YEARS_FALLBACK;
    this.defaults = {
      version: first.faf_version, scenario: 'mid', year: first.default_year, view: 'total', direction: 'both', measure: 'tons', dollars: 'const',
      commodities: [], modes: [], topN: 50, minFlow: 0, selected: null,
      layers: { flows: true, network: false, zones: true }, net: { year: netYears[0], truck: 'all', market: 'total', connectors: false },
      basemap: null, theme: 'system', cam: null,
    };
    this.allowed = {
      versions,
      years: (v) => yearsFor(m, v),
      defaultYear: (v) => m.versions.products[productKey(m, v)].default_year,
      netYears,
    };
    this.s = decode(location.search, this.defaults, this.allowed);
    this.stateZones = m.state.zones[this.s.version];
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
  get benchmarkYear(): number {
    return this.meta!.versions.products[this.product].benchmark_year;
  }
  get yearList(): number[] {
    return yearsFor(this.meta!, this.s.version);
  }
  get dataVersionOfYear(): string {
    return this.meta!.versions.products[this.product].years[String(this.s.year)];
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
    return s.version === d.version && s.year === d.year && s.view === 'total' && s.direction === 'both' && s.measure === 'tons' && !s.commodities.length && !s.modes.length && !s.selected && s.topN === 50 && s.minFlow === 0;
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
      this.available = { tmiles: avail.tmiles_m != null, current: avail.value_current_musd != null };
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
    this.s.year = this.allowed.defaultYear(version);
    this.s.selected = null;
    this.detail = null;
    this.notice = null;
    this.stateZones = m.state.zones[version];
    this.headlineShown = false;
    await this.loadVersionGeometry();
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
    return encode(this.s, this.defaults, this.allowed.defaultYear);
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

  // ---- formatting helpers bound to the current state
  fmtMeasure(v: number | null | undefined): string {
    return formatMeasure(this.s.measure, v, this.s.dollars, this.benchmarkYear);
  }
  get measureColumn(): string {
    return measureColumn(this.s.measure, this.s.dollars);
  }
}

