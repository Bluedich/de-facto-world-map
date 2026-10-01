"""Build data/drc/defacto.sqlite from the schema, entity catalogue, admin units, locations and assessments.

Usage: python3 scripts/drc/build_db.py   (rebuilds from scratch; raw admin boundaries needed only for admin names)
"""
import csv
import glob
import json
import os
import sqlite3

from validate_assessment import validate

HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, '..', '..')
DATA = os.path.join(ROOT, 'data', 'drc')
DB = os.path.join(DATA, 'defacto.sqlite')
RUN_ID = 'drc-swarm-1'


def top_parent(entities, eid):
    while entities[eid].get('parent_id'):
        eid = entities[eid]['parent_id']
    return eid


def main():
    if os.path.exists(DB):
        os.remove(DB)
    con = sqlite3.connect(DB)
    con.executescript(open(os.path.join(HERE, 'schema.sql')).read())

    entities = {e['id']: e for e in json.load(open(os.path.join(HERE, 'entities.json')))}
    assessments = []
    for path in sorted(glob.glob(os.path.join(DATA, 'assessments', '*.json'))):
        errs = validate(path)
        if errs:
            print(f'SKIP {os.path.basename(path)}: {errs[:3]}')
            continue
        a = json.load(open(path))
        for e in a.get('new_entities', []):
            if e['id'] not in entities:
                entities[e['id']] = dict(e, needs_review=1)
        assessments.append(a)

    # insert parents before children
    done = set()
    def insert_entity(e):
        if e['id'] in done:
            return
        if e.get('parent_id'):
            insert_entity(entities[e['parent_id']])
        con.execute('insert into entity (id, name, short_name, aliases, type, parent_id, force_kind, color, country, '
                    'description, url, needs_review) values (?,?,?,?,?,?,?,?,?,?,?,?)',
                    (e['id'], e['name'], e.get('short_name'), e.get('aliases'), e['type'], e.get('parent_id'),
                     e.get('force_kind'), e.get('color'), e.get('country'), e.get('description'), e.get('url'),
                     e.get('needs_review', 0)))
        done.add(e['id'])
    for e in entities.values():
        insert_entity(e)

    rows = list(csv.DictReader(open(os.path.join(DATA, 'locations.csv'))))
    admin = {}
    for r in rows:
        admin[r['adm1_pcode']] = (r['adm1_name'], 1, None)
        admin[r['adm2_pcode']] = (r['adm2_name'], 2, r['adm1_pcode'])
        admin[r['adm3_pcode']] = (r['adm3_name'], 3, r['adm2_pcode'])
    for level in (1, 2, 3):
        for pcode, (name, lvl, parent) in sorted(admin.items()):
            if lvl == level and pcode:
                con.execute('insert into admin_unit values (?,?,?,?)', (pcode, name, lvl, parent))

    num = lambda v, t=int: t(v) if v not in ('', None) else None
    for r in sorted(rows, key=lambda r: r['kind'] != 'settlement'):
        con.execute('insert into location values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (
            r['loc_id'], r['kind'], r['name'], r['alt_names'] or None, r['parent_loc_id'] or None,
            float(r['lat']), float(r['lon']), num(r['population']), 'GRID3 COD population v4.4 (100 m)',
            num(r['building_count']), r['extent_type'], r['grid3_extent_id'], r['adm1_pcode'] or None,
            r['adm2_pcode'] or None, r['adm3_pcode'] or None, r['health_zone'], r['health_zone_id'],
            r['health_area'], r['health_area_id'], r['name_source']))

    con.execute("insert into run values (?, datetime('now'), 'agent_swarm', null, ?)",
                (RUN_ID, 'One research agent per territory/city unit; see scripts/drc/agent_prompt.md'))
    n = 0
    for a in assessments:
        src_ids = {}
        for s in a.get('sources', []):
            con.execute('insert or ignore into source (url, title, publisher, date) values (?,?,?,?)',
                        (s['url'], s.get('title'), s.get('publisher'), s.get('date')))
            src_ids[s['id']] = con.execute('select id from source where url=?', (s['url'],)).fetchone()[0]
        zones = {z['zone_id']: z for z in a['zones']}
        for loc_id, zid in a['locations'].items():
            z = zones[zid]
            cur = con.execute(
                'insert into control_assessment (location_id, controller_id, sovereign_id, status, confidence, '
                'as_of, since, basis, evidence, unit, run_id) values (?,?,?,?,?,?,?,?,?,?,?)',
                (loc_id, z['controller_id'], top_parent(entities, z['controller_id']), z['status'],
                 z['confidence'], a['as_of'], z.get('since'), z['basis'],
                 f"[{z.get('description', '')}] {z['evidence']}", a['unit_id'], RUN_ID))
            aid = cur.lastrowid
            for p in z.get('presence', []):
                con.execute('insert or ignore into assessment_presence values (?,?,?)', (aid, p['entity_id'], p['role']))
            for sid in z.get('source_ids', []):
                con.execute('insert or ignore into assessment_source values (?,?)', (aid, src_ids[sid]))
            n += 1
    con.commit()
    total = con.execute('select count(*) from location').fetchone()[0]
    print(f'{len(entities)} entities, {total} locations, {n} assessments from {len(assessments)} units')
    con.execute('vacuum')
    con.close()


if __name__ == '__main__':
    main()
