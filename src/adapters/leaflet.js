import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { BASEMAPS, OVERLAYS, byId, CONTROL_COLORS, loadGeoJSON } from '../catalog.js';

// Tile layer whose URL takes the tile's EPSG:3857 bounding box.
const BboxTileLayer = L.TileLayer.extend({
  getTileUrl(coords) {
    const size = this.getTileSize();
    const nw = this._map.unproject(coords.scaleBy(size), coords.z);
    const se = this._map.unproject(coords.add([1, 1]).scaleBy(size), coords.z);
    const a = L.CRS.EPSG3857.project(nw);
    const b = L.CRS.EPSG3857.project(se);
    return this._url.replace('{bbox}', [a.x, b.y, b.x, a.y].join(','));
  },
});

function rasterLayer(l) {
  if (l.kind === 'bbox') {
    return new BboxTileLayer(l.url, { maxNativeZoom: l.maxzoom, maxZoom: 20, opacity: l.opacity ?? 1, attribution: l.attribution });
  }
  if (l.kind === 'wms') {
    return L.tileLayer.wms(l.url, {
      layers: l.layers, format: l.format || 'image/png', transparent: true, version: '1.1.1',
      opacity: l.opacity ?? 1, attribution: l.attribution, maxNativeZoom: l.maxzoom, maxZoom: 20,
    });
  }
  return L.tileLayer(l.url, { maxNativeZoom: l.maxzoom ?? 19, maxZoom: 20, opacity: l.opacity ?? 1, attribution: l.attribution });
}

function geojsonLayer(o, renderer) {
  const group = L.layerGroup();
  group.getAttribution = () => o.attribution;
  Promise.all(o.files.map(loadGeoJSON)).then((files) => {
    files.forEach((gj) => {
      L.geoJSON(gj, {
        renderer,
        interactive: false,
        pointToLayer: (f, latlng) => L.circleMarker(latlng, {
          renderer, radius: Math.max(2, Math.log10(f.properties.population || 1000) * 2 - 4),
          color: '#222', weight: 0.4, fillColor: f.properties.color, fillOpacity: f.properties.confidence === 'low' ? 0.55 : 0.9,
        }),
        style: (f) => (o.id === 'rivers'
          ? (f.geometry.type.includes('Polygon')
            ? { stroke: false, fillColor: '#5b9bd5', fillOpacity: 0.7 }
            : { color: '#2b6cb0', weight: Math.max(0.6, 2 - 0.15 * (f.properties.scalerank ?? 12)) })
          : { color: '#222', weight: 0.8, fillColor: CONTROL_COLORS[f.properties.mapcolor7 ?? 0], fillOpacity: 0.35 }),
      }).addTo(group);
    });
  });
  return group;
}

export async function createMap(container, state, { onMessage }) {
  const map = L.map(container, { preferCanvas: true, worldCopyJump: true })
    .setView([state.view.lat, state.view.lon], Math.round(state.view.zoom));
  L.control.scale().addTo(map);
  const renderer = L.canvas({ padding: 0.5 });
  const cache = new Map();
  let active = [];

  function layerFor(id) {
    if (!cache.has(id)) {
      let def = byId(BASEMAPS, id) || byId(OVERLAYS, id);
      if (def.kind === 'style') def = byId(BASEMAPS, def.fallback);
      cache.set(id, def.kind === 'geojson' ? geojsonLayer(def, renderer) : rasterLayer(def));
    }
    return cache.get(id);
  }

  function apply(next) {
    const base = byId(BASEMAPS, next.base);
    if (base?.kind === 'style') onMessage?.(`${base.name} is MapLibre-only; showing ${byId(BASEMAPS, base.fallback).name}.`);
    active.forEach((l) => map.removeLayer(l));
    active = [next.base, ...next.overlays.filter((id) => byId(OVERLAYS, id)?.kind !== 'colorrelief')].map(layerFor);
    active.forEach((l) => l.addTo(map));
  }
  apply(state);

  return {
    apply,
    getView() {
      const c = map.getCenter();
      return { lon: L.Util.wrapNum(c.lng, [-180, 180], true), lat: c.lat, zoom: map.getZoom() };
    },
    destroy() { map.remove(); },
  };
}
