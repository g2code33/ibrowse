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
    res.writeHead(200, { 'Content-Type': 'application/json' });
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

  // Static file serving from workspace
  let filePath = path.join(rootDir, reqPath);
  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

function serveBrowserApp(res) {
  const html = `<!DOCTYPE html>
<html lang="en" data-theme="dark" data-version="0.1.0">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>yayra — Fast, Private Floating Browser</title>
  <link rel="icon" sizes="32x32" href="/public/favicon-32x32.png">
  <link rel="stylesheet" href="/packages/shared-ui/src/theme/design-system.css">
  <link rel="stylesheet" href="/packages/shared-ui/src/glassmorphism.css">
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
  <div id="app"></div>

  <script type="module">
    import { BrowserShell } from '/packages/shared-ui/src/components/BrowserShell.js';

    const root = document.getElementById('app');
    const shell = new BrowserShell({
      container: root,
      initialUrl: 'yayra://newtab'
    });

    shell.initialize().then(() => {
      shell.render(root);
    });
  </script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

server.listen(PORT, HOST, () => {
  console.log(`Yayra FloatBrowse preview server listening on http://${HOST}:${PORT}`);
});
