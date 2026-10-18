import { MapboxOverlay } from '@deck.gl/mapbox';
import { FlowmapLayer } from '@flowmap.gl/layers';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';
import type { ZoneGeoJSON } from './data';
import type { FlowRow, ZoneInfo } from './types';

export const BASEMAPS = ['positron', 'dark', 'liberty', 'bright', 'fiord'] as const;
const STYLE_URL = (name: string) => `https://tiles.openfreemap.org/styles/${name}`;
const NET_SOURCE_LAYER = 'faf5_links';

type Theme = 'light' | 'dark';

const PALETTE = {
  light: { stateFill: '#1b6a8a', otherFill: '#6b7280', stateLine: '#14536d', otherLine: '#8a8f98', noFlow: '#a3a8b0', ramp: ['#f6a35c', '#c2410c'] },
  dark: { stateFill: '#4fb3d9', otherFill: '#9aa3af', stateLine: '#7cc7e6', otherLine: '#6b7280', noFlow: '#6b7280', ramp: ['#fdba74', '#ea580c'] },
} as const;

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
    this.map = new maplibregl.Map({ container: el, style: STYLE_URL(opts.style), center: opts.center, zoom: opts.zoom, attributionControl: { compact: true } });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
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
    const bg = this.theme === 'dark' ? '#1b2027' : '#eceff1';
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
    const p = PALETTE[this.theme];
    if (this.zones && !this.map.getSource('zones')) {
      this.map.addSource('zones', { type: 'geojson', data: this.zones as unknown as GeoJSON.FeatureCollection });
      this.map.addLayer(
        {
          id: 'zones-fill', type: 'fill', source: 'zones',
          layout: { visibility: this.zonesVisible ? 'visible' : 'none' },
          paint: { 'fill-color': ['case', ['get', 'is_state_zone'], p.stateFill, p.otherFill], 'fill-opacity': ['case', ['get', 'is_state_zone'], 0.16, 0.05] },
        },
        before,
      );
      this.map.addLayer(
        {
          id: 'zones-line', type: 'line', source: 'zones',
          layout: { visibility: this.zonesVisible ? 'visible' : 'none' },
          paint: { 'line-color': ['case', ['get', 'is_state_zone'], p.stateLine, p.otherLine], 'line-width': ['case', ['get', 'is_state_zone'], 1.6, 0.6], 'line-opacity': 0.8 },
        },
        before,
      );
    }
    if (this.netUrl && !this.map.getSource('net')) {
      this.map.addSource('net', { type: 'vector', url: `pmtiles://${this.netUrl}`, promoteId: 'id' });
      this.map.addLayer({ id: 'net-lines', type: 'line', source: 'net', 'source-layer': NET_SOURCE_LAYER, layout: { visibility: this.netVisible ? 'visible' : 'none', 'line-cap': 'round' }, paint: {} }, before);
      this.stylNet();
      this.applyNetValues();
    }
    this.pushOverlay();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    const p = PALETTE[theme];
    if (this.hasLayer('zones-fill')) {
      this.map.setPaintProperty('zones-fill', 'fill-color', ['case', ['get', 'is_state_zone'], p.stateFill, p.otherFill]);
      this.map.setPaintProperty('zones-line', 'line-color', ['case', ['get', 'is_state_zone'], p.stateLine, p.otherLine]);
    }
    this.stylNet();
    this.pushOverlay();
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
    const pick = (info: unknown): FlowmapPick | null => {
      const i = info as { object?: Record<string, any>; x: number; y: number } | undefined;
      const o = i?.object;
      if (!o) return null;
      if (o.type === 'location') return { kind: 'location', id: String(o.id), x: i!.x, y: i!.y };
      if (o.type === 'flow') return { kind: 'flow', originId: String(o.origin.id ?? o.origin.zone_id), destId: String(o.dest.id ?? o.dest.zone_id), count: o.count, x: i!.x, y: i!.y };
      return null;
    };
    return [
      new FlowmapLayer({
        id: 'flowmap',
        data: { locations: this.locations, flows: this.flows },
        pickable: true,
        opacity: 0.95,
        darkMode: this.theme === 'dark',
        colorScheme: 'Teal',
        clusteringEnabled: false,
        fadeAmount: 12,
        adaptiveScalesEnabled: true,
        locationTotalsEnabled: true,
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
    const p = PALETTE[this.theme];
    const v: unknown[] = ['coalesce', ['feature-state', 'v'], 0];
    const root = ['sqrt', v];
    const w = (scale: number) => ['interpolate', ['linear'], root, 0, 0.5 * scale, Math.sqrt(this.netVmax), 5 * scale];
    this.map.setPaintProperty('net-lines', 'line-width', ['interpolate', ['exponential', 1.6], ['zoom'], 4, w(0.45), 12, w(2.4)] as never);
    this.map.setPaintProperty('net-lines', 'line-color', ['case', ['>', v, 0], ['interpolate', ['linear'], root, 0, p.ramp[0], Math.sqrt(this.netVmax), p.ramp[1]], p.noFlow] as never);
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
