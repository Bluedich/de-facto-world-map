import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { BASEMAPS, OVERLAYS, DEM, byId, wmsTemplate, CONTROL_COLORS } from '../catalog.js';
import { RELATION_COLOR, relationExpression } from '../relations.js';

maplibregl.setWorkerUrl(workerUrl);

const styleCache = new Map();
async function fetchStyle(url) {
  if (!styleCache.has(url)) {
    styleCache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }).catch((e) => { styleCache.delete(url); throw e; }));
  }
  return structuredClone(await styleCache.get(url));
}

function rasterSource(l) {
  return {
    type: 'raster',
    tiles: [l.kind === 'wms' ? wmsTemplate(l) : l.url.replace('{bbox}', '{bbox-epsg-3857}')],
    tileSize: 256,
    maxzoom: l.maxzoom ?? 19,
    attribution: l.attribution,
  };
}

const abs = (path) => new URL(import.meta.env.BASE_URL + path, location.href).href;

// Selection context (see relations.js) or null. Points keep their own colour; points the entity controls
// get a white outline, related points an outline in the relation colour; all others are dimmed.
let selection = null;
const DRC_POINTS = 'ov-drc-control-points';

function drcStyle(sel) {
  if (!sel) {
    return {
      paint: {
        'circle-color': ['get', 'color'],
        'circle-opacity': ['match', ['get', 'confidence'], 'low', 0.55, 0.9],
        'circle-stroke-color': '#222', 'circle-stroke-width': 0.4,
      },
      layout: { 'circle-sort-key': 0 },
    };
  }
  const rel = relationExpression(sel);
  const isSel = ['==', ['get', 'id'], sel.id ?? ''];
  return {
    paint: {
      'circle-color': ['get', 'color'],
      'circle-opacity': ['match', rel, 'none', 0.12, 1],
      'circle-stroke-color': ['match', rel,
        ...Object.entries(RELATION_COLOR).filter(([, c]) => c).flat(), '#ffffff'],
      'circle-stroke-width': ['case', isSel, 3, ['match', rel, 'controlled', 1.2, 'none', 0, 2]],
    },
    layout: { 'circle-sort-key': ['case', isSel, 3, ['match', rel, 'controlled', 2, 'none', 0, 1]] },
  };
}

// Returns { sources, layers } for one overlay. Layer ids are prefixed "ov-".
function overlayParts(o, state) {
  const sources = {};
  const layers = [];
  const src = `ov-${o.id}`;
  switch (o.kind) {
    case 'hillshade':
      layers.push({
        id: src, type: 'hillshade', source: 'dem',
        paint: { 'hillshade-exaggeration': 0.5, 'hillshade-shadow-color': '#3d3d3d', 'hillshade-illumination-anchor': 'map' },
      });
      break;
    case 'colorrelief':
      layers.push({
        id: src, type: 'color-relief', source: 'dem',
        paint: {
          'color-relief-opacity': o.opacity,
          'color-relief-color': ['interpolate', ['linear'], ['elevation'],
            -8000, '#08306b', -2000, '#2171b5', -200, '#9ecae1', 0, '#a1d99b',
            300, '#c7e9a5', 800, '#f2e2a0', 1500, '#d9a86c', 2500, '#a0663b', 4000, '#ffffff'],
        },
      });
      break;
    case 'xyz':
    case 'wms':
    case 'bbox':
      sources[src] = rasterSource(o);
      layers.push({ id: src, type: 'raster', source: src, paint: { 'raster-opacity': o.opacity ?? 1 } });
      break;
    case 'geojson':
      o.files.forEach((f, i) => {
        sources[`${src}-${i}`] = { type: 'geojson', data: abs(f), attribution: o.attribution };
      });
      if (o.id === 'rivers') {
        layers.push(
          { id: `${src}-lakes`, type: 'fill', source: `${src}-0`, paint: { 'fill-color': '#5b9bd5', 'fill-opacity': 0.7 } },
          {
            id: `${src}-lines`, type: 'line', source: `${src}-1`,
            paint: {
              'line-color': '#2b6cb0',
              'line-width': ['interpolate', ['linear'], ['zoom'], 2, ['-', 2, ['*', 0.15, ['get', 'scalerank']]], 8, 2.5],
            },
          },
        );
      } else if (o.id === 'drc-control') {
        const { paint, layout } = drcStyle(selection);
        layers.push({
          id: `${src}-points`, type: 'circle', source: `${src}-0`, layout,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'],
              4, ['interpolate', ['linear'], ['get', 'population'], 1000, 1.5, 100000, 4, 1000000, 8],
              10, ['interpolate', ['linear'], ['get', 'population'], 1000, 4, 100000, 9, 1000000, 16]],
            ...paint,
          },
        });
      } else {
        layers.push(
          {
            id: `${src}-fill`, type: 'fill', source: `${src}-0`,
            paint: { 'fill-color': ['to-color', ['at', ['coalesce', ['get', 'mapcolor7'], 0], ['literal', CONTROL_COLORS]]], 'fill-opacity': 0.35 },
          },
          { id: `${src}-line`, type: 'line', source: `${src}-0`, paint: { 'line-color': '#222', 'line-width': 0.8 } },
        );
      }
      break;
  }
  return { sources, layers };
}

async function buildStyle(state, onFallback) {
  let base = byId(BASEMAPS, state.base) || BASEMAPS[0];
  let style;
  if (base.kind === 'style') {
    try {
      style = await fetchStyle(base.url);
    } catch (e) {
      const fb = byId(BASEMAPS, base.fallback);
      onFallback?.(`Could not load ${base.name} (${e.message}); using ${fb.name}.`);
      base = fb;
    }
  }
  if (!style) {
    style = {
      version: 8,
      sources: { base: rasterSource(base) },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#0b1a2b' } },
        { id: 'base', type: 'raster', source: 'base' },
      ],
    };
  }

  // Separate DEM sources for terrain and for hillshade/tint, as MapLibre recommends.
  const dem = {
    type: 'raster-dem', tiles: [DEM.url], encoding: DEM.encoding, tileSize: 256, maxzoom: DEM.maxzoom,
    attribution: DEM.attribution,
  };
  style.sources.dem = dem;
  style.sources['dem-terrain'] = { ...dem };

  // Insert overlays below the first symbol (label) layer so labels stay readable.
  const firstSymbol = style.layers.findIndex((l) => l.type === 'symbol');
  const at = firstSymbol === -1 ? style.layers.length : firstSymbol;
  const added = [];
  for (const id of state.overlays) {
    const o = byId(OVERLAYS, id);
    if (!o) continue;
    const { sources, layers } = overlayParts(o, state);
    Object.assign(style.sources, sources);
    // Reference labels belong above everything else.
    if (o.id === 'labels') style.layers.push(...layers);
    else added.push(...layers);
  }
  style.layers.splice(at, 0, ...added);

  style.projection = { type: state.globe ? 'globe' : 'mercator' };
  style.terrain = state.terrain ? { source: 'dem-terrain', exaggeration: state.exaggeration } : undefined;
  if (!style.terrain) delete style.terrain;
  style.sky = {
    'sky-color': '#1a3a6b', 'horizon-color': '#9ec7ff', 'fog-color': '#ffffff',
    'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.8, 'fog-ground-blend': 0.9,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 0.6, 9, 0],
  };
  return style;
}

export async function createMap(container, state, { onMessage, onSelect }) {
  const map = new maplibregl.Map({
    container,
    style: await buildStyle(state, onMessage),
    center: [state.view.lon, state.view.lat],
    zoom: state.view.zoom,
    maxPitch: 85,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl(), 'bottom-right');
  map.on('error', (e) => console.warn('[maplibre]', e.error?.message || e));
  const points = DRC_POINTS;
  map.on('click', (e) => {
    const hit = map.getLayer(points) && map.queryRenderedFeatures(e.point, { layers: [points] })[0];
    onSelect?.(hit ? hit.properties : null);
  });
  map.on('mouseenter', points, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', points, () => { map.getCanvas().style.cursor = ''; });

  let seq = 0;
  let terrainOn = state.terrain;
  return {
    async apply(next) {
      const mine = ++seq;
      const style = await buildStyle(next, onMessage);
      if (mine !== seq) return;
      map.setStyle(style, { diff: true });
      if (next.terrain && !terrainOn && map.getPitch() < 10) map.easeTo({ pitch: 60, duration: 1000 });
      terrainOn = next.terrain;
    },
    highlight(sel) {
      selection = sel;
      if (!map.getLayer(DRC_POINTS)) return;
      const { paint, layout } = drcStyle(sel);
      for (const [k, v] of Object.entries(paint)) map.setPaintProperty(DRC_POINTS, k, v);
      for (const [k, v] of Object.entries(layout)) map.setLayoutProperty(DRC_POINTS, k, v);
    },
    getView() {
      const c = map.getCenter();
      return { lon: c.lng, lat: c.lat, zoom: map.getZoom() };
    },
    destroy() { map.remove(); },
  };
}
