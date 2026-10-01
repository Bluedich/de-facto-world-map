// Catalog of base maps and overlays shared by every library adapter.
//
// kind:
//   xyz      raster tiles, url template with {z}/{x}/{y}
//   wms      WMS GetMap in EPSG:3857 (url + layers)
//   style    MapLibre vector style JSON (MapLibre only)
//   bbox     image per tile from a URL with a {bbox} placeholder (EPSG:3857 minx,miny,maxx,maxy),
//            e.g. ArcGIS ImageServer exportImage
//   geojson  local GeoJSON rendered as vector features
//   hillshade  shaded relief: computed from DEM in MapLibre, Esri raster elsewhere

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi';

// WorldPop population density (people/km², 100 m grid, 2000–2020) served as an ArcGIS ImageServer.
// The service returns raw float values, so classes and colours are applied server-side with a
// Remap + Colormap rendering rule. Values below 1 person/km² become NoData (transparent).
const POP_CLASSES = [
  // [from, to, colour]  people per km²
  [1, 10, '#2c105c'],
  [10, 50, '#711f81'],
  [50, 150, '#b63679'],
  [150, 500, '#ee605e'],
  [500, 1500, '#fb9b5f'],
  [1500, 5000, '#fdcf73'],
  [5000, 15000, '#fcfdbf'],
  [15000, 1e9, '#ffffff'],
];
function worldpopUrl(service, year) {
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const rule = {
    rasterFunction: 'Colormap',
    rasterFunctionArguments: {
      Colormap: POP_CLASSES.map(([, , c], i) => [i + 1, ...hex(c)]),
      Raster: {
        rasterFunction: 'Remap',
        rasterFunctionArguments: {
          InputRanges: POP_CLASSES.flatMap(([a, b]) => [a, b]),
          OutputValues: POP_CLASSES.map((_, i) => i + 1),
          AllowUnmatched: false,
        },
      },
    },
  };
  const p = new URLSearchParams({
    bboxSR: '3857', imageSR: '3857', size: '256,256', format: 'png32', transparent: 'true',
    time: String(Date.UTC(year, 0, 1)), interpolation: 'RSP_NearestNeighbor', f: 'image',
    renderingRule: JSON.stringify(rule),
  });
  return `https://worldpop.arcgis.com/arcgis/rest/services/${service}/ImageServer/exportImage?bbox={bbox}&${p}`;
}
export const POPULATION_LEGEND = POP_CLASSES;

export const DEM = {
  // Mapzen/Tilezen Terrarium tiles on AWS Open Data. Global, ~30 m on land, includes bathymetry.
  url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  encoding: 'terrarium',
  maxzoom: 15,
  attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen Terrain Tiles</a>',
};

export const BASEMAPS = [
  {
    id: 'ofm-liberty', name: 'OpenFreeMap Liberty (vector)', kind: 'style', group: 'Vector',
    url: 'https://tiles.openfreemap.org/styles/liberty',
    fallback: 'osm',
    note: 'OSM vector tiles, no key. Rivers, roads, labels at all zooms.',
  },
  {
    id: 'ofm-positron', name: 'OpenFreeMap Positron (vector)', kind: 'style', group: 'Vector',
    url: 'https://tiles.openfreemap.org/styles/positron',
    fallback: 'carto-light',
    note: 'Light, low-contrast vector style. Good under coloured control areas.',
  },
  {
    id: 'osm', name: 'OpenStreetMap', kind: 'xyz', group: 'Street',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxzoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    note: 'Standard OSM raster. Usage policy forbids heavy use.',
  },
  {
    id: 'carto-light', name: 'CARTO Positron (no labels)', kind: 'xyz', group: 'Street',
    url: 'https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png', maxzoom: 19,
    attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    note: 'Neutral background, free up to 75k views/month.',
  },
  {
    id: 'carto-dark', name: 'CARTO Dark Matter (no labels)', kind: 'xyz', group: 'Street',
    url: 'https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png', maxzoom: 19,
    attribution: '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  {
    id: 'esri-imagery', name: 'Esri World Imagery', kind: 'xyz', group: 'Satellite',
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, maxzoom: 19,
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    note: 'High-res satellite/aerial imagery, sub-metre in many places.',
  },
  {
    id: 's2cloudless', name: 'Sentinel-2 cloudless 2020 (EOX)', kind: 'xyz', group: 'Satellite',
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg', maxzoom: 15,
    attribution: '<a href="https://s2maps.eu">Sentinel-2 cloudless</a> by EOX (Copernicus Sentinel data 2020), CC BY-NC-SA 4.0',
    note: '10 m cloud-free mosaic. Non-commercial licence.',
  },
  {
    id: 'gibs-bluemarble', name: 'NASA Blue Marble + relief', kind: 'wms', group: 'Satellite',
    url: GIBS_WMS, layers: 'BlueMarble_ShadedRelief_Bathymetry', format: 'image/jpeg', maxzoom: 8,
    attribution: 'NASA GIBS / Blue Marble',
    note: 'Low-res natural colour with shaded relief and bathymetry. Looks good on a globe.',
  },
  {
    id: 'esri-physical', name: 'Esri World Physical', kind: 'xyz', group: 'Topography',
    url: `${ESRI}/World_Physical_Map/MapServer/tile/{z}/{y}/{x}`, maxzoom: 8,
    attribution: 'Tiles &copy; Esri, US National Park Service',
    note: 'Natural Earth II style physical map. Small scale only (z ≤ 8).',
  },
  {
    id: 'esri-shaded', name: 'Esri World Shaded Relief', kind: 'xyz', group: 'Topography',
    url: `${ESRI}/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}`, maxzoom: 13,
    attribution: 'Tiles &copy; Esri',
  },
  {
    id: 'esri-topo', name: 'Esri World Topographic', kind: 'xyz', group: 'Topography',
    url: `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`, maxzoom: 19,
    attribution: 'Tiles &copy; Esri and contributors',
  },
  {
    id: 'opentopomap', name: 'OpenTopoMap', kind: 'xyz', group: 'Topography',
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', maxzoom: 17,
    attribution: '&copy; OpenStreetMap contributors, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    note: 'Contour lines + hillshade from OSM/SRTM.',
  },
];

export const OVERLAYS = [
  {
    id: 'hillshade', name: 'Hillshade', kind: 'hillshade', opacity: 0.45,
    url: `${ESRI}/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}`, maxzoom: 16,
    attribution: 'Hillshade &copy; Esri',
    note: 'MapLibre computes it from the DEM; other libraries use Esri World Hillshade.',
  },
  {
    id: 'elevation', name: 'Elevation tint (hypsometric)', kind: 'colorrelief', opacity: 0.55, libs: ['maplibre'],
    note: 'Colour by height computed client-side from the DEM (MapLibre color-relief layer).',
  },
  {
    id: 'worldpop', name: 'Population density (WorldPop 100 m, 2020)', kind: 'bbox', opacity: 0.85, maxzoom: 14,
    url: worldpopUrl('WorldPop_Population_Density_100m', 2020),
    attribution: 'Population: <a href="https://www.worldpop.org">WorldPop</a> (CC BY 4.0) via Esri Living Atlas',
    note: '100 m grid, rendered on the fly by Esri. Best on a dark base.',
  },
  {
    id: 'population', name: 'Population density (GPW v4, 2020)', kind: 'wms', opacity: 0.65,
    url: GIBS_WMS, layers: 'GPW_Population_Density_2020', format: 'image/png', maxzoom: 9,
    attribution: 'Population: CIESIN GPWv4 via NASA GIBS',
    note: '~1 km grid. Higher-res alternatives (GHSL, WorldPop, Kontur) need self-hosting.',
  },
  {
    id: 'nightlights', name: 'Night lights (VIIRS Black Marble)', kind: 'wms', opacity: 0.8,
    url: GIBS_WMS, layers: 'VIIRS_Black_Marble', format: 'image/png', maxzoom: 8,
    attribution: 'Night lights: NASA Black Marble via GIBS',
    note: 'Proxy for settlement density. Best on a dark base map.',
  },
  {
    id: 'rivers', name: 'Rivers & lakes (Natural Earth 10m)', kind: 'geojson',
    files: ['data/lakes-50m.geojson', 'data/rivers-10m.geojson'],
    attribution: 'Rivers: Natural Earth',
    note: 'Bundled locally. Vector bases already include OSM waterways.',
  },
  {
    id: 'countries', name: 'Sample control overlay (NE countries)', kind: 'geojson',
    files: ['data/countries-50m.geojson'],
    attribution: 'Borders: Natural Earth',
    note: 'Stand-in for control polygons: shows how filled areas look on each base.',
  },
  {
    id: 'labels', name: 'Place labels & boundaries (Esri)', kind: 'xyz', opacity: 1,
    url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, maxzoom: 19,
    attribution: 'Labels &copy; Esri',
    note: 'Transparent reference layer, mainly for satellite bases.',
  },
];

export const LIBRARIES = [
  { id: 'maplibre', name: 'MapLibre GL JS', globe: true, terrain: true, vectorStyles: true,
    note: 'WebGL, vector tiles, globe projection, 3D terrain. Open source (BSD).' },
  { id: 'cesium', name: 'CesiumJS', globe: true, terrain: true, vectorStyles: false,
    note: 'Full 3D globe engine. Real 3D terrain needs a free Cesium ion token.' },
  { id: 'openlayers', name: 'OpenLayers', globe: false, terrain: false, vectorStyles: false,
    note: '2D, strongest GIS feature set (projections, WMS/WMTS, editing).' },
  { id: 'leaflet', name: 'Leaflet', globe: false, terrain: false, vectorStyles: false,
    note: '2D, smallest and simplest. Raster tiles + GeoJSON.' },
];

export const byId = (list, id) => list.find((x) => x.id === id);

// WMS GetMap URL template using MapLibre's {bbox-epsg-3857} placeholder.
export function wmsTemplate(layer) {
  const p = new URLSearchParams({
    SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.1.1', LAYERS: layer.layers, STYLES: '',
    FORMAT: layer.format || 'image/png', TRANSPARENT: 'TRUE', SRS: 'EPSG:3857', WIDTH: '256', HEIGHT: '256',
  });
  return `${layer.url}?${p}&BBOX={bbox-epsg-3857}`;
}

// Colours for the sample control overlay (indexed by Natural Earth MAPCOLOR7, 1..7).
export const CONTROL_COLORS = ['#888888', '#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#a65628', '#f781bf'];

const geojsonCache = new Map();
export function loadGeoJSON(path) {
  const url = import.meta.env.BASE_URL + path;
  if (!geojsonCache.has(url)) geojsonCache.set(url, fetch(url).then((r) => r.json()));
  return geojsonCache.get(url);
}
