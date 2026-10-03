const BUILD_VERSION = '__BUILD_VERSION__';
const BUILD_HASH = '__BUILD_SHA__';
const CACHE_NAME = `yayra-${BUILD_VERSION}-${BUILD_HASH}`;
const PRECACHE = __PRECACHE_MANIFEST__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('yayra-') && key !== CACHE_NAME).map((key) => caches.delete(key)))));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.pathname.endsWith('/updates/manifest.json')) return;
  if (request.method !== 'GET') return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});

self.__YAYRA_BUILD = { version: BUILD_VERSION, hash: BUILD_HASH, precache: PRECACHE };
