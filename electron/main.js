// Windows-app: laadt de web-app zonder browserbeperkingen (geen CORS, http-streams toegestaan).
const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');

// ---- Externe spelers ----
const PF = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
const KNOWN = [
  ['VLC', 'VideoLAN\\VLC\\vlc.exe'],
  ['mpv', 'mpv\\mpv.exe'],
  ['MPC-HC', 'MPC-HC\\mpc-hc64.exe'], ['MPC-HC', 'MPC-HC\\mpc-hc.exe'],
  ['MPC-BE', 'MPC-BE x64\\mpc-be64.exe'], ['MPC-BE', 'MPC-BE\\mpc-be.exe'],
  ['PotPlayer', 'DAUM\\PotPlayer\\PotPlayerMini64.exe'], ['PotPlayer', 'DAUM\\PotPlayer\\PotPlayerMini.exe'],
  ['Kodi', 'Kodi\\kodi.exe'],
];
function detectPlayers() {
  const out = [], seen = new Set();
  for (const base of PF) for (const [name, rel] of KNOWN) {
    const p = path.join(base, rel);
    if (!seen.has(name) && fs.existsSync(p)) { seen.add(name); out.push({ name, path: p }); }
  }
  for (const exe of ['mpv.exe', 'vlc.exe']) { // ook via PATH (scoop/winget)
    try { const p = execFileSync('where', [exe], { encoding: 'utf8' }).split(/\r?\n/)[0].trim(); const n = exe === 'vlc.exe' ? 'VLC' : 'mpv'; if (p && !seen.has(n)) { seen.add(n); out.push({ name: n, path: p }); } } catch {}
  }
  return out;
}
function splitArgs(str) { return (str.match(/"[^"]*"|\S+/g) || []).map(a => a.replace(/^"|"$/g, '')); }
function playerArgs(exe, custom, url, title) {
  if (custom && custom.trim()) {
    const a = splitArgs(custom).map(x => x.replace(/\{url\}/g, url).replace(/\{title\}/g, title));
    return custom.includes('{url}') ? a : [...a, url];
  }
  const n = path.basename(exe).toLowerCase();
  if (n.startsWith('vlc')) return ['--meta-title=' + title, '--no-video-title-show', url];
  if (n.startsWith('mpv')) return ['--force-media-title=' + title, url];
  if (n.startsWith('potplayer')) return [url, '/title=' + title];
  return [url];
}
ipcMain.handle('players:detect', () => detectPlayers());
ipcMain.handle('players:browse', async e => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Kies je mediaspeler', properties: ['openFile'], filters: [{ name: 'Programma', extensions: ['exe'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('players:open', (_e, { path: exe, args, url, title }) => {
  if (!exe || !fs.existsSync(exe)) return { ok: false, msg: 'Speler niet gevonden: ' + exe };
  if (!/^https?:\/\//i.test(url || '')) return { ok: false, msg: 'Ongeldige stream-URL' };
  try {
    const child = spawn(exe, playerArgs(exe, args, url, title || 'Kijkdoos'), { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => {}); child.unref();
    return { ok: true };
  } catch (err) { return { ok: false, msg: err.message }; }
});

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow() {
  const win = new BrowserWindow({
    width: 1360, height: 840, minWidth: 420, minHeight: 500,
    backgroundColor: '#0b0d14', autoHideMenuBar: true, title: 'Kijkdoos',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { webSecurity: false, allowRunningInsecureContent: true, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // F11 = volledig scherm
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
