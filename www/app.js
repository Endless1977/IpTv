/* Kijkdoos — IPTV voor Android, Windows en de browser.
 * Bronnen: gratis (iptv-org, Internet Archive) + eigen abonnementen (Xtream Codes / M3U).
 * Alleen streams die echt beschikbaar zijn worden getoond (tenzij je dat uitzet).
 */
'use strict';

// ---------- Omgeving ----------
const ENV = (() => {
  const cap = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const electron = /Electron/i.test(navigator.userAgent);
  const v = document.createElement('video');
  const nativeHls = !!v.canPlayType('application/vnd.apple.mpegurl');
  return { cap, electron, native: cap || electron, nativeHls, https: location.protocol === 'https:' };
})();

// ---------- Opslag ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem('kd.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('kd.' + k, JSON.stringify(v)); } catch {} },
};

const BUILTIN = [
  { id: 'iptv-movies', name: 'iptv-org · Filmkanalen', desc: 'Gratis live filmkanalen wereldwijd', type: 'm3u', tab: 'film', url: 'https://iptv-org.github.io/iptv/categories/movies.m3u', on: true },
  { id: 'iptv-series', name: 'iptv-org · Seriekanalen', desc: 'Gratis live seriekanalen wereldwijd', type: 'm3u', tab: 'series', url: 'https://iptv-org.github.io/iptv/categories/series.m3u', on: true },
  { id: 'iptv-classic', name: 'iptv-org · Klassiekers', desc: 'Kanalen met klassieke films en tv', type: 'm3u', tab: 'film', url: 'https://iptv-org.github.io/iptv/categories/classic.m3u', on: true },
  { id: 'iptv-animation', name: 'iptv-org · Animatie', desc: 'Tekenfilm- en animatiekanalen', type: 'm3u', tab: 'series', url: 'https://iptv-org.github.io/iptv/categories/animation.m3u', on: true },
  { id: 'iptv-nl', name: 'iptv-org · Nederland', desc: 'Gratis Nederlandse zenders (Live TV)', type: 'm3u', tab: 'live', url: 'https://iptv-org.github.io/iptv/countries/nl.m3u', on: true },
  { id: 'iptv-be', name: 'iptv-org · België', desc: 'Gratis Belgische zenders (Live TV)', type: 'm3u', tab: 'live', url: 'https://iptv-org.github.io/iptv/countries/be.m3u', on: false },
  { id: 'archive-films', name: 'Internet Archive · Films', desc: 'Duizenden rechtenvrije speelfilms (on demand)', type: 'archive', tab: 'film', on: true },
  { id: 'archive-tv', name: 'Internet Archive · Series', desc: 'Klassieke tv-series en tekenfilms (on demand)', type: 'archive', tab: 'series', on: true },
];

const ARCHIVE_ROWS = {
  film: [
    ['Populaire klassiekers', 'collection:feature_films AND mediatype:movies'],
    ['Sciencefiction & horror', 'collection:SciFi_Horror'],
    ['Film noir', 'collection:film_noir'],
    ['Comedy', 'collection:feature_films AND subject:comedy'],
    ['Western', 'collection:feature_films AND subject:western'],
    ['Stomme films', 'collection:silent_films'],
  ],
  series: [
    ['Klassieke tv-series', 'collection:classic_tv'],
    ['Klassieke tekenfilms', 'collection:classic_cartoons'],
    ['Tv-comedy', 'collection:classic_tv AND subject:comedy'],
    ['Tv-western', 'collection:classic_tv AND subject:western'],
  ],
};

const state = {
  tab: 'film',
  q: '',
  settings: LS.get('settings', { showAll: false, proxy: '', builtin: {} }),
  subs: LS.get('subs', []),
  avail: LS.get('avail', {}),          // url -> {s:'ok'|'reach'|'dead', t}
  rows: [],                            // {id, tab, title, items:[], more?:fn, src}
  subStatus: {},                       // sub.id -> {ok, msg}
};
for (const b of BUILTIN) if (!(b.id in state.settings.builtin)) state.settings.builtin[b.id] = b.on;

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const saveSettings = () => LS.set('settings', state.settings);
const saveSubs = () => LS.set('subs', state.subs);
let availDirty = false;
setInterval(() => { if (availDirty) { availDirty = false; LS.set('avail', state.avail); } }, 3000);

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms);
}

// ---------- Netwerk ----------
const px = url => (!ENV.native && state.settings.proxy ? state.settings.proxy + encodeURIComponent(url) : url);
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

async function http(url, { type = 'text', timeout = 20000, headers } = {}) {
  const r = await withTimeout(fetch(px(url), { headers, cache: 'no-store' }), timeout);
  if (!r.ok && r.status !== 206) throw new Error('HTTP ' + r.status);
  return type === 'json' ? r.json() : r.text();
}

const isHls = url => /\.m3u8(\?|$)/i.test(url) || /\/live\/[^/]+\/[^/]+\/\d+$/.test(url);
const mixedBlocked = url => ENV.https && !ENV.native && /^http:/i.test(url) && !state.settings.proxy;

/** Controleer of een stream werkt. ok = afspeelbaar, reach = server antwoordt (zonder CORS), dead = kapot */
async function probe(url) {
  if (mixedBlocked(url)) return 'dead';
  const hls = isHls(url);
  try {
    const r = await withTimeout(fetch(px(url), { headers: hls ? {} : { Range: 'bytes=0-1023' }, cache: 'no-store' }), 9000);
    if (!r.ok && r.status !== 206) return 'dead';
    if (hls) {
      const txt = await withTimeout(r.text(), 6000);
      return txt.includes('#EXT') ? 'ok' : 'dead';
    }
    try { r.body && r.body.cancel(); } catch {}
    return 'ok';
  } catch (e) {
    if (ENV.native || e.message === 'timeout') return 'dead';
    try { // CORS geweigerd? Kijk of de server überhaupt reageert.
      await withTimeout(fetch(url, { mode: 'no-cors', cache: 'no-store' }), 7000);
      return 'reach';
    } catch { return 'dead'; }
  }
}

function playableStatus(s, url) {
  if (s === 'ok') return true;
  if (s === 'reach') return !isHls(url) || ENV.nativeHls; // native speler heeft geen CORS nodig
  return false;
}

// ---------- Item-beschikbaarheid ----------
const TTL = { ok: 6 * 3600e3, reach: 6 * 3600e3, dead: 1 * 3600e3 };
function cachedStatus(key) {
  const a = state.avail[key];
  if (a && Date.now() - a.t < TTL[a.s]) return a.s;
  return null;
}
function setStatus(key, s) { state.avail[key] = { s, t: Date.now() }; availDirty = true; }

/** status van een item: 'ok' | 'dead' | null (nog onbekend) */
function itemStatus(it) {
  if (it.status) return it.status;
  if (it.statusKey) {
    const s = cachedStatus(it.statusKey);
    if (s) return playableStatus(s, it.url || '') ? 'ok' : 'dead';
  }
  return null;
}
const visible = it => state.settings.showAll || itemStatus(it) === 'ok';

// Wachtrij met beperkte gelijktijdigheid
const queue = { list: [], running: 0, max: 6, done: 0, total: 0, seen: new Set() };
function enqueue(it, front = false) {
  if (!it.check || itemStatus(it) || queue.seen.has(it.uid)) return;
  queue.seen.add(it.uid); queue.total++;
  front ? queue.list.unshift(it) : queue.list.push(it);
  pump();
}
function pump() {
  while (queue.running < queue.max && queue.list.length) {
    const it = queue.list.shift();
    queue.running++;
    it.check().then(s => {
      if (it.statusKey) setStatus(it.statusKey, s); else it.status = s;
    }).catch(() => { if (it.statusKey) setStatus(it.statusKey, 'dead'); else it.status = 'dead'; })
      .finally(() => { queue.running--; queue.done++; scheduleRender(); updateStatus(); pump(); });
  }
  updateStatus();
}
function updateStatus() {
  const el = $('#status');
  const busy = queue.running > 0 || queue.list.length > 0;
  const loading = loaders.size > 0;
  if (!busy && !loading) { el.innerHTML = ''; queue.done = queue.total = 0; return; }
  const parts = [];
  if (loading) parts.push('Bronnen laden…');
  if (busy) parts.push(`Streams controleren ${queue.done}/${queue.total}`);
  el.innerHTML = '<span class="dot"></span>' + parts.join(' · ');
}

// ---------- M3U ----------
function parseM3U(text) {
  const out = []; let cur = null;
  for (let raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      cur = { attrs: {}, opts: false };
      const re = /([\w-]+)="([^"]*)"/g; let m, lastEnd = 0;
      while ((m = re.exec(line))) { cur.attrs[m[1].toLowerCase()] = m[2]; lastEnd = re.lastIndex; }
      const comma = line.indexOf(',', lastEnd || line.indexOf(':'));
      cur.name = (comma >= 0 ? line.slice(comma + 1) : '').trim();
    } else if (line.startsWith('#EXTVLCOPT') || line.startsWith('#KODIPROP')) {
      if (cur && /http-(referrer|user-agent)|license/i.test(line)) cur.opts = true;
    } else if (line.startsWith('#EXTGRP:')) {
      if (cur) cur.attrs['group-title'] = cur.attrs['group-title'] || line.slice(8).trim();
    } else if (!line.startsWith('#') && cur) {
      cur.url = line; out.push(cur); cur = null;
    }
  }
  return out;
}

const cleanName = n => n.replace(/\s*\((\d{3,4}p|geo-blocked|not 24\/7)\)/gi, '').replace(/\s*\[[^\]]*\]\s*$/,'').trim();

function classify(e) {
  const g = (e.attrs['group-title'] || '') + ' ' + (e.attrs['tvg-type'] || '');
  if (/\/movie\//i.test(e.url) || /\b(vod|films?|movies?|cinema|bioscoop)\b/i.test(g)) return 'film';
  if (/\/series\//i.test(e.url) || /\b(series?|shows?|seizoen|season)\b/i.test(g)) return 'series';
  return 'live';
}

let uidN = 0;
const uid = () => 'i' + (++uidN);

function liveItem(e, tab, src, srcName) {
  const url = e.url;
  return {
    uid: uid(), kind: 'live', tab, src, srcName, title: cleanName(e.name) || 'Kanaal',
    poster: e.attrs['tvg-logo'] || '', logo: true, url, statusKey: url,
    group: e.attrs['group-title'] || '',
    check: e.opts && !ENV.native ? async () => 'dead' : () => probe(url),
  };
}

// ---------- Bronnen laden ----------
const loaders = new Set();
async function track(name, fn) { loaders.add(name); updateStatus(); try { return await fn(); } finally { loaders.delete(name); updateStatus(); } }

function addRow(row) {
  state.rows = state.rows.filter(r => r.id !== row.id);
  state.rows.push(row);
  for (const it of row.items) if (row.tab === state.tab) enqueue(it);
  scheduleRender();
}

async function loadBuiltinM3U(b) {
  const text = await http(b.url);
  const entries = parseM3U(text);
  const items = entries.map(e => liveItem(e, b.tab, b.id, b.name));
  const title = { film: 'Live filmkanalen', series: 'Live seriekanalen', live: 'Gratis zenders' }[b.tab];
  addRow({ id: b.id, tab: b.tab, title: `${title} · ${b.name.split('· ')[1]}`, items, src: b.id });
}

// Internet Archive
function archiveSearchURL(q, page) {
  const p = new URLSearchParams({ q: `(${q}) AND mediatype:movies AND NOT access-restricted-item:true`, rows: '40', page: String(page), output: 'json' });
  ['identifier', 'title', 'year', 'description', 'runtime'].forEach(f => p.append('fl[]', f));
  p.append('sort[]', 'downloads desc');
  return 'https://archive.org/advancedsearch.php?' + p;
}
const archiveCache = new Map();
async function archiveFiles(id) {
  if (archiveCache.has(id)) return archiveCache.get(id);
  const meta = await http('https://archive.org/metadata/' + encodeURIComponent(id), { type: 'json', timeout: 15000 });
  const files = (meta.files || []).filter(f => /\.(mp4|m4v|webm|ogv)$/i.test(f.name));
  // per basisnaam beste formaat kiezen (h.264 mp4 > overig)
  const best = new Map();
  const score = f => (/h\.264|mpeg4/i.test(f.format || '') ? 3 : 0) + (/\.mp4$/i.test(f.name) ? 2 : 0) + (/512kb/i.test(f.name) ? 0 : 1);
  for (const f of files) {
    const base = f.name.replace(/(\.ia)?(_512kb)?\.(mp4|m4v|webm|ogv)$/i, '');
    if (!best.has(base) || score(f) > score(best.get(base))) best.set(base, f);
  }
  const list = [...best.values()].sort((a, b) => a.name.localeCompare(b.name, 'nl', { numeric: true }))
    .map(f => ({
      name: f.name,
      title: (f.title || f.name.split('/').pop().replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ')).trim(),
      url: `https://archive.org/download/${encodeURIComponent(id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
    }));
  const res = { list, meta: meta.metadata || {} };
  archiveCache.set(id, res);
  return res;
}
function archiveItem(d, tab) {
  const id = d.identifier;
  const desc = Array.isArray(d.description) ? d.description.join('\n') : (d.description || '');
  return {
    uid: uid(), kind: tab === 'film' ? 'film' : 'series', tab, src: tab === 'film' ? 'archive-films' : 'archive-tv',
    srcName: 'Internet Archive', title: Array.isArray(d.title) ? d.title[0] : d.title, year: d.year,
    desc: desc.replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n').trim(),
    poster: `https://archive.org/services/img/${encodeURIComponent(id)}`, archiveId: id, statusKey: 'ia:' + id,
    check: async () => ((await archiveFiles(id)).list.length ? 'ok' : 'dead'),
  };
}
async function loadArchive(tab, srcId) {
  const defs = ARCHIVE_ROWS[tab];
  await Promise.all(defs.map(async ([title, q], i) => {
    const row = { id: `${srcId}-${i}`, tab, title: `${title} · gratis`, items: [], src: srcId, page: 0 };
    row.more = async () => {
      row.page++;
      const j = await http(archiveSearchURL(q, row.page), { type: 'json' });
      const docs = (j.response && j.response.docs) || [];
      const seen = new Set(row.items.map(x => x.archiveId));
      const fresh = docs.filter(d => !seen.has(d.identifier)).map(d => archiveItem(d, tab));
      row.items.push(...fresh);
      row.done = docs.length < 40;
      for (const it of fresh) enqueue(it);
      scheduleRender();
    };
    try { await row.more(); addRow(row); } catch (e) { console.warn('archive', title, e); }
  }));
}

// Abonnementen
const SXE = /^(.*?)[\s._\-:|]*S(\d{1,2})[\s._-]*E(\d{1,3})\b/i;

async function loadM3USub(sub) {
  const text = await http(sub.url, { timeout: 60000 });
  const entries = parseM3U(text);
  if (!entries.length) throw new Error('Lege of ongeldige playlist');
  const groups = new Map(); // key tab|group -> items
  const shows = new Map();  // series-naam -> item
  const put = (tab, g, it) => { const k = tab + '\u0001' + g; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); };
  for (const e of entries) {
    const tab = classify(e), g = e.attrs['group-title'] || 'Overig';
    const name = cleanName(e.name);
    if (tab === 'live') { const it = liveItem(e, 'live', sub.id, sub.name); put('live', g, it); continue; }
    const m = tab === 'series' && name.match(SXE);
    if (m) {
      const show = m[1].trim() || name, key = g + '|' + show;
      let it = shows.get(key);
      if (!it) {
        it = { uid: uid(), kind: 'series', tab: 'series', src: sub.id, srcName: sub.name, sub: true, title: show,
          poster: e.attrs['tvg-logo'] || '', episodes: [], group: g };
        shows.set(key, it); put('series', g, it);
      }
      it.episodes.push({ season: +m[2], ep: +m[3], title: name, url: e.url, img: e.attrs['tvg-logo'] });
      continue;
    }
    put(tab, g, { uid: uid(), kind: tab === 'film' ? 'film' : 'series', tab, src: sub.id, srcName: sub.name, sub: true,
      title: name, poster: e.attrs['tvg-logo'] || '', url: e.url, group: g });
  }
  // Steekproef per groep: werken een paar streams, dan is de groep beschikbaar.
  for (const [k, items] of groups) {
    const [tab, g] = k.split('\u0001');
    const urlOf = it => it.url || (it.episodes && it.episodes[0] && it.episodes[0].url);
    const gkey = `grp:${sub.id}:${k}`;
    const samples = items.slice(0, 3).map(urlOf).filter(Boolean);
    const gate = { uid: uid(), statusKey: gkey, url: samples[0] || '',
      check: async () => { for (const u of samples) { const s = await probe(u); if (playableStatus(s, u)) return 'ok'; } return 'dead'; } };
    for (const it of items) { if (tab !== 'live') { it.statusKey = gkey; it.url = it.url || samples[0]; } }
    const row = { id: `${sub.id}-${k}`, tab, title: `${g}`, items, src: sub.id, sub: true };
    if (tab === 'live') row.items.forEach(it => { it.check = () => probe(it.url); });
    else row.gate = gate;
    addRow(row);
    if (tab === state.tab && row.gate) enqueue(row.gate);
  }
  return `${entries.length} streams`;
}

function xt(sub) {
  const base = sub.server.trim().replace(/\/+$/, '');
  const auth = `username=${encodeURIComponent(sub.user)}&password=${encodeURIComponent(sub.pass)}`;
  return {
    base, api: a => `${base}/player_api.php?${auth}${a ? '&action=' + a : ''}`,
    movie: (id, ext) => `${base}/movie/${encodeURIComponent(sub.user)}/${encodeURIComponent(sub.pass)}/${id}.${ext || 'mp4'}`,
    series: (id, ext) => `${base}/series/${encodeURIComponent(sub.user)}/${encodeURIComponent(sub.pass)}/${id}.${ext || 'mp4'}`,
    live: id => `${base}/live/${encodeURIComponent(sub.user)}/${encodeURIComponent(sub.pass)}/${id}.m3u8`,
  };
}

async function loadXtream(sub) {
  const x = xt(sub);
  const info = await http(x.api(), { type: 'json' });
  const u = info && info.user_info;
  if (!u || String(u.auth) !== '1') throw new Error('Inloggen mislukt');
  if (u.status && u.status !== 'Active') throw new Error('Abonnement ' + u.status);
  if (u.exp_date && +u.exp_date * 1000 < Date.now()) throw new Error('Abonnement verlopen');
  const exp = u.exp_date ? ' · tot ' + new Date(+u.exp_date * 1000).toLocaleDateString('nl-NL') : '';
  const getCats = async a => { try { return await http(x.api(a), { type: 'json' }); } catch { return []; } };
  const [vc, sc, lc, vod, ser, live] = await Promise.all([
    getCats('get_vod_categories'), getCats('get_series_categories'), getCats('get_live_categories'),
    getCats('get_vod_streams'), getCats('get_series'), getCats('get_live_streams'),
  ]);
  const catName = (cats, id) => ((cats || []).find(c => String(c.category_id) === String(id)) || {}).category_name || 'Overig';
  const bucket = (list, cats, mk, tab) => {
    const m = new Map();
    for (const s of list || []) { const g = catName(cats, s.category_id); if (!m.has(g)) m.set(g, []); m.get(g).push(mk(s)); }
    for (const [g, items] of m) addRow({ id: `${sub.id}-${tab}-${g}`, tab, title: g, items, src: sub.id, sub: true });
  };
  // Account is actief → films en series van de provider gelden als beschikbaar.
  bucket(vod, vc, s => ({ uid: uid(), kind: 'film', tab: 'film', src: sub.id, srcName: sub.name, sub: true, status: 'ok',
    title: s.name, poster: s.stream_icon || '', year: s.year || '', rating: s.rating,
    url: x.movie(s.stream_id, s.container_extension) }), 'film');
  bucket(ser, sc, s => ({ uid: uid(), kind: 'series', tab: 'series', src: sub.id, srcName: sub.name, sub: true, status: 'ok',
    title: s.name, poster: s.cover || '', year: (s.releaseDate || s.release_date || '').slice(0, 4), desc: s.plot || '',
    rating: s.rating, xtreamSeries: s.series_id, subRef: sub }), 'series');
  bucket(live, lc, s => { const url = x.live(s.stream_id); return { uid: uid(), kind: 'live', tab: 'live', src: sub.id, srcName: sub.name, sub: true,
    title: s.name, poster: s.stream_icon || '', logo: true, url, statusKey: url, check: () => probe(url) }; }, 'live');
  return `${(vod || []).length} films · ${(ser || []).length} series · ${(live || []).length} zenders${exp}`;
}

async function loadSub(sub) {
  state.subStatus[sub.id] = { ok: null, msg: 'Laden…' }; renderSettings();
  try {
    const msg = await track(sub.name, () => (sub.type === 'xtream' ? loadXtream(sub) : loadM3USub(sub)));
    state.subStatus[sub.id] = { ok: true, msg: 'Actief · ' + msg };
  } catch (e) {
    state.rows = state.rows.filter(r => r.src !== sub.id); // niets tonen als het abonnement niet werkt
    let msg = e.message;
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) msg = ENV.native ? 'Server niet bereikbaar' : 'Server niet bereikbaar of blokkeert de browser (CORS) — gebruik de app of een proxy';
    state.subStatus[sub.id] = { ok: false, msg };
  }
  renderSettings(); scheduleRender();
}

async function loadAll() {
  state.rows = []; queue.list = []; queue.seen.clear();
  const jobs = [];
  for (const b of BUILTIN) {
    if (!state.settings.builtin[b.id]) continue;
    if (b.type === 'm3u') jobs.push(track(b.name, () => loadBuiltinM3U(b)).catch(e => console.warn(b.id, e)));
    else jobs.push(track(b.name, () => loadArchive(b.tab, b.id)).catch(e => console.warn(b.id, e)));
  }
  for (const s of state.subs) if (s.enabled !== false) jobs.push(loadSub(s));
  scheduleRender();
  await Promise.all(jobs);
}

// ---------- Weergave ----------
let renderPending = false;
function scheduleRender() {
  if (renderPending) return; renderPending = true;
  setTimeout(() => { renderPending = false; render(); }, 250);
}

const COLORS = ['#ff7a1a', '#7a5cff', '#1ac8ff', '#ff4f8b', '#3ccf7a', '#ffb347'];
function placeholder(title) {
  const n = [...title].reduce((a, c) => a + c.charCodeAt(0), 0);
  const c1 = COLORS[n % COLORS.length], c2 = COLORS[(n + 2) % COLORS.length];
  const ini = title.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  return `<div class="ph" style="background:linear-gradient(135deg,${c1},${c2})">${esc(ini)}</div>`;
}

function cardHTML(it) {
  const st = itemStatus(it);
  const wide = it.kind === 'live';
  const img = it.poster ? `<img loading="lazy" src="${esc(it.poster)}" alt="">` : '';
  return `<button class="card${wide ? ' wide' : ''}${it.logo ? ' logo' : ''}" data-uid="${it.uid}">
    <div class="thumb" data-title="${esc(it.title)}">${img || placeholder(it.title)}
      ${it.kind === 'live' ? '<span class="badge live">LIVE</span>' : ''}
      ${it.sub ? '<span class="badge sub">ABO</span>' : ''}
      ${st !== 'ok' ? `<span class="badge unk">${st === 'dead' ? 'offline' : 'niet gecontroleerd'}</span>` : ''}
    </div>
    <div class="t">${esc(it.title)}</div>
    <div class="s">${esc([it.year, it.kind === 'series' && it.episodes ? it.episodes.length + ' afl.' : '', it.srcName].filter(Boolean).join(' · '))}</div>
  </button>`;
}
// fallback als een thumbnail niet laadt
document.addEventListener('error', e => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.closest('.thumb')) return;
  const th = img.closest('.thumb'); img.remove();
  th.insertAdjacentHTML('afterbegin', placeholder(th.dataset.title || '?'));
  th.closest('.card') && th.closest('.card').classList.remove('logo');
}, true);

const itemIndex = new Map();
function rowVisibleItems(row) {
  if (row.gate && !state.settings.showAll) {
    const s = itemStatus(row.gate);
    if (s !== 'ok') return [];
  }
  return row.items.filter(it => row.gate ? true : visible(it));
}
const matches = it => !state.q || it.title.toLowerCase().includes(state.q);

const rank = r => (r.sub ? 0 : r.src.startsWith('archive') ? 1 : 2);
function render() {
  itemIndex.clear();
  for (const r of state.rows) for (const it of r.items) itemIndex.set(it.uid, it);
  // tabbladen
  const hasLive = state.rows.some(r => r.tab === 'live');
  $('#tabs [data-tab=live]').hidden = !hasLive;
  if (state.tab === 'live' && !hasLive) state.tab = 'film';
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));

  const rows = state.rows.filter(r => r.tab === state.tab)
    .sort((a, b) => rank(a) - rank(b));
  const rowsEl = $('#rows');
  const scrolls = {}; rowsEl.querySelectorAll('.row').forEach(r => (scrolls[r.dataset.id] = $('.strip', r).scrollLeft));

  let html = '', total = 0, hero = null;
  for (const r of rows) {
    const items = rowVisibleItems(r).filter(matches);
    if (!items.length) continue;
    total += items.length;
    if (!hero) hero = items.find(i => i.kind !== 'live' && i.poster) || null;
    const shown = items.slice(0, 40);
    html += `<section class="row" data-id="${esc(r.id)}">
      <div class="row-head"><h2>${esc(r.title)}</h2><span class="count">${items.length}${r.more && !r.done ? '+' : ''}</span>
      <button class="more" data-row="${esc(r.id)}">Alles ›</button></div>
      <div class="strip">${shown.map(cardHTML).join('')}</div></section>`;
  }
  rowsEl.innerHTML = html;
  rowsEl.querySelectorAll('.row').forEach(r => { const s = scrolls[r.dataset.id]; if (s) $('.strip', r).scrollLeft = s; });

  const heroEl = $('#hero');
  if (hero && !state.q) {
    heroEl.hidden = false;
    heroEl.innerHTML = `<div class="bg" style="background-image:url('${esc(hero.poster)}')"></div>
      <div class="inner"><img src="${esc(hero.poster)}" alt=""><div><h1>${esc(hero.title)}</h1>
      <p>${esc(hero.desc || hero.srcName || '')}</p>
      <button class="btn primary" data-uid="${hero.uid}" data-act="open">▶ Bekijken</button></div></div>`;
  } else heroEl.hidden = true;

  const empty = $('#empty');
  empty.hidden = total > 0;
  if (!total) {
    const busy = loaders.size || queue.running || queue.list.length;
    empty.textContent = state.q ? `Niets gevonden voor “${state.q}”.` :
      busy ? 'Even geduld — streams worden gecontroleerd. Alleen wat werkt verschijnt hier.' :
      'Nog niets beschikbaar. Voeg een abonnement toe of zet bronnen aan via ⚙.';
  }
  if (!$('#gridView').hidden && gridState.row) renderGrid();
}

// lazy: start controle voor items van huidig tabblad
function enqueueTab() { for (const r of state.rows) if (r.tab === state.tab) { if (r.gate) enqueue(r.gate, true); r.items.forEach(it => enqueue(it)); } }

// horizontale strip: aan het eind meer laden (Internet Archive)
document.addEventListener('scroll', e => {
  const s = e.target;
  if (!s.classList || !s.classList.contains('strip')) return;
  if (s.scrollLeft + s.clientWidth > s.scrollWidth - 300) {
    const row = state.rows.find(r => r.id === s.closest('.row').dataset.id);
    loadMore(row);
  }
}, true);
async function loadMore(row) {
  if (!row || !row.more || row.done || row.loading) return;
  row.loading = true; try { await row.more(); } catch {} finally { row.loading = false; }
}

// ---------- Raster ----------
const gridState = { row: null, title: '' };
function openGrid(row) { gridState.row = row; $('#gridTitle').textContent = row.title; $('#gridView').hidden = false; renderGrid(); }
function renderGrid() {
  const row = gridState.row;
  const items = (row.virtual ? row.items.filter(visible) : rowVisibleItems(row)).filter(matches);
  $('#grid').innerHTML = items.slice(0, 600).map(cardHTML).join('') || '<div class="empty">Niets beschikbaar.</div>';
}
$('#gridView').addEventListener('scroll', e => {
  const g = e.currentTarget;
  if (g.scrollTop + g.clientHeight > g.scrollHeight - 600) loadMore(gridState.row);
});

// ---------- Detail ----------
async function openDetail(it) {
  const d = $('#detail');
  $('#dTitle').textContent = it.title;
  $('#dPoster').src = it.poster || 'icons/icon-512.png';
  $('#dPoster').style.objectFit = it.logo ? 'contain' : 'cover';
  $('#dBg').style.backgroundImage = it.poster ? `url("${it.poster}")` : '';
  const meta = [it.kind === 'live' ? '🔴 Live' : it.kind === 'film' ? 'Film' : 'Serie', it.year, it.rating ? '★ ' + it.rating : '', it.group, it.srcName].filter(Boolean);
  $('#dMeta').innerHTML = meta.map(m => `<span>${esc(m)}</span>`).join('');
  $('#dDesc').textContent = it.desc || '';
  $('#dEpisodes').innerHTML = '';
  const acts = $('#dActions'); acts.innerHTML = '';
  d.hidden = false;

  const addPlay = (url, label = '▶ Afspelen', title = it.title) => {
    const b = document.createElement('button'); b.className = 'btn primary'; b.textContent = label;
    b.onclick = () => play(url, title, it); acts.appendChild(b);
    extraActions(url);
  };
  const extraActions = url => {
    const c = document.createElement('button'); c.className = 'btn'; c.textContent = 'Kopieer link';
    c.onclick = () => navigator.clipboard.writeText(url).then(() => toast('Link gekopieerd — plak in VLC'), () => prompt('Stream-URL', url));
    acts.appendChild(c);
    if (/Android/i.test(navigator.userAgent) && !ENV.cap) {
      const a = document.createElement('a'); a.className = 'btn'; a.textContent = 'Open in VLC';
      a.href = `intent:${url}#Intent;package=org.videolan.vlc;type=video/*;end`; acts.appendChild(a);
    }
  };

  if (it.archiveId) {
    $('#dEpisodes').innerHTML = '<div class="loading">Bestanden ophalen…</div>';
    try {
      const { list, meta: m } = await archiveFiles(it.archiveId);
      if (!it.desc && m.description) $('#dDesc').textContent = String(m.description).replace(/<[^>]+>/g, ' ');
      if (!list.length) throw new Error('geen video');
      $('#dEpisodes').innerHTML = '';
      if (it.kind === 'film' || list.length === 1) addPlay(list[0].url);
      if (list.length > 1) episodeList(list.map((f, i) => ({ season: 1, ep: i + 1, title: f.title, url: f.url })), it, it.kind === 'film');
    } catch {
      setStatus(it.statusKey, 'dead'); scheduleRender();
      $('#dEpisodes').innerHTML = '<div class="loading">Niet (meer) beschikbaar — verborgen.</div>';
    }
  } else if (it.xtreamSeries) {
    $('#dEpisodes').innerHTML = '<div class="loading">Afleveringen ophalen…</div>';
    try {
      const x = xt(it.subRef);
      const info = await http(x.api('get_series_info') + '&series_id=' + it.xtreamSeries, { type: 'json' });
      if (info.info && info.info.plot && !it.desc) $('#dDesc').textContent = info.info.plot;
      const eps = [];
      for (const [season, list] of Object.entries(info.episodes || {}))
        for (const e of list) eps.push({ season: +season, ep: +e.episode_num, title: e.title, url: x.series(e.id, e.container_extension), img: e.info && e.info.movie_image });
      if (!eps.length) throw new Error('leeg');
      $('#dEpisodes').innerHTML = '';
      episodeList(eps, it);
    } catch { $('#dEpisodes').innerHTML = '<div class="loading">Geen afleveringen beschikbaar.</div>'; }
  } else if (it.episodes) {
    episodeList(it.episodes, it);
  } else if (it.url) {
    addPlay(it.url);
  }
}

function episodeList(eps, it, asParts = false) {
  eps.sort((a, b) => a.season - b.season || a.ep - b.ep);
  const seasons = [...new Set(eps.map(e => e.season))];
  const box = $('#dEpisodes');
  box.innerHTML = `<h3 style="margin:10px 0 6px">${asParts ? 'Delen' : 'Afleveringen'}</h3>` +
    (seasons.length > 1 ? `<select id="seasonSel">${seasons.map(s => `<option value="${s}">Seizoen ${s}</option>`).join('')}</select>` : '') +
    '<div id="epList"></div>';
  const show = s => {
    $('#epList').innerHTML = eps.filter(e => e.season === s).map(e =>
      `<button class="ep" data-url="${esc(e.url)}" data-t="${esc(e.title)}">${e.img ? `<img loading="lazy" src="${esc(e.img)}" alt="">` : ''}<span class="n">${e.ep}</span><span>${esc(e.title)}</span></button>`).join('');
  };
  show(seasons[0]);
  const sel = $('#seasonSel'); if (sel) sel.onchange = () => show(+sel.value);
  box.onclick = e => { const b = e.target.closest('.ep'); if (b) play(b.dataset.url, `${it.title} — ${b.dataset.t}`, it, eps, b.dataset.url); };
}

// ---------- Speler ----------
let hls = null, idleT = null, playCtx = null;
function play(url, title, it, eps, cur) {
  const p = $('#player'), v = $('#video'), msg = $('#pMsg');
  playCtx = { it, eps, cur: cur || url };
  $('#pTitle').textContent = title; msg.hidden = true; p.hidden = false;
  stopPlayback(false);
  const useHlsJs = isHls(url) && window.Hls && Hls.isSupported() && (!ENV.nativeHls || state.settings.proxy) && !ENV.cap;
  if (useHlsJs) {
    hls = new Hls({
      enableWorker: true, lowLatencyMode: true,
      xhrSetup: state.settings.proxy && !ENV.native ? (xhr, u) => xhr.open('GET', px(u), true) : undefined,
    });
    hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) fail(it, url, d.type === 'networkError' ? 'Stream niet bereikbaar.' : 'Kan stream niet afspelen.'); });
    hls.loadSource(url); hls.attachMedia(v);
  } else {
    v.src = state.settings.proxy && !ENV.native && ENV.https && /^http:/i.test(url) ? px(url) : url;
  }
  v.play().catch(() => {});
  v.onerror = () => fail(it, url, /\.(mkv|avi)(\?|$)/i.test(url) ? 'Dit formaat (MKV/AVI) speelt niet in de ingebouwde speler. Kopieer de link en open hem in VLC.' : 'Kan stream niet afspelen.');
  v.onended = () => { // volgende aflevering
    if (!playCtx || !playCtx.eps) return;
    const i = playCtx.eps.findIndex(e => e.url === playCtx.cur);
    const n = playCtx.eps[i + 1]; if (n) play(n.url, `${it.title} — ${n.title}`, it, playCtx.eps, n.url);
  };
  if (p.requestFullscreen && matchMedia('(pointer:coarse)').matches) p.requestFullscreen().catch(() => {});
  try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch {}
  poke();
}
function fail(it, url, text) {
  const msg = $('#pMsg'); msg.hidden = false;
  msg.innerHTML = esc(text) + '<br><br><button class="btn" id="pCopy">Kopieer link</button>';
  $('#pCopy').onclick = () => navigator.clipboard.writeText(url).then(() => toast('Link gekopieerd'));
  if (it && it.kind === 'live' && it.statusKey) { setStatus(it.statusKey, 'dead'); scheduleRender(); }
}
function stopPlayback(hide = true) {
  const v = $('#video');
  if (hls) { hls.destroy(); hls = null; }
  v.onerror = null; v.pause(); v.removeAttribute('src'); v.load();
  if (hide) {
    $('#player').hidden = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch {}
  }
}
function poke() { const p = $('#player'); p.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => p.classList.add('idle'), 3000); }
['mousemove', 'touchstart', 'keydown'].forEach(ev => $('#player').addEventListener(ev, poke));
$('#pClose').onclick = () => stopPlayback();

// ---------- Instellingen ----------
function renderSettings() {
  $('#setShowAll').checked = !!state.settings.showAll;
  $('#setProxy').value = state.settings.proxy || '';
  $('#webOnly').hidden = ENV.native;
  $('#builtinList').innerHTML = BUILTIN.map(b => `<label class="toggle"><input type="checkbox" data-b="${b.id}" ${state.settings.builtin[b.id] ? 'checked' : ''}>
    <span>${esc(b.name)}<small>${esc(b.desc)}</small></span></label>`).join('');
  $('#subList').innerHTML = state.subs.length ? state.subs.map(s => {
    const st = state.subStatus[s.id] || { msg: s.enabled === false ? 'Uitgeschakeld' : '' };
    return `<div class="sub"><div class="grow"><div class="nm">${esc(s.name)} <small style="color:var(--mut)">${s.type === 'xtream' ? 'Xtream' : 'M3U'}</small></div>
      <div class="st ${st.ok === true ? 'ok' : st.ok === false ? 'bad' : ''}">${esc(st.msg || '')}</div></div>
      <button data-s="${s.id}" data-a="toggle">${s.enabled === false ? 'Aan' : 'Uit'}</button>
      <button data-s="${s.id}" data-a="reload">↻</button>
      <button data-s="${s.id}" data-a="del">🗑</button></div>`;
  }).join('') : '<p class="hint">Nog geen abonnementen. Voeg er hieronder een toe — wat werkt verschijnt automatisch bij Films, Series en Live TV.</p>';
  $('#envInfo').textContent = `Modus: ${ENV.cap ? 'Android-app' : ENV.electron ? 'Windows-app' : 'Browser/PWA'} · native HLS: ${ENV.nativeHls ? 'ja' : 'nee'}`;
}

$('#settings').addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'setShowAll') { state.settings.showAll = t.checked; saveSettings(); render(); }
  if (t.dataset.b) { state.settings.builtin[t.dataset.b] = t.checked; saveSettings(); reloadSoon(); }
  if (t.id === 'setProxy') { state.settings.proxy = t.value.trim(); saveSettings(); reloadSoon(); }
  if (t.name === 'stype') document.querySelectorAll('#subForm [data-for]').forEach(d => (d.hidden = d.dataset.for !== t.value));
});
$('#subList').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const s = state.subs.find(x => x.id === b.dataset.s); if (!s) return;
  if (b.dataset.a === 'del') { if (!confirm(`Abonnement “${s.name}” verwijderen?`)) return; state.subs = state.subs.filter(x => x !== s); state.rows = state.rows.filter(r => r.src !== s.id); }
  if (b.dataset.a === 'toggle') { s.enabled = s.enabled === false; if (s.enabled) loadSub(s); else { state.rows = state.rows.filter(r => r.src !== s.id); delete state.subStatus[s.id]; } }
  if (b.dataset.a === 'reload') loadSub(s);
  saveSubs(); renderSettings(); scheduleRender();
});
$('#subForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.target), type = f.get('stype');
  const sub = { id: 's' + Date.now().toString(36), type, name: f.get('name').trim(), enabled: true };
  if (type === 'xtream') {
    sub.server = f.get('server').trim(); sub.user = f.get('user').trim(); sub.pass = f.get('pass');
    if (!/^https?:\/\//i.test(sub.server)) sub.server = 'http://' + sub.server;
    if (!sub.user || !sub.pass) return toast('Vul gebruikersnaam en wachtwoord in');
  } else {
    sub.url = f.get('url').trim();
    // Xtream-link geplakt als M3U? Haal de gegevens eruit voor een rijkere weergave.
    const m = sub.url.match(/^(https?:\/\/[^/]+)\/get\.php\?(.*)$/i);
    if (m) { const q = new URLSearchParams(m[2]); if (q.get('username') && q.get('password')) Object.assign(sub, { type: 'xtream', server: m[1], user: q.get('username'), pass: q.get('password') }); }
    if (!sub.url && sub.type === 'm3u') return toast('Vul een M3U-link in');
  }
  state.subs.push(sub); saveSubs(); e.target.reset();
  document.querySelectorAll('#subForm [data-for]').forEach(d => (d.hidden = d.dataset.for !== 'xtream'));
  loadSub(sub); toast('Abonnement toegevoegd — wordt gecontroleerd');
});
$('#btnRecheck').onclick = () => { state.avail = {}; LS.set('avail', {}); archiveCache.clear(); loadAll(); toast('Alles wordt opnieuw gecontroleerd'); };
let reloadT; function reloadSoon() { clearTimeout(reloadT); reloadT = setTimeout(loadAll, 600); }

// ---------- Interactie ----------
$('#btnSettings').onclick = () => { renderSettings(); $('#settings').hidden = false; };
document.addEventListener('click', e => {
  const close = e.target.closest('[data-close]');
  if (close) { close.closest('.modal,.overlay').hidden = true; return; }
  if (e.target.classList.contains('modal')) { e.target.hidden = true; return; }
  const more = e.target.closest('.more');
  if (more) { openGrid(state.rows.find(r => r.id === more.dataset.row)); return; }
  const c = e.target.closest('[data-uid]');
  if (c) { const it = itemIndex.get(c.dataset.uid); if (it) it.kind === 'live' && it.url ? play(it.url, it.title, it) : openDetail(it); }
});
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  state.tab = b.dataset.tab; window.scrollTo(0, 0); enqueueTab(); render();
});
let qT; $('#q').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); render(); }, 200); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' && e.key !== 'GoBack' && e.key !== 'BrowserBack') return;
  if (!$('#player').hidden) return stopPlayback();
  for (const id of ['detail', 'settings', 'gridView']) if (!$('#' + id).hidden) { $('#' + id).hidden = true; return; }
});
// Android terugknop (Capacitor)
document.addEventListener('backbutton', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
if (ENV.cap && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
  window.Capacitor.Plugins.App.addListener('backButton', () => {
    const open = !$('#player').hidden || ['detail', 'settings', 'gridView'].some(id => !$('#' + id).hidden);
    if (open) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); else window.Capacitor.Plugins.App.exitApp();
  });
}

// ---------- Start ----------
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !ENV.native) navigator.serviceWorker.register('sw.js').catch(() => {});
window.KD = { state, parseM3U, classify, ENV }; // voor debuggen/tests
loadAll();
