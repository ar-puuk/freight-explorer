import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { FlowmapLayer } from '@flowmap.gl/layers';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';
import type { ZoneGeoJSON } from './data';
import { mix } from './palette';
import type { Dir, FlowRow, ZoneInfo } from './types';

export const BASEMAPS = ['positron', 'dark', 'liberty', 'bright', 'fiord'] as const;
const STYLE_URL = (name: string) => `https://tiles.openfreemap.org/styles/${name}`;
const NET_SOURCE_LAYER = 'faf5_links';

type Theme = 'light' | 'dark';

/** Colors come from the CSS design tokens, so the map follows the theme and the color-blind palette. Read after the theme is applied. */
function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    accent: v('--accent'), ink: v('--ink'), ink3: v('--ink-3'), line2: v('--line-2'), panel: v('--panel'), mapBg: v('--map-bg'), net: v('--net'),
    dir: { inbound: v('--in'), outbound: v('--out'), within: v('--within') } as Record<Dir, string>,
  };
}



export interface FlowmapPick {
  kind: 'location' | 'flow';
  id?: string;
  originId?: string;
  destId?: string;
  count?: number;
  x: number;
  y: number;
}

export interface MapCallbacks {
  onBasemapFailed: () => void;
  onFlowHover: (pick: FlowmapPick | null) => void;
  onFlowClick: (pick: FlowmapPick) => void;
  onZoneClick: (zoneId: string | null) => void;
  onLinkHover: (props: Record<string, unknown> | null, x: number, y: number) => void;
  onLinkClick: (props: Record<string, unknown>) => void;
  onMoveEnd: (cam: [number, number, number]) => void;
  onMove?: () => void;
  onScale?: (samples: { magnitude: number; thickness: number }[]) => void;
}

let protocolAdded = false;

export class MapView {
  readonly map: maplibregl.Map;
  private overlay: MapboxOverlay;
  private zones: ZoneGeoJSON | null = null;
  private zonesVisible = true;
  private netUrl: string | null = null;
  private netVisible = false;
  private netValues = new Map<number, number>();
  private netVmax = 1;
  private connectors = false;
  private theme: Theme = 'light';
  private home: { center: [number, number]; zoom: number };
  private shade = new Map<string, number>();
  private shadeIds = new Set<string>();
  private locations: ZoneInfo[] = [];
  private flows: FlowRow[] = [];
  private flowsVisible = true;
  private readonly cb: MapCallbacks;
  styleName: string;
  private styleReady = false;
  private fallbackActive = false;
  private styleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(el: HTMLElement, opts: { style: string; theme: Theme; center: [number, number]; zoom: number; callbacks: MapCallbacks }) {
    if (!protocolAdded) {
      maplibregl.setWorkerUrl(maplibreWorkerUrl);
      maplibregl.addProtocol('pmtiles', new Protocol().tile);
      protocolAdded = true;
    }
    this.cb = opts.callbacks;
    this.theme = opts.theme;
    this.styleName = opts.style;
    this.home = { center: opts.center, zoom: opts.zoom };
    this.map = new maplibregl.Map({ container: el, style: STYLE_URL(opts.style), center: opts.center, zoom: opts.zoom, attributionControl: { compact: true } });
    this.overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    this.map.addControl(this.overlay as unknown as maplibregl.IControl);

    // Everything MapLibre owns (sources and layers) disappears on setStyle, so it is re-added here. The deck.gl overlay
    // has its own canvas and survives.
    this.map.on('style.load', () => {
      clearTimeout(this.styleTimer);
      this.styleReady = true;
      this.installLayers();
    });
    // If the basemap cannot load (service down, offline, blocked) the flows and zones still work on a plain background.
    this.map.on('error', (e) => {
      console.warn('map error before the style loaded:', (e as unknown as { error?: Error }).error?.message ?? e);
      if (!this.styleReady && !this.fallbackActive) this.useFallbackStyle();
    });
    this.armStyleTimeout();
    // deck.gl's overlay canvas is not an interactive control: keep it out of the keyboard tab order (the controls and the zone picker are)
    this.map.on('idle', () => document.getElementById('deckgl-overlay')?.setAttribute('tabindex', '-1'));
    this.map.on('moveend', () => {
      const c = this.map.getCenter();
      this.cb.onMoveEnd([c.lng, c.lat, this.map.getZoom()]);
    });
    this.map.on('move', () => this.cb.onMove?.());
    this.map.on('resize', () => this.cb.onMove?.());
    this.map.on('click', (e) => {
      if (this.overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 6 })) return; // a flow or location was hit; its own handler runs
      const link = this.hasLayer('net-lines') && this.map.queryRenderedFeatures(e.point, { layers: ['net-lines'] })[0];
      if (link && this.netVisible) return this.cb.onLinkClick(link.properties ?? {});
      const z = this.hasLayer('zones-fill') && this.map.queryRenderedFeatures(e.point, { layers: ['zones-fill'] })[0];
      this.cb.onZoneClick(z ? String(z.properties?.zone_id) : null);
    });
    this.map.on('mousemove', (e) => {
      if (!this.netVisible || !this.hasLayer('net-lines')) return this.cb.onLinkHover(null, 0, 0);
      const f = this.map.queryRenderedFeatures(e.point, { layers: ['net-lines'] })[0];
      this.map.getCanvas().style.cursor = f ? 'pointer' : '';
      this.cb.onLinkHover(f ? (f.properties ?? {}) : null, e.point.x, e.point.y);
    });
  }

  /**
   * Push the flow layers to the deck.gl overlay. This must also happen before the style has loaded (the overlay needs its first
   * props to initialise; holding them back stalls the map), but when the basemap style failed there is no map projection yet and
   * deck.gl throws, so a failure here is ignored: installLayers() pushes the latest layers again once a style (or the fallback) is in.
   */
  private pushOverlay(): void {
    try {
      this.overlay.setProps({ layers: this.flowLayers() });
    } catch {
      /* retried on the next style.load */
    }
  }

  private hasLayer(id: string): boolean {
    return this.styleReady && !!this.map.getLayer(id);
  }

  private armStyleTimeout(): void {
    clearTimeout(this.styleTimer);
    this.styleTimer = setTimeout(() => {
      if (!this.styleReady && !this.fallbackActive) this.useFallbackStyle();
    }, 10_000);
  }

  private useFallbackStyle(): void {
    this.fallbackActive = true;
    this.styleReady = false;
    const bg = tokens().mapBg;
    this.map.setStyle({ version: 8, sources: {}, layers: [{ id: 'plain-background', type: 'background', paint: { 'background-color': bg } }] });
    this.cb.onBasemapFailed();
  }

  /** First symbol layer of the basemap, so overlays sit under labels. */
  private beforeLabels(): string | undefined {
    return this.map.getStyle()?.layers?.find((l) => l.type === 'symbol')?.id;
  }

  private installLayers(): void {
    if (!this.map.getStyle()) return; // no style yet (or it failed): nothing to attach to; retried on the next style.load
    const before = this.beforeLabels();
    if (this.zones && !this.map.getSource('zones')) {
      this.map.addSource('zones', { type: 'geojson', data: this.zones as unknown as GeoJSON.FeatureCollection, promoteId: 'zone_id' });
      this.map.addLayer(
        { id: 'zones-fill', type: 'fill', source: 'zones', layout: { visibility: this.zonesVisible ? 'visible' : 'none' }, paint: {} },
        before,
      );
      this.map.addLayer(
        { id: 'zones-line', type: 'line', source: 'zones', layout: { visibility: this.zonesVisible ? 'visible' : 'none' }, paint: {} },
        before,
      );
      this.styleZones();
      this.applyShade();
    }
    if (this.netUrl && !this.map.getSource('net')) {
      this.map.addSource('net', { type: 'vector', url: `pmtiles://${this.netUrl}`, promoteId: 'id' });
      this.map.addLayer({ id: 'net-lines', type: 'line', source: 'net', 'source-layer': NET_SOURCE_LAYER, layout: { visibility: this.netVisible ? 'visible' : 'none', 'line-cap': 'round' }, paint: {} }, before);
      this.stylNet();
      this.applyNetValues();
    }
    this.pushOverlay();
  }

  /** State zones in the accent; the zones that trade with the state are tinted by the strength of the link (feature-state `s`, 0 to 1). */
  private styleZones(): void {
    if (!this.hasLayer('zones-fill')) return;
    const t = tokens();
    const s: unknown[] = ['coalesce', ['feature-state', 's'], 0];
    this.map.setPaintProperty('zones-fill', 'fill-color', ['case', ['get', 'is_state_zone'], t.accent, t.accent] as never);
    this.map.setPaintProperty('zones-fill', 'fill-opacity', ['case', ['get', 'is_state_zone'], 0.1, ['+', 0.015, ['*', 0.2, s]]] as never);
    this.map.setPaintProperty('zones-line', 'line-color', ['case', ['get', 'is_state_zone'], t.accent, t.ink3] as never);
    this.map.setPaintProperty('zones-line', 'line-width', ['case', ['get', 'is_state_zone'], 1.5, 0.5] as never);
    this.map.setPaintProperty('zones-line', 'line-opacity', ['case', ['get', 'is_state_zone'], 0.9, 0.45] as never);
  }

  /** Strength of each zone's link with the state, as shares of the largest (0 to 1). Cleared and re-applied on every query. */
  setZoneShading(values: Map<string, number>): void {
    this.shade = values;
    this.applyShade();
  }

  private applyShade(): void {
    if (!this.styleReady || !this.map.getSource('zones')) return;
    for (const id of this.shadeIds) this.map.removeFeatureState({ source: 'zones', id });
    this.shadeIds = new Set(this.shade.keys());
    for (const [id, s] of this.shade) this.map.setFeatureState({ source: 'zones', id }, { s });
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.styleZones();
    this.stylNet();
    this.pushOverlay();
  }

  // ---- camera helpers for the custom map controls
  zoomBy(d: number): void {
    this.map.easeTo({ zoom: this.map.getZoom() + d, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250 });
  }

  goHome(): void {
    this.map.flyTo({ center: this.home.center, zoom: this.home.zoom, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600 });
  }

  /** Screen position of a lon/lat inside the map element, and the element size (for edge labels). */
  project(lon: number, lat: number): { x: number; y: number } {
    const p = this.map.project([lon, lat]);
    return { x: p.x, y: p.y };
  }

  get size(): { w: number; h: number } {
    const c = this.map.getContainer();
    return { w: c.clientWidth, h: c.clientHeight };
  }

  setBasemap(name: string): void {
    if (name === this.styleName && !this.fallbackActive) return;
    this.styleName = name;
    this.fallbackActive = false; // an explicit choice tries the real basemap again
    this.styleReady = false;
    this.map.setStyle(STYLE_URL(name));
    this.armStyleTimeout();
  }

  // ---- zones
  setZones(zones: ZoneGeoJSON): void {
    this.zones = zones;
    if (!this.styleReady) return; // installed when the style (or the fallback) loads
    const src = this.map.getSource('zones') as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(zones as unknown as GeoJSON.FeatureCollection);
    else this.installLayers();
  }

  setZonesVisible(v: boolean): void {
    this.zonesVisible = v;
    for (const id of ['zones-fill', 'zones-line']) if (this.hasLayer(id)) this.map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none');
  }

  // ---- flows (deck.gl + flowmap.gl)
  setFlows(locations: ZoneInfo[], flows: FlowRow[]): void {
    this.locations = locations;
    this.flows = flows;
    this.pushOverlay();
  }

  setFlowsVisible(v: boolean): void {
    this.flowsVisible = v;
    this.pushOverlay();
  }

  private flowLayers() {
    if (!this.flowsVisible || !this.flows.length) return [];
    const t = tokens();
    const dark = this.theme === 'dark';
    const pick = (info: unknown): FlowmapPick | null => {
      const i = info as { object?: Record<string, any>; x: number; y: number } | undefined;
      const o = i?.object;
      if (!o) return null;
      if (o.type === 'location') return { kind: 'location', id: String(o.id), x: i!.x, y: i!.y };
      if (o.type === 'flow') return { kind: 'flow', originId: String(o.origin.id ?? o.origin.zone_id), destId: String(o.dest.id ?? o.dest.zone_id), count: o.count, x: i!.x, y: i!.y };
      return null;
    };
    // One layer per direction so inbound, outbound and within carry their own hue. A shared scale lock keeps arc widths comparable
    // across the three layers, and a fourth layer draws the zone circles (location totals) from every flow without drawing arcs.
    // zone-to-itself flows are drawn as the zone circle, not as an arc, so they must not set the arc width scale
    const max = Math.max(1, ...this.flows.filter((f) => f.origin !== f.dest).map((f) => f.count));
    const base = {
      pickable: true,
      opacity: 0.95,
      darkMode: dark,
      clusteringEnabled: false,
      fadeAmount: 12,
      adaptiveScalesEnabled: false,
      scaleLock: { enabled: true, domains: { flowMagnitude: [0, max] as [number, number], locationTotals: [0, max * 1.6] as [number, number] } },
      maxTopFlowsDisplayNum: 500,
      getLocationId: (l: ZoneInfo) => l.id,
      getLocationName: (l: ZoneInfo) => l.name,
      getLocationLat: (l: ZoneInfo) => l.lat,
      getLocationLon: (l: ZoneInfo) => l.lon,
      getFlowOriginId: (f: FlowRow) => f.origin,
      getFlowDestId: (f: FlowRow) => f.dest,
      getFlowMagnitude: (f: FlowRow) => f.count,
      onHover: (info: unknown) => this.cb.onFlowHover(pick(info)),
      onClick: (info: unknown) => {
        const p = pick(info);
        if (p) this.cb.onFlowClick(p);
      },
    };
    const ramp = (c: string): string[] => [mix(c, dark ? '#10161d' : '#ffffff', dark ? 0.55 : 0.6), c];
    let reported = false;
    const layers = (['within', 'outbound', 'inbound'] as Dir[]).flatMap((d) => {
      const flows = this.flows.filter((f) => (f.dir ?? 'inbound') === d);
      if (!flows.length) return [];
      // the three layers share one locked scale, so one of them reports the width legend
      const report = reported
        ? undefined
        : (st: { flowThickness?: { samples: { magnitude: number; thickness: number }[] } } | undefined) => this.cb.onScale?.((st?.flowThickness?.samples ?? []).map((x) => ({ magnitude: x.magnitude, thickness: x.thickness })));
      reported = true;
      return [new FlowmapLayer({ ...base, id: `flowmap-${d}`, data: { locations: this.locations, flows }, colorScheme: ramp(t.dir[d]), locationsEnabled: false, locationTotalsEnabled: false, onScaleChange: report } as never)];
    });
    return [...layers, ...this.nodeLayers(t, pick)];
  }

  /** Zone circles sized by the flow that touches them (state zones in the accent), with names for the largest and the state's own zones. */
  private nodeLayers(t: ReturnType<typeof tokens>, pick: (info: unknown) => FlowmapPick | null) {
    const total = new Map<string, number>();
    for (const f of this.flows) {
      total.set(f.origin, (total.get(f.origin) ?? 0) + f.count);
      if (f.dest !== f.origin) total.set(f.dest, (total.get(f.dest) ?? 0) + f.count);
    }
    const byId = new Map(this.locations.map((l) => [l.id, l]));
    const max = Math.max(1, ...total.values());
    const nodes = [...total.entries()].flatMap(([id, v]) => {
      const l = byId.get(id);
      return l ? [{ id, name: l.name, lon: l.lon, lat: l.lat, v, r: 5 + 13 * Math.sqrt(v / max), state: l.is_state_zone }] : [];
    });
    const rgba = (hex: string, a: number): [number, number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), Math.round(a * 255)];
    const labeled = nodes.filter((n) => n.state).concat([...nodes].filter((n) => !n.state).sort((a, b) => b.v - a.v).slice(0, 7));
    return [
      new ScatterplotLayer({
        id: 'nodes', data: nodes, pickable: true, radiusUnits: 'pixels', lineWidthUnits: 'pixels', stroked: true, filled: true,
        getPosition: (n: { lon: number; lat: number }) => [n.lon, n.lat],
        getRadius: (n: { r: number }) => n.r,
        getFillColor: (n: { state: boolean }) => (n.state ? rgba(t.accent, 0.2) : rgba(t.panel, 0.92)),
        getLineColor: (n: { state: boolean }) => rgba(n.state ? t.accent : t.ink3, 1),
        getLineWidth: 1.8,
        onHover: (info: unknown) => {
          const o = (info as { object?: { id: string }; x: number; y: number }).object;
          this.cb.onFlowHover(o ? { kind: 'location', id: o.id, x: (info as { x: number }).x, y: (info as { y: number }).y } : null);
        },
        onClick: (info: unknown) => {
          const o = (info as { object?: { id: string } }).object;
          if (o) this.cb.onFlowClick({ kind: 'location', id: o.id, x: 0, y: 0 });
        },
      } as never),
      new TextLayer({
        id: 'node-labels', data: labeled, pickable: false, getPosition: (n: { lon: number; lat: number }) => [n.lon, n.lat], getText: (n: { name: string }) => n.name,
        getSize: 12, getColor: rgba(t.ink, 1), getTextAnchor: 'start', getAlignmentBaseline: 'center',
        getPixelOffset: (n: { r: number }) => [n.r + 6, 0], fontFamily: '"Instrument Sans", system-ui, sans-serif', fontWeight: 600,
        outlineWidth: 3, outlineColor: rgba(t.mapBg, 0.95), fontSettings: { sdf: true },
      } as never),
    ];
  }

  fitTo(ids: string[]): void {
    const pts = this.locations.filter((l) => ids.includes(l.id));
    if (!pts.length) return;
    const b = new maplibregl.LngLatBounds([pts[0].lon, pts[0].lat], [pts[0].lon, pts[0].lat]);
    for (const p of pts) b.extend([p.lon, p.lat]);
    this.map.fitBounds(b, { padding: 80, maxZoom: 7, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600 });
  }

  // ---- network (PMTiles + feature-state join)
  setNetworkSource(url: string): void {
    this.netUrl = url;
    if (this.styleReady) this.installLayers();
  }

  setNetwork(opts: { visible: boolean; connectors: boolean; values?: Map<number, number> }): void {
    this.netVisible = opts.visible;
    this.connectors = opts.connectors;
    if (opts.values) {
      this.netValues = opts.values;
      this.netVmax = Math.max(1, ...opts.values.values());
    }
    if (!this.hasLayer('net-lines')) return;
    this.map.setLayoutProperty('net-lines', 'visibility', opts.visible ? 'visible' : 'none');
    this.stylNet();
    if (opts.values) this.applyNetValues();
  }

  private stylNet(): void {
    if (!this.hasLayer('net-lines')) return;
    const t = tokens();
    const ramp = [mix(t.net, t.mapBg, 0.7), t.net];
    const v: unknown[] = ['coalesce', ['feature-state', 'v'], 0];
    const root = ['sqrt', v];
    const w = (scale: number) => ['interpolate', ['linear'], root, 0, 0.5 * scale, Math.sqrt(this.netVmax), 5 * scale];
    this.map.setPaintProperty('net-lines', 'line-width', ['interpolate', ['exponential', 1.6], ['zoom'], 4, w(0.45), 12, w(2.4)] as never);
    this.map.setPaintProperty('net-lines', 'line-color', ['case', ['>', v, 0], ['interpolate', ['linear'], root, 0, ramp[0], Math.sqrt(this.netVmax), ramp[1]], t.line2] as never);
    this.map.setPaintProperty('net-lines', 'line-opacity', ['case', ['>', v, 0], 0.9, 0.55] as never);
    // centroid connectors (road class 50) are model access links, not roads; hidden unless asked for
    this.map.setFilter('net-lines', this.connectors ? null : ['!=', ['get', 'cls'], 50]);
  }

  private applyNetValues(): void {
    if (!this.styleReady || !this.map.getSource('net')) return;
    this.map.removeFeatureState({ source: 'net', sourceLayer: NET_SOURCE_LAYER });
    for (const [id, v] of this.netValues) this.map.setFeatureState({ source: 'net', sourceLayer: NET_SOURCE_LAYER, id }, { v });
  }

  getCamera(): [number, number, number] {
    const c = this.map.getCenter();
    return [c.lng, c.lat, this.map.getZoom()];
  }

  destroy(): void {
    this.map.remove();
  }
}
