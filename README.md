# De facto world map

Goal: a world map showing which state or armed group controls each area.

Current stage: **base map lab** – a web app to compare rendering libraries and base datasets before
building the control layer. See [docs/basemap-options.md](docs/basemap-options.md) for the comparison.

## Run

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

The URL hash stores library, base map, overlays and view, so a configuration can be shared as a link.

## What can be switched

- **Library**: MapLibre GL JS, CesiumJS, OpenLayers, Leaflet (`src/adapters/`)
- **Base map**: OpenFreeMap vector styles, OSM, CARTO, Esri imagery/topo/relief, Sentinel-2, NASA Blue Marble, OpenTopoMap
- **Overlays**: hillshade, hypsometric tint, population density (WorldPop 100 m, GPW 1 km), night lights, rivers & lakes,
  sample control polygons (Natural Earth countries), place labels
- **3D**: globe projection, 3D terrain with exaggeration (MapLibre, Cesium). Cesium can use a Cesium ion token
  (entered in the panel, stored in localStorage) for Cesium World Terrain.

Datasets are defined once in `src/catalog.js`; each adapter translates them to its library.

## Data

`public/data/*.geojson` are slimmed Natural Earth layers (public domain), regenerated with `npm run data`.
Third-party tile services have their own terms; see attribution in the map and notes in the docs.
