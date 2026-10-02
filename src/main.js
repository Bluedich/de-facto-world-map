import { BASEMAPS, OVERLAYS, LIBRARIES, POP_CUTOFFS, byId, configureWorldpop, loadGeoJSON } from './catalog.js';
import { initDetails, showDetails, hideDetails, showHighlightSummary, loadIndex } from './details.js';
import { RELATIONS, buildContext, summarize } from './relations.js';

const adapters = {
  maplibre: () => import('./adapters/maplibre.js'),
  cesium: () => import('./adapters/cesium.js'),
  openlayers: () => import('./adapters/openlayers.js'),
  leaflet: () => import('./adapters/leaflet.js'),
};

const DEFAULTS = {
  lib: 'maplibre', base: 'esri-imagery', overlays: ['hillshade', 'labels'],
  globe: true, terrain: true, exaggeration: 1.5,
  popOpacity: 0.5, popMin: 50,
  view: { lon: 30, lat: 25, zoom: 2 },
};

// ---- state <-> URL hash ----
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const s = structuredClone(DEFAULTS);
  if (adapters[p.get('lib')]) s.lib = p.get('lib');
  if (byId(BASEMAPS, p.get('base'))) s.base = p.get('base');
  if (p.has('ov')) s.overlays = p.get('ov').split(',').filter((id) => byId(OVERLAYS, id));
  if (p.has('globe')) s.globe = p.get('globe') === '1';
  if (p.has('terrain')) s.terrain = p.get('terrain') === '1';
  if (p.has('ex')) s.exaggeration = Number(p.get('ex')) || DEFAULTS.exaggeration;
  if (p.has('popop')) s.popOpacity = Math.min(1, Math.max(0, Number(p.get('popop')))) || DEFAULTS.popOpacity;
  if (POP_CUTOFFS.includes(Number(p.get('popmin')))) s.popMin = Number(p.get('popmin'));
  if (p.has('at')) {
    const [zoom, lat, lon] = p.get('at').split('/').map(Number);
    if ([zoom, lat, lon].every(Number.isFinite)) s.view = { lon, lat, zoom };
  }
  return s;
}
function writeHash() {
  const v = current?.getView() || state.view;
  const p = new URLSearchParams({
    lib: state.lib, base: state.base, ov: state.overlays.join(','),
    globe: state.globe ? '1' : '0', terrain: state.terrain ? '1' : '0', ex: String(state.exaggeration),
    popop: String(state.popOpacity), popmin: String(state.popMin),
    at: `${v.zoom.toFixed(2)}/${v.lat.toFixed(4)}/${v.lon.toFixed(4)}`,
  });
  history.replaceState(null, '', '#' + p.toString().replaceAll('%2C', ',').replaceAll('%2F', '/'));
}

let state = readHash();
let current = null;
let mountSeq = 0;
const $ = (id) => document.getElementById(id);

function message(text) {
  $('message').textContent = text || '';
}

// ---- selection: an entity (from a clicked point or a chip in the details) and how every point relates to it ----
let selection = null; // context from buildContext(), see relations.js
let selectSeq = 0;

const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const dot = (color) => `<i style="background:${escHtml(color)}"></i>`;
const fmt = (n) => n.toLocaleString('en');

function summaryHtml(ctx, entities, stats) {
  const e = entities[ctx.entity] || {};
  const own = stats.controlled;
  const color = e.color || entities[e.parent_id]?.color || '#888';
  const head = `${dot(color)}<b>${escHtml(e.short_name || e.name || ctx.entity)}</b> `
    + (own ? `controls ${fmt(own.count)} point${own.count === 1 ? '' : 's'} · ${fmt(own.people)} people`
      : 'controls no mapped points');
  const rest = RELATIONS.filter((r) => r.color && stats[r.id])
    .map((r) => `<span class="rel"><i class="ring" style="border-color:${escHtml(r.color)}"></i>${r.label} ${fmt(stats[r.id].count)}</span>`);
  return head + (rest.length ? `<br>${rest.join(' ')}` : '');
}

async function selectEntity(entity, pointId = null) {
  const mine = ++selectSeq;
  const [gj, idx] = await Promise.all([loadGeoJSON(byId(OVERLAYS, 'drc-control').files[0]), loadIndex()]);
  if (mine !== selectSeq) return;
  selection = buildContext(entity, gj.features, idx.entities, pointId);
  current?.highlight?.(selection);
  showHighlightSummary(summaryHtml(selection, idx.entities, summarize(gj.features, selection)));
}

function clearSelection() {
  selectSeq++;
  selection = null;
  current?.highlight?.(null);
  showHighlightSummary('');
}

function select(props) {
  if (!props?.controller_id) {
    clearSelection();
    hideDetails();
    return;
  }
  showDetails(props);
  selectEntity(props.controller_id, props.id).catch((e) => console.error(e));
}

// ---- map lifecycle ----
async function mount() {
  const seq = ++mountSeq;
  if (current) {
    state.view = current.getView();
    current.destroy();
    current = null;
  }
  const el = $('map');
  el.replaceChildren();
  const container = document.createElement('div');
  el.append(container);
  message('');
  try {
    const mod = await adapters[state.lib]();
    if (seq !== mountSeq) return;
    const instance = await mod.createMap(container, state, { onMessage: message, onSelect: select });
    if (seq !== mountSeq) { instance.destroy(); return; }
    current = instance;
    current.highlight?.(selection);
  } catch (e) {
    console.error(e);
    message(`Failed to start ${state.lib}: ${e.message}`);
  }
}

function update() {
  state.overlays = OVERLAYS.map((o) => o.id).filter((id) => state.overlays.includes(id));
  renderPanel();
  message('');
  current?.apply(state);
  writeHash();
}

// ---- panel ----
function buildPanel() {
  $('libraries').innerHTML = LIBRARIES.map((l) => `
    <label><input type="radio" name="lib" value="${l.id}"> ${l.name}
      <div class="note">${l.note}</div></label>`).join('');
  $('libraries').addEventListener('change', (e) => {
    state.lib = e.target.value;
    renderPanel();
    writeHash();
    mount().then(writeHash);
  });

  const groups = [...new Set(BASEMAPS.map((b) => b.group))];
  $('base').innerHTML = groups.map((g) => `<optgroup label="${g}">${
    BASEMAPS.filter((b) => b.group === g).map((b) => `<option value="${b.id}">${b.name}</option>`).join('')
  }</optgroup>`).join('');
  $('base').addEventListener('change', (e) => { state.base = e.target.value; update(); });

  $('overlays').innerHTML = OVERLAYS.map((o) => `
    <label data-id="${o.id}"><input type="checkbox" value="${o.id}"> ${o.name}
      <div class="note">${o.note || ''}</div></label>`).join('');
  $('overlays').addEventListener('change', (e) => {
    const id = e.target.value;
    state.overlays = e.target.checked ? [...state.overlays, id] : state.overlays.filter((x) => x !== id);
    update();
  });

  // WorldPop settings change the overlay's URL/opacity, which adapters cache per layer: remount the map.
  $('pop-min').innerHTML = POP_CUTOFFS.map((v) => `<option value="${v}">${v.toLocaleString('en')}</option>`).join('');
  const popChanged = () => {
    configureWorldpop({ opacity: state.popOpacity, min: state.popMin });
    renderPanel();
    if (state.overlays.includes('worldpop')) mount().then(writeHash);
    else writeHash();
  };
  $('pop-opacity').addEventListener('input', (e) => { $('pop-opacity-value').textContent = `${Math.round(e.target.value * 100)}%`; });
  $('pop-opacity').addEventListener('change', (e) => { state.popOpacity = Number(e.target.value); popChanged(); });
  $('pop-min').addEventListener('change', (e) => { state.popMin = Number(e.target.value); popChanged(); });

  $('globe').addEventListener('change', (e) => { state.globe = e.target.checked; update(); });
  $('terrain').addEventListener('change', (e) => { state.terrain = e.target.checked; update(); });
  $('exaggeration').addEventListener('input', (e) => { state.exaggeration = Number(e.target.value); update(); });

  try { $('ion-token').value = localStorage.getItem('cesiumIonToken') || ''; } catch {}
  $('ion-token').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    try { v ? localStorage.setItem('cesiumIonToken', v) : localStorage.removeItem('cesiumIonToken'); } catch {}
    if (state.lib === 'cesium') mount();
  });

  $('toggle-panel').addEventListener('click', () => { document.body.classList.add('collapsed'); $('show-panel').hidden = false; });
  $('show-panel').addEventListener('click', () => { document.body.classList.remove('collapsed'); $('show-panel').hidden = true; });

  window.addEventListener('pointerup', () => setTimeout(writeHash, 300));
  window.addEventListener('wheel', () => { clearTimeout(window.__hashT); window.__hashT = setTimeout(writeHash, 500); }, { passive: true });
}

function renderPanel() {
  const lib = byId(LIBRARIES, state.lib);
  document.querySelectorAll('input[name=lib]').forEach((i) => { i.checked = i.value === state.lib; });
  $('base').value = state.base;
  const base = byId(BASEMAPS, state.base);
  $('base-note').textContent = [base.note, base.kind === 'style' && !lib.vectorStyles
    ? `Vector styles are MapLibre-only here; ${lib.name} shows ${byId(BASEMAPS, base.fallback).name}.` : '']
    .filter(Boolean).join(' ');
  document.querySelectorAll('#overlays label').forEach((label) => {
    const o = byId(OVERLAYS, label.dataset.id);
    const supported = !o.libs || o.libs.includes(state.lib);
    label.classList.toggle('disabled', !supported);
    label.title = supported ? '' : `Not available in ${lib.name}`;
    label.querySelector('input').checked = state.overlays.includes(o.id);
  });
  $('globe').checked = state.lib === 'cesium' || state.globe;
  $('globe').disabled = state.lib !== 'maplibre';
  $('terrain').checked = state.terrain && lib.terrain;
  $('terrain').disabled = !lib.terrain;
  $('exaggeration').value = state.exaggeration;
  $('exaggeration').disabled = !lib.terrain;
  $('exaggeration-value').textContent = `${state.exaggeration}×`;
  $('three-d').querySelectorAll('label').forEach((l) => l.classList.toggle('disabled', !lib.terrain));
  $('ion').hidden = state.lib !== 'cesium';
  $('pop-opacity').value = state.popOpacity;
  $('pop-opacity-value').textContent = `${Math.round(state.popOpacity * 100)}%`;
  $('pop-min').value = String(state.popMin);
}

configureWorldpop({ opacity: state.popOpacity, min: state.popMin });
buildPanel();
initDetails({
  onClose: clearSelection,
  onEntity: (id) => selectEntity(id).catch((e) => console.error(e)),
});
renderPanel();
mount().then(writeHash);
