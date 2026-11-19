'use strict';
/* PALIMPSEST: the Earth, written over.
   A satellite globe with old maps, photos, drawings, newspapers, events and strange accounts
   pulled live from public archives. No build step, no backend, no keys. */

/* ---------- small helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(3)) if (k != null && k !== false) el.append(k.nodeType ? k : String(k));
  return el;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem('pal.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('pal.' + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } }
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const first = v => Array.isArray(v) ? v[0] : v;
function plain(s) {
  if (s == null) return '';
  const d = document.createElement('div'); d.innerHTML = String(s);
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
}
function caps(s) { return s && s === s.toLowerCase() ? s.replace(/\b([a-z])/g, c => c.toUpperCase()) : (s || ''); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtN = n => n == null ? '' : n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n);

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms);
}

async function getJSON(url, { ms = 25000, signal } = {}) {
  const ctl = new AbortController();
  let why = '';
  const timer = setTimeout(() => { why = 'timeout'; ctl.abort(); }, ms);
  const onAbort = () => { why = 'cancel'; ctl.abort(); };
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return await r.json();
  } catch (e) {
    if (why) { const e2 = new Error(why); e2.status = why; throw e2; }
    throw e;
  } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); }
}
// The Library of Congress is slow and sometimes drops a request; try once more.
async function getJSONRetry(url, opts) {
  try { return await getJSON(url, opts); }
  catch (e) {
    if (e.status === 'cancel' || e.status === 'timeout' || (e.status && e.status < 500 && e.status !== 429)) throw e;
    await sleep(2500);
    return getJSON(url, opts);
  }
}
function errText(e) {
  const s = e && e.status;
  if (s === 429) return 'busy, try again in a minute';
  if (s === 'timeout') return 'didn\'t answer in time';
  if (s && s >= 500) return 'having trouble (' + s + ')';
  if (e instanceof TypeError) return 'unreachable, check your connection';
  return 'error' + (s ? ' (' + s + ')' : '');
}

/* ---------- years ---------- */
// Pulls a year out of messy archive dates: "1887", "ca. 1890s", "1863-07-01", "300 BC", ISO "-0500-01-01T00:00:00Z".
function yearOf(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  const s = String(v);
  const iso = /^([+-]?)(\d{1,6})-\d\d-\d\dT/.exec(s);
  if (iso) return (iso[1] === '-' ? -1 : 1) * +iso[2];
  const bc = /(\d{1,5})\s*(?:BC|BCE|B\.C\.)/i.exec(s);
  if (bc) return -+bc[1];
  const m = /(?:^|\D)(1\d{3}|20[0-2]\d)(?=\D|$)/.exec(s);
  if (m) return +m[1];
  const ad = /(?:AD|A\.D\.)\s*(\d{1,4})|(\d{1,4})\s*(?:AD|CE|A\.D\.)/i.exec(s);
  if (ad) return +(ad[1] || ad[2]);
  return null;
}
function yearsIn(s) {
  const out = []; const re = /(?:^|\D)(1\d{3}|20[0-2]\d)(?=\D|$)/g; let m;
  while ((m = re.exec(String(s || '')))) out.push(+m[1]);
  return out;
}
function fmtYear(y) {
  if (y == null) return 'Undated';
  if (y < 0) return `${(-y).toLocaleString('en-US')} BC`;
  if (y < 1000) return `AD ${y}`;
  return String(y);
}
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)] || 'th');

/* ---------- layers, topics, state ---------- */
const LAYERS = {
  maps: { name: 'Old maps', c: '#ffb000', desc: 'Old maps from David Rumsey, NYPL, the Library of Congress, Harvard, Yale and others, warped to fit and draped over the satellite. Zoom to a region or a city.' },
  photos: { name: 'Photos & drawings', c: '#22e5ff', desc: 'Old photographs, engravings, paintings and drawings tied to a spot: Wikimedia Commons everywhere, Europeana across Europe. Zoom into a town to see them.' },
  papers: { name: 'Newspapers', c: '#ff6b5a', desc: 'U.S. newspaper pages, 1770 to 1963, from the Library of Congress. Pick a topic; each stack sits on the town that printed it. A scan takes about 30 seconds.' },
  strange: { name: 'Strange', c: '#ff3df2', desc: 'Case files of famous strange events, plus thousands of hoaxes, sightings, ghost towns, meteorite falls, haunted houses and lost places.' },
  events: { name: 'Events', c: '#b79cff', desc: 'Battles, sieges, disasters, eruptions, epidemics, uprisings and world\'s fairs with a place and a date.' },
  ancient: { name: 'Ancient sites', c: '#b6ff3b', desc: 'Megaliths, stone circles, mounds, petroglyphs, pyramids, hillforts, ancient and lost cities.' },
  places: { name: 'Historic places', c: '#3dffb0', desc: 'Old buildings, forts, mills, churches, cemeteries and sites with Wikipedia articles near the map center. Zoom into a town.' }
};
const ORDER = ['maps', 'photos', 'papers', 'strange', 'events', 'ancient', 'places'];
const KIND = { library: ['Library', '#e9d9a6'], 'maps-scan': ['Map scan', '#ffb000'], 'papers-eu': ['Old text', '#ff6b5a'] };
const kindName = L => LAYERS[L] ? LAYERS[L].name : KIND[L] ? KIND[L][0] : 'Archive';
const kindColor = L => LAYERS[L] ? LAYERS[L].c : KIND[L] ? KIND[L][1] : '#ffe14d';
// Phrases are in the words newspapers used at the time.
const TOPICS = {
  all: { name: 'All strange', q: ['mysterious affair', 'ghost', 'strange creature'] },
  sky: { name: 'Sky', q: ['airship', 'strange light'] },
  creatures: { name: 'Creatures', q: ['sea serpent', 'wild man'] },
  spirits: { name: 'Spirits', q: ['ghost', 'haunted house'] },
  bones: { name: 'Giants & bones', q: ['giant skeleton', 'petrified'] },
  vanished: { name: 'Vanished', q: ['mysterious disappearance', 'never been seen'] },
  relics: { name: 'Relics', q: ['ancient relics', 'mound builders'] },
  disaster: { name: 'Disasters', q: ['terrible disaster', 'great fire'] }
};
const ERAS = [['All time', -10000, 1950], ['Ancient', -10000, 499], ['Middle Ages', 500, 1499], ['1500–1799', 1500, 1799], ['1800s', 1800, 1899], ['1900–1950', 1900, 1950]];

const S = {
  from: store.get('from', -10000), to: store.get('to', 1950), undated: store.get('undated', true),
  on: Object.assign({ maps: true, photos: true, papers: false, strange: true, events: false, ancient: false, places: false }, store.get('on', {})),
  aged: store.get('aged', true), labels: store.get('labels', true),
  topic: store.get('topic', 'sky'), opacity: store.get('opacity', 0.82), autoDrape: store.get('autoDrape', true),
  saved: store.get('saved', []),
  data: {}, loading: {}, index: new Map(),
  thumbs: new Map(), papers: new Map(), papersNote: '',
  oldmaps: [], draped: [], places: [],
  status: {}
};
const inTime = y => y == null ? S.undated : (y >= S.from && y <= S.to);

/* ---------- time dial ---------- */
// Non-linear: more room for the centuries with the most material.
const AX = [[0, -10000], [80, -3000], [200, 0], [330, 1000], [460, 1500], [620, 1700], [1000, 1950]];
function posToYear(p) {
  for (let i = 0; i < AX.length - 1; i++) {
    const [p0, y0] = AX[i], [p1, y1] = AX[i + 1];
    if (p <= p1) {
      const y = y0 + (y1 - y0) * (p - p0) / (p1 - p0);
      const step = y < -3000 ? 100 : y < 0 ? 50 : y < 1500 ? 10 : 1;
      return Math.round(y / step) * step;
    }
  }
  return 1950;
}
function yearToPos(y) {
  for (let i = 0; i < AX.length - 1; i++) {
    const [p0, y0] = AX[i], [p1, y1] = AX[i + 1];
    if (y <= y1) return Math.round(p0 + (p1 - p0) * (clamp(y, y0, y1) - y0) / (y1 - y0));
  }
  return 1000;
}
function buildDial() {
  const ticks = $('#ticks');
  for (const [y, label] of [[-3000, '3000 BC'], [0, 'AD 1'], [1000, '1000'], [1500, '1500'], [1700, '1700'], [1800, '1800']]) {
    const pct = yearToPos(y) / 10;
    ticks.append(h('span', { style: `left:${pct}%` }), h('em', { style: `left:${pct}%`, text: label }));
  }
  const rf = $('#rFrom'), rt = $('#rTo');
  rf.value = yearToPos(S.from); rt.value = yearToPos(S.to);
  const live = () => {
    let a = +rf.value, b = +rt.value;
    if (a > b - 4) { if (document.activeElement === rf) { a = b - 4; rf.value = a; } else { b = a + 4; rt.value = b; } }
    S.from = posToYear(a); S.to = posToYear(b);
    paintDial(); timeChanged();
  };
  rf.addEventListener('input', live); rt.addEventListener('input', live);
  const pre = $('#presets');
  for (const [name, a, b] of ERAS) pre.append(h('button', { type: 'button', 'data-a': a, 'data-b': b, text: name, onclick: () => setEra(a, b) }));
  paintDial();
}
function setEra(a, b) {
  S.from = a; S.to = b; $('#rFrom').value = yearToPos(a); $('#rTo').value = yearToPos(b);
  paintDial(); timeChanged(true);
}
function paintDial() {
  const a = yearToPos(S.from) / 10, b = yearToPos(S.to) / 10;
  Object.assign($('#dialFill').style, { left: a + '%', width: Math.max(0.5, b - a) + '%' });
  $('#yFrom').textContent = fmtYear(S.from); $('#yTo').textContent = fmtYear(S.to);
  $$('#presets button').forEach(b2 => b2.classList.toggle('on', +b2.dataset.a === S.from && +b2.dataset.b === S.to));
}
const timeChangedSlow = debounce(() => {
  store.set('from', S.from); store.set('to', S.to);
  // Searches that take the dates as a filter have to run again.
  LIVE.papers.last = null; LIVE.photos.last = null;
  scheduleLive();
}, 900);
function timeChanged(now) {
  refreshPoints(); renderRelics(); rankMaps(); autoPick(); refreshDrapeCard();
  if (now) { store.set('from', S.from); store.set('to', S.to); LIVE.papers.last = null; LIVE.photos.last = null; scheduleLive(); }
  else timeChangedSlow();
}

/* ---------- map ---------- */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRIL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
let map;
function initMap() {
  map = new maplibregl.Map({
    container: 'map', center: [-38, 30], zoom: 1.55, maxPitch: 70, attributionControl: { compact: true },
    style: {
      version: 8, projection: { type: 'globe' },
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] },
      sources: {
        sat: { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
        lbl: { type: 'raster', tiles: [ESRIL], tileSize: 256, maxzoom: 19 }
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#05070a' } },
        { id: 'sat', type: 'raster', source: 'sat' },
        { id: 'lbl', type: 'raster', source: 'lbl', paint: { 'raster-opacity': 0.75 } }
      ]
    }
  });
  map.on('load', () => {
    applyLook();
    addPointLayers();
    for (const L of ['strange', 'events', 'ancient']) if (S.on[L]) ensureData(L);
    ensureData('cases');
    fitPadding();
    onMove(); scheduleLive();
    if (!store.get('seenIntro', false)) openIntro();
    else idleSpin();
  });
  map.on('move', updateCoords);
  map.on('moveend', onMove);
  map.on('zoom', () => document.body.classList.toggle('z5', map.getZoom() >= 6.2));
  ['mousedown', 'touchstart', 'wheel'].forEach(ev => map.getCanvas().addEventListener(ev, () => { spinning = false; }, { passive: true }));
}
let spinning = false;
function idleSpin() {
  spinning = true;
  const step = () => {
    if (!spinning || map.getZoom() > 3) return;
    const c = map.getCenter();
    map.easeTo({ center: [c.lng + 6, c.lat], duration: 1000, easing: t => t });
    setTimeout(() => { if (spinning) step(); }, 1000);
  };
  step();
}
function applyLook() {
  document.body.classList.toggle('aged', S.aged);
  map.setPaintProperty('sat', 'raster-saturation', S.aged ? -0.82 : -0.05);
  map.setPaintProperty('sat', 'raster-contrast', S.aged ? 0.14 : 0.04);
  map.setPaintProperty('sat', 'raster-brightness-max', S.aged ? 0.86 : 1);
  map.setLayoutProperty('lbl', 'visibility', S.labels ? 'visible' : 'none');
  $('#agedBtn').setAttribute('aria-pressed', S.aged); $('#labelsBtn').setAttribute('aria-pressed', S.labels);
}
function fitPadding() {
  const dock = $('#dock');
  const hgt = dock.classList.contains('min') ? 64 : dock.offsetHeight;
  document.documentElement.style.setProperty('--dockH', hgt + 'px');
  if (map) map.setPadding({ top: 70, bottom: Math.min(hgt, innerHeight * 0.45), left: 0, right: 0 });
}
function viewCtx() {
  const b = map.getBounds(), c = map.getCenter(), z = map.getZoom();
  const s = Math.max(-85, b.getSouth()), n = Math.min(85, b.getNorth());
  let w = b.getWest(), e = b.getEast();
  if (e - w > 360) { w = -180; e = 180; }
  const dy = (n - s) * 111320, dx = (e - w) * 111320 * Math.cos(c.lat * Math.PI / 180);
  return { z, lat: c.lat, lon: ((c.lng + 540) % 360) - 180, b: { s, w, n, e }, area: Math.abs(dx * dy), R: Math.min(dx, dy) / 2 };
}
function updateCoords() {
  const c = map.getCenter(), z = map.getZoom();
  const mpp = 156543.03 * Math.cos(c.lat * Math.PI / 180) / Math.pow(2, z);
  const alt = mpp * innerHeight * 1.2 / 1000;
  const lon = ((c.lng + 540) % 360) - 180;
  $('#coords').textContent = `${Math.abs(c.lat).toFixed(3)}°${c.lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'} · ALT ${alt >= 100 ? Math.round(alt).toLocaleString('en-US') : alt.toFixed(1)} KM`;
}
function onMove() { updateCoords(); renderRelics(); scheduleLive(); updateScan(); }

/* ---------- static atlas data (cases, strange, events, ancient) ---------- */
const DATA_FILES = { cases: 'data/cases.json', strange: 'data/strange.json', events: 'data/events.json', ancient: 'data/ancient.json' };
async function ensureData(L) {
  if (S.data[L]) return S.data[L];
  if (S.loading[L]) return S.loading[L];
  S.loading[L] = (async () => {
    try {
      const r = await fetch(DATA_FILES[L]); if (!r.ok) throw new Error('HTTP ' + r.status);
      const raw = await r.json();
      let rows;
      if (L === 'cases') {
        rows = raw.map(c => ({ id: 'case:' + c.id, L: 'strange', isCase: true, name: c.t, y: c.y, circa: !!c.c, lat: c.lat, lon: c.lon, place: c.p, kind: caseKind(c.k), desc: c.b, q: c.q }));
        S.cases = rows; buildCaseMarkers();
      } else {
        // Compact snapshot from Wikidata: { k: [class labels], r: [[qid, name, lat, lon, year, classIndex, enwikiSlug, description]] }
        rows = raw.r.map(a => ({ id: 'Q' + a[0], L, name: a[1], lat: a[2], lon: a[3], y: a[4], kind: raw.k[a[5]] || '', wiki: a[6] || '', desc: a[7] || '' }));
      }
      for (const r2 of rows) {
        S.index.set(r2.id, r2);
        r2.f = { type: 'Feature', geometry: { type: 'Point', coordinates: [r2.lon, r2.lat] }, properties: { id: r2.id, L: r2.L, n: r2.name } };
      }
      S.data[L] = { rows };
      refreshPoints(); updateChips();
      return S.data[L];
    } catch (e) {
      S.status[L] = { err: 'atlas file didn\'t load' }; updateChips();
      S.loading[L] = null; return null;
    }
  })();
  return S.loading[L];
}
function caseKind(k) {
  return { sky: 'sky phenomenon', creature: 'creature report', spirit: 'spirits & witchcraft', hoax: 'hoax or fraud', relic: 'mystery relic', vanish: 'disappearance', site: 'enigmatic site', phenomenon: 'unexplained phenomenon', secret: 'secret or lost treasure' }[k] || 'case file';
}

function addPointLayers() {
  const col = ['match', ['get', 'L'], 'strange', LAYERS.strange.c, 'events', LAYERS.events.c, 'ancient', LAYERS.ancient.c, 'places', LAYERS.places.c, '#ffffff'];
  map.addSource('pts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: 42, clusterMaxZoom: 8 });
  map.addLayer({ id: 'pt-cluster', type: 'circle', source: 'pts', filter: ['has', 'point_count'],
    paint: { 'circle-color': 'rgba(8,10,14,0.82)', 'circle-stroke-color': '#ffe14d', 'circle-stroke-width': 1.2, 'circle-stroke-opacity': 0.7,
      'circle-radius': ['step', ['get', 'point_count'], 11, 25, 14, 150, 18, 800, 23] } });
  map.addLayer({ id: 'pt-count', type: 'symbol', source: 'pts', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Open Sans Semibold'], 'text-size': 11, 'text-allow-overlap': true },
    paint: { 'text-color': '#ffe14d' } });
  map.addLayer({ id: 'pt-glow', type: 'circle', source: 'pts', filter: ['!', ['has', 'point_count']],
    paint: { 'circle-color': col, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 6, 12, 12], 'circle-blur': 0.9, 'circle-opacity': 0.5 } });
  map.addLayer({ id: 'pt-core', type: 'circle', source: 'pts', filter: ['!', ['has', 'point_count']],
    paint: { 'circle-color': col, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 12, 5.5], 'circle-stroke-color': '#000', 'circle-stroke-width': 1.2 } });
  map.addLayer({ id: 'pt-label', type: 'symbol', source: 'pts', minzoom: 9.5, filter: ['!', ['has', 'point_count']],
    layout: { 'text-field': ['get', 'n'], 'text-font': ['Open Sans Semibold'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-max-width': 10, 'text-optional': true },
    paint: { 'text-color': col, 'text-halo-color': '#000', 'text-halo-width': 1.4 } });
  map.on('click', 'pt-cluster', async e => {
    const f = e.features[0];
    try {
      const z = await map.getSource('pts').getClusterExpansionZoom(f.properties.cluster_id);
      map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(z + 0.3, 14) });
    } catch (err) { map.easeTo({ center: f.geometry.coordinates, zoom: map.getZoom() + 2 }); }
  });
  map.on('click', 'pt-core', e => {
    const f = e.features[0]; const r = S.index.get(f.properties.id) || S.places.find(p => p.id === f.properties.id);
    if (r) openRecord(r);
  });
  for (const id of ['pt-cluster', 'pt-core']) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }
}
function refreshPoints() {
  if (!map || !map.getSource('pts')) return;
  const feats = [];
  for (const L of ['strange', 'events', 'ancient']) {
    const d = S.data[L]; if (!S.on[L] || !d) continue;
    for (const r of d.rows) if (inTime(r.y)) feats.push(r.f);
  }
  if (S.on.places) for (const r of S.places) if (inTime(r.y)) feats.push(r.f);
  map.getSource('pts').setData({ type: 'FeatureCollection', features: feats });
  refreshCases();
  updateChips();
}

/* case files: glowing eyes, always on top */
const caseMarkers = new Map();
function buildCaseMarkers() {
  for (const c of S.cases) {
    const el = h('button', { class: 'case', type: 'button', 'aria-label': c.name }, h('i'), h('span', { text: c.name }));
    el.addEventListener('click', e => { e.stopPropagation(); openRecord(c); });
    caseMarkers.set(c.id, { m: new maplibregl.Marker({ element: el, anchor: 'left', offset: [-11, 0] }).setLngLat([c.lon, c.lat]), c, shown: false });
  }
  refreshCases();
}
function refreshCases() {
  for (const v of caseMarkers.values()) {
    const show = S.on.strange && inTime(v.c.y);
    if (show && !v.shown) { v.m.addTo(map); v.shown = true; }
    else if (!show && v.shown) { v.m.remove(); v.shown = false; }
  }
}

/* ---------- relic markers: photo thumbnails and newspaper stacks ---------- */
const relicMarkers = new Map();
function renderRelics() {
  if (!map) return;
  const z = map.getZoom(), b = map.getBounds(), c = map.getCenter();
  const want = new Map();
  if (S.on.photos && z >= 8) {
    const list = [];
    for (const it of S.thumbs.values()) if (inTime(it.year) && b.contains([it.lon, it.lat])) list.push(it);
    const d2 = it => (it.lat - c.lat) ** 2 + (it.lon - c.lng) ** 2;
    list.sort((a, b2) => (b2.year != null) - (a.year != null) || d2(a) - d2(b2));
    const max = innerWidth < 700 ? 36 : 70;
    for (const it of list.slice(0, max)) want.set(it.id, { it });
  }
  if (S.on.papers) for (const st of S.papers.values()) {
    const vis = st.items.filter(i => inTime(i.year));
    if (vis.length && b.contains([st.lon, st.lat])) want.set('stack:' + st.key, { st, vis });
  }
  for (const [id, m] of relicMarkers) if (!want.has(id)) { m.remove(); relicMarkers.delete(id); }
  for (const [id, w] of want) {
    const old = relicMarkers.get(id);
    if (old && !w.st) continue;
    if (old) old.remove();
    const el = w.st ? stackEl(w.st, w.vis) : relicEl(w.it);
    const m = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(w.st ? [w.st.lon, w.st.lat] : [w.it.lon, w.it.lat]).addTo(map);
    relicMarkers.set(id, m);
  }
}
function relicEl(it) {
  const img = h('img', { src: it.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  const el = h('button', { class: 'relic', type: 'button', style: `--c:${LAYERS[it.L].c}`, 'aria-label': it.title }, img, h('b', { text: it.year != null ? fmtYear(it.year) : '?' }));
  img.addEventListener('error', () => el.classList.add('noimg'));
  el.addEventListener('click', e => { e.stopPropagation(); openItem(it); });
  return el;
}
function stackEl(st, vis) {
  const top = vis[0];
  const ys = vis.map(v => v.year).filter(v => v != null);
  const img = h('img', { src: top.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  const el = h('button', { class: 'relic' + (vis.length > 1 ? ' stack' : ''), type: 'button', style: `--c:${LAYERS.papers.c}`, 'aria-label': `${vis.length} newspaper pages from ${st.city}` },
    img, h('b', { text: ys.length ? (Math.min(...ys) === Math.max(...ys) ? String(ys[0]) : `${Math.min(...ys)}–${Math.max(...ys)}`) : '?' }),
    vis.length > 1 ? h('s', { text: String(vis.length) }) : null);
  img.addEventListener('error', () => el.classList.add('noimg'));
  el.addEventListener('click', e => { e.stopPropagation(); vis.length === 1 ? openItem(vis[0]) : openStack(st, vis); });
  return el;
}

/* ---------- live archive layers ---------- */
const WM = 'https://commons.wikimedia.org/w/api.php?';
const WP = 'https://en.wikipedia.org/w/api.php?';
const LOC_CA = 'https://www.loc.gov/collections/chronicling-america/?';
const EU = 'https://api.europeana.eu/record/v2/search.json?';
const inEurope = (lat, lon) => lat > 34 && lat < 72 && lon > -26 && lon < 46;
const inUSish = (lat, lon) => (lat > 24 && lat < 50 && lon > -125 && lon < -66) || (lat > 51 && lat < 72 && lon > -170 && lon < -129) || (lat > 18 && lat < 23 && lon > -161 && lon < -154);

const LIVE = {
  maps: {
    ready: x => x.z >= 6.5 ? null : 'zoom in to a region for old maps',
    key: x => [x.b.s, x.b.w, x.b.n, x.b.e].map(v => v.toFixed(x.z > 11 ? 3 : 2)).join(','),
    load: loadOldMaps
  },
  photos: {
    ready: x => x.z >= 10.3 || (x.z >= 8 && inEurope(x.lat, x.lon)) ? null : 'zoom into a town for photos',
    key: x => `${x.lat.toFixed(x.z > 12 ? 3 : 2)},${x.lon.toFixed(x.z > 12 ? 3 : 2)},${Math.round(x.z)},${S.from},${S.to}`,
    load: loadPhotos
  },
  papers: {
    ready: x => x.z < 3.2 ? 'zoom in on the U.S. for newspapers' : (x.z < 5.5 || inUSish(x.lat, x.lon)) ? null : 'newspapers cover the U.S. only; move the map there',
    key: x => `${x.z < 5.5 ? 'US' : x.lat.toFixed(0) + ',' + x.lon.toFixed(0)},${S.topic},${S.from},${S.to}`,
    load: loadPapers, slow: true
  },
  places: {
    ready: x => x.z >= 11 ? null : 'zoom into a town for historic places',
    key: x => `${x.lat.toFixed(2)},${x.lon.toFixed(2)}`,
    load: loadPlaces
  }
};
const scheduleLive = debounce(() => { for (const k of Object.keys(LIVE)) runLive(k); }, 650);
async function runLive(k) {
  const L = LIVE[k];
  if (!map || !S.on[k]) { if (L.ctl) L.ctl.abort(); S.status[k] = null; updateChips(); return; }
  if (k === 'papers' && S.trace) return;
  const x = viewCtx();
  const hint = L.ready(x);
  if (hint) { S.status[k] = { hint }; updateChips(); updateScan(); return; }
  const key = L.key(x);
  if (L.last === key) return;
  // A slow newspaper scan keeps running when the map moves a little; a new one replaces it.
  if (L.ctl) L.ctl.abort();
  const ctl = L.ctl = new AbortController();
  L.last = key;
  S.status[k] = { wait: true }; updateChips(); updateScan();
  try {
    const n = await L.load(x, ctl.signal);
    if (ctl.signal.aborted) return;
    S.status[k] = { n }; L.fails = 0;
  } catch (e) {
    if (ctl.signal.aborted || e.status === 'cancel') return;
    if (e.status === 'hint') { S.status[k] = { hint: e.message }; }
    else {
      S.status[k] = { err: e.status === 429 ? 'archive busy, retrying soon' : errText(e) }; L.last = null;
      L.fails = (L.fails || 0) + 1;
      if (L.fails <= 4) setTimeout(() => runLive(k), (e.status === 429 ? 20000 : 8000) * L.fails);
    }
  }
  updateChips(); updateScan();
}

/* photos & drawings: Wikimedia Commons near the center, Europeana inside the view (Europe) */
const OLDWORDS = /engrav|lithograph|etching|woodcut|drawing|sketch|painting|postcard|daguerreotype|stereo(?:graph|view|card)|ambrotype|tintype|albumen|cabinet card|carte de visite|histor|antique|vintage|\bold\b|circa|\bca?\. ?1\d|HABS|HAER|Detroit Publishing|bird.?s.?eye|view of|panorama of|plate \d|illustrat|\bLOC\b|NYPL|Library of Congress|Keystone|Underwood|glass plate|negative|gravure|aquatint|mezzotint/i;
function oldScore(title) {
  const t = title.replace(/^File:/, '');
  let s = 0;
  const ys = yearsIn(t);
  if (ys.length) s += Math.min(...ys) <= 1950 ? 4 : -5;
  if (OLDWORDS.test(t)) s += 2;
  if (/^(IMG|DSC|DSCN|DSCF|PXL|P\d{6,}|Photo \d|WP_|20\d\d\d\d\d\d)/i.test(t) || /\d{8}[_ -]\d{6}/.test(t)) s -= 4;
  return s;
}
async function commonsNear(lat, lon, radius, signal, max = 100) {
  const p = new URLSearchParams({ action: 'query', list: 'geosearch', gscoord: `${lat.toFixed(5)}|${lon.toFixed(5)}`, gsradius: String(Math.round(clamp(radius, 300, 10000))), gslimit: '500', gsnamespace: '6', format: 'json', origin: '*' });
  const d = await getJSON(WM + p, { signal });
  const geo = (d.query && d.query.geosearch) || [];
  const pick = geo.map(g => ({ g, s: oldScore(g.title) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s || a.g.dist - b.g.dist).slice(0, max);
  const out = [];
  for (let i = 0; i < pick.length; i += 50) {
    const chunk = pick.slice(i, i + 50);
    const q = new URLSearchParams({ action: 'query', pageids: chunk.map(x => x.g.pageid).join('|'), prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '360', iiextmetadatafilter: 'DateTimeOriginal|ObjectName|Artist|ImageDescription|Credit', format: 'json', origin: '*' });
    const m = await getJSON(WM + q, { signal });
    const pages = (m.query && m.query.pages) || {};
    for (const x of chunk) {
      const pg = pages[x.g.pageid]; const ii = pg && pg.imageinfo && pg.imageinfo[0];
      if (!ii || !ii.thumburl || /\.(svg|pdf|tif?f|djvu|ogg|webm|mp3)$/i.test(pg.title) && !/\.(tif?f|pdf|djvu)$/i.test(pg.title)) continue;
      const md = ii.extmetadata || {};
      const metaY = yearOf(plain(md.DateTimeOriginal && md.DateTimeOriginal.value));
      const titleYs = yearsIn(pg.title); const titleY = titleYs.length ? Math.min(...titleYs) : null;
      const year = titleY != null && (metaY == null || titleY < metaY) ? titleY : metaY;
      if (year != null && (year < S.from || year > S.to)) continue;
      if (year == null && x.s < 2) continue;
      const name = plain(md.ObjectName && md.ObjectName.value) || pg.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
      out.push({
        id: 'wm:' + x.g.pageid, L: 'photos', src: 'Wikimedia Commons', title: cut(name, 140), year, lat: x.g.lat, lon: x.g.lon,
        creator: cut(plain(md.Artist && md.Artist.value), 100), holder: /own work/i.test(plain(md.Credit && md.Credit.value)) ? 'Wikimedia Commons' : (cut(plain(md.Credit && md.Credit.value), 90) || 'Wikimedia Commons'),
        desc: cut(plain(md.ImageDescription && md.ImageDescription.value), 420),
        thumb: ii.thumburl, large: ii.width > 1400 ? ii.thumburl.replace(/\/360px-/, '/1400px-') : ii.url, link: ii.descriptionurl
      });
    }
  }
  return out;
}
async function europeanaBox(b, signal, rows = 80) {
  const p = new URLSearchParams({ wskey: 'api2demo', query: '*', rows: String(rows), profile: 'rich', reusability: 'open' });
  p.append('qf', `pl_wgs84_pos_lat:[${b.s.toFixed(4)} TO ${b.n.toFixed(4)}]`);
  p.append('qf', `pl_wgs84_pos_long:[${b.w.toFixed(4)} TO ${b.e.toFixed(4)}]`);
  p.append('qf', 'TYPE:IMAGE');
  if (S.from >= 1000) p.append('qf', `YEAR:[${S.from} TO ${S.to}]`);
  const d = await getJSON(EU + p, { signal });
  if (d.success === false) { const e = new Error(d.error || 'rejected'); e.status = 401; throw e; }
  const out = [];
  for (const x of d.items || []) {
    const lats = (x.edmPlaceLatitude || []).map(Number), lons = (x.edmPlaceLongitude || []).map(Number);
    let lat = null, lon = null;
    for (let i = 0; i < Math.min(lats.length, lons.length); i++) {
      if (lats[i] >= b.s && lats[i] <= b.n && lons[i] >= b.w && lons[i] <= b.e && !(Number.isInteger(lats[i]) && Number.isInteger(lons[i]))) { lat = lats[i]; lon = lons[i]; break; }
    }
    if (lat == null) continue;
    const year = yearOf(first(x.year));
    if (!inTime(year) || (year != null && year < 1400)) continue;
    const prev = first(x.edmPreview); if (!prev) continue;
    out.push(euItem(x, { lat, lon, year, L: 'photos' }));
  }
  return out;
}
function euItem(x, o) {
  const prev = first(x.edmPreview) || ''; const by = first(x.edmIsShownBy) || '';
  return Object.assign({
    id: 'eu:' + x.id, src: 'Europeana', title: cut(plain(first(x.title)) || 'Untitled', 140), year: yearOf(first(x.year)),
    creator: cut(plain(first(x.dcCreator)), 100), holder: plain(first(x.dataProvider)) || 'Europeana', place: plain(first(x.country)),
    desc: cut(plain(first(x.dcDescription)), 420),
    thumb: prev, large: /^https:.*\.(jpe?g|png|gif|webp)(\?|$)/i.test(by) ? by : prev.replace(/&size=[^&]*/, '') + '&size=w400',
    link: String(x.guid || '').split('?')[0] || `https://www.europeana.eu/item${x.id}`, kind: x.type === 'TEXT' ? 'text' : 'picture'
  }, o);
}
async function loadPhotos(x, signal) {
  const jobs = [];
  if (x.z >= 10.3) jobs.push(commonsNear(x.lat, x.lon, x.R * 1.15, signal));
  if (inEurope(x.lat, x.lon) && x.z >= 8) jobs.push(europeanaBox(x.b, signal));
  const res = await Promise.allSettled(jobs);
  const ok = res.filter(r => r.status === 'fulfilled');
  if (!ok.length) throw res[0].reason;
  let n = 0;
  for (const r of ok) for (const it of r.value) { if (!S.thumbs.has(it.id)) n++; S.thumbs.set(it.id, it); }
  // Keep memory in check on long sessions.
  if (S.thumbs.size > 900) { const ks = [...S.thumbs.keys()].slice(0, S.thumbs.size - 900); ks.forEach(k2 => S.thumbs.delete(k2)); }
  renderRelics();
  return ok.reduce((a, r) => a + r.value.length, 0);
}

/* historic places from Wikipedia */
const HISTORIC = /histor|built in|\b1[0-9]\d\d\b|centur|church|chapel|cathedral|abbey|priory|monaster|convent|cemetery|burying|graveyard|meeting ?house|house\b|mansion|manor|homestead|farmstead|hall\b|mill\b|forge|furnace|fort\b|fortress|battle|ruin|monument|memorial|museum|lighthouse|bridge|tavern|\binn\b|castle|temple|synagogue|mosque|tower|gate\b|palace|courthouse|jail|gaol|prison|armory|arsenal|tomb|mound|archaeolog|statue|shrine|\bwell\b|cave|\bmine\b|canal|aqueduct|wharf|shipyard|depot|ghost town|site of/i;
const NOT_HISTORIC = /census-designated|unincorporated|school district|neighborhood in|neighbourhood in|shopping|\bmall\b|sports|stadium|arena|radio station|television station|high school|elementary school|middle school|company|band\b|airport|interchange|highway|freeway|road in|street in/i;
async function loadPlaces(x, signal) {
  const p = new URLSearchParams({ action: 'query', generator: 'geosearch', ggscoord: `${x.lat.toFixed(5)}|${x.lon.toFixed(5)}`, ggsradius: '10000', ggslimit: '100', prop: 'coordinates|pageimages|description', piprop: 'thumbnail', pithumbsize: '400', pilimit: '50', format: 'json', origin: '*' });
  const d = await getJSON(WP + p, { signal });
  const pages = Object.values((d.query && d.query.pages) || {});
  const keep = [];
  for (const pg of pages) {
    const co = pg.coordinates && pg.coordinates[0]; if (!co) continue;
    const text = `${pg.title} ${pg.description || ''}`;
    if (!HISTORIC.test(text) || NOT_HISTORIC.test(text)) continue;
    const ys = yearsIn(pg.description || '').filter(y => y <= 1950);
    const r = { id: 'wp:' + pg.pageid, L: 'places', name: pg.title, lat: co.lat, lon: co.lon, y: ys.length ? Math.min(...ys) : null, kind: pg.description || 'historic place',
      desc: '', wiki: pg.title.replace(/ /g, '_'), thumb: pg.thumbnail && pg.thumbnail.source };
    r.f = { type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, properties: { id: r.id, L: 'places', n: r.name } };
    keep.push(r);
  }
  const ids = new Set(keep.map(r => r.id));
  S.places = S.places.filter(r => !ids.has(r.id)).concat(keep).slice(-600);
  refreshPoints();
  return keep.length;
}

/* newspapers: Library of Congress, Chronicling America */
async function caSearch({ q, state, city, from, to, c = 25, page = 1, signal, sort }) {
  const f = Math.max(1770, from), t = Math.min(1963, to);
  if (f > t) return { items: [], total: 0, skip: 'these newspapers run 1770 to 1963' };
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  p.set('dates', `${f}/${t}`); p.set('fo', 'json'); p.set('c', String(c)); p.set('sp', String(page)); p.set('at', 'pagination,results');
  if (sort) p.set('sb', sort);
  const fa = [state && 'location_state:' + state.toLowerCase(), city && 'location_city:' + city.toLowerCase()].filter(Boolean).join('|');
  if (fa) p.set('fa', fa);
  const d = await getJSONRetry(LOC_CA + p, { ms: 55000, signal });
  const items = (d.results || []).map(r => {
    const img = (r.image_url || []).find(u => /\/full\//.test(u)) || '';
    const paper = String(r.title || '').replace(/^Image \d+ of /i, '').replace(/,\s*[A-Z][a-z]+\.? \d{1,2}, \d{4}\s*$/, '');
    const pg = parseInt(first(r.number_page) || '0', 10);
    const year = yearOf(r.date);
    return {
      id: 'ca:' + (r.id || r.url), L: 'papers', src: 'Library of Congress', kind: 'text',
      title: paper || 'Newspaper page', holder: paper, year, dateText: longDate(r.date) + (pg ? `, page ${pg}` : ''),
      city: caps(first(r.location_city) || ''), state: caps(first(r.location_state) || ''),
      base: img.split('/full/')[0], thumb: img ? img.split('#')[0].replace(/\/full\/[^/]+\//, '/full/!400,400/') : '',
      large: img ? img.split('#')[0].replace(/\/full\/[^/]+\//, '/full/!1600,1600/') : '',
      link: r.url || r.id, wc: r.word_coordinates_url, q
    };
  });
  return { items, total: (d.pagination && d.pagination.of) || 0, next: !!(d.pagination && d.pagination.next) };
}
function longDate(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(s || ''); if (!m) return s || '';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
// Find the matching passage on the page and crop the scan to the article around it.
function clipRegion(v) {
  const W = +v.width, H = +v.height;
  const boxes = Object.values(v.searchTerms || {}).flat().filter(b => b && b.length === 4);
  if (!W || !H || !boxes.length) return null;
  boxes.sort((a, b) => a[1] - b[1]);
  const anchor = boxes[0];
  const near = boxes.filter(b => Math.abs(b[1] - anchor[1]) < 0.08 * H && Math.abs(b[0] - anchor[0]) < 0.2 * W);
  let x0 = Math.min(...near.map(b => b[0])), y0 = Math.min(...near.map(b => b[1]));
  let x1 = Math.max(...near.map(b => b[0] + b[2])), y1 = Math.max(...near.map(b => b[1] + b[3]));
  const cx = (x0 + x1) / 2, w = Math.max(x1 - x0 + 0.12 * W, 0.24 * W);
  x0 = Math.max(0, cx - w / 2); x1 = Math.min(W, cx + w / 2);
  y0 = Math.max(0, y0 - 0.035 * H); y1 = Math.min(H, Math.max(y1 + 0.1 * H, y0 + 0.16 * H));
  const pc = (a, t) => Math.max(0, Math.min(100, a / t * 100)).toFixed(2);
  return `pct:${pc(x0, W)},${pc(y0, H)},${pc(x1 - x0, W)},${pc(y1 - y0, H)}`;
}
let enrichActive = 0; const enrichWait = [];
function enrichCA(x) {
  if (!x.wc) return Promise.resolve(x);
  if (x._p) return x._p;
  x._p = (async () => {
    if (enrichActive >= 3) await new Promise(r => enrichWait.push(r));
    enrichActive++;
    try {
      const d = await getJSON(x.wc, { ms: 30000 });
      const v = Object.values(d || {})[0] || {};
      x.excerpt = String(v.relevant_snippet || '').replace(/^[\s.…]+|[\s.…]+$/g, '');
      const region = x.base ? clipRegion(v) : null;
      if (region) { x.clip = `${x.base}/${region}/!900,900/0/default.jpg`; x.clipLarge = `${x.base}/${region}/!1600,1600/0/default.jpg`; }
    } catch (e) { x.excerpt = x.excerpt || ''; }
    finally { x.enriched = true; enrichActive--; const n = enrichWait.shift(); if (n) n(); }
    return x;
  })();
  return x._p;
}
const unmark = s => String(s || '').replace(/\[\[\/?tag\]\]/g, '').replace(/<\/?[^>]+>/g, '');
const firstSentence = s => { const m = /^[^.!?]*[.!?]/.exec(s || ''); return (m ? m[0] : s || '').trim(); };
// Shows <em>/<b> highlight markup from archives as <mark>, everything else as plain text.
function markText(el, s) {
  el.replaceChildren();
  const parts = String(s || '').replace(/\[\[tag\]\]/g, '<mark>').replace(/\[\[\/tag\]\]/g, '</mark>').split(/(<(?:em|b|strong|mark)>.*?<\/(?:em|b|strong|mark)>)/i);
  for (const p of parts) {
    const m = /^<(em|b|strong|mark)>(.*?)<\/\1>$/i.exec(p);
    if (m) el.append(h('mark', { text: unmark(m[2]) })); else if (p) el.append(unmark(p));
  }
}

const geoCache = store.get('geo', {});
async function geocodeCity(city, state) {
  const key = `${city}|${state}`.toLowerCase();
  if (key in geoCache) return geoCache[key];
  try {
    const p = new URLSearchParams({ name: city, count: '10', language: 'en', format: 'json', countryCode: 'US' });
    const d = await getJSON('https://geocoding-api.open-meteo.com/v1/search?' + p, { ms: 12000 });
    const res = d.results || [];
    const hit = res.find(r => (r.admin1 || '').toLowerCase() === state.toLowerCase()) || (state ? null : res[0]);
    geoCache[key] = hit ? [hit.latitude, hit.longitude] : null;
  } catch (e) { return null; }
  store.set('geo', geoCache);
  return geoCache[key];
}
async function placeAt(lat, lon, zoom = 10) {
  const key = `${lat.toFixed(zoom >= 10 ? 2 : 1)},${lon.toFixed(zoom >= 10 ? 2 : 1)},${zoom}`;
  placeAt.cache = placeAt.cache || {};
  if (placeAt.cache[key]) return placeAt.cache[key];
  const p = new URLSearchParams({ lat: lat.toFixed(5), lon: lon.toFixed(5), format: 'jsonv2', zoom: String(zoom), 'accept-language': 'en', addressdetails: '1' });
  const d = await getJSON('https://nominatim.openstreetmap.org/reverse?' + p, { ms: 12000 });
  const a = d.address || {};
  const r = { name: a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || a.county || a.state_district || a.state || d.name || '', state: a.state || '', county: a.county || '', country: a.country || '', cc: (a.country_code || '').toLowerCase(), lat, lon };
  placeAt.cache[key] = r;
  return r;
}
async function loadPapers(x, signal) {
  let state = null;
  if (x.z >= 5.5) {
    try { const pl = await placeAt(x.lat, x.lon, 5); if (pl.cc && pl.cc !== 'us') { S.papers.clear(); renderRelics(); const e = new Error('U.S. papers only'); e.status = 'hint'; throw e; } state = pl.state || null; }
    catch (e) { if (e.status === 'hint') throw e; }
  }
  const t = TOPICS[S.topic] || TOPICS.sky;
  S.papersNote = `${t.name}, ${state || 'all states'}`;
  updateScan();
  const res = await Promise.allSettled(t.q.map(q => caSearch({ q: `"${q}"`, state, from: S.from, to: S.to, c: 25, signal })));
  const ok = res.filter(r => r.status === 'fulfilled').map(r => r.value);
  if (!ok.length) throw res[0].reason;
  if (ok.every(o => o.skip)) { S.papers.clear(); renderRelics(); const e = new Error(ok[0].skip); e.status = 'hint'; throw e; }
  const items = ok.flatMap(o => o.items);
  await placePapers(items, signal, true);
  return items.length;
}
async function placePapers(items, signal, replace) {
  if (replace) S.papers.clear();
  const byCity = new Map();
  for (const it of items) {
    if (!it.city) continue;
    const k = `${it.city}|${it.state}`;
    if (!byCity.has(k)) byCity.set(k, []);
    byCity.get(k).push(it);
  }
  const keys = [...byCity.keys()];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (keys.length) {
      if (signal && signal.aborted) return;
      const k = keys.shift(); const [city, state] = k.split('|');
      const ll = await geocodeCity(city, state);
      if (!ll) continue;
      const st = S.papers.get(k) || { key: k, city, state, lat: ll[0], lon: ll[1], items: [] };
      for (const it of byCity.get(k)) if (!st.items.some(o => o.id === it.id)) st.items.push(Object.assign(it, { lat: ll[0], lon: ll[1] }));
      st.items.sort((a, b) => (a.year || 0) - (b.year || 0));
      S.papers.set(k, st);
      renderRelics();
    }
  }));
}

/* old maps: Allmaps (georeferenced IIIF maps) */
function amLabel(m) {
  let label = '';
  const walk = parts => {
    for (const p of parts || []) {
      if (p.type === 'Manifest' && p.label) label = labelText(p.label) || label;
      walk(p.partOf);
    }
  };
  walk(m.resource && m.resource.partOf);
  return label;
}
function labelText(l) {
  if (!l) return '';
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) return labelText(l[0]);
  if (l['@value']) return l['@value'];
  const v = l.en || l.none || Object.values(l)[0];
  return Array.isArray(v) ? v.join(' ') : String(v || '');
}
function amManifestId(m) {
  let id = '';
  const walk = parts => { for (const p of parts || []) { if (p.type === 'Manifest' && p.id) id = p.id; walk(p.partOf); } };
  walk(m.resource && m.resource.partOf);
  return id;
}
function amItem(m) {
  const id = String(m.id || '').split('/').pop(); const res = m.resource || {};
  if (!id || !res.id) return null;
  const g = m.gcps || [];
  const xs = g.map(p => p.geo[0]), ys = g.map(p => p.geo[1]);
  const prov = labelText(res.provider && res.provider[0] && res.provider[0].label) || (res.id.match(/\/\/([^/]+)/) || [])[1] || '';
  const label = plain(amLabel(m));
  const rumsey = /davidrumsey\.com\/luna\/servlet\/iiif\//.test(res.id) ? res.id.replace('/luna/servlet/iiif/', '/luna/servlet/iiif/m/') + '/manifest' : '';
  return {
    id, L: 'maps', title: label || '', provider: prov, year: yearOf(label), manifest: amManifestId(m) || rumsey, area: m._allmaps && m._allmaps.area,
    thumb: `${res.id}/full/,240/0/default.jpg`, large: `${res.id}/full/,1400/0/default.jpg`,
    bbox: g.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null,
    link: `https://viewer.allmaps.org/?url=${encodeURIComponent('https://annotations.allmaps.org/maps/' + id)}`,
    tiles: `https://allmaps.xyz/maps/${id}/{z}/{x}/{y}.png`
  };
}
async function allmapsQuery(b, area, signal, limit = 60, point) {
  // Allmaps takes lat,lng order: a box is south,west,north,east; a point is lat,lng.
  const p = new URLSearchParams({ limit: String(limit), intersects: point ? point.map(v => v.toFixed(5)).join(',') : [b.s, b.w, b.n, b.e].map(v => v.toFixed(5)).join(',') });
  if (area) { p.set('minarea', String(Math.round(area.min))); p.set('maxarea', String(Math.round(area.max))); }
  const d = await getJSON('https://api.allmaps.org/maps?' + p, { signal, ms: 20000 });
  return (Array.isArray(d) ? d : []).map(amItem).filter(Boolean);
}
async function loadOldMaps(x, signal) {
  const [list, here] = await Promise.all([
    allmapsQuery(x.b, { min: x.area / 300, max: x.area * 80 }, signal),
    allmapsQuery(null, null, signal, 60, [x.lat, x.lon]).catch(() => [])
  ]);
  const hereIds = new Set(here.map(m => m.id));
  for (const m of here) if (!list.some(o => o.id === m.id) && m.area && m.area > x.area / 300 && m.area < x.area * 80) list.push(m);
  for (const m of list) m.here = hereIds.has(m.id);
  S.oldmaps = list; S.mapView = x.area;
  rankMaps(); autoPick();
  fillMapTitles(list.slice(0, 18)).then(() => { if (S.oldmaps === list) { rankMaps(); autoPick(); refreshDrapeCard(); } });
  refreshDrapeCard();
  return list.length;
}
// Best map: covers the middle of the view, about the size of the view, inside the time dial, and older is better.
function mapScore(m) {
  let s = m.here ? 3 : 0;
  if (m.area && S.mapView) s -= Math.abs(Math.log10(m.area / S.mapView)) * 0.9;
  if (m.title) s += 0.3;
  if (m.year != null) s += inTime(m.year) ? 1.2 + (1950 - m.year) / 300 : -3;
  return s;
}
function rankMaps() { S.oldmaps.sort((a, b) => mapScore(b) - mapScore(a)); }
function autoPick() {
  if (!map || !S.on.maps || !S.autoDrape || S.drapeOff || !S.oldmaps.length) return;
  const best = S.oldmaps[0];
  const cur = S.draped[S.draped.length - 1];
  if (cur && (cur.manual || cur.id === best.id)) return;
  if (cur && S.oldmaps.some(m => m.id === cur.id) && mapScore(cur) >= mapScore(best) - 0.3) return;
  if (cur) undrape(cur.id, true);
  drape(best, true);
}
// Some maps only carry their title in the IIIF manifest; fetch a few.
async function fillMapTitles(list) {
  const todo = list.filter(m => !m.title && m.manifest && !m.tried);
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (todo.length) {
      const m = todo.shift(); m.tried = true;
      try {
        const d = await getJSON(m.manifest, { ms: 12000 });
        m.title = plain(labelText(d.label));
        const md = d.metadata || [];
        for (const e of md) { const k = plain(labelText(e.label)).toLowerCase(); if (/date|year|created|published/.test(k)) { const y = yearOf(plain(labelText(e.value))); if (y) { m.year = y; break; } } }
        if (m.year == null) m.year = yearOf(m.title);
      } catch (e) { /* the map still works without a title */ }
    }
  }));
  refreshDrapeCard();
  if ($('#sheet').dataset.view === 'maps') openMapsSheet(true);
}
function drape(m, auto) {
  if (S.draped.some(d => d.id === m.id)) return;
  const sid = 'om-' + m.id;
  if (!map.getSource(sid)) map.addSource(sid, { type: 'raster', tiles: [m.tiles], tileSize: 256, maxzoom: 20 });
  map.addLayer({ id: sid, type: 'raster', source: sid, paint: { 'raster-opacity': S.opacity, 'raster-fade-duration': 200 } }, 'lbl');
  m.manual = !auto;
  S.draped.push(m);
  if (S.draped.length > 3) undrape(S.draped[0].id, true);
  if (!auto) S.drapeOff = false;
  refreshDrapeCard();
}
function undrape(id, quiet) {
  const sid = 'om-' + id;
  if (map.getLayer(sid)) map.removeLayer(sid);
  if (map.getSource(sid)) map.removeSource(sid);
  S.draped = S.draped.filter(d => d.id !== id);
  if (!quiet) { if (!S.draped.length) S.drapeOff = true; refreshDrapeCard(); }
}
function setOpacity(v) {
  S.opacity = v; store.set('opacity', v);
  for (const d of S.draped) if (map.getLayer('om-' + d.id)) map.setPaintProperty('om-' + d.id, 'raster-opacity', v);
}
function refreshDrapeCard() {
  const box = $('#drape');
  const m = S.draped[S.draped.length - 1];
  if (!S.on.maps || !m) { box.hidden = true; return; }
  box.hidden = false;
  const range = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(S.opacity), 'aria-label': 'Old map see-through' });
  range.addEventListener('input', () => setOpacity(+range.value));
  const img = h('img', { src: m.thumb, alt: '', referrerpolicy: 'no-referrer', onerror: e => { e.target.style.visibility = 'hidden'; } });
  box.replaceChildren(
    h('button', { type: 'button', style: 'flex:none', 'aria-label': 'Open map details', onclick: () => openItem(m) }, img),
    h('div', { class: 't' }, h('div', { class: 'k', text: `Draped${m.year ? ' · ' + fmtYear(m.year) : ''} · ${S.oldmaps.length} here` }), h('div', { class: 'n', text: m.title || ('Map from ' + m.provider) }), range),
    h('button', { class: 'x', type: 'button', text: 'SWAP', onclick: () => openMapsSheet() }));
}

/* ---------- chips, scan line ---------- */
function updateChips() {
  const box = $('#chips');
  if (!box.firstChild) {
    for (const k of ORDER) box.append(h('button', { class: 'chip', type: 'button', 'data-k': k, style: `--c:${LAYERS[k].c}`, onclick: () => toggleLayer(k) },
      h('span', { class: 'g' }), h('span', { class: 'l', text: LAYERS[k].name }), h('span', { class: 'n' })));
    box.append(h('button', { class: 'chip gear', type: 'button', 'aria-label': 'Layer options', onclick: openLayersSheet }, h('span', { text: '⚙ Options' })));
  }
  for (const k of ORDER) {
    const el = box.querySelector(`[data-k="${k}"]`); if (!el) continue;
    el.classList.toggle('on', !!S.on[k]);
    const n = el.querySelector('.n'); const st = S.status[k];
    n.className = 'n'; n.textContent = '';
    if (!S.on[k]) continue;
    if (st && st.wait) n.classList.add('wait');
    else if (k === 'strange' || k === 'events' || k === 'ancient') {
      const d = S.data[k]; if (!d) { n.classList.add('wait'); continue; }
      let c = 0; for (const r of d.rows) if (inTime(r.y)) c++;
      if (k === 'strange' && S.cases) for (const r of S.cases) if (inTime(r.y)) c++;
      n.textContent = fmtN(c);
    } else if (st && st.n != null) n.textContent = fmtN(k === 'papers' ? [...S.papers.values()].reduce((a, s) => a + s.items.length, 0) : st.n);
    else if (st && st.err) n.textContent = '!';
  }
}
function updateScan() {
  const waits = ORDER.filter(k => S.on[k] && S.status[k] && S.status[k].wait);
  const el = $('#scan'), tx = $('#scanText');
  if (waits.length) {
    el.classList.add('on');
    const names = { maps: 'old maps', photos: 'photos', papers: `newspapers (${S.papersNote || 'scan'}, ~30 s)`, places: 'historic places' };
    tx.textContent = 'Scanning ' + waits.map(k => names[k] || k).join(' · ');
    return;
  }
  if (S.trace && S.on.papers) { el.classList.remove('on'); tx.textContent = `Reprints of “${cut(S.trace, 40)}” in ${S.papers.size} towns · turn Newspapers off to clear`; return; }
  el.classList.remove('on');
  const errs = ORDER.filter(k => S.on[k] && S.status[k] && S.status[k].err);
  if (errs.length) { tx.textContent = errs.map(k => `${LAYERS[k].name.split(' ')[0]}: ${S.status[k].err}`).join(' · '); return; }
  const hints = ORDER.filter(k => S.on[k] && S.status[k] && S.status[k].hint).map(k => S.status[k].hint);
  const shown = relicMarkers.size;
  tx.textContent = (shown ? `${shown} relic${shown === 1 ? '' : 's'} pinned · ` : '') + (hints[0] || `${fmtYear(S.from)} to ${fmtYear(S.to)}`);
}
function toggleLayer(k, force) {
  S.on[k] = force != null ? force : !S.on[k];
  store.set('on', S.on);
  if (['strange', 'events', 'ancient'].includes(k) && S.on[k]) ensureData(k);
  if (k === 'maps') { if (!S.on.maps) [...S.draped].forEach(d => undrape(d.id, true)); else { S.drapeOff = false; LIVE.maps.last = null; } refreshDrapeCard(); }
  if (k === 'papers' && !S.on.papers) { S.papers.clear(); S.trace = null; }
  if (S.on[k] && LIVE[k]) LIVE[k].last = null;
  refreshPoints(); renderRelics(); updateChips(); scheduleLive(); updateScan();
  if (S.on[k] && LIVE[k]) { const hint = LIVE[k].ready(viewCtx()); if (hint) toast(hint.charAt(0).toUpperCase() + hint.slice(1)); }
}

/* ---------- sheets ---------- */
function openSheet(view, ...kids) {
  const s = $('#sheet');
  s.dataset.view = view;
  $('#sheetBody').replaceChildren(...kids.flat(3).filter(Boolean));
  s.hidden = false; $('#sheetBg').hidden = false;
  s.scrollTop = 0;
}
function closeSheet() { $('#sheet').hidden = true; $('#sheetBg').hidden = true; $('#sheet').dataset.view = ''; }

function isSaved(id) { return S.saved.some(s => s.id === id); }
function saveBtn(it) {
  const b = h('button', { class: 'btn', type: 'button' });
  const paint = () => { b.textContent = isSaved(it.id) ? '✓ In case file' : '+ Case file'; b.classList.toggle('pri', !isSaved(it.id)); };
  b.addEventListener('click', () => {
    if (isSaved(it.id)) S.saved = S.saved.filter(s => s.id !== it.id);
    else S.saved.unshift(slim(it));
    store.set('saved', S.saved); paint(); paintSaved();
    toast(isSaved(it.id) ? 'Saved to your case file' : 'Removed');
  });
  paint(); return b;
}
function slim(it) {
  const o = {};
  for (const k of ['id', 'L', 'title', 'name', 'year', 'circa', 'dateText', 'place', 'city', 'state', 'holder', 'src', 'creator', 'kind', 'desc', 'excerpt', 'thumb', 'clip', 'large', 'link', 'lat', 'lon', 'wiki', 'tiles', 'provider', 'q', 'isCase'])
    if (it[k] != null && it[k] !== '') o[k] = it[k];
  o.savedAt = Date.now(); o.note = '';
  return o;
}
function paintSaved() { $('#savedCount').textContent = S.saved.length ? String(S.saved.length) : ''; }

// A record from the offline atlas (case file, Wikidata item, Wikipedia place).
function openRecord(r) {
  const c = LAYERS[r.L].c;
  const link = r.wiki ? `https://en.wikipedia.org/wiki/${encodeURIComponent(r.wiki)}` : (/^Q\d+$/.test(r.id) ? `https://www.wikidata.org/wiki/${r.id}` : null);
  const kids = [];
  if (r.thumb) kids.push(h('div', { class: 'hero' }, h('img', { src: r.thumb.replace(/\/\d+px-/, '/800px-'), alt: '', referrerpolicy: 'no-referrer', onerror: e => e.target.parentNode.remove() })));
  kids.push(h('div', { class: 'kick', style: `--c:${c}`, text: `${r.isCase ? 'Case file' : LAYERS[r.L].name} · ${r.y != null ? (r.circa ? 'c. ' : '') + fmtYear(r.y) : 'date unknown'}` }));
  kids.push(h('div', { class: 'ttl', text: r.name }));
  kids.push(h('div', { class: 'meta', text: [r.kind, r.place].filter(Boolean).join(' · ') }));
  if (r.desc) kids.push(h('p', { class: 'body', text: r.desc }));
  if (!r.isCase && !r.thumb && r.wiki) kids.push(wikiSummary(r.wiki));
  const row = h('div', { class: 'row' });
  const item = { id: r.id, L: r.L, title: r.name, year: r.y, circa: r.circa, place: r.place, kind: r.kind, desc: r.desc, lat: r.lat, lon: r.lon, wiki: r.wiki, link, q: r.q, isCase: r.isCase, thumb: r.thumb };
  if (r.q) {
    row.append(h('button', { class: 'btn pri', type: 'button', text: '▤ Search old newspapers', onclick: () => caseSearch(r, 'papers') }));
    row.append(h('button', { class: 'btn', type: 'button', text: '❧ Search old books', onclick: () => caseSearch(r, 'library') }));
  }
  if (link) row.append(h('a', { class: 'btn', href: link, target: '_blank', rel: 'noopener', text: r.wiki ? 'Wikipedia ↗' : 'Wikidata ↗' }));
  row.append(saveBtn(item));
  row.append(h('button', { class: 'btn', type: 'button', text: '⌂ Museum here', onclick: () => { closeSheet(); openMuseumAt(r.lat, r.lon); } }));
  if (map.getZoom() < 9) row.append(h('button', { class: 'btn', type: 'button', text: 'Fly here', onclick: () => { closeSheet(); map.flyTo({ center: [r.lon, r.lat], zoom: 12.5, speed: 1.4 }); } }));
  kids.push(row);
  openSheet('record', kids);
}
function wikiSummary(slug) {
  const box = h('div', { class: 'body', text: '' });
  getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`, { ms: 12000 }).then(d => {
    if (d.thumbnail && d.thumbnail.source) box.before(h('div', { class: 'hero' }, h('img', { src: d.thumbnail.source.replace(/\/\d+px-/, '/800px-'), alt: '', referrerpolicy: 'no-referrer', onerror: e => e.target.parentNode.remove() })));
    box.textContent = cut(d.extract || '', 700);
  }).catch(() => {});
  return box;
}
// From a case file, jump to the museum of that place with the case's words already searched.
function caseSearch(r, wing) {
  closeSheet();
  const span = r.y != null ? [Math.max(r.y - 3, -10000), Math.min(r.y + 12, 1950)] : null;
  openMuseumAt(r.lat, r.lon, { wing, q: r.q, years: span, nationwide: wing === 'papers', anywhere: true });
}

// An archive item (photo, newspaper page, old map, book).
function openItem(it) {
  const c = kindColor(it.L);
  const hero = h('div', { class: 'hero' + (it.L === 'papers' ? ' clip' : '') });
  const img = h('img', { src: it.clip || it.large || it.thumb, alt: '', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => { if (img.src !== it.thumb && it.thumb) img.src = it.thumb; else hero.remove(); });
  if (it.thumb || it.large || it.clip) hero.append(h('a', { href: it.clipLarge || it.large || it.link, target: '_blank', rel: 'noopener' }, img));
  const kick = h('div', { class: 'kick', style: `--c:${c}`, text: `${kindName(it.L)} · ${it.year != null ? fmtYear(it.year) : 'undated'}` });
  const ttl = h('div', { class: 'ttl', text: it.headline || it.title || 'Untitled' });
  const metaParts = it.L === 'papers' ? [it.dateText, it.city && `printed in ${it.city}, ${it.state}`]
    : it.L === 'maps' ? [it.provider] : [it.dateText, it.creator, it.holder !== it.creator && it.holder !== it.title ? it.holder : '', it.place];
  const meta = h('div', { class: 'meta', text: metaParts.filter(Boolean).join(' · ') });
  const body = h('p', { class: 'body' });
  if (it.excerpt) markText(body, '…' + it.excerpt + '…'); else if (it.desc) body.textContent = it.desc;
  const row = h('div', { class: 'row' });
  if (it.L === 'maps') {
    const on = S.draped.some(d => d.id === it.id);
    row.append(h('button', { class: 'btn pri', type: 'button', text: on ? 'Lift off the map' : 'Drape over the satellite', onclick: () => {
      closeSheet(); closePanel();
      if (on) undrape(it.id); else { if (!S.on.maps) toggleLayer('maps', true); drape(it); if (it.bbox) map.fitBounds([[it.bbox[0], it.bbox[1]], [it.bbox[2], it.bbox[3]]], { padding: 40, maxZoom: 15 }); }
    } }));
  }
  if (it.link) row.append(h('a', { class: 'btn', href: it.link, target: '_blank', rel: 'noopener', text: 'Open original ↗' }));
  row.append(saveBtn(it));
  if (it.L === 'papers') row.append(h('button', { class: 'btn', type: 'button', text: '⇶ Trace reprints', onclick: () => traceReprints(it) }));
  if (it.lat != null && it.L !== 'maps') row.append(h('button', { class: 'btn', type: 'button', text: '⌂ Museum here', onclick: () => { closeSheet(); openMuseumAt(it.lat, it.lon); } }));
  openSheet('item', hero, kick, ttl, meta, body, row,
    it.L === 'papers' ? h('p', { class: 'note', text: 'Old newspaper text was read by machine, so expect odd misspellings. "Trace reprints" finds other papers that printed the same story, and pins them on the map.' }) : null);
  if (it.L === 'papers' && !it.excerpt) {
    body.textContent = 'Finding the passage on this page…';
    enrichCA(it).then(x => {
      if ($('#sheet').hidden) return;
      if (x.excerpt) markText(body, '…' + x.excerpt + '…'); else body.textContent = 'The passage didn\'t load. Open the original to read the page.';
      if (x.clip) img.src = x.clip;
    });
  }
}
function openStack(st, vis) {
  const list = h('div', { class: 'list' });
  for (const it of vis) {
    const img = h('img', { src: it.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    list.append(h('button', { class: 'li', type: 'button', onclick: () => openItem(it) }, img,
      h('div', { class: 'tx' }, h('div', { class: 'a', text: it.holder }), h('div', { class: 'b', text: `${it.dateText}${it.q ? ' · “' + it.q.replace(/"/g, '') + '”' : ''}` }))));
  }
  openSheet('stack', h('div', { class: 'kick', style: `--c:${LAYERS.papers.c}`, text: `Newspapers · ${vis.length} pages` }),
    h('div', { class: 'ttl', text: `${st.city}, ${st.state}` }), list,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: '⌂ Museum of ' + st.city, onclick: () => { closeSheet(); openMuseumAt(st.lat, st.lon); } })));
}
// Papers copied stories word for word. Six clean words in a row, searched as a phrase, show how far a story spread.
function reprintPhrase(text) {
  const body = unmark(text);
  const rest = body.replace(/^[^.!?]*[.!?]\s+/, '') || body;
  const toks = s => s.split(/\s+/).map(w => w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, ''));
  const win = (list, ok) => { for (let i = 0; i + 6 <= list.length; i++) if (list.slice(i, i + 6).every(ok)) return list.slice(i, i + 6).join(' '); return ''; };
  return win(toks(rest), w => /^[a-z]{2,}$/.test(w)) || win(toks(body), w => /^[A-Za-z]{2,}$/.test(w));
}
async function traceReprints(it) {
  await enrichCA(it);
  const q = reprintPhrase(it.excerpt);
  if (!q) { toast('Not enough clean text on this page to match'); return; }
  closeSheet(); closePanel();
  if (!S.on.papers) { S.on.papers = true; store.set('on', S.on); }
  if (LIVE.papers.ctl) LIVE.papers.ctl.abort();
  LIVE.papers.last = 'trace'; S.trace = q;
  S.status.papers = { wait: true }; S.papersNote = 'tracing reprints'; updateChips(); updateScan();
  toast('Searching every paper for the same wording…', 3500);
  try {
    const y = it.year || S.from;
    const r = await caSearch({ q: `"${q}"`, from: y, to: y + 1, c: 60 });
    const items = r.items.concat([it]);
    await placePapers(items, null, true);
    S.status.papers = { n: items.length };
    const pts = [...S.papers.values()];
    if (pts.length > 1) {
      const lons = pts.map(p => p.lon), lats = pts.map(p => p.lat);
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 60, maxZoom: 9 });
    }
    toast(`Found in ${pts.length} town${pts.length === 1 ? '' : 's'}: “${q}”`, 4500);
  } catch (e) { S.status.papers = { err: errText(e) }; }
  updateChips(); updateScan(); renderRelics();
}

function openMapsSheet(refresh) {
  const list = h('div', { class: 'list' });
  for (const m of S.oldmaps) {
    const on = S.draped.some(d => d.id === m.id);
    const img = h('img', { src: m.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: e => e.target.replaceWith(h('div', { class: 'ph', style: `--c:${LAYERS.maps.c}`, text: '▦' })) });
    list.append(h('button', { class: 'li', type: 'button', onclick: () => { if (on) undrape(m.id); else drape(m); openMapsSheet(true); } }, img,
      h('div', { class: 'tx' }, h('div', { class: 'a', text: m.title || `Map from ${m.provider || 'an archive'}` }),
        h('div', { class: 'b' }, (m.year ? fmtYear(m.year) + ' · ' : '') + m.provider + ' ', on ? h('span', { class: 'on', text: '· DRAPED' }) : null))));
  }
  const range = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(S.opacity), style: 'width:100%;accent-color:var(--c-maps)' });
  range.addEventListener('input', () => setOpacity(+range.value));
  const kids = [h('div', { class: 'kick', style: `--c:${LAYERS.maps.c}`, text: `Old maps · ${S.oldmaps.length} cover this view` }),
    h('div', { class: 'ttl', text: 'Drape a map over the Earth' }),
    h('p', { class: 'hint', text: 'Tap a map to lay it over the satellite; tap again to lift it. Up to three at once. Slide to see through them.' }), range,
    S.oldmaps.length ? list : h('p', { class: 'empty', text: 'No warped maps cover this view yet. Zoom or move to a city.' }),
    h('p', { class: 'note', text: 'Maps are warped to modern coordinates by volunteers and libraries through Allmaps.' })];
  if (refresh && $('#sheet').dataset.view === 'maps') { const st = $('#sheet').scrollTop; $('#sheetBody').replaceChildren(...kids.filter(Boolean)); $('#sheet').scrollTop = st; }
  else openSheet('maps', kids);
}

function openLayersSheet() {
  const kids = [h('div', { class: 'kick', text: 'Layers' }), h('div', { class: 'ttl', text: 'What lights up on the map' })];
  for (const k of ORDER) {
    const tg = h('button', { class: 'tog', type: 'button', style: `--c:${LAYERS[k].c}`, 'aria-pressed': String(!!S.on[k]), 'aria-label': LAYERS[k].name });
    tg.addEventListener('click', () => { toggleLayer(k); tg.setAttribute('aria-pressed', String(!!S.on[k])); });
    const extra = [];
    if (k === 'papers') {
      const pills = h('div', { class: 'pills' });
      for (const [tk, t] of Object.entries(TOPICS)) pills.append(h('button', { class: 'pill' + (S.topic === tk ? ' on' : ''), style: `--c:${LAYERS.papers.c}`, type: 'button', text: t.name, onclick: e => {
        S.topic = tk; store.set('topic', tk); S.trace = null; $$('.pill', pills).forEach(p => p.classList.toggle('on', p === e.target));
        if (!S.on.papers) { toggleLayer('papers', true); tg.setAttribute('aria-pressed', 'true'); } else { LIVE.papers.last = null; scheduleLive(); }
      } }));
      extra.push(pills, h('div', { class: 'meta', style: 'margin-top:6px', text: 'Searches for: ' + Object.values(TOPICS).map(t => t.q.join(', ')).slice(0, 0).join('') + (TOPICS[S.topic] || TOPICS.sky).q.map(q => `"${q}"`).join(' and ') }));
    }
    if (k === 'maps') extra.push(h('button', { class: 'btn sm', type: 'button', style: 'margin-top:8px', text: `Browse ${S.oldmaps.length} maps here`, onclick: () => openMapsSheet() }));
    kids.push(h('div', { class: 'sw' }, h('div', { class: 'tx' }, h('div', { class: 'a', style: `color:${LAYERS[k].c}`, text: LAYERS[k].name }), h('div', { class: 'b', text: LAYERS[k].desc }), extra), tg));
  }
  const ud = h('button', { class: 'tog', type: 'button', 'aria-pressed': String(S.undated), 'aria-label': 'Show undated' });
  ud.addEventListener('click', () => { toggleUndated(); ud.setAttribute('aria-pressed', String(S.undated)); });
  kids.push(h('div', { class: 'sw' }, h('div', { class: 'tx' }, h('div', { class: 'a', text: 'Include undated things' }), h('div', { class: 'b', text: 'Many ghost towns, ancient sites and old maps have no exact year. Turn this off to see only what fits your dates.' })), ud));
  const ad = h('button', { class: 'tog', type: 'button', style: `--c:${LAYERS.maps.c}`, 'aria-pressed': String(S.autoDrape), 'aria-label': 'Auto-drape' });
  ad.addEventListener('click', () => { S.autoDrape = !S.autoDrape; store.set('autoDrape', S.autoDrape); ad.setAttribute('aria-pressed', String(S.autoDrape)); });
  kids.push(h('div', { class: 'sw' }, h('div', { class: 'tx' }, h('div', { class: 'a', text: 'Drape the best old map automatically' }), h('div', { class: 'b', text: 'When you arrive somewhere, lay the best-fitting old map over it.' })), ad));
  openSheet('layers', kids);
}
function toggleUndated() {
  S.undated = !S.undated; store.set('undated', S.undated);
  $('#undatedBtn').setAttribute('aria-pressed', String(S.undated));
  refreshPoints(); renderRelics(); LIVE.photos.last = null; scheduleLive();
}

/* ---------- search ---------- */
function openSearch() {
  const input = h('input', { type: 'search', placeholder: 'A town, city or region…', enterkeyhint: 'search', autocomplete: 'off', 'aria-label': 'Place name' });
  const list = h('div', { class: 'list' });
  const quick = h('div', { class: 'pills' });
  for (const [n, lat, lon] of [['Hartford', 41.7637, -72.6851], ['Salem', 42.5195, -70.8967], ['New Orleans', 29.9511, -90.0715], ['London', 51.5074, -0.1278], ['Paris', 48.8566, 2.3522], ['Rome', 41.9028, 12.4964], ['Cairo', 30.0444, 31.2357], ['Jerusalem', 31.7683, 35.2137]])
    quick.append(h('button', { class: 'pill', type: 'button', text: n, onclick: () => { closeSheet(); goTo(lat, lon, 13); } }));
  let seq = 0;
  const run = debounce(async () => {
    const q = input.value.trim(); const my = ++seq;
    if (q.length < 2) { list.replaceChildren(); return; }
    try {
      const d = await getJSON('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: q, count: '8', language: 'en', format: 'json' }), { ms: 10000 });
      if (my !== seq) return;
      const res = d.results || [];
      list.replaceChildren(...res.map(r => h('div', { class: 'li' },
        h('div', { class: 'ph', text: '⌖' }),
        h('button', { class: 'tx', type: 'button', style: 'text-align:left', onclick: () => { closeSheet(); goTo(r.latitude, r.longitude, r.feature_code && /^PCL|^ADM1/.test(r.feature_code) ? 6 : 12.5); } },
          h('div', { class: 'a', text: r.name }), h('div', { class: 'b', text: [r.admin1, r.country].filter(Boolean).join(', ') + (r.population ? ` · pop. ${fmtN(r.population)}` : '') })),
        h('button', { class: 'btn sm', type: 'button', text: 'Museum', onclick: () => { closeSheet(); goTo(r.latitude, r.longitude, 12.5); openMuseum({ name: r.name, state: r.admin1 || '', country: r.country || '', cc: (r.country_code || '').toLowerCase(), lat: r.latitude, lon: r.longitude }); } }))));
      if (!res.length) list.replaceChildren(h('p', { class: 'empty', text: 'No place by that name.' }));
    } catch (e) { list.replaceChildren(h('p', { class: 'empty', text: 'Place search ' + errText(e) + '.' })); }
  }, 300);
  input.addEventListener('input', run);
  openSheet('search', h('div', { class: 'kick', text: 'Go to' }), h('div', { class: 'field' }, input), quick, list);
  setTimeout(() => input.focus(), 60);
}
function goTo(lat, lon, zoom) { spinning = false; map.flyTo({ center: [lon, lat], zoom, speed: 1.5, curve: 1.5, essential: true }); }

/* ---------- the museum ---------- */
const WINGS = [
  { k: 'gallery', name: 'Gallery', c: '#22e5ff' },
  { k: 'maps', name: 'Map room', c: '#ffb000' },
  { k: 'library', name: 'Library', c: '#e9d9a6' },
  { k: 'papers', name: 'Newspapers', c: '#ff6b5a' },
  { k: 'oddities', name: 'Oddities & events', c: '#ff3df2' }
];
const MU = { place: null, wing: 'gallery', q: '', topic: 'all', years: null, nationwide: false, seq: 0, items: [], src: {}, page: {} };
async function openMuseumAt(lat, lon, opts) {
  toast('Finding this place…', 1500);
  let pl;
  try { pl = await placeAt(lat, lon, 10); }
  catch (e) { pl = { name: `${lat.toFixed(2)}, ${lon.toFixed(2)}`, state: '', country: '', cc: '', lat, lon }; }
  openMuseum(Object.assign({}, pl, { lat, lon }), opts);
}
async function museumHere() {
  if (map.getZoom() < 6) { toast('Zoom in on a town first, or search for one'); openSearch(); return; }
  const c = map.getCenter();
  openMuseumAt(c.lat, ((c.lng + 540) % 360) - 180);
}
function openMuseum(place, opts = {}) {
  MU.place = place; MU.wing = opts.wing || MU.wing || 'gallery'; MU.q = opts.q || ''; MU.years = opts.years || null; MU.nationwide = !!opts.nationwide; MU.anywhere = !!opts.anywhere;
  const p = $('#panel'); p.hidden = false; p.dataset.view = 'museum';
  const where = [place.state && place.state !== place.name ? place.state : '', place.country].filter(Boolean).join(', ');
  const input = h('input', { type: 'search', placeholder: 'Look for… (ghost, fire, giant, mill)', value: MU.q, enterkeyhint: 'search', 'aria-label': 'Look for words' });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { MU.q = input.value.trim(); input.blur(); loadWing(); } });
  input.addEventListener('search', () => { if (!input.value) { MU.q = ''; loadWing(); } });
  const wings = h('div', { class: 'wings', role: 'tablist' }, WINGS.map(w => h('button', { class: 'wing' + (w.k === MU.wing ? ' on' : ''), type: 'button', role: 'tab', style: `--c:${w.c}`, 'data-w': w.k, text: w.name, onclick: () => { MU.wing = w.k; $$('.wing', p).forEach(b => b.classList.toggle('on', b.dataset.w === w.k)); loadWing(); } })));
  p.replaceChildren(
    h('div', { class: 'ph-head' },
      h('div', { class: 'kick', text: 'The museum of' }),
      h('h2', { text: place.name || 'This place' }),
      h('div', { class: 'meta', text: `${where ? where + ' · ' : ''}${Math.abs(place.lat).toFixed(3)}°${place.lat >= 0 ? 'N' : 'S'} ${Math.abs(place.lon).toFixed(3)}°${place.lon >= 0 ? 'E' : 'W'}` }),
      h('button', { class: 'ic close', type: 'button', 'aria-label': 'Leave the museum', onclick: closePanel }, h('span', { style: 'font-size:20px', text: '✕' }))),
    wings,
    h('div', { class: 'ph-tools' }, h('div', { class: 'field' }, input, h('button', { class: 'btn', type: 'button', text: 'Look', onclick: () => { MU.q = input.value.trim(); loadWing(); } })),
      h('div', { class: 'meta', id: 'muEra' }), h('div', { class: 'pills', id: 'muTopics' }), h('div', { class: 'decades', id: 'muDecades' })),
    h('div', { class: 'ph-body', id: 'muBody' }));
  loadWing();
}
function closePanel() { const p = $('#panel'); p.hidden = true; p.dataset.view = ''; MU.seq++; }
function muRange() { return MU.years ? { from: MU.years[0], to: MU.years[1] } : { from: S.from, to: S.to }; }
const muIn = y => { const r = muRange(); return y == null ? S.undated : y >= r.from && y <= r.to; };

const MU_SOURCES = {
  gallery: pl => [
    ['loc', 'Library of Congress', () => locSearch('photos', pl, 40)],
    ['wm', 'Wikimedia Commons', s => commonsNear(pl.lat, pl.lon, 6000, s, 150).then(l => l.filter(x => !MU.q || new RegExp(MU.q.split(/\s+/).join('|'), 'i').test(x.title + ' ' + x.desc)))],
    ['eu', 'Europeana', s => pl.cc === 'us' ? Promise.resolve({ skip: 'mostly European, left out' }) : europeanaPlace(pl, 'IMAGE', s)]
  ],
  maps: pl => [
    ['am', 'Warped maps (Allmaps)', s => allmapsQuery({ s: pl.lat - 0.02, w: pl.lon - 0.02, n: pl.lat + 0.02, e: pl.lon + 0.02 }, { min: 5e4, max: 2e12 }, s, 100).then(async l => { await fillMapTitles(l.slice(0, 30)); return l; })],
    ['locm', 'Library of Congress maps', () => locSearch('maps', pl, 30)]
  ],
  library: pl => [
    ['ia', MU.anywhere ? 'Internet Archive books & journals, anywhere' : 'Internet Archive books & journals', s => iaTexts(pl, s)],
    ['fts', 'Words inside old books', s => MU.q ? iaFullText(pl, s) : Promise.resolve({ skip: 'type words above to search inside the books' })]
  ],
  papers: pl => pl.cc === 'us' || MU.nationwide ? [
    ['ca', MU.nationwide ? 'Newspapers, every state' : `Newspapers printed in ${pl.name}`, s => papersHere(pl, s, false)],
    ['cas', MU.nationwide ? null : `Elsewhere in ${pl.state}`, s => MU.nationwide ? Promise.resolve({ skip: '' }) : papersHere(pl, s, true)]
  ].filter(x => x[1]) : [
    ['eut', 'Europeana texts & newspapers', s => europeanaPlace(pl, 'TEXT', s)]
  ],
  oddities: pl => [
    ['atlas', 'Case files, events & sites within 80 km', () => nearbyAtlas(pl)],
    ['wp', 'Historic places (Wikipedia)', s => wikiNear(pl, s)]
  ]
};
async function loadWing() {
  const my = ++MU.seq; const pl = MU.place; const w = WINGS.find(x => x.k === MU.wing);
  MU.items = []; MU.src = {};
  const body = $('#muBody'); body.replaceChildren(h('div', { class: 'src', id: 'muSrc' }), h('div', { id: 'muRooms' }));
  const r = muRange();
  $('#muEra').textContent = `Showing ${fmtYear(r.from)} to ${fmtYear(r.to)}${MU.years ? ' (around the case)' : ' (set on the time dial)'}${MU.q ? ` · looking for “${MU.q}”` : ''}`;
  const tp = $('#muTopics'); tp.replaceChildren();
  if (MU.wing === 'papers' && !MU.q) for (const [k, t] of Object.entries(TOPICS)) tp.append(h('button', { class: 'pill' + (MU.topic === k ? ' on' : ''), style: `--c:${LAYERS.papers.c}`, type: 'button', text: t.name, onclick: () => { MU.topic = k; loadWing(); } }));
  if (MU.years) tp.append(h('button', { class: 'pill', type: 'button', text: '✕ Use time dial dates', onclick: () => { MU.years = null; loadWing(); } }));
  const srcs = MU_SOURCES[MU.wing](pl);
  const paintSrc = () => {
    const box = $('#muSrc'); if (!box) return;
    box.replaceChildren(...srcs.map(([k, name]) => {
      const st = MU.src[k] || { wait: true };
      return h('span', { class: st.wait ? 'wait' : st.err ? 'err' : 'ok', text: `${name}: ${st.wait ? (k === 'ca' || k === 'cas' ? 'searching (~30 s)' : 'searching') : st.err ? st.err : st.skip != null ? (st.skip || 'skipped') : st.n + ' found'}` });
    }));
  };
  paintSrc();
  const ctl = new AbortController();
  const stop = () => { if (MU.seq !== my) ctl.abort(); };
  const tick = setInterval(() => { stop(); if (ctl.signal.aborted) clearInterval(tick); }, 500);
  await Promise.all(srcs.map(async ([k, , fn]) => {
    try {
      const res = await fn(ctl.signal);
      if (MU.seq !== my) return;
      if (res && res.skip != null) MU.src[k] = { skip: res.skip };
      else { const list = (res || []).map(x => Object.assign(x, { srcKey: k })); MU.items.push(...list); MU.src[k] = { n: list.length }; }
    } catch (e) { if (MU.seq !== my) return; MU.src[k] = { err: errText(e) }; }
    paintSrc(); paintRooms(w);
  }));
  clearInterval(tick);
  if (MU.seq === my) { paintSrc(); paintRooms(w, true); }
}
function paintRooms(w, done) {
  const box = $('#muRooms'); if (!box) return;
  const seen = new Set();
  const items = MU.items.filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return x.L === 'maps' || muIn(x.year); });
  const ys = items.map(x => x.year).filter(y => y != null);
  const span = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  const size = span <= 260 ? 10 : span <= 1500 ? 100 : 1000;
  const roomOf = y => y == null ? null : Math.floor(y / size) * size;
  const rooms = new Map();
  for (const it of items) { const k = roomOf(it.year); if (!rooms.has(k)) rooms.set(k, []); rooms.get(k).push(it); }
  const keys = [...rooms.keys()].sort((a, b) => a == null ? 1 : b == null ? -1 : a - b);
  const label = k => k == null ? 'Undated' : size === 10 ? (k < 0 ? `${-k}s BC` : `${k}s`) : size === 100 ? (k >= 0 ? `${ordinal(k / 100 + 1)} century` : `${ordinal(-k / 100)} century BC`) : `${fmtYear(k)} – ${fmtYear(k + size - 1)}`;
  const dec = $('#muDecades'); dec.replaceChildren();
  box.replaceChildren();
  if (!items.length) {
    box.append(h('p', { class: 'empty', text: done ? emptyText() : 'Opening the archives…' }));
    return;
  }
  keys.forEach((k, i) => {
    const list = rooms.get(k).sort((a, b) => (a.year ?? 1e9) - (b.year ?? 1e9));
    const id = 'room-' + i;
    const grid = h('div', { class: 'grid' }, list.map(it => card(it, w)));
    box.append(h('section', { class: 'room', id }, h('h4', {}, label(k), h('small', { text: `${list.length} item${list.length === 1 ? '' : 's'}` })), grid));
    dec.append(h('button', { type: 'button', style: `--c:${w.c}`, onclick: () => document.getElementById(id).scrollIntoView({ behavior: 'smooth', block: 'start' }) }, label(k).replace(' century', ' c.'), h('b', { text: String(list.length) })));
  });
}
function emptyText() {
  if (MU.wing === 'papers' && MU.place.cc !== 'us' && !MU.nationwide) return 'Nothing in these archives for this place and these dates. Try a wider time range.';
  return `Nothing found for ${MU.place.name} in ${fmtYear(muRange().from)}–${fmtYear(muRange().to)}. Widen the time dial, try fewer words, or try the next wing.`;
}
function card(it, w) {
  const c = LAYERS[it.L] || KIND[it.L] ? kindColor(it.L) : w.c;
  const isText = it.kind === 'text' || it.L === 'papers' || it.srcKey === 'ia' || it.srcKey === 'fts';
  const imgSrc = it.thumb;
  const im = imgSrc ? h('div', { class: 'im' }, h('img', { src: imgSrc, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: e => { e.target.parentNode.classList.add('tx'); e.target.parentNode.textContent = '❧'; } }))
    : h('div', { class: 'im tx', text: it.isRecord ? (it.L === 'strange' ? '◎' : it.L === 'ancient' ? '▲' : it.L === 'events' ? '◆' : '⌂') : '❧' });
  const cap = h('div', { class: 'cap' }, h('div', { class: 'a', text: it.headline || it.title || it.name || 'Untitled' }),
    h('div', { class: 'b', text: [it.year != null ? (it.circa ? 'c. ' : '') + fmtYear(it.year) : 'undated', it.L === 'papers' ? `${it.city}` : it.srcKey === 'atlas' ? it.kind : (it.provider || it.holder || it.src)].filter(Boolean).join(' · ') }));
  if ((isText || it.isRecord) && (it.excerpt || it.desc)) { const ex = h('div', { class: 'ex' }); it.excerpt ? markText(ex, '…' + it.excerpt + '…') : (ex.textContent = it.desc); cap.append(ex); }
  const el = h('button', { class: 'card' + (isText || it.isRecord ? ' wide' : '') + (imgSrc ? '' : ' noim'), type: 'button', style: `--c:${c}` }, im, cap);
  el.addEventListener('click', () => it.isRecord ? openRecord(it.rec) : openItem(it));
  if (it.L === 'papers' && it.wc) enrichCard(it, el);
  return el;
}
// Pull the matching passage and cropped clipping into a newspaper card when it arrives.
function enrichCard(it, node) {
  enrichCA(it).then(x => {
    if (!node.isConnected) return;
    let ex = node.querySelector('.ex'); if (!ex) { ex = h('div', { class: 'ex' }); node.querySelector('.cap').append(ex); }
    if (x.excerpt) markText(ex, '…' + x.excerpt + '…');
    if (x.clip) { const img = node.querySelector('img'); if (img) img.src = x.clip.replace('!900,900', '!400,400'); }
  });
}
/* museum source functions */
async function locSearch(kind, pl, c) {
  const r = muRange(); const from = Math.max(1, r.from), to = Math.max(1, r.to);
  if (r.to < 1) return { skip: 'nothing dated BC here' };
  const q = MU.anywhere && MU.q ? MU.q : [pl.name, pl.cc === 'us' ? pl.state : pl.country, MU.q].filter(Boolean).join(' ');
  const d = await getJSON(`https://www.loc.gov/${kind}/?` + new URLSearchParams({ q, dates: `${String(from).padStart(4, '0')}/${String(to).padStart(4, '0')}`, fo: 'json', c: String(c), at: 'results,pagination' }), { ms: 40000 });
  return (d.results || []).map(locItem).filter(x => x && x.thumb && !(kind === 'maps' && /^\[.*--/.test(x.title))).map(x => Object.assign(x, { L: kind === 'maps' ? 'maps-scan' : 'photos' }));
}
function locItem(r) {
  const imgs = (r.image_url || []).map(u => ({ url: u.split('#')[0], w: +((u.match(/[#&]w=(\d+)/) || [])[1] || 0) }));
  if (!imgs.length) return null;
  const iiif = imgs.find(i => /\/full\/[^/]+\/0\/default\.jpg$/.test(i.url));
  let thumb, large;
  if (iiif) { thumb = iiif.url.replace(/\/full\/[^/]+\/0\/default\.jpg$/, '/full/!400,400/0/default.jpg'); large = iiif.url.replace(/\/full\/[^/]+\/0\/default\.jpg$/, '/full/!1400,1400/0/default.jpg'); }
  else { const byW = imgs.slice().sort((a, b) => a.w - b.w); thumb = (byW.find(i => i.w >= 140 && i.w <= 450) || byW[byW.length - 1]).url; large = (byW.filter(i => i.w <= 1400).pop() || byW[byW.length - 1]).url; }
  return { id: 'loc:' + (r.id || r.url), src: 'Library of Congress', title: cut(plain(r.title) || 'Untitled', 160), year: yearOf(r.date) || yearOf(first(r.dates)),
    creator: caps(plain(first(r.contributor))), holder: 'Library of Congress', place: caps(plain(first(r.location))), thumb, large, link: r.url || r.id, desc: cut(plain(first(r.description)), 400) };
}
async function europeanaPlace(pl, type, signal) {
  const r = muRange();
  const p = new URLSearchParams({ wskey: 'api2demo', query: MU.anywhere && MU.q ? MU.q : `"${pl.name}"${MU.q ? ' AND (' + MU.q + ')' : ''}`, rows: '60', profile: 'rich' });
  p.append('qf', 'TYPE:' + type);
  if (r.from >= 1000) p.append('qf', `YEAR:[${r.from} TO ${r.to}]`);
  if (type === 'IMAGE') p.set('reusability', 'open');
  const d = await getJSON(EU + p, { signal });
  if (d.success === false) { const e = new Error(d.error || 'rejected'); e.status = 401; throw e; }
  return (d.items || []).filter(x => first(x.edmPreview) || type === 'TEXT').map(x => euItem(x, { L: type === 'TEXT' ? 'papers-eu' : 'photos' })).filter(x => muIn(x.year));
}
async function iaTexts(pl, signal) {
  const r = muRange(); if (r.to < 1) return { skip: 'nothing dated BC here' };
  const nm = pl.name.replace(/"/g, '');
  let q = MU.anywhere && MU.q ? `(${MU.q}) AND mediatype:texts AND year:[${Math.max(1, r.from)} TO ${r.to}]`
    : `(title:("${nm}") OR subject:("${nm}") OR coverage:("${nm}")) AND mediatype:texts AND year:[${Math.max(1, r.from)} TO ${r.to}]`;
  if (MU.q && !MU.anywhere) q += ` AND (${MU.q})`;
  const p = new URLSearchParams({ q, rows: '80', page: '1', output: 'json' });
  ['identifier', 'title', 'year', 'date', 'creator', 'downloads', 'subject'].forEach(f => p.append('fl[]', f));
  p.append('sort[]', 'year asc');
  const d = await getJSON('https://archive.org/advancedsearch.php?' + p, { signal });
  return (d.response && d.response.docs || []).map(x => ({
    id: 'ia:' + x.identifier, L: 'library', src: 'Internet Archive', kind: 'text', title: cut(plain(first(x.title)) || 'Untitled', 180), year: yearOf(x.year) || yearOf(x.date),
    creator: plain(first(x.creator)), holder: 'Internet Archive', desc: cut([].concat(x.subject || []).slice(0, 6).join(' · '), 200),
    thumb: `https://archive.org/services/img/${encodeURIComponent(x.identifier)}`, large: `https://archive.org/services/img/${encodeURIComponent(x.identifier)}`,
    link: `https://archive.org/details/${encodeURIComponent(x.identifier)}`
  }));
}
async function iaFullText(pl, signal) {
  const r = muRange(); if (r.to < 1) return { skip: 'nothing dated BC here' };
  const uq = `${MU.anywhere ? '' : '"' + pl.name.replace(/"/g, '') + '" AND '}(${MU.q.includes(' ') && !MU.q.includes('"') ? '"' + MU.q + '"' : MU.q}) AND year:[${Math.max(1, r.from)} TO ${r.to}]`;
  const p = new URLSearchParams({ service_backend: 'fts', user_query: uq, hits_per_page: '30', page: '1' });
  const d = await getJSON('https://archive.org/services/search/beta/page_production/?' + p, { signal, ms: 30000 });
  const b = d.response && d.response.body; if (!b || !b.hits) return [];
  return b.hits.hits.map(hh => {
    const f = hh.fields || {}, hl = (hh.highlight && hh.highlight.text) || [];
    const id = f.identifier;
    return { id: `fts:${id}:${f.page_num || 0}`, L: 'library', src: 'Internet Archive', kind: 'text', title: cut(plain(f.title) || id, 180), year: yearOf(f.year) || yearOf(f.date),
      creator: plain(first(f.creator)), holder: 'Internet Archive', dateText: f.page_num ? `page ${f.page_num}` : '',
      thumb: `https://archive.org/services/img/${encodeURIComponent(id)}`, link: 'https://archive.org' + (f.__href__ || `/details/${encodeURIComponent(id)}`), excerpt: hl.slice(0, 2).join(' … ') };
  });
}
async function papersHere(pl, signal, stateWide) {
  const r = muRange();
  const words = MU.q ? [MU.q.includes(' ') && !MU.q.includes('"') ? `"${MU.q}"` : MU.q] : (TOPICS[MU.topic] || TOPICS.all).q.map(q => `"${q}"`);
  const state = MU.nationwide ? null : pl.state;
  const city = MU.nationwide || stateWide ? null : pl.name;
  const res = await Promise.allSettled(words.map(q => caSearch({ q, state, city, from: r.from, to: r.to, c: stateWide ? 12 : 20, signal })));
  const ok = res.filter(x => x.status === 'fulfilled').map(x => x.value);
  if (!ok.length) throw res[0].reason;
  if (ok.every(o => o.skip)) return { skip: ok[0].skip };
  let items = ok.flatMap(o => o.items);
  if (stateWide) items = items.filter(x => x.city.toLowerCase() !== pl.name.toLowerCase());
  return items;
}
function nearbyAtlas(pl) {
  const out = []; const R = 80;
  const km = (a, b, c2, d) => { const dx = (d - b) * 111.32 * Math.cos((a + c2) / 2 * Math.PI / 180), dy = (c2 - a) * 110.57; return Math.sqrt(dx * dx + dy * dy); };
  const add = (r) => { if (km(pl.lat, pl.lon, r.lat, r.lon) <= R && (!MU.q || new RegExp(MU.q.split(/\s+/).join('|'), 'i').test(`${r.name} ${r.desc} ${r.kind}`)))
    out.push({ id: 'rec:' + r.id, isRecord: true, rec: r, L: r.L, title: r.name, year: r.y, circa: r.circa, kind: r.isCase ? 'case file' : r.kind, desc: r.desc, thumb: r.thumb }); };
  for (const r of S.cases || []) add(r);
  for (const L of ['strange', 'events', 'ancient']) if (S.data[L]) for (const r of S.data[L].rows) add(r);
  const missing = ['strange', 'events', 'ancient'].filter(L => !S.data[L]);
  if (missing.length) return Promise.all(missing.map(ensureData)).then(() => nearbyAtlas(pl));
  return Promise.resolve(out);
}
async function wikiNear(pl, signal) {
  const p = new URLSearchParams({ action: 'query', generator: 'geosearch', ggscoord: `${pl.lat.toFixed(5)}|${pl.lon.toFixed(5)}`, ggsradius: '10000', ggslimit: '150', prop: 'coordinates|pageimages|description', piprop: 'thumbnail', pithumbsize: '400', pilimit: '50', format: 'json', origin: '*' });
  const d = await getJSON(WP + p, { signal });
  const out = [];
  for (const pg of Object.values((d.query && d.query.pages) || {})) {
    const text = `${pg.title} ${pg.description || ''}`;
    if (!HISTORIC.test(text) || NOT_HISTORIC.test(text)) continue;
    if (MU.q && !new RegExp(MU.q.split(/\s+/).join('|'), 'i').test(text)) continue;
    const co = pg.coordinates && pg.coordinates[0];
    const ys = yearsIn(pg.description || '').filter(y => y <= 1950);
    const rec = { id: 'wp:' + pg.pageid, L: 'places', name: pg.title, lat: co ? co.lat : pl.lat, lon: co ? co.lon : pl.lon, y: ys.length ? Math.min(...ys) : null, kind: pg.description || 'historic place', desc: '', wiki: pg.title.replace(/ /g, '_'), thumb: pg.thumbnail && pg.thumbnail.source };
    out.push({ id: 'rec:' + rec.id, isRecord: true, rec, L: 'places', title: rec.name, year: rec.y, kind: rec.kind, thumb: rec.thumb });
  }
  return out;
}

/* ---------- case file ---------- */
function openCaseFile() {
  const p = $('#panel'); p.hidden = false; p.dataset.view = 'casefile';
  const body = h('div', { class: 'ph-body' });
  const paint = () => {
    body.replaceChildren();
    if (!S.saved.length) { body.append(h('p', { class: 'empty', text: 'Nothing saved yet. Tap “+ Case file” on anything you find: a clipping, a photo, an old map, a strange event. Add notes and build your theory here.' })); return; }
    for (const s of S.saved) {
      const c = kindColor(s.L);
      const ta = h('textarea', { placeholder: 'Your notes, connections, theories…', 'aria-label': 'Notes' });
      ta.value = s.note || '';
      ta.addEventListener('input', debounce(() => { s.note = ta.value; store.set('saved', S.saved); }, 400));
      const img = s.clip || s.thumb;
      body.append(h('div', { class: 'saved', style: 'border-bottom:1px solid var(--line);padding:14px 0' },
        h('div', { style: 'display:flex;gap:12px' },
          img ? h('img', { src: img, alt: '', referrerpolicy: 'no-referrer', style: 'width:84px;height:84px;object-fit:cover;border-radius:10px;flex:none;background:#151a20' }) : null,
          h('div', { style: 'flex:1;min-width:0' },
            h('div', { class: 'kick', style: `--c:${c}`, text: `${kindName(s.L)} · ${s.year != null ? (s.circa ? 'c. ' : '') + fmtYear(s.year) : 'undated'}` }),
            h('div', { style: 'font:18px/1.2 var(--serif);margin-top:3px', text: s.title || s.name }),
            h('div', { class: 'meta', text: [s.dateText, s.city ? s.city + ', ' + s.state : s.place, s.holder].filter(Boolean).join(' · ') }))),
        ta,
        h('div', { class: 'row', style: 'margin-top:8px' },
          s.link ? h('a', { class: 'btn sm', href: s.link, target: '_blank', rel: 'noopener', text: 'Original ↗' }) : null,
          s.lat != null ? h('button', { class: 'btn sm', type: 'button', text: 'Show on map', onclick: () => { closePanel(); goTo(s.lat, s.lon, 13); } }) : null,
          h('button', { class: 'btn sm', type: 'button', text: 'Remove', onclick: () => { S.saved = S.saved.filter(x => x.id !== s.id); store.set('saved', S.saved); paintSaved(); paint(); } }))));
    }
  };
  const copy = async () => {
    const txt = S.saved.map((s, i) => `${i + 1}. ${s.title || s.name} (${s.year != null ? fmtYear(s.year) : 'undated'})\n${[s.dateText, s.city ? s.city + ', ' + s.state : s.place, s.holder].filter(Boolean).join(' · ')}\n${s.link || ''}${s.note ? '\nNotes: ' + s.note : ''}`).join('\n\n');
    try { await navigator.clipboard.writeText(`PALIMPSEST case file\n\n${txt}`); toast('Copied the case file'); } catch (e) { toast('Copy was blocked by the browser'); }
  };
  p.replaceChildren(
    h('div', { class: 'ph-head' }, h('div', { class: 'kick', text: 'Your' }), h('h2', { text: 'Case file' }),
      h('div', { class: 'meta', text: `${S.saved.length} item${S.saved.length === 1 ? '' : 's'} · kept on this device` }),
      h('button', { class: 'ic close', type: 'button', 'aria-label': 'Close', onclick: closePanel }, h('span', { style: 'font-size:20px', text: '✕' }))),
    h('div', { class: 'ph-tools' }, h('div', { class: 'row', style: 'margin:0' }, h('button', { class: 'btn', type: 'button', text: 'Copy all as text', onclick: copy }))),
    body);
  paint();
}

/* ---------- intro / about ---------- */
function openIntro(again) {
  const legend = h('div', { class: 'legend' }, ORDER.map(k => h('span', { style: `--c:${LAYERS[k].c}`, text: LAYERS[k].name })));
  const pills = h('div', { class: 'pills' });
  for (const [n, lat, lon, z] of [['Hartford', 41.7637, -72.6851, 13], ['New York', 40.7128, -74.006, 12.5], ['London', 51.5074, -0.1278, 12.5], ['Paris', 48.8566, 2.3522, 12.5], ['Rome', 41.9028, 12.4964, 12.5], ['Stay on the globe', null, null, null]])
    pills.append(h('button', { class: 'pill' + (lat == null ? '' : ' on'), type: 'button', text: n, onclick: () => { store.set('seenIntro', true); closeSheet(); if (lat != null) goTo(lat, lon, z); else idleSpin(); } }));
  openSheet('intro', h('div', { class: 'intro' },
    h('div', { class: 'kick', text: 'Palimpsest · n. a page scraped and written over, the old writing still showing through' }),
    h('div', { class: 'ttl', text: 'The Earth, written over' }),
    h('ul', {},
      h('li', { text: 'Set the time dial at the bottom. Everything on the map follows it.' }),
      h('li', { text: 'Zoom into any town. Old maps drape over the satellite, and photos, drawings and newspapers pin themselves where they were made.' }),
      h('li', { text: 'Pink eyes are case files: strange events worth digging into. Tap one to search the old newspapers about it.' }),
      h('li', { text: 'Tap the columns icon at the top to walk through the museum of wherever you are, room by room, decade by decade.' })),
    legend,
    h('h3', { class: 'sec', text: 'Start somewhere' }), pills,
    h('p', { class: 'note', text: 'Sources: Library of Congress, Internet Archive, Wikimedia Commons, Wikipedia, Wikidata, Europeana, Allmaps (David Rumsey, NYPL, Harvard, Yale and more). Imagery: Esri. Everything loads live from those archives; nothing about you is stored anywhere but this device.' }),
    again ? h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Show the layer options', onclick: openLayersSheet })) : null));
}

/* ---------- wiring ---------- */
function wire() {
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'search') openSearch();
    else if (a === 'museum') museumHere();
    else if (a === 'casefile') openCaseFile();
    else if (a === 'about') openIntro(true);
    else if (a === 'sheetclose') closeSheet();
    else if (a === 'aged') { S.aged = !S.aged; store.set('aged', S.aged); applyLook(); }
    else if (a === 'labels') { S.labels = !S.labels; store.set('labels', S.labels); applyLook(); }
    else if (a === 'globe') { closeSheet(); map.flyTo({ center: [map.getCenter().lng, 25], zoom: 1.55, speed: 1.6 }); }
    else if (a === 'undated') toggleUndated();
    else if (a === 'dock') { $('#dock').classList.toggle('min'); setTimeout(fitPadding, 260); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#sheet').hidden) closeSheet(); else if (!$('#panel').hidden) closePanel(); } });
  // Swipe the sheet down to close it.
  let y0 = null;
  const sh = $('#sheet');
  sh.addEventListener('touchstart', e => { y0 = sh.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  sh.addEventListener('touchmove', e => { if (y0 != null && e.touches[0].clientY - y0 > 90) { y0 = null; closeSheet(); } }, { passive: true });
  new ResizeObserver(fitPadding).observe($('#dock'));
  addEventListener('resize', fitPadding);
}

/* ---------- start ---------- */
(function start() {
  wire(); buildDial(); paintSaved();
  $('#undatedBtn').setAttribute('aria-pressed', String(S.undated));
  updateChips();
  if (!window.maplibregl) { $('#scanText').textContent = 'The map library didn\'t load. Check your connection and reload.'; return; }
  initMap();
})();
