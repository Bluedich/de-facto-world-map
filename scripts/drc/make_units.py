"""Split data/drc/locations.csv into agent work units (one per territory/ville; big ones chunked by adm3).

Output: data/drc/units/<unit_id>.json and data/drc/units/index.json
"""
import csv
import json
import os
import re
import unicodedata
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
SRC = os.path.join(ROOT, 'data', 'drc', 'locations.csv')
OUT = os.path.join(ROOT, 'data', 'drc', 'units')
MAX_LOCATIONS = 200
KEEP = ['loc_id', 'kind', 'name', 'alt_names', 'parent_loc_id', 'lat', 'lon', 'population', 'adm3_name',
        'health_zone', 'health_area']


def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def main():
    rows = list(csv.DictReader(open(SRC)))
    by_adm2 = defaultdict(list)
    for r in rows:
        by_adm2[(r['adm1_name'], r['adm2_pcode'], r['adm2_name'])].append(r)

    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        os.remove(os.path.join(OUT, f))
    index = []
    for (adm1, pcode, adm2), locs in sorted(by_adm2.items()):
        # chunk large units by adm3 (commune/secteur/chefferie), keeping each adm3 whole
        chunks, cur = [], []
        by_adm3 = defaultdict(list)
        for r in locs:
            by_adm3[r['adm3_name']].append(r)
        for adm3 in sorted(by_adm3, key=lambda a: -sum(int(r['population']) for r in by_adm3[a])):
            if cur and len(cur) + len(by_adm3[adm3]) > MAX_LOCATIONS:
                chunks.append(cur)
                cur = []
            cur.extend(by_adm3[adm3])
        chunks.append(cur)
        for i, chunk in enumerate(chunks):
            uid = f'{pcode}-{slug(adm2)}' + (f'-{i + 1}' if len(chunks) > 1 else '')
            unit = dict(unit_id=uid, province=adm1, territory=adm2, adm2_pcode=pcode,
                        part=f'{i + 1}/{len(chunks)}', adm3_in_unit=sorted({r['adm3_name'] for r in chunk}),
                        population=sum(int(r['population']) for r in chunk if r['kind'] == 'settlement'),
                        locations=[{k: r[k] for k in KEEP} for r in chunk])
            json.dump(unit, open(os.path.join(OUT, uid + '.json'), 'w'), ensure_ascii=False, indent=0)
            index.append(dict(unit_id=uid, province=adm1, territory=adm2, part=unit['part'],
                              n_locations=len(chunk), population=unit['population']))
    json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'{len(index)} units, {len(rows)} locations, max {max(u["n_locations"] for u in index)} per unit')


if __name__ == '__main__':
    main()
