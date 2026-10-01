"""Export current control per location from data/drc/defacto.sqlite to public/data/drc-control.geojson."""
import json
import os
import sqlite3

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
DB = os.path.join(ROOT, 'data', 'drc', 'defacto.sqlite')
OUT = os.path.join(ROOT, 'public', 'data', 'drc-control.geojson')


def main():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    # cities that were split are drawn through their neighbourhoods only
    rows = con.execute('''
        select v.*, (select short_name from entity where id = v.controller_id) as controller_short,
               (select short_name from entity where id = v.sovereign_id) as sovereign_short
        from v_current_control v
        where not exists (select 1 from location n where n.parent_id = v.location_id)''').fetchall()
    feats = [{
        'type': 'Feature',
        'geometry': {'type': 'Point', 'coordinates': [round(r['lon'], 5), round(r['lat'], 5)]},
        'properties': {
            'id': r['location_id'], 'name': r['name'], 'kind': r['kind'], 'population': r['population'],
            'controller': r['controller_short'] or r['controller'], 'controller_id': r['controller_id'],
            'sovereign': r['sovereign_short'] or r['sovereign'], 'color': r['controller_color'] or r['sovereign_color'],
            'status': r['status'], 'confidence': r['confidence'],
        },
    } for r in rows]
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(OUT, 'w'), separators=(',', ':'))
    print(f'{len(feats)} features -> {OUT}')


if __name__ == '__main__':
    main()
