const { contextBridge, ipcRenderer } = require('electron');

const WEBVIEW_EVENT_CHANNEL = 'yayra:webview-event';
const AUTH_EVENT_CHANNEL = 'yayra:auth-event';
const DOWNLOADS_EVENT_CHANNEL = 'yayra:downloads-event';

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
  },
  // "Sign in with Google" for Yayra's own app-level identity (not for
  // browsing Google services logged in - Google forbids that for any
  // embedded surface, see electron/webviewBridge.cjs). Presence of
  // `window.yayra.auth` is how the renderer knows this desktop build
  // supports real Google sign-in; it is absent on web/PWA/mobile builds
  // until those platforms get their own implementation. See
  // electron/googleAuth.cjs for the full flow.
  auth: {
    signIn: () => ipcRenderer.invoke('yayra:auth-sign-in'),
    signOut: () => ipcRenderer.invoke('yayra:auth-sign-out'),
    getSession: () => ipcRenderer.invoke('yayra:auth-get-session'),
    openAccountPage: () => ipcRenderer.invoke('yayra:auth-open-account-page'),
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on(AUTH_EVENT_CHANNEL, listener);
      return () => ipcRenderer.removeListener(AUTH_EVENT_CHANNEL, listener);
    }
  },
  // Real download tracking (see electron/downloadsBridge.cjs). Presence of
  // `window.yayra.downloads` is how the renderer knows this build can show
  // real download history/open/show-in-folder/custom storage root instead
  // of the old decorative placeholder list.
  downloads: {
    list: () => ipcRenderer.invoke('yayra:downloads-list'),
    clear: () => ipcRenderer.invoke('yayra:downloads-clear'),
    remove: (id) => ipcRenderer.invoke('yayra:downloads-remove', { id }),
    open: (id) => ipcRenderer.invoke('yayra:downloads-open', { id }),
    showInFolder: (id) => ipcRenderer.invoke('yayra:downloads-show-in-folder', { id }),
    getRoot: () => ipcRenderer.invoke('yayra:downloads-get-root'),
    chooseRoot: () => ipcRenderer.invoke('yayra:downloads-choose-root'),
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on(DOWNLOADS_EVENT_CHANNEL, listener);
      return () => ipcRenderer.removeListener(DOWNLOADS_EVENT_CHANNEL, listener);
    }
  },
  // System-wide floating overlay bubble settings (see
  // electron/overlayWindow.cjs). The overlay window itself is a completely
  // separate native window/renderer - this is just the Settings-facing
  // control surface for it.
  overlay: {
    getSettings: () => ipcRenderer.invoke('yayra:overlay-get-settings'),
    setEnabled: (enabled) => ipcRenderer.invoke('yayra:overlay-set-enabled', enabled),
    setLaunchAtStartup: (enabled) => ipcRenderer.invoke('yayra:overlay-set-launch-at-startup', enabled),
    setOverlayAllApps: (enabled) => ipcRenderer.invoke('yayra:overlay-set-overlay-all-apps', enabled)
  }
};

contextBridge.exposeInMainWorld('yayra', api);
contextBridge.exposeInMainWorld('ibrowse', api);
