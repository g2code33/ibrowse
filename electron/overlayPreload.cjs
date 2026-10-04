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
  reportMoved: (position) => ipcRenderer.send('yayra:overlay-moved', position),
  // Settled tap-count gestures: 1 = toggle mini, 2 = full browser,
  // 3 = lock/unlock the bubble's position (triple-click feature).
  tap: (count) => ipcRenderer.send('yayra:overlay-bubble-tap', count),
  // Manual drag (the bubble has no native drag region - drag regions
  // swallow left-button events, which was the "clicking does nothing" bug).
  dragStart: (offset) => ipcRenderer.send('yayra:overlay-drag-start', offset),
  dragMove: (point) => ipcRenderer.send('yayra:overlay-drag-move', point),
  dragEnd: () => ipcRenderer.send('yayra:overlay-drag-end'),
  // Double-tap radial menu: a circular button was pressed
  // (ai / mini / full / lock / hide / quit / close).
  radialAction: (action) => ipcRenderer.send('yayra:overlay-radial-action', action),
  onRadial: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('yayra:overlay-radial', listener);
    return () => ipcRenderer.removeListener('yayra:overlay-radial', listener);
  },
  onLockChanged: (callback) => {
    const listener = (_event, locked) => callback(locked);
    ipcRenderer.on('yayra:overlay-lock-changed', listener);
    return () => ipcRenderer.removeListener('yayra:overlay-lock-changed', listener);
  }
});
