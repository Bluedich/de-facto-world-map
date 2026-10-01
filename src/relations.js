// How each control point relates to a selected entity. One classifier for OpenLayers/Leaflet/Cesium
// and an equivalent MapLibre expression, so all libraries highlight the same points.
//
// Selection context: { entity, sovereign, allies: [entity ids], id: clicked point id or null }
// Relations, highest priority first:
//   controlled  the entity controls the point
//   contesting  the entity contests it (presence role)
//   raiding     the entity raids it (presence role)
//   sovereign   controlled by another force of the same sovereign
//   allied      controlled by an ally (the two appear as 'allied' at each other's locations)
//   present     the entity is otherwise present there
// Points keep their own fill; the relation is shown by the outline colour (white for controlled).

export const RELATIONS = [
  { id: 'controlled', label: 'controlled' },
  { id: 'contesting', label: 'contested', color: '#e41a1c' },
  { id: 'raiding', label: 'raided', color: '#ffd92f' },
  { id: 'sovereign', label: 'same sovereign', color: '#4daf4a' },
  { id: 'allied', label: 'allied', color: '#377eb8' },
  { id: 'present', label: 'present', color: '#b07cc6' },
];
export const RELATION_COLOR = Object.fromEntries(RELATIONS.map((r) => [r.id, r.color]));

const has = (p, entity, role) => (p.presence || '').includes(`|${entity}:${role}|`);

export function classify(p, ctx) {
  const e = ctx.entity;
  if (p.controller_id === e) return 'controlled';
  if (has(p, e, 'contesting')) return 'contesting';
  if (has(p, e, 'raiding')) return 'raiding';
  if (ctx.sovereign && p.sovereign_id === ctx.sovereign) return 'sovereign';
  if (ctx.allies.includes(p.controller_id)) return 'allied';
  if (has(p, e, 'present')) return 'present';
  return null;
}

// Same logic as classify(), as a MapLibre expression returning the relation id or 'none'.
export function relationExpression(ctx) {
  const e = ctx.entity;
  const presence = ['coalesce', ['get', 'presence'], ''];
  return ['case',
    ['==', ['get', 'controller_id'], e], 'controlled',
    ['in', `|${e}:contesting|`, presence], 'contesting',
    ['in', `|${e}:raiding|`, presence], 'raiding',
    ['==', ['get', 'sovereign_id'], ctx.sovereign ?? ''], 'sovereign',
    ['in', ['get', 'controller_id'], ['literal', ctx.allies]], 'allied',
    ['in', `|${e}:present|`, presence], 'present',
    'none'];
}

function rootOf(entities, id) {
  let e = id;
  for (let i = 0; i < 10 && entities[e]?.parent_id; i++) e = entities[e].parent_id;
  return e;
}

// Builds the selection context for `entity` from the control points and the entity index.
export function buildContext(entity, features, entities, pointId = null) {
  const own = features.find((f) => f.properties.controller_id === entity);
  const sovereign = own?.properties.sovereign_id || rootOf(entities, entity);
  const allies = new Set();
  for (const { properties: p } of features) {
    if (has(p, entity, 'allied')) allies.add(p.controller_id);
    if (p.controller_id === entity && p.presence) {
      for (const m of p.presence.matchAll(/\|([^|:]+):allied(?=\|)/g)) allies.add(m[1]);
    }
  }
  allies.delete(entity);
  return { entity, sovereign, allies: [...allies], id: pointId };
}

// Counts and population per relation, for the summary line.
export function summarize(features, ctx) {
  const out = {};
  for (const { properties: p } of features) {
    const r = classify(p, ctx);
    if (!r) continue;
    out[r] ??= { count: 0, people: 0 };
    out[r].count++;
    out[r].people += p.population || 0;
  }
  return out;
}
