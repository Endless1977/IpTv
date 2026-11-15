/* Catalogus van iptv-org/iptv: leest de originele PLAYLISTS.md en de lijst bronbestanden (streams/).
 * Werkt in de browser (window.IptvCatalog) en in Node (scripts/build-iptv-catalog.js). */
(function (root) {
  'use strict';
  const CAT_NL = {
    Animation: 'Animatie', Auto: 'Auto', Business: 'Zakelijk', Classic: 'Klassiek', Comedy: 'Comedy', Cooking: 'Koken',
    Culture: 'Cultuur', Documentary: 'Documentaire', Education: 'Educatie', Entertainment: 'Entertainment', Family: 'Familie',
    General: 'Algemeen', Interactive: 'Interactief', Kids: 'Kinderen', Legislative: 'Politiek', Lifestyle: 'Lifestyle',
    Movies: 'Films', Music: 'Muziek', News: 'Nieuws', Outdoor: 'Buitenleven', Public: 'Publieke omroep', Relax: 'Ontspanning',
    Religious: 'Religie', Science: 'Wetenschap', Series: 'Series', Shop: 'Shoppen', Sports: 'Sport', Travel: 'Reizen',
    Weather: 'Weer', Undefined: 'Overig',
  };
  const PLATFORM = {
    samsung: 'Samsung TV Plus', pluto: 'Pluto TV', rakuten: 'Rakuten TV', distro: 'DistroTV', amagi: 'Amagi', tubi: 'Tubi',
    xumo: 'Xumo', stirr: 'Stirr', stingray: 'Stingray', vizio: 'Vizio WatchFree+', tcl: 'TCLtv+', plex: 'Plex', roku: 'Roku',
    lg: 'LG Channels', fashiontv: 'FashionTV', traceplus: 'Trace+', bfm: 'BFM', groupem6: 'Groupe M6', groupecanalplus: 'Groupe Canal+',
    cctv: 'CCTV', cgtn: 'CGTN', yeslivetv: 'YesLiveTV', morescreens: 'MoreScreens', wurl: 'Wurl', uplynk: 'Uplynk', wowza: 'Wowza',
  };
  const platformName = p => PLATFORM[p] || p.replace(/(^|[-_])(\w)/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase());

  /** PLAYLISTS.md → { categories, languages, countries (met subs), regions } */
  function parsePlaylists(md) {
    const out = { categories: [], languages: [], countries: [], regions: [] };
    const sec = title => { const i = md.indexOf(title); if (i < 0) return ''; const j = md.indexOf('\n### ', i + title.length); return md.slice(i, j < 0 ? undefined : j); };
    const rows = txt => [...txt.matchAll(/<tr><td[^>]*>([^<]+)<\/td><td[^>]*>(\d+)<\/td><td[^>]*><code>https:\/\/iptv-org\.github\.io\/iptv\/([^<]+?)\.m3u<\/code>/g)]
      .map(m => ({ name: m[1].trim(), n: +m[2], path: m[3] }));
    out.categories = rows(sec('### Grouped by category')).filter(c => c.n > 0 && !/xxx$/i.test(c.path));
    out.languages = rows(sec('### Grouped by language')).filter(c => c.n > 0);
    const area = sec('### Grouped by broadcast area');
    const ci = area.indexOf('#### Countries'), ri = area.indexOf('#### Regions');
    const items = txt => [...txt.matchAll(/^( *)- (.+?) <code>https:\/\/iptv-org\.github\.io\/iptv\/([^<]+?)\.m3u<\/code>/gm)]
      .map(m => ({ lvl: Math.round(m[1].length / 2), name: m[2].replace(/^[\u{1F1E6}-\u{1F1FF}]{2}\s*/u, '').trim(), path: m[3] }));
    let cur = null;
    for (const it of items(ci >= 0 ? area.slice(ci, ri > ci ? ri : undefined) : '')) {
      if (it.lvl === 0) { cur = { name: it.name, path: it.path, subs: [] }; out.countries.push(cur); }
      else if (cur) cur.subs.push({ name: it.name, path: it.path, lvl: it.lvl });
    }
    out.regions = ri >= 0 ? items(area.slice(ri)).map(({ name, path }) => ({ name, path })) : [];
    return out;
  }

  /** bestandsnamen uit streams/ → platformbronnen (bijv. nl_samsung.m3u) */
  function sourcesFromFiles(names) {
    return names.map(n => n.match(/^([a-z]{2})_([a-z0-9_-]+)\.m3u$/i)).filter(Boolean)
      .map(m => ({ cc: m[1].toLowerCase(), pf: m[2].toLowerCase(), path: 'sources/' + m[1] + '_' + m[2] }));
  }

  root.IptvCatalog = { parsePlaylists, sourcesFromFiles, CAT_NL, PLATFORM, platformName };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.IptvCatalog;
})(typeof window !== 'undefined' ? window : globalThis);
