// Windows-app: laadt de web-app zonder browserbeperkingen (geen CORS, http-streams toegestaan).
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow() {
  const win = new BrowserWindow({
    width: 1360, height: 840, minWidth: 420, minHeight: 500,
    backgroundColor: '#0b0d14', autoHideMenuBar: true, title: 'Kijkdoos',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { webSecurity: false, allowRunningInsecureContent: true, contextIsolation: true },
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
