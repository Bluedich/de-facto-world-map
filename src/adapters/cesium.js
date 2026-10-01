import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { BASEMAPS, OVERLAYS, DEM, byId, CONTROL_COLORS, loadGeoJSON } from '../catalog.js';
import { classify, RELATION_COLOR, RING } from '../relations.js';

const ION_TOKEN_KEY = 'cesiumIonToken';
const FOV = Cesium.Math.toRadians(60);

function imageryProvider(l) {
  const credit = new Cesium.Credit(l.attribution || '', true);
  if (l.kind === 'wms') {
    return new Cesium.WebMapServiceImageryProvider({
      url: l.url, layers: l.layers, credit,
      tilingScheme: new Cesium.WebMercatorTilingScheme(),
      parameters: { format: l.format || 'image/png', transparent: true },
      maximumLevel: l.maxzoom,
    });
  }
  if (l.kind === 'bbox') {
    return new Cesium.UrlTemplateImageryProvider({
      url: l.url.replace('{bbox}', '{westProjected},{southProjected},{eastProjected},{northProjected}'),
      tilingScheme: new Cesium.WebMercatorTilingScheme(), maximumLevel: l.maxzoom, credit,
    });
  }
  return new Cesium.UrlTemplateImageryProvider({ url: l.url, maximumLevel: l.maxzoom ?? 19, credit });
}

// Key-free terrain: decode Terrarium PNG tiles (same DEM MapLibre uses) into heightmaps.
function terrariumTerrain() {
  const N = 65;
  const tiles = new Map();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const loadTile = (z, x, y) => {
    const key = `${z}/${x}/${y}`;
    if (!tiles.has(key)) {
      const url = DEM.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      tiles.set(key, Cesium.Resource.fetchImage({ url, preferImageBitmap: true }).then((img) => {
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, 256, 256).data;
      }));
      if (tiles.size > 300) tiles.delete(tiles.keys().next().value);
    }
    return tiles.get(key);
  };
  return new Cesium.CustomHeightmapTerrainProvider({
    width: N, height: N,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    credit: new Cesium.Credit(DEM.attribution, true),
    callback: async (x, y, level) => {
      // Above the DEM's max zoom, sample a sub-window of the ancestor tile.
      const z = Math.min(level, DEM.maxzoom - 1);
      const d = 2 ** (level - z);
      const px = Math.floor(x / d), py = Math.floor(y / d);
      const ox = ((x % d) / d) * 256, oy = ((y % d) / d) * 256, span = 256 / d;
      const data = await loadTile(z, px, py);
      const out = new Float32Array(N * N);
      for (let j = 0; j < N; j++) {
        const sy = Math.min(255, Math.floor(oy + (j / (N - 1)) * span));
        for (let i = 0; i < N; i++) {
          const sx = Math.min(255, Math.floor(ox + (i / (N - 1)) * span));
          const k = (sy * 256 + sx) * 4;
          out[j * N + i] = Math.max(0, data[k] * 256 + data[k + 1] + data[k + 2] / 256 - 32768);
        }
      }
      return out;
    },
  });
}

async function terrainProvider(state, onMessage) {
  if (!state.terrain) return new Cesium.EllipsoidTerrainProvider();
  let token = null;
  try { token = localStorage.getItem(ION_TOKEN_KEY); } catch {}
  if (token) {
    Cesium.Ion.defaultAccessToken = token;
    try {
      return await Cesium.createWorldTerrainAsync({ requestVertexNormals: true });
    } catch (e) {
      onMessage?.(`Cesium World Terrain failed (${e.message}); using Terrarium DEM.`);
    }
  }
  return terrariumTerrain();
}

function zoomToHeight(zoom, lat, px) {
  const mpp = (156543.034 * Math.cos(Cesium.Math.toRadians(lat))) / 2 ** zoom;
  return (mpp * px) / (2 * Math.tan(FOV / 2));
}
function heightToZoom(h, lat, px) {
  const mpp = (h * 2 * Math.tan(FOV / 2)) / px;
  return Math.log2((156543.034 * Math.cos(Cesium.Math.toRadians(lat))) / mpp);
}

// Style every control point for the current selection context (see relations.js) or null.
// Related points get a dark outline plus a ring point (transparent fill, outline in the relation colour)
// in the `rings` data source. Point outlines are drawn outside pixelSize.
function styleSelection(ds, sel, rings) {
  const now = Cesium.JulianDate.now();
  rings.entities.suspendEvents();
  rings.entities.removeAll();
  for (const e of ds.entities.values) {
    if (!e.point) continue;
    const p = e.properties.getValue(now);
    const rel = sel ? classify(p, sel) : null;
    const color = Cesium.Color.fromCssColorString(p.color);
    e.point.color = sel && !rel ? color.withAlpha(0.12) : color;
    e.point.outlineColor = Cesium.Color.fromCssColorString(rel ? '#111' : '#000');
    e.point.outlineWidth = !sel ? 0.5 : rel ? RING.inner : 0;
    if (!rel) continue;
    rings.entities.add({
      position: e.position,
      point: {
        pixelSize: e.point.pixelSize.getValue(now) + 2 * (RING.inner + RING.gap),
        color: Cesium.Color.TRANSPARENT,
        outlineColor: Cesium.Color.fromCssColorString(RELATION_COLOR[rel] || '#fff'),
        outlineWidth: p.id === sel.id ? RING.selectedWidth : RING.width,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }
  rings.entities.resumeEvents();
}

async function geojsonSource(o) {
  const ds = new Cesium.CustomDataSource(o.id);
  const files = await Promise.all(o.files.map(loadGeoJSON));
  for (const [i, gj] of files.entries()) {
    const isRiverLines = o.id === 'rivers' && i === 1;
    const loaded = await Cesium.GeoJsonDataSource.load(gj, {
      stroke: isRiverLines ? Cesium.Color.fromCssColorString('#2b6cb0') : Cesium.Color.fromCssColorString('#222'),
      strokeWidth: isRiverLines ? 2 : 1,
      fill: Cesium.Color.fromCssColorString('#5b9bd5').withAlpha(0.7),
      clampToGround: isRiverLines, // drape river lines over 3D terrain
    });
    for (const e of loaded.entities.values) {
      if (o.id === 'drc-control' && e.billboard) {
        e.billboard = undefined;
        e.point = new Cesium.PointGraphics({
          color: Cesium.Color.fromCssColorString(e.properties.color.getValue()),
          pixelSize: Math.max(3, Math.log10(e.properties.population.getValue() || 1000) * 2 - 2),
          outlineColor: Cesium.Color.BLACK, outlineWidth: 0.5,
          // Not clamped to ground: clamped points drift from their position when restyled in bulk.
          // Drawn without depth test instead, so they stay visible over 3D terrain.
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }
      if (o.id === 'countries' && e.polygon) {
        const c = CONTROL_COLORS[e.properties.mapcolor7?.getValue() ?? 0] || CONTROL_COLORS[0];
        e.polygon.material = Cesium.Color.fromCssColorString(c).withAlpha(0.35);
        e.polygon.outline = true;
        e.polygon.outlineColor = Cesium.Color.fromCssColorString('#222');
        e.polygon.height = 0;
      }
      ds.entities.add(e);
    }
  }
  return ds;
}

export async function createMap(container, state, { onMessage, onSelect }) {
  window.CESIUM_BASE_URL ??= import.meta.env.BASE_URL + 'cesium';
  const viewer = new Cesium.Viewer(container, {
    baseLayer: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: true,
    sceneModePicker: true,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
  });
  if (import.meta.env.DEV) window.__cesiumViewer = viewer;
  viewer.scene.globe.enableLighting = false;
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(state.view.lon, state.view.lat,
      zoomToHeight(state.view.zoom, state.view.lat, container.clientHeight || 800)),
  });

  const clicks = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  clicks.setInputAction((e) => {
    // drillPick so selection rings drawn over a point do not hide it.
    const picked = viewer.scene.drillPick(e.position, 5).map((x) => x?.id)
      .find((x) => x?.entityCollection?.owner?.name === 'drc-control' && x.properties);
    onSelect?.(picked ? picked.properties.getValue(Cesium.JulianDate.now()) : null);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  const imageryCache = new Map(); // id -> ImageryLayer
  const dataSources = new Map(); // id -> Promise<DataSource>
  let terrainKey = null;
  let seq = 0;
  let selection = null;
  const rings = new Cesium.CustomDataSource('drc-rings');
  viewer.dataSources.add(rings);

  async function apply(next) {
    const mine = ++seq;
    const layers = viewer.imageryLayers;
    const wanted = [next.base, ...next.overlays.filter((id) => byId(OVERLAYS, id)?.kind !== 'geojson')];

    // Imagery: rebuild order to match `wanted`.
    for (const [id, layer] of imageryCache) {
      if (!wanted.includes(id)) { layers.remove(layer, true); imageryCache.delete(id); }
    }
    for (const id of wanted) {
      let def = byId(BASEMAPS, id) || byId(OVERLAYS, id);
      if (!def || def.kind === 'colorrelief') continue;
      if (def.kind === 'style') def = byId(BASEMAPS, def.fallback); // vector styles: MapLibre only
      if (!imageryCache.has(id)) {
        const layer = new Cesium.ImageryLayer(imageryProvider(def), { alpha: def.opacity ?? 1 });
        layers.add(layer);
        imageryCache.set(id, layer);
      }
      layers.raiseToTop(imageryCache.get(id));
    }

    // Vector overlays.
    for (const o of OVERLAYS.filter((x) => x.kind === 'geojson')) {
      const on = next.overlays.includes(o.id);
      if (on && !dataSources.has(o.id)) {
        dataSources.set(o.id, geojsonSource(o).then((ds) => {
          if (o.id === 'drc-control' && selection) styleSelection(ds, selection, rings);
          return viewer.dataSources.add(ds);
        }));
      }
      if (dataSources.has(o.id)) dataSources.get(o.id).then((ds) => { ds.show = next.overlays.includes(o.id); });
      if (o.id === 'drc-control') rings.show = on;
    }

    viewer.scene.verticalExaggeration = next.exaggeration;
    const key = `${next.terrain}`;
    if (key !== terrainKey) {
      terrainKey = key;
      const tp = await terrainProvider(next, onMessage);
      if (mine === seq || terrainKey === key) viewer.terrainProvider = tp;
    }
  }

  await apply(state);

  return {
    apply,
    highlight(sel) {
      selection = sel;
      dataSources.get('drc-control')?.then((ds) => styleSelection(ds, sel, rings));
    },
    getView() {
      const c = viewer.camera.positionCartographic;
      const lat = Cesium.Math.toDegrees(c.latitude);
      return {
        lon: Cesium.Math.toDegrees(c.longitude), lat,
        zoom: Math.max(0, Math.min(20, heightToZoom(c.height, lat, container.clientHeight || 800))),
      };
    },
    destroy() { clicks.destroy(); viewer.destroy(); },
  };
}
