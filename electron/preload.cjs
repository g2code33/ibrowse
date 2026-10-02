const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ibrowse', {
  getLaunchInfo: () => ipcRenderer.invoke('ibrowse:get-launch-info'),
  updates: {
    check: () => ipcRenderer.invoke('ibrowse:updates-check'),
    install: () => ipcRenderer.invoke('ibrowse:updates-install')
  }
});
