"""Export current control per location from data/drc/defacto.sqlite to public/data/drc-control.geojson,
plus the full record behind each point (location, all assessments, presence, sources, entities) to
public/data/drc-details/: one file per territory (adm2) and index.json with entities, admin names and runs.
The map loads a territory's file when a point in it is clicked."""
import glob
import json
import os
import re
import shutil
import sqlite3

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
DB = os.path.join(ROOT, 'data', 'drc', 'defacto.sqlite')
OUT = os.path.join(ROOT, 'public', 'data', 'drc-control.geojson')
DETAILS = os.path.join(ROOT, 'public', 'data', 'drc-details')


def dump(obj, path):
    json.dump(obj, open(path, 'w'), separators=(',', ':'), ensure_ascii=False)


def export_points(con):
    # cities that were split are drawn through their neighbourhoods only
    rows = con.execute('''
        select v.*, (select short_name from entity where id = v.controller_id) as controller_short,
               (select short_name from entity where id = v.sovereign_id) as sovereign_short
        from v_current_control v
        where not exists (select 1 from location n where n.parent_id = v.location_id)''').fetchall()
    # Other actors at each location in its current assessment, as '|entity:role|entity:role|' so the map
    # can test membership with a plain substring match.
    presence = dict(con.execute('''
        select l.id, '|' || group_concat(p.entity_id || ':' || p.role, '|') || '|'
        from location l
        join assessment_presence p on p.assessment_id = (
          select id from control_assessment where location_id = l.id order by as_of desc, id desc limit 1)
        group by l.id''').fetchall())
    feats = [{
        'type': 'Feature',
        'geometry': {'type': 'Point', 'coordinates': [round(r['lon'], 5), round(r['lat'], 5)]},
        'properties': {
            'id': r['location_id'], 'name': r['name'], 'kind': r['kind'], 'population': r['population'],
            'controller': r['controller_short'] or r['controller'], 'controller_id': r['controller_id'],
            'sovereign': r['sovereign_short'] or r['sovereign'], 'sovereign_id': r['sovereign_id'],
            **({'presence': presence[r['location_id']]} if r['location_id'] in presence else {}),
            'color': r['controller_color'] or r['sovereign_color'],
            'status': r['status'], 'confidence': r['confidence'], 'adm2': r['adm2_pcode'],
        },
    } for r in rows]
    dump({'type': 'FeatureCollection', 'features': feats}, OUT)
    print(f'{len(feats)} features -> {OUT}')


def export_details(con):
    if os.path.exists(DETAILS):
        shutil.rmtree(DETAILS)
    os.makedirs(DETAILS)

    entities = {r['id']: {k: r[k] for k in r.keys() if k != 'id' and r[k] not in (None, '')}
                for r in con.execute('select * from entity')}
    admin = {r['pcode']: {'name': r['name'], 'level': r['level'], 'parent': r['parent']}
             for r in con.execute('select * from admin_unit')}
    runs = {r['id']: {k: r[k] for k in r.keys() if k != 'id'} for r in con.execute('select * from run')}
    dump({'entities': entities, 'admin': admin, 'runs': runs}, os.path.join(DETAILS, 'index.json'))

    sources = {r['id']: {k: r[k] for k in ('url', 'title', 'publisher', 'date') if r[k]}
               for r in con.execute('select * from source')}
    presence, cited = {}, {}
    for r in con.execute('select * from assessment_presence order by role, entity_id'):
        presence.setdefault(r['assessment_id'], []).append({'entity_id': r['entity_id'], 'role': r['role']})
    for r in con.execute('select * from assessment_source order by source_id'):
        cited.setdefault(r['assessment_id'], []).append(r['source_id'])

    # Assessments of one zone share evidence, presence and sources: store each distinct one once per file.
    shards = {}
    for a in con.execute('select * from control_assessment order by as_of desc, id desc'):
        loc = a['location_id']
        adm2 = con.execute('select adm2_pcode from location where id = ?', (loc,)).fetchone()[0] or 'none'
        shard = shards.setdefault(adm2, {'assessments': [], 'keys': {}, 'sources': {}, 'locations': {}})
        m = re.match(r'\[(.*?)\] (.*)', a['evidence'] or '', re.S)
        zone, evidence = (m.group(1), m.group(2)) if m else (None, a['evidence'])
        rec = {
            'controller_id': a['controller_id'], 'sovereign_id': a['sovereign_id'], 'status': a['status'],
            'confidence': a['confidence'], 'basis': a['basis'], 'as_of': a['as_of'], 'since': a['since'],
            'zone': zone or None, 'evidence': evidence, 'unit': a['unit'], 'run_id': a['run_id'],
            'presence': presence.get(a['id'], []), 'source_ids': cited.get(a['id'], []),
        }
        rec = {k: v for k, v in rec.items() if v not in (None, '', [])}
        key = json.dumps(rec, sort_keys=True)
        if key not in shard['keys']:
            shard['keys'][key] = len(shard['assessments'])
            shard['assessments'].append(rec)
            for sid in rec.get('source_ids', []):
                shard['sources'][sid] = sources[sid]
        shard['locations'].setdefault(loc, []).append(shard['keys'][key])

    loc_cols = ('kind', 'name', 'alt_names', 'parent_id', 'lat', 'lon', 'population', 'pop_source', 'building_count',
                'extent_type', 'grid3_extent_id', 'adm1_pcode', 'adm2_pcode', 'adm3_pcode', 'health_zone',
                'health_area', 'name_source')
    # unit-level research summaries (not in the DB)
    summaries = {}
    for path in glob.glob(os.path.join(ROOT, 'data', 'drc', 'assessments', '*.json')):
        a = json.load(open(path))
        if a.get('summary'):
            summaries[a['unit_id']] = a['summary']

    for adm2, shard in shards.items():
        ids = list(shard['locations'])
        locations = {}
        for i in range(0, len(ids), 500):
            chunk = ids[i:i + 500]
            for r in con.execute(f'select * from location where id in ({",".join("?" * len(chunk))})', chunk):
                rec = {k: r[k] for k in loc_cols if r[k] not in (None, '')}
                rec['assessments'] = shard['locations'][r['id']]
                locations[r['id']] = rec
        # parent cities of neighbourhoods, for their names
        parents = {l['parent_id'] for l in locations.values() if l.get('parent_id')} - set(locations)
        for p in parents:
            r = con.execute('select name, population from location where id = ?', (p,)).fetchone()
            locations[p] = {'name': r['name'], 'population': r['population']}
        units = {a['unit']: summaries[a['unit']] for a in shard['assessments'] if a.get('unit') in summaries}
        dump({'locations': locations, 'assessments': shard['assessments'], 'sources': shard['sources'], 'units': units},
             os.path.join(DETAILS, f'{adm2}.json'))
    print(f'{len(shards)} detail files -> {DETAILS}')


def main():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    export_points(con)
    export_details(con)


if __name__ == '__main__':
    main()
