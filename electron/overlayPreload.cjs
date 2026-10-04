const { contextBridge, ipcRenderer } = require('electron');

// Minimal bridge for the system-wide floating overlay bubble window. Kept
// deliberately tiny - the overlay is NOT a full Yayra renderer, it is a
// standalone always-on-top window that exists whether or not the main
// Yayra window is even open. Single click toggles the floating mini
// browser; right-click opens a quick menu (mini / full browser / quit).
contextBridge.exposeInMainWorld('yayraOverlay', {
  restore: () => ipcRenderer.send('yayra:overlay-restore'),
  bubbleClick: () => ipcRenderer.send('yayra:overlay-bubble-click'),
  openMenu: () => ipcRenderer.send('yayra:overlay-bubble-menu'),
  reportMoved: (position) => ipcRenderer.send('yayra:overlay-moved', position)
});
