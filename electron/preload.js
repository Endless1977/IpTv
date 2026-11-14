// Brug tussen de app en Windows: externe speler zoeken/kiezen/starten.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('kdNative', {
  detectPlayers: () => ipcRenderer.invoke('players:detect'),
  browsePlayer: () => ipcRenderer.invoke('players:browse'),
  openPlayer: opts => ipcRenderer.invoke('players:open', opts),
});
