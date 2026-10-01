# Base map options

Requirements: zoomable, 3D globe, population density, topography, rivers. Later: polygons of de facto control
(states and armed groups) drawn on top, so the base must stay readable under semi-transparent fills.

Everything below is wired into the app (`npm run dev`) so it can be compared side by side.
All sources work without an API key unless noted.

## Rendering libraries

| | MapLibre GL JS 6 | CesiumJS 1.14x | OpenLayers 10 | Leaflet 1.9 |
|---|---|---|---|---|
| Globe | Yes (`projection: globe`), switches to Mercator when zoomed in | Yes, true 3D ellipsoid | No | No |
| 3D terrain | Yes, from any raster-DEM | Yes; quantized-mesh (Cesium ion) or custom heightmap | No | No |
| Hillshade / elevation tint from DEM | Built-in (`hillshade`, `color-relief` layers) | No (needs lighting or pre-rendered tiles) | Possible via WebGL tile shaders, not built-in | No |
| Vector tiles + styling | Native, best in class | Limited (3D Tiles / imagery only) | Yes (via `ol-mapbox-style`) | Plugin only |
| Large polygon overlays | GPU, smooth at all zooms | OK; heavy entity count slows it | Canvas, OK | Canvas/SVG, slows with large data |
| Bundle (gzip) | ~280 kB | ~1.1 MB + assets | ~95 kB (tree-shaken) | ~45 kB |
| Licence | BSD-3 | Apache-2.0 (ion services are commercial, free tier) | BSD-2 | BSD-2 |

Not included but worth knowing:
- **deck.gl** – GPU data-visualisation layers; can run inside MapLibre (interleaved) and has an experimental `GlobeView`.
  Useful later if control areas get time-animated or very large.
- **Mapbox GL JS / Google Maps / ArcGIS JS** – capable, but proprietary licences and per-load pricing.
- **Three.js globe (e.g. globe.gl)** – nice visuals, but no proper tiled zooming.

## Base maps

| Id | Type | Max zoom | Notes |
|---|---|---|---|
| OpenFreeMap Liberty / Positron | Vector (OSM) | 14 data, overzoom to 22 | Free, no key, includes waterways and labels. MapLibre only. |
| OpenStreetMap | Raster | 19 | Tile usage policy: fine for testing, not for a production site. |
| CARTO Positron / Dark Matter (no labels) | Raster | 19 | Neutral backgrounds; free tier limits for commercial use. |
| Esri World Imagery | Raster | 19 | Best free high-res satellite imagery; attribution required, Esri ToS. |
| Sentinel-2 cloudless 2020 (EOX) | Raster | 15 | 10 m mosaic, CC BY-NC-SA (non-commercial). |
| NASA Blue Marble shaded relief | WMS (GIBS) | ~8 | Good-looking from orbit, blurry when zoomed in. |
| Esri World Physical | Raster | 8 | Natural Earth II look, small scales only. |
| Esri World Shaded Relief | Raster | 13 | Grey relief. |
| Esri World Topographic | Raster | 19 | Full topo map. |
| OpenTopoMap | Raster | 17 | Contours + hillshade, CC-BY-SA. |

## Topography

- **DEM: Mapzen/Tilezen Terrarium tiles** on AWS Open Data (`elevation-tiles-prod`). Global, z0–15, includes
  bathymetry, free. Drives MapLibre terrain, hillshade and hypsometric tint, and Cesium terrain (decoded in the
  browser by a `CustomHeightmapTerrainProvider`).
- **Cesium World Terrain** (ion token, free tier) – better meshes and normals for Cesium.
- Alternatives for self-hosting: Copernicus GLO-30 DEM, MapTiler terrain-rgb (key), Mapterhorn.

## Population density

- **WorldPop 100 m density (2000–2020) via Esri Living Atlas ImageServer** – public, no key. Included (2020).
  The service returns raw floats; the app sends a Remap + Colormap rendering rule so Esri returns
  classed, coloured PNG tiles (8 classes, 1 to 15 000+ people/km², magma-like ramp).
  `https://worldpop.arcgis.com/arcgis/rest/services/WorldPop_Population_Density_100m/ImageServer`
  (also `_1km` and `WorldPop_Total_Population_100m`). Year selectable via the `time` parameter.
- **GPW v4 2020 (CIESIN) via NASA GIBS WMS** – ~1 km, coarse but very reliable. Included.
- **VIIRS Black Marble night lights (NASA GIBS)** – proxy for settlement. Included.
- **GHSL GHS-POP** (JRC, used by luminocity3d.org) – 100 m / 1 km, 1975–2030 epochs, CC BY 4.0. No public tile
  service: data is GeoTIFF (Mollweide or EPSG:4326) from JRC, AWS Open Data (`s3://jrc-ghsl/ghs-pop`) or
  source.coop (COG). To use it: download the 2025 epoch, `gdalwarp` to EPSG:3857, colour with
  `gdaldem color-relief`, cut to a PMTiles raster archive (z0–10 is a few GB) and host it on object storage
  (Cloudflare R2, S3). MapLibre reads PMTiles directly via the `pmtiles` protocol.
- **Kontur Population** – H3 hexagons (400 m), CC BY; renders well as vector polygons, also needs self-hosting.
- **Meta High Resolution Settlement Layer** – 30 m, CC BY.

## Rivers

- **Natural Earth 10 m rivers + 50 m lakes** – bundled in `public/data` (slimmed with `npm run data`). Good for world
  to country zoom levels.
- OSM waterways already included in the OpenFreeMap vector styles at higher zooms.
- More detail: **HydroRIVERS** (HydroSHEDS, ~8.5 M segments, would need vector tiling).

## Recommendation

**MapLibre GL JS** as the main engine: it is the only option that covers all requirements (globe, terrain,
DEM-driven hillshade/tint, vector styles, fast polygon overlays) in one open-source library. Pair it with
OpenFreeMap Positron or a CARTO no-labels base for political overlays, and Esri imagery / Sentinel-2 as an
alternative "physical" view. Keep population as a toggleable overlay; move to self-hosted GHSL or Kontur
tiles if 1 km GPW is too coarse.

Cesium is the choice only if true 3D (camera flying, 3D Tiles, vertical data) matters more than cartographic
styling.
