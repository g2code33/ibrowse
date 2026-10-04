const { app, BrowserWindow, WebContentsView, ipcMain, protocol, net, shell, safeStorage, Menu, clipboard, session, dialog, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { registerDesktopUpdateHandlers } = require('./desktopUpdater.cjs');
const { createWebviewBridge, buildContextMenuTemplate } = require('./webviewBridge.cjs');
const { createAuthBridge } = require('./authBridge.cjs');
const { createAuthStore } = require('./authStore.cjs');
const { signInWithGoogle } = require('./googleAuth.cjs');
const { resolveGoogleClientId, resolveGoogleClientSecret } = require('./googleAuthConfig.cjs');
const { createDownloadsStore } = require('./downloadsStore.cjs');
const { createDownloadsBridge } = require('./downloadsBridge.cjs');
const { createOverlayBridge } = require('./overlayWindow.cjs');
const { createOverlayStore } = require('./overlayStore.cjs');

const CUSTOM_SCHEME = 'yayra';
const DIST_DIR = path.join(__dirname, '..', 'dist');
let mainWindow;
let overlayBridge = null;
let lastLoadError = null;

protocol.registerSchemesAsPrivileged([{ scheme: CUSTOM_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
if (process.env.YAYRA_SMOKE === '1' || process.env.IBROWSE_SMOKE === '1') {
  app.commandLine.appendSwitch('headless');
  app.disableHardwareAcceleration();
}

app.whenReady().then(async () => {
  protocol.handle(CUSTOM_SCHEME, async (request) => {
    const url = new URL(request.url);
    const pathname = safeAssetPath(url.pathname);
    if (!pathname) return new Response('not found', { status: 404 });
    const file = path.join(DIST_DIR, pathname);
    if (!file.startsWith(DIST_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('not found', { status: 404 });
    const type = mimeType(file);
    if (/\.m?js$/.test(file) && !/javascript/.test(type)) return new Response('refused wrong MIME type', { status: 415 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();

  // The floating overlay bubble is intentionally started independently of
  // createWindow()/the main browser window - see electron/overlayWindow.cjs
  // for exactly what "system-wide overlay" does and does not mean here.
  // Skipped under the automated smoke/CI harness (no real display,
  // hardware acceleration disabled) where a transparent always-on-top
  // window serves no purpose and isn't exercised by any assertion.
  const isSmokeRun = process.env.YAYRA_SMOKE === '1' || process.env.IBROWSE_SMOKE === '1';
  if (!isSmokeRun) {
    const overlayStore = createOverlayStore({ fs, userDataDir: app.getPath('userData') });
    overlayBridge = createOverlayBridge({
      BrowserWindow,
      app,
      ipcMain,
      screen,
      path,
      preloadPath: path.join(__dirname, 'overlayPreload.cjs'),
      overlayStore,
      getMainWindow: () => mainWindow
    });
    overlayBridge.initializeOnStartup();
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: process.env.YAYRA_SMOKE !== '1' && process.env.IBROWSE_SMOKE !== '1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  registerDesktopUpdateHandlers({ getWindow: () => mainWindow });

  // Chrome-equivalent native right-click menu for Yayra's OWN chrome (the
  // omnibox, side drawer, settings forms, etc.) - this is a different
  // webContents than the per-tab WebContentsViews below (those get their
  // own context menu wired in electron/webviewBridge.cjs), so without this
  // right-clicking the address bar or any text field in Yayra's own UI
  // would show no menu at all.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const wc = mainWindow.webContents;
    const template = buildContextMenuTemplate({
      params,
      wc,
      tabId: null,
      send: () => {},
      clipboard
    });
    if (mainWindow.isDestroyed()) return;
    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });

  // Native website-rendering engine bridge (replaces <iframe>-based rendering
  // so real sites with X-Frame-Options/frame-ancestors - Google, GitHub,
  // etc. - actually load). See electron/webviewBridge.cjs for the full
  // architecture rationale.
  const webviewBridge = createWebviewBridge({
    WebContentsView,
    ipcMain,
    shell,
    Menu,
    clipboard,
    getMainWindow: () => mainWindow
  });
  mainWindow.on('closed', () => webviewBridge.destroyAll());

  // "Sign in with Google" for Yayra's own app-level identity. See
  // electron/googleAuth.cjs + electron/authBridge.cjs for the full
  // architecture rationale (RFC 8252 loopback + PKCE, system-browser-only).
  const authStore = createAuthStore({
    fs,
    safeStorageImpl: safeStorage,
    userDataDir: app.getPath('userData')
  });
  createAuthBridge({
    ipcMain,
    shell,
    getMainWindow: () => mainWindow,
    authStore,
    clientId: resolveGoogleClientId(),
    clientSecret: resolveGoogleClientSecret(),
    // Use Electron's own net.fetch (Chromium's network stack) instead of
    // Node's global fetch for the Google token/userinfo requests. The
    // system browser (Chromium) and Node's undici-based fetch do NOT share
    // a network stack - on machines with a corporate proxy, VPN, or a
    // TLS-inspecting antivirus whose root cert is trusted by the OS/Chromium
    // but not by Node's own CA store, Node's fetch fails outright with a
    // generic "fetch failed" even though the browser-driven consent step
    // worked fine. net.fetch is proxy- and OS-cert-aware the same way the
    // browser is, so it succeeds in those environments too.
    fetchImpl: typeof net.fetch === 'function' ? net.fetch : undefined,
    signInImpl: signInWithGoogle
  });

  // Real file-download tracking (replaces the old hardcoded fake "Downloads"
  // row entirely - see electron/downloadsBridge.cjs). Tracks downloads that
  // happen in the shared "persist:yayra-webview" session that regular
  // (non-private) tabs use, plus Yayra's own window, and lets the user pick
  // where new downloads are saved.
  const downloadsStore = createDownloadsStore({
    fs,
    userDataDir: app.getPath('userData'),
    defaultDownloadsDir: app.getPath('downloads')
  });
  createDownloadsBridge({
    ipcMain,
    shell,
    dialog,
    path,
    fs,
    sessions: [session.fromPartition('persist:yayra-webview'), mainWindow.webContents.session],
    downloadsStore,
    getMainWindow: () => mainWindow
  });

  ipcMain.handle('yayra:get-launch-info', () => ({
    version: app.getVersion(),
    updateState: 'diagnostics-ready',
    flags: process.argv.filter((arg) => arg.startsWith('--')),
    lastLoadError
  }));
  ipcMain.handle('ibrowse:get-launch-info', () => ({
    version: app.getVersion(),
    updateState: 'diagnostics-ready',
    flags: process.argv.filter((arg) => arg.startsWith('--')),
    lastLoadError
  }));
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    lastLoadError = { code, description, url };
    console.error(`[yayra] renderer load failed; retrying file fallback code=${code} url=${url}`);
    if (!mainWindow.webContents.isDestroyed()) mainWindow.loadFile(path.join(DIST_DIR, 'index.html'));
  });
  const isBadLoad = process.env.YAYRA_FORCE_BAD_LOAD === '1' || process.env.IBROWSE_FORCE_BAD_LOAD === '1';
  const loadTarget = isBadLoad ? `${CUSTOM_SCHEME}://app/does-not-exist.html` : `${CUSTOM_SCHEME}://app/index.html`;
  mainWindow.loadURL(loadTarget);
  if (process.env.YAYRA_SMOKE === '1' || process.env.IBROWSE_SMOKE === '1') {
    mainWindow.webContents.once('did-finish-load', async () => {
      const result = await mainWindow.webContents.executeJavaScript('({ title: document.title, hasRoot: Boolean(document.getElementById("app")), headerControl: Boolean(document.getElementById("update-button") || document.getElementById("top-header")) })');
      console.log(`[yayra-smoke] ${JSON.stringify(result)}`);
      app.quit();
    });
    setTimeout(() => {
      console.error('[yayra-smoke] timeout waiting for renderer paint');
      app.exit(1);
    }, 15000).unref();
  }
}

function safeAssetPath(rawPath) {
  let decoded = rawPath || '/';
  for (let i = 0; i < 3; i += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  decoded = decoded.replace(/\\/g, '/');
  if (decoded.includes('..')) return null;
  if (decoded === '/' || decoded === '') return 'index.html';
  return decoded.replace(/^\/+/, '');
}

function mimeType(file) {
  if (file.endsWith('.html')) return 'text/html';
  if (file.endsWith('.js') || file.endsWith('.mjs')) return 'text/javascript';
  if (file.endsWith('.css')) return 'text/css';
  if (file.endsWith('.json')) return 'application/json';
  if (file.endsWith('.webmanifest')) return 'application/manifest+json';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.ico')) return 'image/x-icon';
  return 'application/octet-stream';
}
