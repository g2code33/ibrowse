const { contextBridge, ipcRenderer } = require('electron');

const api = {
  getLaunchInfo: () => ipcRenderer.invoke('yayra:get-launch-info'),
  updates: {
    check: () => ipcRenderer.invoke('yayra:updates-check'),
    install: () => ipcRenderer.invoke('yayra:updates-install')
  }
};

contextBridge.exposeInMainWorld('yayra', api);
contextBridge.exposeInMainWorld('ibrowse', api);
