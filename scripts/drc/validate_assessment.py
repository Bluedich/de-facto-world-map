"""Validate an agent assessment file against its unit and the entity catalogue.

Usage: python3 scripts/drc/validate_assessment.py data/drc/assessments/<unit_id>.json
Exit code 0 and 'OK' when valid; otherwise prints every problem.

File format (see scripts/drc/agent_prompt.md):
{
  "unit_id": "...", "as_of": "YYYY-MM-DD", "summary": "...",
  "sources": [{"id": "s1", "url": "...", "title": "...", "publisher": "...", "date": "YYYY-MM-DD"}],
  "new_entities": [{"id": "...", "name": "...", "type": "...", "parent_id": null, "description": "..."}],
  "zones": [{"zone_id": "z1", "description": "...", "controller_id": "cod-pnc", "status": "dominant",
             "confidence": "medium", "basis": "area_report", "since": null,
             "presence": [{"entity_id": "adf", "role": "raiding"}], "evidence": "...", "source_ids": ["s1"]}],
  "locations": {"<loc_id>": "z1", ...}
}
"""
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
STATUS = {'exclusive', 'dominant', 'contested', 'unclear'}
CONF = {'high', 'medium', 'low'}
BASIS = {'specific_report', 'area_report', 'default_state_presence', 'inference'}
ROLES = {'contesting', 'raiding', 'present', 'allied'}
TYPES = {'state', 'state_force', 'quasi_state', 'quasi_state_force', 'rebel_group', 'armed_group', 'militia',
         'militia_coalition', 'self_defence', 'gang', 'terrorist_group', 'foreign_state_force',
         'international_force', 'customary_authority', 'other'}


def validate(path):
    errs = []
    a = json.load(open(path))
    unit_path = os.path.join(ROOT, 'data', 'drc', 'units', f'{a.get("unit_id")}.json')
    if not os.path.exists(unit_path):
        return [f'unknown unit_id {a.get("unit_id")!r}']
    unit = json.load(open(unit_path))
    entities = {e['id'] for e in json.load(open(os.path.join(ROOT, 'scripts', 'drc', 'entities.json')))}
    for e in a.get('new_entities', []):
        if not re.fullmatch(r'[a-z0-9-]+', e.get('id', '')):
            errs.append(f'new entity id must be a lowercase slug: {e.get("id")!r}')
        if e.get('id') in entities:
            errs.append(f'new entity {e["id"]} already exists in entities.json')
        if e.get('type') not in TYPES:
            errs.append(f'new entity {e.get("id")}: bad type {e.get("type")!r}')
        if not e.get('name'):
            errs.append(f'new entity {e.get("id")}: missing name')
        entities.add(e.get('id'))
    for e in a.get('new_entities', []):
        if e.get('parent_id') and e['parent_id'] not in entities:
            errs.append(f'new entity {e["id"]}: unknown parent {e["parent_id"]}')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', a.get('as_of', '')):
        errs.append('as_of must be YYYY-MM-DD')
    src_ids = {s.get('id') for s in a.get('sources', [])}
    for s in a.get('sources', []):
        if not str(s.get('url', '')).startswith('http'):
            errs.append(f'source {s.get("id")}: url must be http(s)')
    zones = {}
    for z in a.get('zones', []):
        zid = z.get('zone_id')
        zones[zid] = z
        if z.get('controller_id') not in entities:
            errs.append(f'zone {zid}: unknown controller_id {z.get("controller_id")!r}')
        if z.get('status') not in STATUS:
            errs.append(f'zone {zid}: bad status {z.get("status")!r}')
        if z.get('confidence') not in CONF:
            errs.append(f'zone {zid}: bad confidence {z.get("confidence")!r}')
        if z.get('basis') not in BASIS:
            errs.append(f'zone {zid}: bad basis {z.get("basis")!r}')
        if not z.get('evidence'):
            errs.append(f'zone {zid}: evidence is required')
        for p in z.get('presence', []):
            if p.get('entity_id') not in entities:
                errs.append(f'zone {zid}: unknown presence entity {p.get("entity_id")!r}')
            if p.get('role') not in ROLES:
                errs.append(f'zone {zid}: bad presence role {p.get("role")!r}')
        for sid in z.get('source_ids', []):
            if sid not in src_ids:
                errs.append(f'zone {zid}: unknown source id {sid!r}')
    expected = {l['loc_id'] for l in unit['locations']}
    got = a.get('locations', {})
    missing = expected - set(got)
    extra = set(got) - expected
    if missing:
        errs.append(f'{len(missing)} locations not assigned, e.g. {sorted(missing)[:5]}')
    if extra:
        errs.append(f'{len(extra)} unknown location ids, e.g. {sorted(extra)[:5]}')
    bad = {z for z in got.values() if z not in zones}
    if bad:
        errs.append(f'locations point to unknown zones {sorted(bad)[:5]}')
    return errs


if __name__ == '__main__':
    errs = validate(sys.argv[1])
    print('\n'.join(errs) if errs else 'OK')
    sys.exit(1 if errs else 0)
