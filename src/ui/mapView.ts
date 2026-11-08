/** Mapa MapLibre GL + OpenFreeMap (OSM, gratuito, sem chave) com camadas táticas. */
import * as maplibregl from 'maplibre-gl';
import { setWorkerUrl, type GeoJSONSource, type Map as MLMap, type Marker } from 'maplibre-gl';
import maplibreglWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { FeatureCollection, Geometry } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';

// Configura explicitamente o worker URL exportado pelo Vite
setWorkerUrl(maplibreglWorkerUrl);
import { circlePolygon, destination, type LngLat } from '../engine/geo';
import { zoneColor, type ScoredZone } from '../engine/veteranBrain';
import { REPORT_META, type Opportunity, type TrafficReport } from '../engine/types';
import type { DangerZone } from '../engine/safetyZones';
import type { GnvStation } from '../engine/gnvTracker';
import { hhmm } from '../engine/eventDetector';
import type { Route } from '../nav/osrm';
import { carSvg } from './icons';

const DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function hexagon(center: LngLat, radiusM: number): LngLat[] {
  const ring: LngLat[] = [];
  for (let i = 0; i <= 6; i++) ring.push(destination(center, 30 + i * 60, radiusM));
  return ring;
}

export class MapView {
  map: MLMap;
  ready: Promise<void>;
  follow = true;
  currentTheme: 'dark' | 'light' = 'dark';
  private car: Marker;
  private dest: Marker | null = null;
  private reportMarkers = new Map<string, Marker>();
  private eventMarkers = new Map<string, Marker>();
  private stationMarkers = new Map<string, Marker>();
  private lastZones: ScoredZone[] = [];
  private lastDangerZones: DangerZone[] = [];
  private lastRoute: { route: Route | null; color: string } | null = null;
  private lastAlternatives: { routes: Route[]; selected: number } | null = null;
  onLongPress?: (p: LngLat, screen: { x: number; y: number }) => void;
  onUserPan?: () => void;
  onReportClick?: (report: TrafficReport) => void;

  constructor(container: string, center: LngLat) {
    this.map = new maplibregl.Map({
      container,
      style: DARK_STYLE,
      center,
      zoom: 13,
      attributionControl: { compact: true },
      pitchWithRotate: true,
    });
    const el = document.createElement('div');
    el.className = 'car-marker';
    el.innerHTML = carSvg;
    this.car = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(center).addTo(this.map);

    this.ready = new Promise((resolve) => this.map.on('load', () => { this.setupLayers(); resolve(); }));

    this.map.on('dragstart', () => { this.follow = false; this.onUserPan?.(); });
    this.map.on('contextmenu', (e) => this.onLongPress?.([e.lngLat.lng, e.lngLat.lat], e.point));
    let pressTimer: number | null = null;
    this.map.on('touchstart', (e) => {
      if (e.originalEvent.touches.length !== 1) return;
      pressTimer = window.setTimeout(() => this.onLongPress?.([e.lngLat.lng, e.lngLat.lat], e.point), 650);
    });
    const cancel = () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; };
    this.map.on('touchend', cancel);
    this.map.on('touchmove', cancel);
    this.map.on('touchcancel', cancel);
  }

  setTheme(theme: 'dark' | 'light') {
    if (this.currentTheme === theme) return;
    this.currentTheme = theme;
    const styleUrl = theme === 'light' ? LIGHT_STYLE : DARK_STYLE;
    this.map.setStyle(styleUrl);
    this.map.once('style.load', () => {
      this.setupLayers();
      if (this.lastZones.length) this.setZones(this.lastZones);
      if (this.lastDangerZones.length) this.setDangerZones(this.lastDangerZones);
      if (this.lastRoute) this.setRoute(this.lastRoute.route, this.lastRoute.color);
      if (this.lastAlternatives) this.setAlternatives(this.lastAlternatives.routes, this.lastAlternatives.selected);
    });
  }

  private setupLayers() {
    const m = this.map;
    m.addSource('zones', { type: 'geojson', data: EMPTY });
    m.addSource('zone-pts', { type: 'geojson', data: EMPTY });
    m.addSource('route', { type: 'geojson', data: EMPTY });
    m.addSource('route-alt', { type: 'geojson', data: EMPTY });
    m.addSource('danger-zones', { type: 'geojson', data: EMPTY });
    m.addSource('danger-pts', { type: 'geojson', data: EMPTY });

    m.addLayer({
      id: 'danger-zones-fill',
      type: 'fill',
      source: 'danger-zones',
      paint: { 'fill-color': '#ef4444', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.28, 14, 0.12] },
    });
    m.addLayer({
      id: 'danger-zones-line',
      type: 'line',
      source: 'danger-zones',
      paint: { 'line-color': '#dc2626', 'line-width': 1.8, 'line-dasharray': [3, 2], 'line-opacity': 0.85 },
    });

    m.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.45, 15, 0.18] } });
    m.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.8 } });
    m.addLayer({ id: 'route-alt', type: 'line', source: 'route-alt', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#64748b', 'line-width': 7, 'line-opacity': 0.8 } });
    m.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0b1220', 'line-width': 13 } });
    m.addLayer({ id: 'route-main', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['coalesce', ['get', 'color'], '#3b82f6'], 'line-width': 8 } });
    m.addLayer({
      id: 'zones-label', type: 'symbol', source: 'zone-pts', minzoom: 11.5,
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': false, 'text-max-width': 9 },
      paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1.6 },
    });
    m.addLayer({
      id: 'danger-zones-label',
      type: 'symbol',
      source: 'danger-pts',
      minzoom: 11.5,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 11,
        'text-allow-overlap': false,
        'text-max-width': 10,
      },
      paint: { 'text-color': '#fca5a5', 'text-halo-color': '#000', 'text-halo-width': 1.6 },
    });
    m.on('click', 'route-alt', (e) => {
      const idx = e.features?.[0]?.properties?.idx;
      if (idx != null) this.onAltClick?.(Number(idx));
    });
  }

  onAltClick?: (idx: number) => void;

  setDangerZones(zones: DangerZone[]) {
    this.lastDangerZones = zones;
    const polys: FeatureCollection = {
      type: 'FeatureCollection',
      features: zones.map((z) => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [circlePolygon(z.center, z.radiusMeters)] },
        properties: { id: z.id, name: z.name },
      })),
    };
    const pts: FeatureCollection = {
      type: 'FeatureCollection',
      features: zones.map((z) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: z.center },
        properties: { label: `🛡️ ${z.neighborhood}` },
      })),
    };
    (this.map.getSource('danger-zones') as GeoJSONSource | undefined)?.setData(polys);
    (this.map.getSource('danger-pts') as GeoJSONSource | undefined)?.setData(pts);
  }

  setZones(zones: ScoredZone[]) {
    this.lastZones = zones;
    const fc = (geom: (z: ScoredZone) => Geometry, label = false): FeatureCollection => ({
      type: 'FeatureCollection',
      features: zones.map((z) => ({
        type: 'Feature',
        geometry: geom(z),
        properties: {
          id: z.zone.id,
          color: zoneColor(z.potential),
          ...(label ? { label: `${z.potential.toFixed(1)} · ${z.zone.name}` } : {}),
        },
      })),
    });
    (this.map.getSource('zones') as GeoJSONSource | undefined)?.setData(fc((z) => ({ type: 'Polygon', coordinates: [hexagon(z.zone.pos, 420)] })));
    (this.map.getSource('zone-pts') as GeoJSONSource | undefined)?.setData(fc((z) => ({ type: 'Point', coordinates: z.zone.pos }), true));
  }

  setRoute(route: Route | null, color = '#3b82f6') {
    this.lastRoute = { route, color };
    const data: FeatureCollection = route
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: route.geometry }, properties: { color } }] }
      : EMPTY;
    (this.map.getSource('route') as GeoJSONSource | undefined)?.setData(data);
    if (this.dest) { this.dest.remove(); this.dest = null; }
    if (route) {
      const el = document.createElement('div');
      el.className = 'dest-marker';
      el.textContent = '🏁';
      this.dest = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(route.geometry[route.geometry.length - 1]).addTo(this.map);
    }
  }

  setAlternatives(routes: Route[], selected: number) {
    this.lastAlternatives = { routes, selected };
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: routes
        .map((r, idx) => ({ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: r.geometry }, properties: { idx } }))
        .filter((f) => f.properties.idx !== selected),
    };
    (this.map.getSource('route-alt') as GeoJSONSource | undefined)?.setData(routes.length ? data : EMPTY);
  }

  fitRoute(route: Route) {
    const b = new maplibregl.LngLatBounds();
    route.geometry.forEach((c) => b.extend(c));
    this.follow = false;
    this.map.fitBounds(b, { padding: { top: 140, bottom: 320, left: 40, right: 40 }, bearing: 0, pitch: 0, duration: 800 });
  }

  updateCar(pos: LngLat, heading: number | null, speedMps: number, navigating: boolean) {
    this.car.setLngLat(pos);
    if (heading != null) this.car.setRotation(heading);
    if (!this.follow) return;
    if (navigating) {
      const zoom = speedMps > 22 ? 15.3 : speedMps > 14 ? 16 : 16.8;
      this.map.easeTo({
        center: pos, bearing: heading ?? this.map.getBearing(), pitch: 55, zoom,
        padding: { top: Math.round(window.innerHeight * 0.38), bottom: 0, left: 0, right: 0 }, duration: 900, easing: (t) => t,
      });
    } else {
      this.map.easeTo({ center: pos, bearing: 0, pitch: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 700 });
    }
  }

  recenter(pos: LngLat, navigating: boolean) {
    this.follow = true;
    if (!navigating) this.map.easeTo({ center: pos, zoom: Math.max(this.map.getZoom(), 14), bearing: 0, pitch: 0, duration: 600 });
  }

  setReports(reports: TrafficReport[], onClick?: (r: TrafficReport) => void) {
    const ids = new Set(reports.map((r) => r.id));
    for (const [id, mk] of this.reportMarkers) if (!ids.has(id)) { mk.remove(); this.reportMarkers.delete(id); }
    for (const r of reports) {
      if (this.reportMarkers.has(r.id)) continue;
      const el = document.createElement('div');
      el.className = 'report-marker';
      el.style.borderColor = REPORT_META[r.type].color;
      el.style.cursor = 'pointer';
      el.textContent = REPORT_META[r.type].emoji;
      el.title = `${REPORT_META[r.type].label} — ${r.street} (Clique para gerenciar/remover)`;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        (onClick || this.onReportClick)?.(r);
      });
      this.reportMarkers.set(r.id, new maplibregl.Marker({ element: el }).setLngLat(r.pos).addTo(this.map));
    }
  }

  setEvents(events: Opportunity[], onClick: (e: Opportunity) => void) {
    for (const mk of this.eventMarkers.values()) mk.remove();
    this.eventMarkers.clear();
    for (const e of events) {
      const el = document.createElement('div');
      el.className = 'event-marker';
      el.innerHTML = `🎤<span>${hhmm(e.goldenArrival)}</span>`;
      el.title = e.title;
      el.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(e); });
      this.eventMarkers.set(e.id, new maplibregl.Marker({ element: el }).setLngLat(e.escape).addTo(this.map));
    }
  }

  setGasStations(stations: GnvStation[], onClick?: (s: GnvStation) => void) {
    for (const mk of this.stationMarkers.values()) mk.remove();
    this.stationMarkers.clear();
    for (const s of stations) {
      const el = document.createElement('div');
      el.className = 'station-marker';
      el.style.cursor = 'pointer';
      el.innerHTML = `⛽<span>R$ ${s.pricePerM3.toFixed(2)}</span>`;
      el.title = `${s.name} · ${s.pressureBar} bar ${s.isOpen24h ? '(24h)' : ''} · ${s.address}`;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onClick?.(s);
      });
      this.stationMarkers.set(s.id, new maplibregl.Marker({ element: el }).setLngLat(s.pos).addTo(this.map));
    }
  }
}
