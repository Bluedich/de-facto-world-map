// Details panel for a clicked control point: loads the full record of its territory from
// public/data/drc-details/ (written by scripts/drc/export_geojson.py) and renders everything known about it.

const cache = new Map();
function load(file) {
  const url = `${import.meta.env.BASE_URL}data/drc-details/${file}.json`;
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }).catch((e) => { cache.delete(url); throw e; }));
  }
  return cache.get(url);
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const num = (v) => (v == null ? '' : Number(v).toLocaleString('en'));
const label = (v) => esc(String(v ?? '').replaceAll('_', ' '));

function row(name, value) {
  return value === '' || value == null ? '' : `<dt>${name}</dt><dd>${value}</dd>`;
}

function entityChip(entities, id) {
  const e = entities[id];
  if (!e) return esc(id);
  const color = e.color || entities[e.parent_id]?.color || '#888';
  return `<span class="chip" data-entity="${esc(id)}" title="Highlight ${esc(e.name)} on the map"><i style="background:${esc(color)}"></i>${esc(e.short_name || e.name)}</span>`;
}

function entityCard(entities, id) {
  const e = entities[id];
  if (!e) return `<p>${esc(id)}</p>`;
  const parent = e.parent_id ? entities[e.parent_id] : null;
  return `<div class="entity">
    <div class="entity-name">${entityChip(entities, id)} ${esc(e.name)}</div>
    <dl>
      ${row('Type', label(e.type))}
      ${row('Force', label(e.force_kind))}
      ${row('Part of', parent ? entityChip(entities, e.parent_id) + ' ' + esc(parent.name) : '')}
      ${row('Country', esc(e.country))}
      ${row('Also known as', esc(e.aliases))}
      ${row('Link', e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.url)}</a>` : '')}
    </dl>
    ${e.description ? `<p class="note-text">${esc(e.description)}</p>` : ''}
    ${e.needs_review ? '<p class="flag">Added by a research agent, not yet curated.</p>' : ''}
  </div>`;
}

function adminPath(admin, loc) {
  return [loc.adm3_pcode, loc.adm2_pcode, loc.adm1_pcode]
    .filter((p) => admin[p]).map((p) => `${esc(admin[p].name)} <span class="muted">${esc(p)}</span>`).join(', ');
}

function assessmentHtml(a, i, idx, shard, runs) {
  const { entities } = idx;
  const sources = (a.source_ids || []).map((id) => shard.sources[id]).filter(Boolean);
  return `<article class="assessment">
    <h3>${i === 0 ? 'Current assessment' : 'Earlier assessment'} · ${esc(a.as_of)}</h3>
    <dl>
      ${row('Controller', entityChip(entities, a.controller_id))}
      ${row('Sovereign', entityChip(entities, a.sovereign_id))}
      ${row('Status', label(a.status))}
      ${row('Confidence', label(a.confidence))}
      ${row('Basis', label(a.basis))}
      ${row('Since', esc(a.since))}
      ${row('Other actors', (a.presence || []).map((p) => `${entityChip(entities, p.entity_id)} <span class="muted">${label(p.role)}</span>`).join('<br>'))}
      ${row('Work unit', esc(a.unit))}
      ${row('Run', a.run_id ? esc(a.run_id) + (runs[a.run_id]?.method ? ` <span class="muted">(${label(runs[a.run_id].method)})</span>` : '') : '')}
    </dl>
    ${a.zone ? `<h4>Zone</h4><p>${esc(a.zone)}</p>` : ''}
    ${a.evidence ? `<h4>Evidence</h4><p>${esc(a.evidence)}</p>` : ''}
    ${sources.length ? `<h4>Sources</h4><ol class="sources">${sources.map((s) => `<li>
      <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a>
      <span class="muted">${[s.publisher, s.date].filter(Boolean).map(esc).join(', ')}</span></li>`).join('')}</ol>` : ''}
    ${shard.units?.[a.unit] ? `<details><summary>Unit summary (${esc(a.unit)})</summary><p>${esc(shard.units[a.unit])}</p></details>` : ''}
  </article>`;
}

function render(props, idx, shard) {
  const loc = shard.locations[props.id];
  if (!loc) return `<p>No record for ${esc(props.id)}.</p>`;
  const assessments = loc.assessments.map((i) => shard.assessments[i]);
  const parent = loc.parent_id ? shard.locations[loc.parent_id] : null;
  const current = assessments[0];
  const ids = new Set(assessments.flatMap((a) => [a.controller_id, a.sovereign_id]));
  return `
    <h2 class="title">${esc(loc.name)}</h2>
    <p class="muted">${label(loc.kind)}${parent ? ` of ${esc(parent.name)}` : ''} · ${num(loc.population)} people</p>
    <section>
      <h3>Location</h3>
      <dl>
        ${row('ID', `<code>${esc(props.id)}</code>`)}
        ${row('Admin', adminPath(idx.admin, loc))}
        ${row('Health zone', esc(loc.health_zone))}
        ${row('Health area', esc(loc.health_area))}
        ${row('Coordinates', `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}`)}
        ${row('Population', num(loc.population) + (loc.pop_source ? ` <span class="muted">${esc(loc.pop_source)}</span>` : ''))}
        ${row('Buildings', num(loc.building_count))}
        ${row('Extent', [loc.extent_type, loc.grid3_extent_id].filter(Boolean).map(esc).join(' · '))}
        ${row('Name source', esc(loc.name_source))}
        ${row('City', parent ? `${esc(parent.name)} <span class="muted">${num(parent.population)} people</span>` : '')}
      </dl>
      ${loc.alt_names ? `<details><summary>Other names</summary><p>${esc(loc.alt_names)}</p></details>` : ''}
    </section>
    <section>${assessments.map((a, i) => assessmentHtml(a, i, idx, shard, idx.runs)).join('')}</section>
    <section>
      <h3>Controlling ${ids.size > 1 ? 'entities' : 'entity'}</h3>
      ${[...ids].map((id) => entityCard(idx.entities, id)).join('')}
      ${current?.presence?.length ? `<details><summary>Other actors present</summary>${current.presence.map((p) => entityCard(idx.entities, p.entity_id)).join('')}</details>` : ''}
    </section>`;
}

let seq = 0;
export async function showDetails(props) {
  const el = document.getElementById('details');
  const body = el.querySelector('.body');
  const mine = ++seq;
  el.hidden = false;
  body.innerHTML = `<h2 class="title">${esc(props.name)}</h2><p class="muted">Loading…</p>`;
  try {
    const [idx, shard] = await Promise.all([load('index'), load(props.adm2 || 'none')]);
    if (mine === seq) body.innerHTML = render(props, idx, shard);
  } catch (e) {
    if (mine === seq) body.innerHTML += `<p class="flag">Could not load details: ${esc(e.message)}</p>`;
  }
  body.scrollTop = 0;
}

export function hideDetails() {
  document.getElementById('details').hidden = true;
  seq++;
}

// One line above the details: how many points the highlighted controller holds.
export function showHighlightSummary(html) {
  document.querySelector('#details .highlight-info').innerHTML = html;
}

export const loadIndex = () => load('index');

// onClose: details closed; onEntity(id): an entity chip was clicked.
export function initDetails({ onClose, onEntity } = {}) {
  const el = document.getElementById('details');
  el.querySelector('.close').addEventListener('click', () => { hideDetails(); onClose?.(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.hidden) { hideDetails(); onClose?.(); }
  });
  el.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-entity]');
    if (!chip) return;
    el.querySelectorAll('.chip.active').forEach((c) => c.classList.remove('active'));
    el.querySelectorAll(`.chip[data-entity="${CSS.escape(chip.dataset.entity)}"]`).forEach((c) => c.classList.add('active'));
    onEntity?.(chip.dataset.entity);
  });
}
