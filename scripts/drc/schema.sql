-- De facto control database (DRC first). See README "De facto control".
PRAGMA foreign_keys = ON;

-- Who can control territory. Top-level entities (parent_id NULL) are states or independent armed groups
-- and carry a base colour; sub-entities (army, police, armed wing...) carry a shade of their parent's colour.
CREATE TABLE entity (
  id            TEXT PRIMARY KEY,           -- slug, e.g. 'cod-fardc', 'm23-arc'
  name          TEXT NOT NULL,
  short_name    TEXT,
  aliases       TEXT,                       -- '; '-separated
  type          TEXT NOT NULL CHECK (type IN (
                  'state', 'state_force', 'quasi_state', 'quasi_state_force', 'rebel_group', 'armed_group',
                  'militia', 'militia_coalition', 'self_defence', 'gang', 'terrorist_group',
                  'foreign_state_force', 'international_force', 'customary_authority', 'other')),
  parent_id     TEXT REFERENCES entity(id), -- sovereign/umbrella over this entity (police -> state)
  force_kind    TEXT,                       -- for sub-entities: army, police, gendarmerie, guard, intelligence, admin
  color         TEXT,                       -- hex; base colour for top-level, shade for sub-entities
  country       TEXT,                       -- ISO3 of state / home country of the group
  description   TEXT,
  url           TEXT,
  needs_review  INTEGER NOT NULL DEFAULT 0  -- added by an agent, not yet curated
);

-- OCHA COD-AB administrative units (1 province, 2 territory/ville, 3 secteur/chefferie/commune).
CREATE TABLE admin_unit (
  pcode     TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  level     INTEGER NOT NULL,
  parent    TEXT REFERENCES admin_unit(pcode)
);

-- Places whose controller is assessed: settlements (>= 1000 people) and neighbourhoods of large cities.
CREATE TABLE location (
  id               TEXT PRIMARY KEY,        -- 'cod-<grid3 extent>' or 'cod-<extent>-<health area uid>'
  kind             TEXT NOT NULL CHECK (kind IN ('settlement', 'neighbourhood')),
  name             TEXT NOT NULL,
  alt_names        TEXT,
  parent_id        TEXT REFERENCES location(id),   -- neighbourhood -> city
  lat              REAL NOT NULL,
  lon              REAL NOT NULL,
  population       INTEGER,
  pop_source       TEXT,
  building_count   INTEGER,
  extent_type      TEXT,
  grid3_extent_id  TEXT,
  adm1_pcode       TEXT REFERENCES admin_unit(pcode),
  adm2_pcode       TEXT REFERENCES admin_unit(pcode),
  adm3_pcode       TEXT REFERENCES admin_unit(pcode),
  health_zone      TEXT,
  health_zone_id   TEXT,
  health_area      TEXT,
  health_area_id   TEXT,
  name_source      TEXT
);
CREATE INDEX location_adm2 ON location(adm2_pcode);

-- One batch of assessments (e.g. one agent swarm run).
CREATE TABLE run (
  id           TEXT PRIMARY KEY,
  started_at   TEXT,
  method       TEXT,                        -- 'agent_swarm', 'manual', ...
  model        TEXT,
  notes        TEXT
);

-- Who controls a location at a given date. Several assessments per location over time / runs.
CREATE TABLE control_assessment (
  id                INTEGER PRIMARY KEY,
  location_id       TEXT NOT NULL REFERENCES location(id),
  controller_id     TEXT NOT NULL REFERENCES entity(id),  -- most specific entity (e.g. PNC, not DRC)
  sovereign_id      TEXT NOT NULL REFERENCES entity(id),  -- top-level ancestor of controller (denormalised)
  status            TEXT NOT NULL CHECK (status IN ('exclusive', 'dominant', 'contested', 'unclear')),
  confidence        TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  as_of             TEXT NOT NULL,          -- ISO date the assessment describes
  since             TEXT,                   -- when this controller took over, if known
  basis             TEXT CHECK (basis IN ('specific_report', 'area_report', 'default_state_presence', 'inference')),
  evidence          TEXT,                   -- short justification
  unit              TEXT,                   -- swarm unit that produced it
  run_id            TEXT REFERENCES run(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX assessment_location ON control_assessment(location_id);

-- Other entities present: contesting control, raiding, or present without control.
CREATE TABLE assessment_presence (
  assessment_id  INTEGER NOT NULL REFERENCES control_assessment(id) ON DELETE CASCADE,
  entity_id      TEXT NOT NULL REFERENCES entity(id),
  role           TEXT NOT NULL CHECK (role IN ('contesting', 'raiding', 'present', 'allied')),
  PRIMARY KEY (assessment_id, entity_id)
);

CREATE TABLE source (
  id         INTEGER PRIMARY KEY,
  url        TEXT UNIQUE NOT NULL,
  title      TEXT,
  publisher  TEXT,
  date       TEXT
);

CREATE TABLE assessment_source (
  assessment_id  INTEGER NOT NULL REFERENCES control_assessment(id) ON DELETE CASCADE,
  source_id      INTEGER NOT NULL REFERENCES source(id),
  PRIMARY KEY (assessment_id, source_id)
);

-- Latest assessment per location, with names and colours ready for mapping.
CREATE VIEW v_current_control AS
SELECT l.id AS location_id, l.kind, l.name, l.lat, l.lon, l.population, l.adm1_pcode, l.adm2_pcode,
       a.controller_id, c.name AS controller, c.color AS controller_color,
       a.sovereign_id, s.name AS sovereign, s.color AS sovereign_color,
       a.status, a.confidence, a.basis, a.as_of, a.evidence
FROM location l
JOIN control_assessment a ON a.id = (
  SELECT id FROM control_assessment WHERE location_id = l.id ORDER BY as_of DESC, id DESC LIMIT 1)
JOIN entity c ON c.id = a.controller_id
JOIN entity s ON s.id = a.sovereign_id;
