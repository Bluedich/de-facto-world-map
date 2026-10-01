"""Build the DRC location list: settlements >= MIN_POP people, large cities split into neighbourhoods.

Inputs (data/drc/raw, see fetch_raw.sh):
  extents.gpkg   GRID3 COD settlement extents v4 (blocks grouped into settlements by mgrs_code)
  names.gpkg     GRID3 COD settlement names v9 (named points with health zone / health area)
  COD_population_v4_4_gridded/COD_Population_v4_4_gridded.tif   GRID3/WorldPop 100 m population v4.4
  admin/cod_admin{1,2,3}.geojson   OCHA COD-AB admin boundaries

Method:
  population of a settlement = sum of 100 m population pixels whose centre lies in (or within 60 m of)
  one of its blocks. Settlement point = population-weighted centroid. Name = GRID3 named point inside
  the settlement closest to that centroid (else nearest named point, flagged 'vicinity').
  Settlements >= CITY_POP are split by health area (aire de sante): each pixel goes to the nearest named
  point in the city, and pixels are grouped by that point's health area.

Output: data/drc/locations.csv
"""
import csv
import json
import math
import os
import sqlite3
from collections import defaultdict

import numpy as np
import rasterio
import shapely

from gpkg import read_table

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
RAW = os.path.join(ROOT, 'data', 'drc', 'raw')
OUT = os.path.join(ROOT, 'data', 'drc', 'locations.csv')
MIN_POP = 1000
CITY_POP = 100_000
R = 6378137.0


def to_merc(lon, lat):
    return np.radians(lon) * R, R * np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))


def to_lonlat(x, y):
    return np.degrees(x / R), np.degrees(2 * np.arctan(np.exp(y / R)) - np.pi / 2)


def load_admin(level):
    gj = json.load(open(os.path.join(RAW, 'admin', f'cod_admin{level}.geojson')))
    props = [f['properties'] for f in gj['features']]
    geoms = shapely.from_geojson([json.dumps(f['geometry']) for f in gj['features']])
    return props, geoms


def point_in_admin(lons, lats, level):
    props, geoms = load_admin(level)
    tree = shapely.STRtree(geoms)
    pts = shapely.points(lons, lats)
    idx = np.full(len(pts), -1)
    # nearest handles points just outside the boundary (lakes, border rivers)
    pi, gi = tree.query_nearest(pts, max_distance=0.1)
    idx[pi] = gi
    return [props[i] if i >= 0 else {} for i in idx]


def main():
    print('reading extents...')
    rows, blocks = read_table(os.path.join(RAW, 'extents.gpkg'), ['mgrs_code', 'building_count', 'extent_type'])
    codes = np.array([r[0] for r in rows])
    ext_type = {r[0]: r[2] for r in rows}
    buildings = defaultdict(int)
    for r in rows:
        buildings[r[0]] += r[1] or 0
    tree = shapely.STRtree(blocks)

    print('reading population raster...')
    with rasterio.open(os.path.join(RAW, 'COD_population_v4_4_gridded', 'COD_Population_v4_4_gridded.tif')) as src:
        pop = src.read(1)
        tr = src.transform
    rr, cc = np.nonzero(np.nan_to_num(pop) > 0)
    pv = pop[rr, cc].astype(np.float64)
    plon = tr.c + (cc + 0.5) * tr.a
    plat = tr.f + (rr + 0.5) * tr.e
    px, py = to_merc(plon, plat)
    print(f'{len(pv):,} populated pixels, total {pv.sum():,.0f}')

    print('assigning pixels to settlements...')
    pts = shapely.points(px, py)
    pix_block = np.full(len(pts), -1)
    step = 500_000
    for s in range(0, len(pts), step):
        pi, bi = tree.query_nearest(pts[s:s + step], max_distance=60, all_matches=False)
        pix_block[pi + s] = bi
    hit = pix_block >= 0
    pix_code = np.where(hit, codes[np.maximum(pix_block, 0)], '')
    print(f'pixels in settlements: {hit.sum():,} ({pv[hit].sum() / pv.sum():.1%} of population)')

    order = np.argsort(pix_code[hit], kind='stable')
    hc, hpv, hlon, hlat = pix_code[hit][order], pv[hit][order], plon[hit][order], plat[hit][order]
    uniq, starts = np.unique(hc, return_index=True)
    bounds = list(starts) + [len(hc)]
    settl = {}
    for code, a, b in zip(uniq, bounds[:-1], bounds[1:]):
        p = hpv[a:b].sum()
        if p >= MIN_POP:
            settl[code] = dict(pop=p, lon=(hlon[a:b] * hpv[a:b]).sum() / p, lat=(hlat[a:b] * hpv[a:b]).sum() / p,
                               span=(a, b))
    print(f'settlements >= {MIN_POP}: {len(settl):,}, population {sum(s["pop"] for s in settl.values()):,.0f}')

    print('reading names...')
    con = sqlite3.connect(os.path.join(RAW, 'names.gpkg'))
    nrows = con.execute('select localite, localitetype, localite_alt, zonesante, zs_uid, airesante, as_uid, '
                        'province, lon, lat, grid3id from GRID3_COD_settlement_names_v9_0 '
                        'where lon is not null and lat is not null').fetchall()
    nlon = np.array([r[8] for r in nrows])
    nlat = np.array([r[9] for r in nrows])
    nx, ny = to_merc(nlon, nlat)
    npts = shapely.points(nx, ny)
    ni, bi = tree.query_nearest(npts, max_distance=100, all_matches=False)
    names_in = defaultdict(list)
    for i, b in zip(ni, bi):
        names_in[codes[b]].append(i)
    name_tree = shapely.STRtree(npts)

    # well-known town names (GeoNames >= 1000 people, OCHA admin capitals) override GRID3 locality names
    towns = [(t['name'], t['population'], t['lon'], t['lat'], f"geonames:{t['geonameid']}")
             for t in json.load(open(os.path.join(RAW, 'geonames_cd.json')))]
    for f in json.load(open(os.path.join(RAW, 'admin', 'cod_admincapitals.geojson')))['features']:
        pr = f['properties']
        towns.append((pr['name'], 0, pr['x_coord'], pr['y_coord'], 'ocha_admincapitals'))
    tpts = shapely.points(*to_merc(np.array([t[2] for t in towns]), np.array([t[3] for t in towns])))
    town_in = {}
    for i, b in zip(*tree.query_nearest(tpts, max_distance=500, all_matches=False)):
        code = codes[b]
        if code not in town_in or towns[i][1] > towns[town_in[code]][1]:
            town_in[code] = i

    out = []
    for code, s in settl.items():
        cx, cy = to_merc(s['lon'], s['lat'])
        c = shapely.Point(cx, cy)
        inside = names_in.get(code, [])
        if inside:
            pref = [i for i in inside if nrows[i][1] in ('Village', 'Quaŕtier', 'Hameau', 'Campement')] or inside
            ni_ = min(pref, key=lambda i: c.distance(npts[i]))
            name_src = 'grid3_names:inside'
        else:
            ni_ = name_tree.nearest(c)
            name_src = 'grid3_names:vicinity'
        nr = nrows[ni_]
        name = nr[0]
        if code in town_in:
            name, name_src = towns[town_in[code]][0], towns[town_in[code]][4]
        elif s['pop'] >= CITY_POP and nr[3]:
            name, name_src = nr[3], 'grid3_names:health_zone'
        alt = sorted({nrows[i][0] for i in inside if nrows[i][0]} - {name})[:15]
        base = dict(loc_id=f'cod-{code}', kind='settlement', name=name, alt_names='; '.join(alt), parent_loc_id='',
                    lat=round(s['lat'], 5), lon=round(s['lon'], 5), population=round(s['pop']),
                    building_count=buildings[code], extent_type=ext_type[code], grid3_extent_id=code,
                    health_zone=nr[3], health_zone_id=nr[4], health_area=nr[5], health_area_id=nr[6],
                    name_source=name_src, name_dist_m=round(c.distance(npts[ni_]) * math.cos(math.radians(s['lat']))))
        out.append(base)

        if s['pop'] < CITY_POP or not inside:
            continue
        # split city into health areas
        a, b = s['span']
        cpts = shapely.points(*to_merc(hlon[a:b], hlat[a:b]))
        city_tree = shapely.STRtree(npts[inside])
        nearest = np.array(inside)[city_tree.nearest(cpts)]
        groups = defaultdict(list)
        for k, ni2 in enumerate(nearest):
            groups[nrows[ni2][6] or nrows[ni2][5]].append((k, ni2))
        for ha_id, members in groups.items():
            ks = np.array([m[0] for m in members])
            w = hpv[a:b][ks]
            p = w.sum()
            lon = (hlon[a:b][ks] * w).sum() / p
            lat = (hlat[a:b][ks] * w).sum() / p
            r0 = nrows[members[0][1]]
            quarters = sorted({nrows[m[1]][0] for m in members if nrows[m[1]][0]})[:15]
            out.append(dict(base, loc_id=f'cod-{code}-{ha_id}', kind='neighbourhood', name=r0[5] or r0[0],
                            alt_names='; '.join(quarters), parent_loc_id=base['loc_id'], lat=round(lat, 5),
                            lon=round(lon, 5), population=round(p), building_count='', health_area=r0[5],
                            health_area_id=r0[6], name_source='grid3_names:health_area', name_dist_m=''))
        print(f'  split {name} ({s["pop"]:,.0f}) into {len(groups)} health areas')

    print('admin lookup...')
    lons = np.array([o['lon'] for o in out])
    lats = np.array([o['lat'] for o in out])
    for level in (1, 2, 3):
        for o, p in zip(out, point_in_admin(lons, lats, level)):
            o[f'adm{level}_pcode'] = p.get(f'adm{level}_pcode', '')
            o[f'adm{level}_name'] = p.get(f'adm{level}_name', '')

    out.sort(key=lambda o: (o['adm1_pcode'], o['adm2_pcode'], o['kind'] != 'settlement', -o['population']))
    cols = ['loc_id', 'kind', 'name', 'alt_names', 'parent_loc_id', 'lat', 'lon', 'population', 'building_count',
            'extent_type', 'grid3_extent_id', 'adm1_pcode', 'adm1_name', 'adm2_pcode', 'adm2_name', 'adm3_pcode',
            'adm3_name', 'health_zone', 'health_zone_id', 'health_area', 'health_area_id', 'name_source',
            'name_dist_m']
    with open(OUT, 'w', newline='') as f:
        w = csv.DictWriter(f, cols)
        w.writeheader()
        w.writerows(out)
    print(f'wrote {len(out):,} locations to {OUT}')


if __name__ == '__main__':
    main()
