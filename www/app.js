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
  settings: LS.get('settings', { scan: false, proxy: '', builtin: {}, langs: [] }),
  subs: LS.get('subs', []),
  rows: [],                            // {id, tab, title, items:[], more?:fn, src}
  subStatus: {},                       // sub.id -> {ok, msg}
};
if (!Array.isArray(state.settings.langs)) state.settings.langs = [];
if (!('scan' in state.settings)) state.settings.scan = false;
if (state.settings.langs.length) setTimeout(() => applyIptvLangs(), 0);
state.settings.ext = Object.assign({ always: false, app: 'chooser', pkg: '', winPath: '', winArgs: '' }, state.settings.ext || {});
for (const b of BUILTIN) if (!(b.id in state.settings.builtin)) state.settings.builtin[b.id] = b.on;

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const saveSettings = () => LS.set('settings', state.settings);
const saveSubs = () => LS.set('subs', state.subs);
try { localStorage.removeItem('kd.avail'); } catch {} // oude cache opruimen

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms);
}

// ---------- Talen ----------
// code: [Nederlandse naam, ...aliassen (ISO 639-2, Engelse/eigen naam)]
const LANGS = {
  nl: ['Nederlands', 'dut', 'nld', 'dutch', 'nederlands', 'vlaams', 'flemish'],
  en: ['Engels', 'eng', 'english'],
  de: ['Duits', 'ger', 'deu', 'german', 'deutsch'],
  fr: ['Frans', 'fre', 'fra', 'french', 'français', 'francais'],
  es: ['Spaans', 'spa', 'spanish', 'español', 'espanol', 'castellano', 'latino'],
  it: ['Italiaans', 'ita', 'italian', 'italiano'],
  pt: ['Portugees', 'por', 'portuguese', 'português', 'portugues'],
  tr: ['Turks', 'tur', 'turkish', 'türkçe', 'turkce'],
  ar: ['Arabisch', 'ara', 'arabic', 'عربي'],
  ru: ['Russisch', 'rus', 'russian', 'русский'],
  pl: ['Pools', 'pol', 'polish', 'polski'],
  uk: ['Oekraïens', 'ukr', 'ukrainian'],
  ro: ['Roemeens', 'rum', 'ron', 'romanian', 'română'],
  hu: ['Hongaars', 'hun', 'hungarian', 'magyar'],
  cs: ['Tsjechisch', 'cze', 'ces', 'czech'],
  el: ['Grieks', 'gre', 'ell', 'greek'],
  sv: ['Zweeds', 'swe', 'swedish', 'svenska'],
  da: ['Deens', 'dan', 'danish', 'dansk'],
  no: ['Noors', 'nor', 'nob', 'norwegian', 'norsk'],
  fi: ['Fins', 'fin', 'finnish', 'suomi'],
  sr: ['Servisch', 'srp', 'serbian'],
  hr: ['Kroatisch', 'hrv', 'croatian'],
  bg: ['Bulgaars', 'bul', 'bulgarian'],
  sq: ['Albanees', 'alb', 'sqi', 'albanian'],
  fa: ['Perzisch', 'per', 'fas', 'persian', 'farsi'],
  he: ['Hebreeuws', 'heb', 'hebrew'],
  hi: ['Hindi', 'hin', 'hindi'],
  ur: ['Urdu', 'urd', 'urdu'],
  bn: ['Bengaals', 'ben', 'bengali', 'bangla'],
  ta: ['Tamil', 'tam', 'tamil'],
  zh: ['Chinees', 'chi', 'zho', 'chinese', 'mandarin', 'cantonese'],
  ja: ['Japans', 'jpn', 'japanese'],
  ko: ['Koreaans', 'kor', 'korean'],
  th: ['Thai', 'tha', 'thai'],
  vi: ['Vietnamees', 'vie', 'vietnamese'],
  id: ['Indonesisch', 'ind', 'indonesian', 'bahasa'],
  ms: ['Maleis', 'may', 'msa', 'malay'],
  tl: ['Filipijns', 'tgl', 'fil', 'tagalog', 'filipino'],
  zz: ['Geen (stom)', 'zxx', 'silent', 'no linguistic content'],
};
const LANG_ALIAS = new Map();
for (const [code, [name, ...al]] of Object.entries(LANGS)) [code, name.toLowerCase(), ...al].forEach(a => LANG_ALIAS.set(a, code));
// landcode -> taal (voor "NL | Films", "UK: Sky", tvg-id "NPO1.nl")
const COUNTRY_LANG = { nl: 'nl', be: 'nl', uk: 'en', gb: 'en', us: 'en', usa: 'en', ca: 'en', au: 'en', ie: 'en', nz: 'en', en: 'en',
  de: 'de', at: 'de', fr: 'fr', es: 'es', mx: 'es', ar: 'es', co: 'es', cl: 'es', it: 'it', pt: 'pt', br: 'pt', tr: 'tr',
  ru: 'ru', pl: 'pl', ua: 'uk', ro: 'ro', hu: 'hu', cz: 'cs', gr: 'el', se: 'sv', dk: 'da', no: 'no', fi: 'fi', rs: 'sr',
  hr: 'hr', bg: 'bg', al: 'sq', ir: 'fa', il: 'he', in: 'hi', pk: 'ur', cn: 'zh', hk: 'zh', tw: 'zh', jp: 'ja', kr: 'ko',
  th: 'th', vn: 'vi', id: 'id', my: 'ms', ph: 'tl', sa: 'ar', ae: 'ar', eg: 'ar', ma: 'ar', dz: 'ar', iq: 'ar', qa: 'ar' };
const langName = c => (c === 'und' ? 'Onbekend' : (LANGS[c] || [c])[0]);
const normLang = v => { const k = String(v || '').trim().toLowerCase(); return LANG_ALIAS.get(k) || LANG_ALIAS.get(k.slice(0, 3)) || null; };
const uniq = a => [...new Set(a.filter(Boolean))];
/** Taal afleiden uit een label als "NL | Films", "[DE] Kino", "|UK| Sky", "Dutch Movies" */
function labelLangs(...labels) {
  for (const l of labels) {
    if (!l) continue;
    const m = String(l).match(/^\s*[\[|(]?\s*([A-Za-z]{2,3})\s*[\]|):\-–•]/) || String(l).match(/[|\[]\s*([A-Z]{2,3})\s*[|\]]/);
    if (m) { const c = COUNTRY_LANG[m[1].toLowerCase()] || normLang(m[1]); if (c && m[1].length >= 2) return [c]; }
    const words = String(l).toLowerCase().split(/[^\p{L}]+/u);
    const hit = uniq(words.filter(w => w.length > 3).map(w => LANG_ALIAS.get(w)));
    if (hit.length) return hit;
  }
  return [];
}
function entryLangs(e) {
  const tl = e.attrs['tvg-language'];
  if (tl) { const l = uniq(tl.split(/[;,]/).map(normLang)); if (l.length) return l; }
  const fromLabel = labelLangs(e.attrs['group-title'], e.name);
  if (fromLabel.length) return fromLabel;
  const cc = (e.attrs['tvg-id'] || '').match(/\.([a-z]{2})(@|$)/i);
  if (cc && COUNTRY_LANG[cc[1].toLowerCase()]) return [COUNTRY_LANG[cc[1].toLowerCase()]];
  return ['und'];
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
// Realtime: alleen kaarten die in beeld zijn worden gecontroleerd, en niets wordt op het apparaat bewaard.
const avail = new Map();            // statusKey -> {s, t}; alleen tijdens deze sessie
const FRESH = 10 * 60e3;            // na 10 minuten opnieuw controleren
function setStatus(key, s) { avail.set(key, { s, t: Date.now() }); }
/** status van een item: 'ok' | 'dead' | null (nog onbekend) */
function itemStatus(it) {
  if (it.status) return it.status;
  const a = it.statusKey && avail.get(it.statusKey);
  if (a && Date.now() - a.t < FRESH) return playableStatus(a.s, it.url || '') ? 'ok' : 'dead';
  return null;
}
const scanOn = () => !!state.settings.scan;
const visible = it => !scanOn() || itemStatus(it) !== 'dead';

// Wachtrij: nieuwste (zojuist in beeld) eerst, max 4 tegelijk
const queue = { list: [], running: 0, max: 4, queued: new Set() };
function enqueue(it) {
  if (!scanOn() || !it.check || itemStatus(it) || queue.queued.has(it.uid)) return;
  queue.queued.add(it.uid); queue.list.unshift(it); pump();
}
function dequeue(it) {
  if (!queue.queued.has(it.uid) || it._running) return;
  queue.queued.delete(it.uid); queue.list = queue.list.filter(x => x !== it); updateStatus();
}
function clearQueue() { for (const it of queue.list) queue.queued.delete(it.uid); queue.list = []; updateStatus(); }
function pump() {
  while (queue.running < queue.max && queue.list.length) {
    const it = queue.list.shift(); queue.running++; it._running = true;
    it.check().catch(() => 'dead').then(s => { if (it.statusKey) setStatus(it.statusKey, s); else it.status = s; })
      .finally(() => { it._running = false; queue.running--; queue.queued.delete(it.uid); onStatus(it); pump(); });
  }
  updateStatus();
}
function updateStatus() {
  const n = queue.running + queue.list.length, parts = [];
  if (loaders.size) parts.push('Index laden…');
  if (n) parts.push(`${n} in beeld controleren`);
  $('#status').innerHTML = parts.length ? '<span class="dot"></span>' + parts.join(' · ') : '';
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
    group: e.attrs['group-title'] || '', langs: entryLangs(e),
    check: e.opts && !ENV.native ? async () => 'dead' : () => probe(url),
  };
}

// ---------- Bronnen laden ----------
const loaders = new Set();
async function track(name, fn) { loaders.add(name); updateStatus(); try { return await fn(); } finally { loaders.delete(name); updateStatus(); } }

function addRow(row) {
  state.rows = state.rows.filter(r => r.id !== row.id);
  row.ver = (row.ver || 0) + 1;
  state.rows.push(row);
  scheduleRender();
}

let iptvLangMap = null, iptvLangsApplied = false;
/** Taal-index van iptv-org pas ophalen wanneer je op taal gaat filteren */
function applyIptvLangs() {
  if (iptvLangsApplied) return; iptvLangsApplied = true;
  track('Taal-index', () => iptvLangs()).then(m => {
    for (const r of state.rows) if (r.src.startsWith('iptv-')) for (const it of r.items) { const l = m.get(it.url); if (l) it.langs = uniq(l); }
    viewKey = ''; render();
  });
}
function iptvLangs() {
  if (!iptvLangMap) iptvLangMap = http('https://iptv-org.github.io/iptv/index.language.m3u', { timeout: 45000 }).then(t => {
    const m = new Map();
    for (const e of parseM3U(t)) { const c = normLang(e.attrs['group-title']); if (!c) continue; if (!m.has(e.url)) m.set(e.url, []); m.get(e.url).push(c); }
    return m;
  }).catch(() => new Map());
  return iptvLangMap;
}
async function loadBuiltinM3U(b) {
  const entries = parseM3U(await http(b.url));
  const items = entries.map(e => liveItem(e, b.tab, b.id, b.name));
  if (iptvLangsApplied) iptvLangs().then(m => items.forEach(it => { const l = m.get(it.url); if (l) it.langs = uniq(l); }));
  const title = { film: 'Live filmkanalen', series: 'Live seriekanalen', live: 'Gratis zenders' }[b.tab];
  addRow({ id: b.id, tab: b.tab, title: `${title} · ${b.name.split('· ')[1]}`, items, src: b.id });
}

// Internet Archive
function archiveLangQuery() {
  const sel = (state.settings.langs || []).filter(c => LANGS[c]);
  if (!sel.length) return '';
  const terms = uniq(sel.flatMap(c => [c, ...LANGS[c]].map(t => /\s/.test(t) ? `"${t}"` : t)));
  return ` AND language:(${terms.join(' OR ')})`;
}
function archiveSearchURL(q, page) {
  const p = new URLSearchParams({ q: `(${q}) AND mediatype:movies AND NOT access-restricted-item:true${archiveLangQuery()}`, rows: '40', page: String(page), output: 'json' });
  ['identifier', 'title', 'year', 'description', 'runtime', 'language'].forEach(f => p.append('fl[]', f));
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
    langs: (l => (l.length ? l : ['und']))(uniq([].concat(d.language || []).flatMap(x => String(x).split(/[;,/]| and /)).map(normLang))),
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
      row.ver = (row.ver || 0) + 1;
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
        it = { uid: uid(), kind: 'series', tab: 'series', src: sub.id, srcName: sub.name, sub: true, title: show, langs: entryLangs(e),
          poster: e.attrs['tvg-logo'] || '', episodes: [], group: g };
        shows.set(key, it); put('series', g, it);
      }
      it.episodes.push({ season: +m[2], ep: +m[3], title: name, url: e.url, img: e.attrs['tvg-logo'] });
      continue;
    }
    put(tab, g, { uid: uid(), kind: tab === 'film' ? 'film' : 'series', tab, src: sub.id, srcName: sub.name, sub: true,
      title: name, poster: e.attrs['tvg-logo'] || '', url: e.url, group: g, langs: entryLangs(e) });
  }
  for (const [k, items] of groups) {
    const [tab, g] = k.split('\u0001');
    for (const it of items) {
      if (!it.url && it.episodes) it.url = it.episodes[0].url;
      if (!it.check) { it.statusKey = it.url; it.check = () => probe(it.url); }
    }
    addRow({ id: `${sub.id}-${k}`, tab, title: g, items, src: sub.id, sub: true });
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
    for (const s of list || []) {
      const g = catName(cats, s.category_id); if (!m.has(g)) m.set(g, []);
      const it = mk(s); const l = labelLangs(g, s.name); it.langs = l.length ? l : ['und']; m.get(g).push(it);
    }
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
  state.rows = []; clearQueue(); viewKey = '';
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
  setTimeout(() => { renderPending = false; render(); }, 300);
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
  const checking = scanOn() && !st && it.check;
  const img = it.poster ? `<img loading="lazy" decoding="async" src="${esc(it.poster)}" alt="">` : '';
  return `<button class="card${it.kind === 'live' ? ' wide' : ''}${it.logo ? ' logo' : ''}${checking ? ' checking' : ''}" data-uid="${it.uid}">
    <div class="thumb" data-title="${esc(it.title)}">${img || placeholder(it.title)}
      ${it.kind === 'live' ? '<span class="badge live">LIVE</span>' : ''}
      ${it.sub ? '<span class="badge sub">ABO</span>' : ''}
      ${checking ? '<span class="badge unk chk">controleren…</span>' : st === 'dead' ? '<span class="badge unk">offline</span>' : ''}
    </div>
    <div class="t">${esc(it.title)}</div>
    <div class="s">${esc([it.year, it.kind === 'series' && it.episodes ? it.episodes.length + ' afl.' : '', it.srcName].filter(Boolean).join(' · '))}</div>
  </button>`;
}
// fallback als een thumbnail niet laadt
document.addEventListener('error', e => {
  const img = e.target;
  if (img.tagName !== 'IMG') return;
  if (img.id === 'dPoster') { if (!/icon-512/.test(img.src)) { img.src = 'icons/icon-512.png'; img.style.objectFit = 'contain'; } return; }
  if (img.closest('.hero')) {
    const ph = document.createElement('div'); ph.className = 'hero-ph'; ph.innerHTML = placeholder(img.closest('.hero').querySelector('h1').textContent);
    img.replaceWith(ph); const bg = $('.hero .bg'); if (bg) bg.style.backgroundImage = 'none'; return;
  }
  if (!img.closest('.thumb')) return;
  const th = img.closest('.thumb'); img.remove();
  th.insertAdjacentHTML('afterbegin', placeholder(th.dataset.title || '?'));
  th.closest('.card') && th.closest('.card').classList.remove('logo');
}, true);

const itemIndex = new Map();
const langOk = it => { const sel = state.settings.langs || []; return !sel.length || (it.langs || ['und']).some(l => sel.includes(l)); };
const matches = it => langOk(it) && (!state.q || it.title.toLowerCase().includes(state.q));
const rowItems = r => r.items.filter(it => visible(it) && matches(it));
const rank = r => (r.sub ? 0 : r.src.startsWith('archive') ? 1 : 2);

// Alleen wat in beeld komt wordt getekend en (als controle aan staat) gecontroleerd.
const cardIO = new IntersectionObserver(entries => {
  for (const e of entries) {
    const it = itemIndex.get(e.target.dataset.uid); if (!it) continue;
    e.isIntersecting ? enqueue(it) : dequeue(it);
  }
}, { rootMargin: '40px' });
const rowIO = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting && e.target._rec && !e.target._rec.shown) showMore(e.target._rec);
}, { rootMargin: '300px 0px' });
function observeCards(box) { box.querySelectorAll('.card:not([data-o])').forEach(c => { c.dataset.o = 1; cardIO.observe(c); }); }

const CHUNK = 20;
const rowRecs = new Map();
let viewKey = '', heroUid = null;
function makeRowRec(r) {
  const el = document.createElement('section'); el.className = 'row'; el.dataset.id = r.id;
  el.innerHTML = `<div class="row-head"><h2>${esc(r.title)}</h2><span class="count"></span><button class="more" data-row="${esc(r.id)}">Alles ›</button></div><div class="strip"></div>`;
  const rec = { r, el, strip: $('.strip', el), list: [], shown: 0, ver: -1 };
  el._rec = rec; rowIO.observe(el);
  return rec;
}
function showMore(rec, n = CHUNK) {
  const slice = rec.list.slice(rec.shown, rec.shown + n); if (!slice.length) return false;
  rec.strip.insertAdjacentHTML('beforeend', slice.map(cardHTML).join(''));
  rec.shown += slice.length; observeCards(rec.strip);
  return true;
}
const countText = rec => `${rec.list.length}${rec.r.more && !rec.r.done ? '+' : ''}`;

/** Status van één item veranderd: alleen die kaart(en) bijwerken, niets opnieuw tekenen. */
function onStatus(it) {
  const st = itemStatus(it);
  document.querySelectorAll(`.card[data-uid="${it.uid}"]`).forEach(c => {
    if (st === 'dead' && scanOn()) {
      const rowEl = c.closest('.row'), rec = rowEl && rowEl._rec;
      c.remove();
      if (rec) {
        const i = rec.list.indexOf(it); if (i >= 0) { rec.list.splice(i, 1); rec.shown--; }
        $('.count', rec.el).textContent = countText(rec);
        if (rec.shown < CHUNK) showMore(rec, 1);
        if (!rec.list.length) rec.el.hidden = true;
      }
    } else {
      c.classList.remove('checking');
      const b = c.querySelector('.chk'); if (b) b.remove();
    }
  });
}

function render() {
  itemIndex.clear();
  for (const r of state.rows) for (const it of r.items) itemIndex.set(it.uid, it);
  const hasLive = state.rows.some(r => r.tab === 'live');
  $('#tabs [data-tab=live]').hidden = !hasLive;
  if (state.tab === 'live' && !hasLive) state.tab = 'film';
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));

  const rowsEl = $('#rows');
  const key = [state.tab, state.q, (state.settings.langs || []).join(), scanOn()].join('|');
  if (key !== viewKey) { // andere weergave: alles opnieuw opbouwen
    viewKey = key; heroUid = null; rowsEl.innerHTML = ''; rowRecs.clear();
    cardIO.disconnect(); rowIO.disconnect(); clearQueue();
  }
  const rows = state.rows.filter(r => r.tab === state.tab).sort((a, b) => rank(a) - rank(b));
  let prev = null, total = 0; const alive = new Set();
  for (const r of rows) {
    let rec = rowRecs.get(r.id);
    if (rec && rec.r !== r) { rec.el.remove(); rec = null; }
    if (!rec) { rec = makeRowRec(r); rowRecs.set(r.id, rec); }
    if (rec.ver !== r.ver) { // nieuwe items in deze rij: alleen aanvullen
      rec.ver = r.ver; rec.list = rowItems(r);
      if (rec.shown && rec.shown < CHUNK) showMore(rec, CHUNK - rec.shown);
    }
    if (!rec.list.length) continue;
    $('.count', rec.el).textContent = countText(rec);
    rec.el.hidden = false; alive.add(r.id); total += rec.list.length;
    const want = prev ? prev.nextSibling : rowsEl.firstChild;
    if (want !== rec.el) rowsEl.insertBefore(rec.el, want);
    prev = rec.el;
  }
  for (const [id, rec] of rowRecs) if (!alive.has(id)) { rec.el.remove(); rowRecs.delete(id); }

  // uitgelicht (blijft staan zolang het item bestaat)
  const heroEl = $('#hero');
  if (state.q) heroEl.hidden = true;
  else if (!heroUid || !itemIndex.has(heroUid)) {
    let hero = null;
    for (const rec of rowRecs.values()) { hero = rec.list.find(i => i.kind !== 'live' && i.poster && itemStatus(i) !== 'dead'); if (hero) break; }
    heroUid = hero ? hero.uid : null; heroEl.hidden = !hero;
    if (hero) heroEl.innerHTML = `<div class="bg" style="background-image:url('${esc(hero.poster)}')"></div>
      <div class="inner"><img src="${esc(hero.poster)}" alt=""><div><h1>${esc(hero.title)}</h1>
      <p>${esc(hero.desc || hero.srcName || '')}</p>
      <button class="btn primary" data-uid="${hero.uid}">▶ Bekijken</button></div></div>`;
  }

  const empty = $('#empty');
  empty.hidden = total > 0;
  if (!total) empty.innerHTML = state.q ? esc(`Niets gevonden voor “${state.q}”.`) :
    loaders.size ? '<img class="crest-sm" src="img/wapen.png" alt=""><br>Index laden…' :
    'Nog niets beschikbaar. Voeg een abonnement toe of zet bronnen aan via ⚙.';
  renderLangs();
  hideSplash(total > 0 || !loaders.size);
}

// ---------- Taalfilter ----------
function renderLangs() {
  const sel = state.settings.langs;
  $('#btnLang').classList.toggle('on', sel.length > 0);
  $('#langLabel').textContent = !sel.length ? 'Alle talen' : sel.length <= 2 ? sel.map(langName).join(', ') : `${sel.length} talen`;
  if ($('#langPop').hidden) return;
  const counts = new Map();
  for (const r of state.rows) {
    if (r.tab !== state.tab) continue;
    for (const it of r.items) if (visible(it)) for (const l of uniq(it.langs || ['und'])) counts.set(l, (counts.get(l) || 0) + 1);
  }
  for (const l of sel) if (!counts.has(l)) counts.set(l, 0);
  const pinned = ['nl', 'en'];
  const list = [...counts.entries()].sort((a, b) =>
    (pinned.includes(b[0]) - pinned.includes(a[0])) || (a[0] === 'und') - (b[0] === 'und') || b[1] - a[1]);
  $('#langList').innerHTML = list.map(([c, n]) => `<label class="lang"><input type="checkbox" value="${c}" ${sel.includes(c) ? 'checked' : ''}>
    <span>${esc(langName(c))}</span><span class="c">${n}</span></label>`).join('') || '<p class="hint">Nog geen talen gevonden.</p>';
}
let langT;
function setLangs(langs) {
  state.settings.langs = langs; saveSettings(); if (langs.length) applyIptvLangs(); render();
  clearTimeout(langT); // Internet Archive opnieuw doorzoeken in de gekozen taal
  langT = setTimeout(() => {
    state.rows = state.rows.filter(r => !r.src.startsWith('archive'));
    for (const b of BUILTIN) if (b.type === 'archive' && state.settings.builtin[b.id]) track(b.name, () => loadArchive(b.tab, b.id));
    scheduleRender();
  }, 700);
}
$('#btnLang').onclick = e => { e.stopPropagation(); const p = $('#langPop'); p.hidden = !p.hidden; if (!p.hidden) applyIptvLangs(); renderLangs(); };
$('#langPop').addEventListener('click', e => e.stopPropagation());
$('#langList').addEventListener('change', () => setLangs([...document.querySelectorAll('#langList input:checked')].map(i => i.value)));
$('#langClear').onclick = () => setLangs([]);
document.addEventListener('click', () => { $('#langPop').hidden = true; });

// horizontale strip: aan het eind de volgende kaarten tekenen / meer ophalen
document.addEventListener('scroll', e => {
  const s = e.target;
  if (!s.classList || !s.classList.contains('strip')) return;
  if (s.scrollLeft + s.clientWidth > s.scrollWidth - 400) {
    const rec = s.closest('.row')._rec;
    if (!showMore(rec)) loadMore(rec.r);
  }
}, true);
async function loadMore(row) {
  if (!row || !row.more || row.done || row.loading) return;
  row.loading = true; try { await row.more(); } catch {} finally { row.loading = false; }
}

// ---------- Raster ----------
const gridState = { row: null, list: [], shown: 0 };
function openGrid(row) { gridState.row = row; $('#gridTitle').textContent = row.title; $('#gridView').hidden = false; $('#gridView').scrollTop = 0; renderGrid(); }
function renderGrid() {
  gridState.list = rowItems(gridState.row); gridState.shown = 0; $('#grid').innerHTML = '';
  if (!gridMore()) $('#grid').innerHTML = '<div class="empty">Niets beschikbaar.</div>';
}
function gridMore() {
  const s = gridState.list.slice(gridState.shown, gridState.shown + 60); if (!s.length) return false;
  $('#grid').insertAdjacentHTML('beforeend', s.map(cardHTML).join('')); gridState.shown += s.length; observeCards($('#grid'));
  return true;
}
$('#gridView').addEventListener('scroll', async e => {
  const g = e.currentTarget;
  if (g.scrollTop + g.clientHeight < g.scrollHeight - 600 || gridState.busy) return;
  if (gridMore()) return;
  gridState.busy = true;
  await loadMore(gridState.row);
  gridState.list = rowItems(gridState.row); gridMore(); gridState.busy = false;
});

// ---------- Detail ----------
async function openDetail(it) {
  const d = $('#detail');
  $('#dTitle').textContent = it.title;
  $('#dPoster').src = it.poster || 'icons/icon-512.png';
  $('#dPoster').style.objectFit = it.logo ? 'contain' : 'cover';
  $('#dBg').style.backgroundImage = it.poster ? `url("${it.poster}")` : '';
  const meta = [it.kind === 'live' ? '🔴 Live' : it.kind === 'film' ? 'Film' : 'Serie', it.year, it.rating ? '★ ' + it.rating : '', (it.langs || []).filter(l => l !== 'und').map(langName).join(' / '), it.group, it.srcName].filter(Boolean);
  $('#dMeta').innerHTML = meta.map(m => `<span>${esc(m)}</span>`).join('');
  $('#dDesc').textContent = it.desc || '';
  $('#dEpisodes').innerHTML = '';
  const acts = $('#dActions'); acts.innerHTML = '';
  d.hidden = false;

  const btn = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = label; b.onclick = fn; acts.appendChild(b); };
  const addPlay = (url, title = it.title) => {
    const ext = state.settings.ext.always;
    btn(ext ? '▶ Afspelen in ' + extName() : '▶ Afspelen', 'primary', () => playAuto(url, title, it));
    btn(ext ? 'Ingebouwde speler' : '↗ ' + extName(), '', () => (ext ? play(url, title, it) : openExternal(url, title)));
    btn('Kopieer link', '', () => navigator.clipboard.writeText(url).then(() => toast('Link gekopieerd'), () => prompt('Stream-URL', url)));
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
      setStatus(it.statusKey, 'dead'); onStatus(it);
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
  box.onclick = e => { const b = e.target.closest('.ep'); if (b) playAuto(b.dataset.url, `${it.title} — ${b.dataset.t}`, it, eps, b.dataset.url); };
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
  msg.innerHTML = esc(text) + `<br><br><button class="btn primary" id="pExt">↗ Open in ${esc(extName())}</button> <button class="btn" id="pCopy">Kopieer link</button>`;
  $('#pCopy').onclick = () => navigator.clipboard.writeText(url).then(() => toast('Link gekopieerd'));
  $('#pExt').onclick = () => { const t = $('#pTitle').textContent; stopPlayback(); openExternal(url, t); };
  if (it && it.kind === 'live' && it.statusKey) { setStatus(it.statusKey, 'dead'); onStatus(it); }
}
// ---------- Externe speler ----------
const ANDROID_PLAYERS = [
  ['chooser', 'Vraag elke keer (kiezer)', ''], ['vlc', 'VLC', 'org.videolan.vlc'], ['mx', 'MX Player', 'com.mxtech.videoplayer.ad'],
  ['mxpro', 'MX Player Pro', 'com.mxtech.videoplayer.pro'], ['just', 'Just Player', 'com.brouken.player'], ['mpv', 'mpv', 'is.xyz.mpv'],
  ['kodi', 'Kodi', 'org.xbmc.kodi'], ['tivimate', 'TiviMate', 'ar.tvplayer.tv'], ['custom', 'Andere app (pakketnaam)…', ''],
];
const isAndroid = /Android/i.test(navigator.userAgent);
const extMode = () => (ENV.cap || isAndroid ? 'android' : ENV.electron ? 'windows' : 'web');
function androidPkg() {
  const e = state.settings.ext;
  if (e.app === 'custom') return e.pkg.trim();
  return (ANDROID_PLAYERS.find(p => p[0] === e.app) || ANDROID_PLAYERS[0])[2];
}
function extName() {
  const e = state.settings.ext, m = extMode();
  if (m === 'android') return e.app === 'custom' ? (e.pkg || 'externe app') : e.app === 'chooser' ? 'externe app' : (ANDROID_PLAYERS.find(p => p[0] === e.app) || [, 'externe app'])[1];
  if (m === 'windows') return e.winPath ? e.winPath.split(/[\\/]/).pop().replace(/\.exe$/i, '').replace(/^vlc$/i, 'VLC') : 'externe speler';
  return 'externe speler';
}
const extPlugin = () => window.Capacitor && ((window.Capacitor.Plugins || {}).ExternalPlayer ||
  (window.Capacitor.registerPlugin && window.Capacitor.registerPlugin('ExternalPlayer')));

function playAuto(url, title, it, eps, cur) {
  if (state.settings.ext.always) openExternal(url, title); else play(url, title, it, eps, cur);
}

async function openExternal(url, title = '') {
  const m = extMode();
  if (m === 'android' && ENV.cap) {
    const pkg = androidPkg(), plug = extPlugin();
    if (!plug) return toast('Externe speler niet beschikbaar in deze versie');
    try { await plug.open({ url, title, package: pkg }); }
    catch (e) {
      if (pkg && /NOT_INSTALLED|niet ge/i.test((e && (e.code || e.message)) || '')) {
        if (confirm(`${extName()} is niet geïnstalleerd. Openen in de Play Store?`)) plug.openStore({ package: pkg }).catch(() => {});
      } else toast('Kon externe speler niet openen');
    }
    return;
  }
  if (m === 'android') { // browser op Android: intent-link
    const u = new URL(url), pkg = androidPkg();
    location.href = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};type=video/*;` +
      (pkg ? `package=${pkg};` : '') + `S.title=${encodeURIComponent(title)};end`;
    return;
  }
  if (m === 'windows' && window.kdNative) {
    let path = state.settings.ext.winPath;
    if (!path) {
      const found = await window.kdNative.detectPlayers().catch(() => []);
      if (found.length) { path = state.settings.ext.winPath = found[0].path; saveSettings(); }
    }
    if (!path) { toast('Kies eerst een externe speler bij ⚙ Instellingen'); renderSettings(); $('#settings').hidden = false; return; }
    const r = await window.kdNative.openPlayer({ path, args: state.settings.ext.winArgs, url, title }).catch(e => ({ ok: false, msg: e.message }));
    if (!r.ok) toast('Openen mislukt: ' + (r.msg || 'onbekende fout'), 4000); else toast('Geopend in ' + extName());
    return;
  }
  // Browser op de computer: playlistbestand downloaden, opent in je standaard mediaspeler (bijv. VLC)
  const blob = new Blob([`#EXTM3U\n#EXTINF:-1,${title}\n${url}\n`], { type: 'audio/x-mpegurl' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = (title || 'stream').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80) + '.m3u'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Playlist gedownload — open hem met VLC of je standaardspeler', 4000);
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
  $('#setScan').checked = !!state.settings.scan;
  $('#setProxy').value = state.settings.proxy || '';
  const e = state.settings.ext, m = extMode();
  $('#setExtAlways').checked = !!e.always;
  $('#extAndroid').hidden = m !== 'android'; $('#extWin').hidden = m !== 'windows'; $('#extWeb').hidden = m !== 'web';
  $('#setExtApp').innerHTML = ANDROID_PLAYERS.map(([id, n]) => `<option value="${id}" ${e.app === id ? 'selected' : ''}>${esc(n)}</option>`).join('');
  $('#setExtPkg').hidden = e.app !== 'custom'; $('#setExtPkg').value = e.pkg || '';
  $('#setWinPath').value = e.winPath || ''; $('#setWinArgs').value = e.winArgs || '';
  if (m === 'windows' && window.kdNative) window.kdNative.detectPlayers().then(list => {
    $('#winFound').innerHTML = list.length ? 'Gevonden: ' + list.map(p => `<button class="linkbtn" data-wp="${esc(p.path)}">${esc(p.name)}</button>`).join(' · ') : 'Geen bekende speler gevonden — kies zelf een .exe.';
  }).catch(() => {});
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
  if (t.id === 'setScan') { state.settings.scan = t.checked; saveSettings(); render(); toast(t.checked ? 'Controle aan — alleen wat in beeld is' : 'Controle uit — alleen de index'); }
  if (t.dataset.b) { state.settings.builtin[t.dataset.b] = t.checked; saveSettings(); reloadSoon(); }
  if (t.id === 'setExtAlways') { state.settings.ext.always = t.checked; saveSettings(); }
  if (t.id === 'setExtApp') { state.settings.ext.app = t.value; saveSettings(); renderSettings(); }
  if (t.id === 'setExtPkg') { state.settings.ext.pkg = t.value.trim(); saveSettings(); }
  if (t.id === 'setWinPath') { state.settings.ext.winPath = t.value.trim().replace(/^"|"$/g, ''); saveSettings(); }
  if (t.id === 'setWinArgs') { state.settings.ext.winArgs = t.value; saveSettings(); }
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
$('#settings').addEventListener('click', e => {
  const wp = e.target.closest('[data-wp]');
  if (wp) { state.settings.ext.winPath = wp.dataset.wp; saveSettings(); renderSettings(); }
});
$('#btnWinBrowse').onclick = async () => {
  if (!window.kdNative) return;
  const p = await window.kdNative.browsePlayer(); if (p) { state.settings.ext.winPath = p; saveSettings(); renderSettings(); }
};
$('#btnExtTest').onclick = () => openExternal('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', 'Kijkdoos testbeeld');
$('#btnRecheck').onclick = () => { avail.clear(); archiveCache.clear(); loadAll(); toast('Index wordt opnieuw geladen'); };
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
  if (c) { const it = itemIndex.get(c.dataset.uid); if (it) it.kind === 'live' && it.url ? playAuto(it.url, it.title, it) : openDetail(it); }
});
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  state.tab = b.dataset.tab; window.scrollTo(0, 0); render();
});
let qT; $('#q').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); render(); }, 200); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' && e.key !== 'GoBack' && e.key !== 'BrowserBack') return;
  if (!$('#player').hidden) return stopPlayback();
  if (!$('#langPop').hidden) { $('#langPop').hidden = true; return; }
  for (const id of ['detail', 'settings', 'gridView']) if (!$('#' + id).hidden) { $('#' + id).hidden = true; return; }
});
// Android terugknop (Capacitor)
document.addEventListener('backbutton', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
if (ENV.cap && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
  window.Capacitor.Plugins.App.addListener('backButton', () => {
    const open = !$('#player').hidden || !$('#langPop').hidden || ['detail', 'settings', 'gridView'].some(id => !$('#' + id).hidden);
    if (open) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); else window.Capacitor.Plugins.App.exitApp();
  });
}

// ---------- Start ----------
let splashGone = false;
function hideSplash(ready) {
  if (splashGone || !ready) return; splashGone = true;
  const s = $('#splash'); if (!s) return;
  setTimeout(() => { s.classList.add('out'); setTimeout(() => s.remove(), 500); }, 400);
}
setTimeout(() => hideSplash(true), 4000);
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !ENV.native) navigator.serviceWorker.register('sw.js').catch(() => {});
window.KD = { state, parseM3U, classify, ENV }; // voor debuggen/tests
loadAll();
