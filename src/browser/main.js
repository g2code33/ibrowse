import { DEFAULT_UPDATE_CONFIG } from '../config/updates.js';
import { MemoryStorage, PromptSession, UpdateService } from '../services/updateService.js';
import { mountUpdateButton } from './updateButton.js';
import { mountMobileUpdatePrompt } from './mobilePrompt.js';
import { BrowserShell } from '../../packages/shared-ui/src/components/BrowserShell.js';

const root = document.getElementById('app');
const header = document.getElementById('top-header');
const target = detectTarget();
const installedVersion = document.documentElement.dataset.version || '0.1.0';
const storage = globalThis.localStorage || new MemoryStorage();
const service = new UpdateService({
  target,
  installedVersion,
  manifestUrl: '/updates/manifest.json',
  deviceId: storage.getItem('yayra:device-id') || ensureDeviceId(storage),
  storage,
  config: DEFAULT_UPDATE_CONFIG,
  telemetry: (event) => navigator.sendBeacon?.('/telemetry/updates', JSON.stringify(event))
});

if (header && !['ios', 'android', 'pwa-installed'].includes(target)) {
  mountUpdateButton({ root: header, service, config: DEFAULT_UPDATE_CONFIG });
}

if (root) {
  const browserShell = new BrowserShell({
    container: root,
    platform: target,
    isMobile: ['android', 'ios', 'pwa-installed'].includes(target),
    updateService: service,
    initialUrl: 'yayra://newtab'
  });
  browserShell.initialize().then(() => {
    browserShell.render(root);
  });

  if (['ios', 'android', 'pwa-installed'].includes(target)) {
    mountMobileUpdatePrompt({
      root: document.body,
      promptSession: new PromptSession({ storage, platform: target === 'pwa-installed' ? 'pwa' : target }),
      service,
      config: DEFAULT_UPDATE_CONFIG
    });
    setTimeout(() => service.check({ manual: false }), 1500);
  }
}

registerPwaUpdateHandler(DEFAULT_UPDATE_CONFIG);

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
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          const toast = document.getElementById('toast');
          if (toast) toast.textContent = 'Update ready to reload.';
          if (config.pwa.reloadStrategy === 'auto') reloadExactlyOnce(worker.scriptURL);
        }
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => reloadExactlyOnce('controllerchange'));
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
