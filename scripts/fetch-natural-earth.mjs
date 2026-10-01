// Downloads Natural Earth layers and writes slimmed GeoJSON to public/data.
// Usage: node scripts/fetch-natural-earth.mjs
import { writeFile, mkdir } from 'node:fs/promises';

const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const LAYERS = [
  { file: 'ne_10m_rivers_lake_centerlines', out: 'rivers-10m', keep: ['name', 'scalerank'] },
  { file: 'ne_50m_lakes', out: 'lakes-50m', keep: ['name'] },
  { file: 'ne_50m_admin_0_countries', out: 'countries-50m', keep: ['NAME', 'ISO_A3', 'MAPCOLOR7'] },
];
const round = (c) => (typeof c[0] === 'number' ? c.map((v) => Math.round(v * 1e4) / 1e4) : c.map(round));

await mkdir('public/data', { recursive: true });
for (const { file, out, keep } of LAYERS) {
  const res = await fetch(BASE + file + '.geojson');
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const gj = await res.json();
  gj.features = gj.features.map((f) => ({
    type: 'Feature',
    properties: Object.fromEntries(keep.map((k) => [k.toLowerCase(), f.properties[k] ?? null])),
    geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
  }));
  delete gj.crs; delete gj.name;
  const json = JSON.stringify(gj);
  await writeFile(`public/data/${out}.geojson`, json);
  console.log(out, (json.length / 1e6).toFixed(2), 'MB,', gj.features.length, 'features');
}
