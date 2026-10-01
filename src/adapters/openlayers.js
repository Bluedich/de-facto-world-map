import 'ol/ol.css';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import TileLayer from 'ol/layer/Tile.js';
import VectorLayer from 'ol/layer/Vector.js';
import XYZ from 'ol/source/XYZ.js';
import TileWMS from 'ol/source/TileWMS.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { Style, Stroke, Fill, Circle as CircleStyle } from 'ol/style.js';
import { fromLonLat, toLonLat } from 'ol/proj.js';
import { defaults as defaultControls, ScaleLine } from 'ol/control.js';
import { BASEMAPS, OVERLAYS, byId, CONTROL_COLORS, loadGeoJSON } from '../catalog.js';
import { classify, RELATION_COLOR, RING } from '../relations.js';

function bboxSource(l) {
  const source = new XYZ({ maxZoom: l.maxzoom, crossOrigin: 'anonymous', attributions: l.attribution });
  const grid = source.getTileGrid();
  source.setTileUrlFunction((coord) => l.url.replace('{bbox}', grid.getTileCoordExtent(coord).join(',')));
  return source;
}

function rasterLayer(l) {
  if (l.kind === 'bbox') return new TileLayer({ source: bboxSource(l), opacity: l.opacity ?? 1 });
  const source = l.kind === 'wms'
    ? new TileWMS({
      url: l.url, crossOrigin: 'anonymous', attributions: l.attribution,
      params: { LAYERS: l.layers, FORMAT: l.format || 'image/png', TRANSPARENT: true, VERSION: '1.1.1' },
    })
    : new XYZ({ url: l.url, maxZoom: l.maxzoom ?? 19, crossOrigin: 'anonymous', attributions: l.attribution });
  return new TileLayer({ source, opacity: l.opacity ?? 1 });
}

const fmt = new GeoJSON({ featureProjection: 'EPSG:3857' });
const lakeStyle = new Style({ fill: new Fill({ color: 'rgba(91,155,213,0.7)' }) });
const riverStyles = Array.from({ length: 13 }, (_, r) => new Style({
  stroke: new Stroke({ color: '#2b6cb0', width: Math.max(0.6, 2 - 0.15 * r) }),
}));
const countryStyles = CONTROL_COLORS.map((c) => new Style({
  fill: new Fill({ color: c + '59' }),
  stroke: new Stroke({ color: '#222', width: 0.8 }),
}));

// Selection context (see relations.js) or null; read by the point style function.
let selection = null;
const dimStyles = new globalThis.Map();

function geojsonLayer(o) {
  const source = new VectorSource({ attributions: o.attribution });
  Promise.all(o.files.map(loadGeoJSON)).then((files) => {
    files.forEach((gj) => source.addFeatures(fmt.readFeatures(gj)));
  });
  const pointStyles = new globalThis.Map();
  const pointStyle = (f) => {
    if (selection) {
      const rel = classify(f.getProperties(), selection);
      if (rel) {
        const r = Math.max(2, Math.log10(f.get('population') || 1000) * 2 - 4);
        const isSel = f.get('id') === selection.id;
        const z = isSel ? 3 : rel === 'controlled' ? 2 : 1;
        const w = isSel ? RING.selectedWidth : RING.width;
        // Double ring: dark ring on the point, then a ring in the relation colour (strokes are centred on the radius).
        return [
          new Style({ zIndex: z, image: new CircleStyle({
            radius: r, fill: new Fill({ color: f.get('color') }), stroke: new Stroke({ color: '#111', width: RING.inner }),
          }) }),
          new Style({ zIndex: z, image: new CircleStyle({
            radius: r + RING.inner / 2 + RING.gap + w / 2,
            stroke: new Stroke({ color: RELATION_COLOR[rel] || '#fff', width: w }),
          }) }),
        ];
      }
      const k = `${f.get('color')}|${Math.round(Math.log10(f.get('population') || 1000) * 2)}`;
      if (!dimStyles.has(k)) {
        dimStyles.set(k, new Style({ image: new CircleStyle({
          radius: Math.max(2, Math.log10(f.get('population') || 1000) * 2 - 4),
          fill: new Fill({ color: f.get('color') + '1f' }),
        }) }));
      }
      return dimStyles.get(k);
    }
    const key = `${f.get('color')}|${Math.round(Math.log10(f.get('population') || 1000) * 2)}`;
    if (!pointStyles.has(key)) {
      pointStyles.set(key, new Style({ image: new CircleStyle({
        radius: Math.max(2, Math.log10(f.get('population') || 1000) * 2 - 4),
        fill: new Fill({ color: f.get('color') }), stroke: new Stroke({ color: '#222', width: 0.4 }),
      }) }));
    }
    return pointStyles.get(key);
  };
  if (o.id === 'drc-control') {
    return new VectorLayer({ source, style: pointStyle, updateWhileInteracting: false, properties: { selectable: true } });
  }
  const style = o.id === 'rivers'
    ? (f) => (f.getGeometry().getType().includes('Polygon') ? lakeStyle : riverStyles[f.get('scalerank') ?? 12] || riverStyles[12])
    : (f) => countryStyles[f.get('mapcolor7') ?? 0];
  return new VectorLayer({ source, style, declutter: false, updateWhileInteracting: false });
}

export async function createMap(container, state, { onMessage, onSelect }) {
  const map = new Map({
    target: container,
    controls: defaultControls().extend([new ScaleLine()]),
    view: new View({ center: fromLonLat([state.view.lon, state.view.lat]), zoom: state.view.zoom, maxZoom: 20 }),
  });
  const cache = new globalThis.Map();
  const selectable = { layerFilter: (l) => l.get('selectable'), hitTolerance: 3 };
  map.on('singleclick', (e) => {
    const f = map.forEachFeatureAtPixel(e.pixel, (x) => x, selectable);
    onSelect?.(f ? f.getProperties() : null);
  });
  map.on('pointermove', (e) => {
    if (!e.dragging) map.getTargetElement().style.cursor = map.hasFeatureAtPixel(e.pixel, selectable) ? 'pointer' : '';
  });

  function layerFor(id) {
    if (!cache.has(id)) {
      let def = byId(BASEMAPS, id) || byId(OVERLAYS, id);
      if (def.kind === 'style') {
        def = byId(BASEMAPS, def.fallback);
      }
      cache.set(id, def.kind === 'geojson' ? geojsonLayer(def) : rasterLayer(def));
    }
    return cache.get(id);
  }

  function apply(next) {
    const base = byId(BASEMAPS, next.base);
    if (base?.kind === 'style') onMessage?.(`${base.name} is MapLibre-only; showing ${byId(BASEMAPS, base.fallback).name}.`);
    const ids = [next.base, ...next.overlays.filter((id) => byId(OVERLAYS, id)?.kind !== 'colorrelief')];
    const coll = map.getLayers();
    coll.clear();
    ids.forEach((id) => coll.push(layerFor(id)));
  }
  apply(state);

  return {
    apply,
    highlight(sel) {
      selection = sel;
      cache.get('drc-control')?.changed();
    },
    getView() {
      const v = map.getView();
      const [lon, lat] = toLonLat(v.getCenter());
      return { lon, lat, zoom: v.getZoom() };
    },
    destroy() { map.setTarget(undefined); },
  };
}
