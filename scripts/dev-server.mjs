import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // Allow all hosts and iframe embedding for preview
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '/index.html') {
    serveBrowserApp(res);
    return;
  }

  if (reqPath === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      app: 'Yayra FloatBrowse',
      version: '0.1.0',
      status: 'operational',
      ui: 'Browser-First (Chrome Desktop & Safari Mobile Layout)',
      desktopModes: ['circle-first', 'browser-first'],
      displaySession: process.env.WAYLAND_DISPLAY ? 'Wayland' : 'X11',
      time: new Date().toISOString()
    }));
    return;
  }

  // Give the live preview a root-scoped manifest so the current dev app can
  // be installed as a PWA without pretending it is a release deployment.
  if (reqPath === '/manifest.webmanifest') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' });
    res.end(JSON.stringify({
      name: 'yayra dev preview',
      short_name: 'yayra dev',
      id: '/?dev=yayra',
      start_url: '/?dev=yayra',
      scope: '/',
      display: 'standalone',
      background_color: '#060b19',
      theme_color: '#172554',
      icons: [
        { src: '/public/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/public/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    }));
    return;
  }

  // Static file serving from workspace
  let filePath = path.join(rootDir, reqPath);
  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const requestedFile = stats.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    fs.stat(requestedFile, (fileErr, fileStats) => {
      if (fileErr || !fileStats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const ext = path.extname(requestedFile).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store, max-age=0' });
      fs.createReadStream(requestedFile).pipe(res);
    });
  });
});

function serveBrowserApp(res) {
  // Query-bust the entry module as an extra guard against a stale preview or
  // an older service worker that cached the previous dev shell.
  const devToken = Date.now().toString(36);
  const html = `<!DOCTYPE html>
<html lang="en" data-theme="dark" data-version="dev">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content">
  <meta name="theme-color" content="#172554">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" type="image/jpeg" href="/assets/brand/mainlogo.JPG">
  <link rel="icon" sizes="32x32" href="/public/favicon-32x32.png">
  <link rel="stylesheet" href="/packages/shared-ui/src/theme/design-system.css?dev=${devToken}">
  <link rel="stylesheet" href="/packages/shared-ui/src/glassmorphism.css?dev=${devToken}">
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #060b19;
      color: #f8fafc;
      font-family: Inter, system-ui, -apple-system, sans-serif;
    }
    #top-header {
      display: none;
    }
    #app {
      width: 100%;
      height: 100%;
      display: flex;
    }
  </style>
</head>
<body>
  <header id="top-header" class="top-header" aria-label="Application header"></header>
  <main id="app"></main>

  <script type="module">
    // Remove a release PWA worker from this preview origin before importing
    // source modules. This prevents an old precache from masking live edits.
    window.__YAYRA_DEV__ = true;
    const registrations = 'serviceWorker' in navigator
      ? await navigator.serviceWorker.getRegistrations()
      : [];
    const hadOldWorker = registrations.length > 0 || Boolean(navigator.serviceWorker?.controller);
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if (globalThis.caches) {
      await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
    }
    if (hadOldWorker && !sessionStorage.getItem('yayra-dev-worker-cleared')) {
      sessionStorage.setItem('yayra-dev-worker-cleared', '1');
      location.reload();
    } else {
      const { BrowserShell } = await import('/packages/shared-ui/src/components/BrowserShell.js?dev=${devToken}');
      const root = document.getElementById('app');
      const shell = new BrowserShell({ container: root, initialUrl: 'yayra://newtab' });
      await shell.initialize();
      shell.render(root);
    }
  </script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' });
  res.end(html);
}

server.listen(PORT, HOST, () => {
  console.log(`Yayra FloatBrowse preview server listening on http://${HOST}:${PORT}`);
});
