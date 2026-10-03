import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');

test('official branding and universal suggestion placement use the uploaded assets', async () => {
  const icons = await read('packages/shared-ui/src/icons/icons.js');
  const index = await read('public/index.html');
  const manifest = await read('public/manifest.webmanifest');
  const devServer = await read('scripts/dev-server.mjs');
  const publicStyles = await read('public/styles.css');
  const main = await read('src/browser/main.js');
  const worker = await read('worker/update-worker.mjs');
  const workerConfig = await read('wrangler.worker.toml');
  const css = await read('packages/shared-ui/src/theme/design-system.css');
  assert.match(icons, /assets\/brand\/logomain1\.jpg/);
  assert.match(index, /assets\/brand\/logomain1\.jpg/);
  assert.match(manifest, /assets\/brand\/logomain1\.jpg/);
  assert.match(devServer, /assets\/brand\/logomain1\.jpg/);
  assert.doesNotMatch(devServer, /favicon-32x32|icons\/icon-192|icons\/icon-512/);
  assert.match(publicStyles, /#app\s*\{[\s\S]*max-width:\s*none/);
  assert.match(publicStyles, /#app \.fb-browser-shell\s*,?\s*\n?#app \.fb-browser-viewport/);
  assert.match(icons, /assets\/brand\/yayrawriing\.PNG/);
  assert.match(main, /https:\/\/updates\.yayra\.app\/updates\/manifest\.json/);
  assert.match(worker, /UPDATES_MANIFEST_JSON/);
  assert.match(workerConfig, /name\s*=\s*"yayra-updates-api"/);
  assert.match(workerConfig, /pattern\s*=\s*"updates\.yayra\.app"/);
  assert.match(css, /\.fb-search-suggestions\s*\{[\s\S]*bottom:\s*calc\(100% \+ 8px\)/);
  assert.match(css, /\.fb-newtab-searchbox \.fb-search-suggestions\s*\{[\s\S]*bottom:\s*calc\(100% \+ 10px\)/);
});

test('PWA and dev preview restrict pinch zoom and resize with the mobile keyboard', async () => {
  const index = await read('public/index.html');
  const devServer = await read('scripts/dev-server.mjs');
  const viewport = 'maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content';
  assert.ok(index.includes(viewport));
  assert.ok(devServer.includes(viewport));
});

test('real external website extension companion is a separate MV3 project', async () => {
  const manifest = JSON.parse(await read('extensions/yayra-companion/manifest.json'));
  const content = await read('extensions/yayra-companion/content.js');
  const rules = JSON.parse(await read('extensions/yayra-companion/rules/trackers.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes('declarativeNetRequest'));
  assert.ok(manifest.content_scripts.some((entry) => entry.matches.includes('<all_urls>')));
  assert.ok(content.includes('MutationObserver'));
  assert.ok(content.includes('darkReader'));
  assert.ok(rules.length >= 3);
});
