const { app, BrowserWindow, WebContentsView, ipcMain, protocol, net, shell, safeStorage, Menu, clipboard, session, dialog, screen, Tray, nativeImage } = require('electron');
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
const { createTrayController } = require('./tray.cjs');

const CUSTOM_SCHEME = 'yayra';
const DIST_DIR = path.join(__dirname, '..', 'dist');
let mainWindow;
let overlayBridge = null;
let webviewBridge = null;
let trayController = null;
let lastLoadError = null;

// Boot launches (login items / XDG autostart) pass --yayra-autostart:
// start the floating bubble + system tray ONLY, without popping the main
// browser window over whatever the user is doing right after login.
const isAutostartLaunch = process.argv.includes('--yayra-autostart');

protocol.registerSchemesAsPrivileged([{ scheme: CUSTOM_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
if (process.env.YAYRA_SMOKE === '1' || process.env.IBROWSE_SMOKE === '1') {
  app.commandLine.appendSwitch('headless');
  app.disableHardwareAcceleration();
}

// One Yayra per desktop: a second launch (e.g. autostart at login racing a
// manual launch - the classic cause of TWO floating bubbles) just focuses
// the existing instance instead of spawning a duplicate app + duplicate
// bubble.
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (overlayBridge) overlayBridge.restoreMainWindow();
    else if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
    else createWindow();
  });
}

app.whenReady().then(async () => {
  if (!isPrimaryInstance) return;
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

  // ALL IPC surfaces are registered exactly once here (never inside
  // createWindow()): the main window can now be closed and recreated from
  // the floating bubble, and re-running ipcMain.handle() for an existing
  // channel throws.
  registerIpcBridges();
  const isSmokeStartup = process.env.YAYRA_SMOKE === '1' || process.env.IBROWSE_SMOKE === '1';
  // Boot launch: bubble + tray only. Manual launch: full browser window.
  if (!isAutostartLaunch || isSmokeStartup) createWindow();

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
      // Full-API preload for the floating "yayra mini" browser window the
      // bubble expands into on single click.
      mainPreloadPath: path.join(__dirname, 'preload.cjs'),
      Menu,
      fsImpl: fs,
      homeDir: app.getPath('home'),
      overlayStore,
      getMainWindow: () => mainWindow,
      // The bubble outlives the main window; clicking "Open full browser"
      // after the main window was closed recreates it from scratch.
      createMainWindow: () => createWindow()
    });
    overlayBridge.initializeOnStartup();

    // System tray: the bubble overlays every app on the PC, so it is also
    // visible and regulated from the OS notification area (enable/disable
    // bubble, overlay-above-all-apps, start-at-login, open mini/full, quit).
    trayController = createTrayController({
      Tray,
      Menu,
      nativeImage,
      app,
      iconPath: resolveTrayIconPath(),
      overlayStore,
      overlayBridge,
      getMainWindow: () => mainWindow,
      createMainWindow: () => createWindow()
    });
    trayController.init();
  }

  // Safety net: a boot launch must NEVER run invisibly. If the user had
  // disabled the bubble AND the platform has no tray, show the browser.
  if (isAutostartLaunch && !isSmokeRun) {
    const bubbleVisible = overlayBridge && overlayBridge.getOverlayWindow && overlayBridge.getOverlayWindow();
    const trayVisible = trayController && trayController.getTray && trayController.getTray();
    if (!bubbleVisible && !trayVisible) createWindow();
  }
});

function resolveTrayIconPath() {
  const candidates = [
    path.join(DIST_DIR, 'icons', 'icon-192.png'),
    path.join(__dirname, '..', 'public', 'icons', 'icon-192.png'),
    path.join(__dirname, '..', 'build', 'icons', 'hicolor', '32x32', 'apps', 'yayra.png')
  ];
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) return candidate; } catch { /* keep looking */ }
  }
  return null;
}

// The floating bubble + mini window keep Yayra alive in the background by
// design (they are real windows, so 'window-all-closed' only fires once
// they are gone too - e.g. after "Hide bubble" or "Quit Yayra").
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

function registerIpcBridges() {
  registerDesktopUpdateHandlers({ getWindow: () => mainWindow });

  // Native website-rendering engine bridge (replaces <iframe>-based rendering
  // so real sites with X-Frame-Options/frame-ancestors - Google, GitHub,
  // etc. - actually load). See electron/webviewBridge.cjs for the full
  // architecture rationale. Views attach to whichever shell window asked
  // for them (main window or the floating mini window).
  webviewBridge = createWebviewBridge({
    WebContentsView,
    ipcMain,
    shell,
    Menu,
    clipboard,
    getMainWindow: () => mainWindow,
    getWindowForWebContents: (wc) => BrowserWindow.fromWebContents(wc),
    // Chrome-style password capture/fill inside real pages (sandboxed
    // preload, nothing exposed to the page) - see autofillPreload.cjs.
    autofillPreloadPath: path.join(__dirname, 'autofillPreload.cjs')
  });

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
  // (non-private) tabs use, plus Yayra's own windows, and lets the user pick
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
    sessions: [session.fromPartition('persist:yayra-webview'), session.defaultSession],
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
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    // Dark surface behind EVERYTHING. Electron's default window background
    // is white, and every time the native page view hides/moves (menu
    // drawer, dropdowns, modals, tab switches) the compositor exposes the
    // window background for a frame or two - which users saw as a blank
    // WHITE flash before the menu appeared. Matching the app's dark theme
    // makes those frames invisible.
    backgroundColor: '#101218',
    show: process.env.YAYRA_SMOKE !== '1' && process.env.IBROWSE_SMOKE !== '1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Chrome-equivalent native right-click menu for Yayra's OWN chrome (the
  // omnibox, side drawer, settings forms, etc.) - this is a different
  // webContents than the per-tab WebContentsViews (those get their
  // own context menu wired in electron/webviewBridge.cjs), so without this
  // right-clicking the address bar or any text field in Yayra's own UI
  // would show no menu at all.
  const win = mainWindow;
  win.webContents.on('context-menu', (_event, params) => {
    if (win.isDestroyed()) return;
    const template = buildContextMenuTemplate({
      params,
      wc: win.webContents,
      tabId: null,
      send: () => {},
      clipboard
    });
    Menu.buildFromTemplate(template).popup({ window: win });
  });

  // Closing the main window only tears down ITS tab views; the floating
  // bubble/mini window (and their views) stay alive independently. The
  // webContents reference is captured now because the BrowserWindow proxy
  // refuses property access after destruction.
  const winContents = win.webContents;
  win.on('closed', () => {
    if (webviewBridge) webviewBridge.destroyForWebContents(winContents);
    if (mainWindow === win) mainWindow = null;
  });

  winContents.on('did-fail-load', (_event, code, description, url) => {
    lastLoadError = { code, description, url };
    console.error(`[yayra] renderer load failed; retrying file fallback code=${code} url=${url}`);
    if (!winContents.isDestroyed()) win.loadFile(path.join(DIST_DIR, 'index.html'));
  });
  const isBadLoad = process.env.YAYRA_FORCE_BAD_LOAD === '1' || process.env.IBROWSE_FORCE_BAD_LOAD === '1';
  const loadTarget = isBadLoad ? `${CUSTOM_SCHEME}://app/does-not-exist.html` : `${CUSTOM_SCHEME}://app/index.html`;
  win.loadURL(loadTarget);
  if (process.env.YAYRA_SMOKE === '1' || process.env.IBROWSE_SMOKE === '1') {
    winContents.once('did-finish-load', async () => {
      const result = await winContents.executeJavaScript('({ title: document.title, hasRoot: Boolean(document.getElementById("app")), headerControl: Boolean(document.getElementById("update-button") || document.getElementById("top-header")) })');
      console.log(`[yayra-smoke] ${JSON.stringify(result)}`);
      app.quit();
    });
    setTimeout(() => {
      console.error('[yayra-smoke] timeout waiting for renderer paint');
      app.exit(1);
    }, 15000).unref();
  }
  return mainWindow;
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
