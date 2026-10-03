const { contextBridge, ipcRenderer } = require('electron');

const WEBVIEW_EVENT_CHANNEL = 'yayra:webview-event';

const api = {
  getLaunchInfo: () => ipcRenderer.invoke('yayra:get-launch-info'),
  updates: {
    check: () => ipcRenderer.invoke('yayra:updates-check'),
    install: () => ipcRenderer.invoke('yayra:updates-install')
  },
  // Native website-rendering engine bridge. See electron/webviewBridge.cjs.
  // Presence of `window.yayra.webview` is how the renderer
  // (packages/shared-ui/src/components/BrowserShell.js) detects it is
  // running inside Electron and should use the native WebContentsView engine
  // instead of an <iframe> for rendering visited websites.
  webview: {
    ensure: (tabId, url, isPrivate = false) => ipcRenderer.invoke('yayra:webview-ensure', { tabId, url, isPrivate }),
    setBounds: (tabId, bounds) => ipcRenderer.invoke('yayra:webview-set-bounds', { tabId, bounds }),
    setVisible: (tabId, visible) => ipcRenderer.invoke('yayra:webview-set-visible', { tabId, visible }),
    goBack: (tabId) => ipcRenderer.invoke('yayra:webview-go-back', { tabId }),
    goForward: (tabId) => ipcRenderer.invoke('yayra:webview-go-forward', { tabId }),
    reload: (tabId) => ipcRenderer.invoke('yayra:webview-reload', { tabId }),
    stop: (tabId) => ipcRenderer.invoke('yayra:webview-stop', { tabId }),
    destroy: (tabId) => ipcRenderer.invoke('yayra:webview-destroy', { tabId }),
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on(WEBVIEW_EVENT_CHANNEL, listener);
      return () => ipcRenderer.removeListener(WEBVIEW_EVENT_CHANNEL, listener);
    }
  }
};

contextBridge.exposeInMainWorld('yayra', api);
contextBridge.exposeInMainWorld('ibrowse', api);
