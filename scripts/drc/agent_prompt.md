# De facto control assessment – agent instructions

You assess **who has de facto control** of every location in one work unit (a DRC territory or city, or part of
one). Reference date: the `as_of` date given in your task (assess the situation as of that date).

## Definition (from README)

The controller is the group/institution that holds the **monopoly of violence (or close to it) most of the time**:
the main group that uses force to keep order, detain people, settle disputes, levy taxes/extort, punish.

- Occasional raids by another actor do not change control. Gang runs the neighbourhood and police raid every
  few months → gang. Gang present and sometimes violent but police have a permanent post and handle justice → police.
- Non-state groups (rebels, militias, gangs, terrorists): controller = the group.
- States and quasi-states (DRC, AFC/M23, foreign armies): pick the specific force that actually holds the place
  (e.g. `cod-pnc` police in a calm town, `cod-fardc` where the army is the main permanent force or in operation
  zones, `afc-m23-police` / `afc-m23-arc` in M23 areas). Use the parent (`cod`, `afc-m23`) only if the force is unknown.
- Pro-government Wazalendo groups that rule a place on their own (own taxation, justice, roadblocks, little FARDC
  presence) are the controller themselves (their specific group entity), with `cod-fardc` as `allied` presence.
  Use `cod-wazalendo` only when the specific group is unknown.
- Default for places with no reported armed-group activity: the state force actually present (usually `cod-pnc`
  in towns and larger villages; `cod-fardc` in garrison/military-run areas), with `basis: default_state_presence`.
  Do not invent armed-group control without a source; do not assume state control in areas known to be held by
  armed groups.

## Inputs

- Unit file: `data/drc/units/<unit_id>.json` – locations with id, name, alternative names, coordinates,
  population, `adm3_name` (secteur/chefferie/commune), `health_zone`, `health_area`. Neighbourhoods
  (`kind: neighbourhood`) are parts of a city given by `parent_loc_id`; they are named after health areas.
- Entity catalogue: `scripts/drc/entities.json`. Use these ids. If a controller is missing, add it to
  `new_entities` (lowercase slug id, type, parent_id if it is a sub-force, short description).

## Notes on data and tools

- `adm3_name` comes from OCHA boundaries and is sometimes a groupement or health-zone name rather than the
  secteur/chefferie; health zone/area names are reliable and are what most security reports and OCHA use.
- Location names are GRID3 locality names; a place can share a name with a different town elsewhere – check
  coordinates.
- Some sites block WebFetch (e.g. Wikipedia, radiookapi.net); search-result summaries are usable evidence.
  Double-check event dates in summaries – they are sometimes wrong.

## Method

1. Research the unit's security situation as of the reference date with WebSearch/WebFetch. Good sources: Kivu
   Security Tracker (kivusecurity.org), ACLED, UN Group of Experts and Secretary-General reports, MONUSCO, OCHA /
   ReliefWeb situation reports, Radio Okapi, Actualite.cd, 7sur7.cd, Mediacongo, Reuters/AFP/BBC, Crisis Group,
   Congo Research Group / Ebuteli, IPIS maps. Search in French and English, by territory, secteur/chefferie,
   groupement, health zone and main town names.
2. Identify zones of control: which armed actors hold which secteurs/chefferies/groupements/axes/towns, where
   frontlines run, which towns are state-held. Prefer recent (last 12 months) information; note dates.
3. Group locations into **zones** that share one assessment (e.g. "Chefferie de Bwisha north of Rutshuru –
   M23", "Kinshasa communes – PNC"). A zone can contain one location or hundreds. Use locations' adm3,
   health zone and coordinates to assign them; write a small Python script for the assignment when
   there are many locations (e.g. rules on adm3/health zone, or lat/lon relative to a frontline).
4. For each zone record controller, status (`exclusive` | `dominant` | `contested` | `unclear`), confidence
   (`high` | `medium` | `low`), basis (`specific_report` | `area_report` | `default_state_presence` |
   `inference`), `since` (YYYY-MM or YYYY-MM-DD if known, else null), other actors present with role
   (`contesting` | `raiding` | `present` | `allied`), a 1–3 sentence evidence summary and the source ids used.
   Be honest about confidence: most rural villages will be `area_report` or `default_state_presence` with
   medium/low confidence.
5. Every location in the unit must be assigned to exactly one zone.

## Output

Write `data/drc/assessments/<unit_id>.json`:

```json
{
  "unit_id": "CD6102-rutshuru",
  "as_of": "2026-10-01",
  "summary": "3–6 sentence overview of who controls what in the unit.",
  "sources": [{"id": "s1", "url": "https://...", "title": "...", "publisher": "...", "date": "2026-08-14"}],
  "new_entities": [],
  "zones": [
    {"zone_id": "z1", "description": "Rutshuru centre, Kiwanja, Bwisha chefferie",
     "controller_id": "afc-m23-arc", "status": "exclusive", "confidence": "high", "basis": "specific_report",
     "since": "2022-06", "presence": [{"entity_id": "rwa-rdf", "role": "allied"}],
     "evidence": "...", "source_ids": ["s1"]}
  ],
  "locations": {"cod-35MQU...": "z1"}
}
```

Then run `python3 scripts/drc/validate_assessment.py data/drc/assessments/<unit_id>.json` and fix every error
until it prints `OK`. Do not edit any other file in the repository. Do not commit.
