const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { registerDesktopUpdateHandlers } = require('./desktopUpdater.cjs');

const CUSTOM_SCHEME = 'ibrowse';
const DIST_DIR = path.join(__dirname, '..', 'dist');
let mainWindow;
let lastLoadError = null;

protocol.registerSchemesAsPrivileged([{ scheme: CUSTOM_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
if (process.env.IBROWSE_SMOKE === '1') {
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
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: process.env.IBROWSE_SMOKE !== '1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  registerDesktopUpdateHandlers({ getWindow: () => mainWindow });
  ipcMain.handle('ibrowse:get-launch-info', () => ({
    version: app.getVersion(),
    updateState: 'diagnostics-ready',
    flags: process.argv.filter((arg) => arg.startsWith('--')),
    lastLoadError
  }));
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    lastLoadError = { code, description, url };
    console.error(`[ibrowse] renderer load failed; retrying file fallback code=${code} url=${url}`);
    if (!mainWindow.webContents.isDestroyed()) mainWindow.loadFile(path.join(DIST_DIR, 'index.html'));
  });
  const loadTarget = process.env.IBROWSE_FORCE_BAD_LOAD === '1' ? `${CUSTOM_SCHEME}://app/does-not-exist.html` : `${CUSTOM_SCHEME}://app/index.html`;
  mainWindow.loadURL(loadTarget);
  if (process.env.IBROWSE_SMOKE === '1') {
    mainWindow.webContents.once('did-finish-load', async () => {
      const result = await mainWindow.webContents.executeJavaScript('({ title: document.title, hasRoot: Boolean(document.getElementById("app")), headerControl: Boolean(document.getElementById("update-button") || document.getElementById("top-header")) })');
      console.log(`[ibrowse-smoke] ${JSON.stringify(result)}`);
      app.quit();
    });
    setTimeout(() => {
      console.error('[ibrowse-smoke] timeout waiting for renderer paint');
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
