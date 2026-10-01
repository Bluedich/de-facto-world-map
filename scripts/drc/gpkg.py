"""Minimal GeoPackage helpers (a .gpkg is a SQLite file; geometries are GPKG blobs wrapping WKB)."""
import sqlite3

import shapely

_ENVELOPE_BYTES = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}


def strip_header(blob):
    flags = blob[3]
    return blob[8 + _ENVELOPE_BYTES[(flags >> 1) & 0b111]:]


def read_table(path, columns, table=None, where=''):
    """Return (rows, geometries) for a GeoPackage feature table. columns excludes the geometry column."""
    con = sqlite3.connect(path)
    if table is None:
        table = con.execute("select table_name from gpkg_contents where data_type='features'").fetchone()[0]
    geom_col = con.execute('select column_name from gpkg_geometry_columns where table_name=?', (table,)).fetchone()[0]
    cols = ', '.join(f'"{c}"' for c in columns)
    rows, blobs = [], []
    for r in con.execute(f'select {cols}, "{geom_col}" from "{table}" {where}'):
        rows.append(r[:-1])
        blobs.append(strip_header(r[-1]) if r[-1] else None)
    con.close()
    return rows, shapely.from_wkb(blobs)
