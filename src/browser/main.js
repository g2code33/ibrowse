import { DEFAULT_UPDATE_CONFIG } from '../config/updates.js';
import { MemoryStorage, PromptSession, UpdateService } from '../services/updateService.js';
import { mountUpdateButton } from './updateButton.js';
import { mountMobileUpdatePrompt } from './mobilePrompt.js';
import { mountAdminUpdatesPanel } from './adminUpdatesPanel.js';
import { mountAbout } from './about.js';

const root = document.getElementById('app');
const header = document.getElementById('top-header');
const target = detectTarget();
const installedVersion = document.documentElement.dataset.version || '0.1.0';
const storage = globalThis.localStorage || new MemoryStorage();
const service = new UpdateService({
  target,
  installedVersion,
  manifestUrl: '/updates/manifest.json',
  deviceId: storage.getItem('ibrowse:device-id') || ensureDeviceId(storage),
  storage,
  config: DEFAULT_UPDATE_CONFIG,
  telemetry: (event) => navigator.sendBeacon?.('/telemetry/updates', JSON.stringify(event))
});

if (header && !['ios', 'android', 'pwa-installed'].includes(target)) {
  mountUpdateButton({ root: header, service, config: DEFAULT_UPDATE_CONFIG });
}

if (root) {
  root.innerHTML = '<h1>ibrowse</h1><p>A web-first shell with release/update infrastructure ready for prompts.</p><div id="toast" role="status" aria-live="polite"></div>';
  mountAbout({ root });
  mountAdminUpdatesPanel({ root, config: DEFAULT_UPDATE_CONFIG, latest: { windows: installedVersion, linux: installedVersion, ios: installedVersion, android: installedVersion, pwa: installedVersion } });
  if (['ios', 'android', 'pwa-installed'].includes(target)) {
    mountMobileUpdatePrompt({ root: document.body, promptSession: new PromptSession({ storage, platform: target === 'pwa-installed' ? 'pwa' : target }), service, config: DEFAULT_UPDATE_CONFIG });
    setTimeout(() => service.check({ manual: false }), 1500);
  }
}

registerPwaUpdateHandler(DEFAULT_UPDATE_CONFIG);

function detectTarget() {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) return 'pwa-installed';
  if (/Linux/i.test(ua)) return 'linux';
  if (/Windows/i.test(ua)) return 'windows';
  return 'pwa';
}

function ensureDeviceId(storage) {
  const id = crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  storage.setItem('ibrowse:device-id', id);
  return id;
}

async function registerPwaUpdateHandler(config) {
  if (!('serviceWorker' in navigator)) return;
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
}

function reloadExactlyOnce(key) {
  const reloadKey = `ibrowse:pwa-reloaded:${key}`;
  if (sessionStorage.getItem(reloadKey)) return;
  sessionStorage.setItem(reloadKey, '1');
  location.reload();
}
