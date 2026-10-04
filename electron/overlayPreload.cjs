const { contextBridge, ipcRenderer } = require('electron');

// Minimal bridge for the system-wide floating overlay bubble window. Kept
// deliberately tiny (restore + move + close) - the overlay is NOT a full
// Yayra renderer, it is a standalone always-on-top window that exists
// whether or not the main Yayra window is even open.
contextBridge.exposeInMainWorld('yayraOverlay', {
  restore: () => ipcRenderer.send('yayra:overlay-restore'),
  reportMoved: (position) => ipcRenderer.send('yayra:overlay-moved', position)
});
