import { DEFAULT_UPDATE_CONFIG } from '../config/updates.js';
import { MemoryStorage, PromptSession, UpdateService } from '../services/updateService.js';
import { mountUpdateButton } from './updateButton.js';
import { mountMobileUpdatePrompt } from './mobilePrompt.js';
import { BrowserShell } from '../../packages/shared-ui/src/components/BrowserShell.js';
import { createWebAuthBridge } from '../services/googleAuthWeb.js';
import { resolveWebGoogleAuthConfig } from '../config/googleAuthWeb.js';
import { createCapacitorAuthBridge } from '../services/googleAuthCapacitor.js';
import { resolveCapacitorGoogleAuthConfig } from '../config/googleAuthCapacitor.js';

const root = document.getElementById('app');
const header = document.getElementById('top-header');
const target = detectTarget();
// Floating "yayra mini" panel (Electron): the native always-on-top window
// the desktop bubble expands into loads this same bundle with ?shell=mini
// and gets the compact layout + a slim draggable titlebar instead of the
// full desktop chrome. See electron/overlayWindow.cjs.
const isMiniShell = typeof location !== 'undefined' && new URLSearchParams(location.search || '').get('shell') === 'mini';
const installedVersion = document.documentElement.dataset.version || '0.1.0';
const storage = globalThis.localStorage || new MemoryStorage();
const service = new UpdateService({
  target,
  installedVersion,
  // Keep local/dev previews on the bundled fallback manifest. Production
  // checks go through the standalone Cloudflare Worker so update metadata is
  // served independently of the static Pages deployment.
  manifestUrl: getUpdateManifestUrl(),
  deviceId: storage.getItem('yayra:device-id') || ensureDeviceId(storage),
  storage,
  config: DEFAULT_UPDATE_CONFIG,
  telemetry: (event) => navigator.sendBeacon?.('/telemetry/updates', JSON.stringify(event))
});

if (header && !isMiniShell && !['ios', 'android', 'pwa-installed'].includes(target)) {
  mountUpdateButton({ root: header, service, config: DEFAULT_UPDATE_CONFIG });
}

if (isMiniShell && typeof document !== 'undefined') {
  mountMiniShellChrome();
}

// Web/PWA "Sign in with Google": BrowserShell drives whatever bridge it
// finds at window.yayra.auth (on desktop that's the Electron preload's IPC
// bridge). On plain web there is no preload, so install the web adapter
// here - but ONLY when a Web Client ID was injected at build time, so an
// unconfigured deployment keeps the honest "not available on this build"
// message in Settings -> Account instead of a button that errors out.
// Running under Electron/Capacitor-with-native-auth is detected by the
// bridge already existing; never overwrite it.
if (typeof window !== 'undefined' && !(window.yayra && window.yayra.auth) && !(window.ibrowse && window.ibrowse.auth)) {
  const installedAuthBridge = createPlatformAuthBridge();
  if (installedAuthBridge) {
    window.yayra = Object.assign(window.yayra || {}, { auth: installedAuthBridge });
  }
}

function createPlatformAuthBridge() {
  // Native Capacitor app (Android/iOS): system-browser + deep-link flow via
  // the first-party App/Browser plugins (src/services/googleAuthCapacitor.js).
  const capacitor = window.Capacitor;
  if (capacitor && typeof capacitor.isNativePlatform === 'function' && capacitor.isNativePlatform()) {
    const capAuthConfig = resolveCapacitorGoogleAuthConfig({ getPlatform: () => capacitor.getPlatform?.() });
    const appPlugin = capacitor.Plugins && capacitor.Plugins.App;
    const browserPlugin = capacitor.Plugins && capacitor.Plugins.Browser;
    if (!capAuthConfig.clientId || !appPlugin || !browserPlugin) return null;
    return createCapacitorAuthBridge({
      clientId: capAuthConfig.clientId,
      platform: capAuthConfig.platform,
      exchangeUrl: capAuthConfig.exchangeUrl,
      localStorage: window.localStorage,
      openBrowser: (options) => browserPlugin.open(options),
      closeBrowser: () => browserPlugin.close(),
      onUrlOpen: (handler) => {
        const subscription = appPlugin.addListener('appUrlOpen', handler);
        return () => subscription.then?.((s) => s.remove()) ?? subscription.remove?.();
      },
      onBrowserFinished: (handler) => {
        const subscription = browserPlugin.addListener('browserFinished', handler);
        return () => subscription.then?.((s) => s.remove()) ?? subscription.remove?.();
      }
    });
  }

  // Plain web/PWA: full-page redirect flow (src/services/googleAuthWeb.js).
  const webAuthConfig = resolveWebGoogleAuthConfig({});
  if (!webAuthConfig.clientId) return null;
  return createWebAuthBridge({
    clientId: webAuthConfig.clientId,
    exchangeUrl: webAuthConfig.exchangeUrl,
    origin: window.location.origin,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    navigate: (url) => window.location.assign(url),
    openWindow: (url) => window.open(url, '_blank', 'noopener'),
    getPath: () => window.location.pathname + window.location.search
  });
}

if (root) {
  const browserShell = new BrowserShell({
    container: root,
    platform: target,
    // The mini panel is a ~420px-wide window: the compact (mobile) layout
    // is the right chrome for it, while still using the native per-tab
    // WebContentsView engine through the same preload bridge.
    isMobile: isMiniShell || ['android', 'ios', 'pwa', 'pwa-installed'].includes(target),
    updateService: service,
    initialUrl: 'yayra://newtab'
  });
  browserShell.initialize().then(() => {
    browserShell.render(root);
  });

  if (!isMiniShell && ['ios', 'android', 'pwa-installed'].includes(target)) {
    mountMobileUpdatePrompt({
      root: document.body,
      promptSession: new PromptSession({ storage, platform: target === 'pwa-installed' ? 'pwa' : target }),
      service,
      config: DEFAULT_UPDATE_CONFIG
    });
    setTimeout(() => service.check({ manual: false }), 1500);
  }
}

if (!isMiniShell) registerPwaUpdateHandler(DEFAULT_UPDATE_CONFIG);

// Slim always-on-top chrome for the frameless mini window: a draggable
// titlebar with "open full browser" and "hide" controls wired to the
// overlay bridge (electron/overlayWindow.cjs IPC).
function mountMiniShellChrome() {
  const overlay = (window.yayra && window.yayra.overlay) || (window.ibrowse && window.ibrowse.overlay) || null;
  const style = document.createElement('style');
  style.textContent = '#app { height: calc(100vh - 30px) !important; margin-top: 30px !important; }';
  document.head.appendChild(style);
  const bar = document.createElement('div');
  bar.id = 'yayra-mini-titlebar';
  bar.style.cssText = [
    'position:fixed; top:0; left:0; right:0; z-index:100000; display:flex; align-items:center; gap:8px;',
    'height:30px; padding:0 8px; background:#141824; color:#dfe4ee; box-sizing:border-box;',
    'font:600 12px system-ui, sans-serif; user-select:none;',
    '-webkit-app-region:drag; border-bottom:1px solid rgba(255,255,255,0.08);'
  ].join(' ');
  const buttonCss = '-webkit-app-region:no-drag; border:none; background:transparent; color:#dfe4ee; cursor:pointer; font-size:13px; line-height:1; padding:4px 6px; border-radius:6px;';
  bar.innerHTML = '<span style="opacity:0.85;">yayra mini</span><span style="flex:1;"></span>'
    + `<button id="yayra-mini-expand" title="Open full browser" style="${buttonCss}">⤢</button>`
    + `<button id="yayra-mini-hide" title="Hide (click the bubble to bring back)" style="${buttonCss}">✕</button>`;
  document.body.prepend(bar);
  document.getElementById('yayra-mini-expand')?.addEventListener('click', () => overlay?.openFullFromMini?.());
  document.getElementById('yayra-mini-hide')?.addEventListener('click', () => overlay?.closeMini?.());
}

function getUpdateManifestUrl() {
  if (typeof location !== 'undefined' && location.hostname === 'yayra.pages.dev') {
    return 'https://yayra-updates-api.g2code335.workers.dev/updates/manifest.json';
  }
  return '/updates/manifest.json';
}

function detectTarget() {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) return 'pwa-installed';
  if (typeof navigator !== 'undefined' && navigator.standalone) return 'pwa-installed';
  if (/Linux/i.test(ua)) return 'linux';
  if (/Windows/i.test(ua)) return 'windows';
  return 'pwa';
}

function ensureDeviceId(storage) {
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  storage.setItem('yayra:device-id', id);
  return id;
}

async function registerPwaUpdateHandler(config) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('./sw.js');

    // Tell the freshly installed worker to take over. Without this the new
    // version sits in "waiting" forever (reloads keep serving the OLD
    // cache), which is why updates used to feel broken on web/PWA. Once it
    // activates, the controllerchange listener below reloads exactly once.
    const activateWaiting = (worker) => {
      const target = worker || registration.waiting;
      if (!target) return false;
      try { target.postMessage({ type: 'SKIP_WAITING' }); } catch { return false; }
      return true;
    };
    // Manual hook: the in-shell "Update" button calls this before its own
    // reload so the new service worker actually takes effect.
    window.__yayraApplyPwaUpdate = () => activateWaiting(null);

    const announce = (worker) => {
      if (config.pwa.reloadStrategy === 'auto') { activateWaiting(worker); return; }
      const toast = document.getElementById('toast');
      if (toast) toast.textContent = 'Update ready to reload.';
      let ok = true;
      try {
        if (typeof window.confirm === 'function') {
          ok = window.confirm('A new version of Yayra is ready. Reload now to update?');
        }
      } catch { /* blocked dialogs must not stall the update path */ }
      if (ok) activateWaiting(worker);
      // Declined: the waiting worker stays staged; the in-shell Update
      // button (via __yayraApplyPwaUpdate) or the next visit applies it.
    };

    // A worker may already be stuck waiting from a previous visit.
    if (registration.waiting && navigator.serviceWorker.controller) announce(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) announce(worker);
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => reloadExactlyOnce('controllerchange'));

    // Yayra is a long-lived SPA: browsers only recheck sw.js on page
    // navigations, so poll periodically and when the tab regains focus.
    const recheck = () => { registration.update().catch(() => {}); };
    const intervalMinutes = Math.min(Math.max(Number(config.checkIntervalMinutes) || 720, 15), 60);
    setInterval(recheck, intervalMinutes * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') recheck();
    });
  } catch (err) {
    // Ignore worker registration errors in testing/non-HTTPS environments
  }
}

function reloadExactlyOnce(key) {
  if (typeof sessionStorage === 'undefined') return;
  const reloadKey = `yayra:pwa-reloaded:${key}`;
  if (sessionStorage.getItem(reloadKey)) return;
  sessionStorage.setItem(reloadKey, '1');
  location.reload();
}
