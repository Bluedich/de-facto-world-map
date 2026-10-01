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

## De facto control

The control layer marks, for each place, **the group or institution that holds the monopoly of violence
(or close to it) most of the time**.

- *Monopoly of violence*: the main group that uses force to keep order, detain people, settle disputes,
  tax/extort and punish. Being present or occasionally violent is not enough.
- *Most of the time*: control goes to whoever does this day to day. If a gang runs a neighbourhood and
  settles disputes while the police only raid it every few months, the gang controls it. If a gang is
  present and sometimes violent but the police have a permanent post and handle justice, the police control it.
- *Simple groups* (rebels, militias, terrorist groups, gangs): the controller is the group itself.
- *States, and rebels that act as de facto states* (e.g. AFC/M23): the controller can be the specific force
  holding the place – army, police, gendarmerie, republican guard, intelligence, auxiliaries – stored with its
  parent. On the map all forces of one parent are **shades of the parent's base colour**.
- Foreign armies (e.g. UPDF, RDF, FDNB) are sub-entities of their own state.
- Each assessment also records a status (`exclusive`, `dominant`, `contested`, `unclear`), a confidence
  (`high`, `medium`, `low`), the basis (specific report, area report, default state presence, inference),
  other armed actors present, sources, and the date it describes.

### DRC (first country)

Data lives in `data/drc/`; scripts in `scripts/drc/` (Python 3, `pip install shapely rasterio numpy`).

| Step | Script | Output |
|---|---|---|
| Download raw data (gitignored) | `scripts/drc/fetch_raw.sh` | `data/drc/raw/` |
| Settlements ≥ 1000 people, cities ≥ 100k split by health area | `scripts/drc/build_locations.py` | `data/drc/locations.csv` |
| Swarm work units (one per territory/ville, large cities split) | `scripts/drc/make_units.py` | `data/drc/units/*.json` |
| Agent assessments | agent swarm (see `scripts/drc/agent_prompt.md`) | `data/drc/assessments/*.json` |
| Build SQLite DB | `scripts/drc/build_db.py` | `data/drc/defacto.sqlite` |
| Map overlay | `scripts/drc/export_geojson.py` | `public/data/drc-control.geojson` |

Sources: GRID3 COD settlement extents v4, settlement names v9 and population v4.4 (100 m),
OCHA COD-AB admin boundaries, GeoNames for well-known town names.
Settlement population is the sum of 100 m population cells falling in each GRID3 settlement extent.

Database tables (`scripts/drc/schema.sql`): `entity` (controllers, with `parent_id` for sub-forces and a colour),
`admin_unit`, `location`, `control_assessment` (controller, sovereign = top-level parent, status, confidence,
date, evidence), `assessment_presence` (other actors present), `source`, `assessment_source`, `run`;
view `v_current_control` gives the latest assessment per location.
