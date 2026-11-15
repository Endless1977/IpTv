// Bouwt de reserve-catalogus (www/iptv-catalog-data.js) uit een lokale clone van iptv-org/iptv.
// Gebruik: node scripts/build-iptv-catalog.js /pad/naar/iptv-org/iptv
const fs = require('fs'), path = require('path');
const C = require('../www/iptv-catalog.js');
const repo = process.argv[2] || '../iptv-org-iptv';
const md = fs.readFileSync(path.join(repo, 'PLAYLISTS.md'), 'utf8');
const data = { generated: new Date().toISOString().slice(0, 10), playlists: C.parsePlaylists(md), sources: C.sourcesFromFiles(fs.readdirSync(path.join(repo, 'streams'))) };
fs.writeFileSync(path.join(__dirname, '..', 'www', 'iptv-catalog-data.js'),
  '/* Reserve-kopie van de iptv-org catalogus (' + data.generated + '); de app leest normaal live het origineel. */\nwindow.IPTV_CATALOG_FALLBACK = ' + JSON.stringify(data) + ';\n');
console.log('categorieën', data.playlists.categories.length, 'talen', data.playlists.languages.length, 'landen', data.playlists.countries.length,
  'subs', data.playlists.countries.reduce((a, c) => a + c.subs.length, 0), 'regio\'s', data.playlists.regions.length, 'platforms', data.sources.length);
