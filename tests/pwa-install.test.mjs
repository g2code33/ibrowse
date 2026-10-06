import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isPngBuffer,
  isIcoBuffer,
  extractManifestLink,
  parseManifest,
  pickManifestIcon,
  resolveStartUrl,
  pickInstallIdentity,
  pngToIco
} = require('../electron/pwaManifest.cjs');

/**
 * THE REQUIREMENT: "the install as an app must install a PWA OF THAT
 * SITE the user is on to the desktop of the user's PC" - the site's OWN
 * name, OWN icon and OWN start url on the desktop, exactly like Chrome's
 * install. This suite pins the pure identity pipeline
 * (electron/pwaManifest.cjs) and its wiring in electron/main.cjs.
 */

const PAGE = 'https://app.example.com/dashboard';
const MANIFEST_URL = 'https://app.example.com/manifest.webmanifest';

test('extractManifestLink: finds the manifest link in every real-world form', () => {
  assert.equal(
    extractManifestLink('<link rel="manifest" href="/manifest.webmanifest">', PAGE),
    'https://app.example.com/manifest.webmanifest'
  );
  assert.equal(
    extractManifestLink("<link rel='manifest' href='https://cdn.example.com/m.json'>", PAGE),
    'https://cdn.example.com/m.json'
  );
  // attribute order reversed + extra attributes
  assert.equal(
    extractManifestLink('<link href="/m.json" rel="manifest" crossorigin="use-credentials">', PAGE),
    'https://app.example.com/m.json'
  );
  // other links must not confuse it
  assert.equal(
    extractManifestLink('<link rel="icon" href="/favicon.ico"><link rel="manifest" href="/m.json">', PAGE),
    'https://app.example.com/m.json'
  );
  assert.equal(extractManifestLink('<link rel="icon" href="/favicon.ico">', PAGE), null, 'no manifest -> null');
  assert.equal(extractManifestLink('<link rel="manifest" href="javascript:alert(1)">', PAGE), null, 'non-http schemes rejected');
  assert.equal(extractManifestLink('', PAGE), null);
});

test('parseManifest: safe parse - garbage and non-objects are null', () => {
  assert.deepEqual(parseManifest('{"name":"X","icons":[]}'), { name: 'X', icons: [] });
  assert.equal(parseManifest('not json {'), null);
  assert.equal(parseManifest('[1,2,3]'), null);
  assert.equal(parseManifest('null'), null);
});

test('pickManifestIcon: chooses the LARGEST usable raster icon and resolves it absolutely', () => {
  const manifest = {
    icons: [
      { src: 'icons/tiny.png', sizes: '48x48', type: 'image/png' },
      { src: '/icons/big.png', sizes: '512x512', type: 'image/png' },
      { src: 'icons/vector.svg', sizes: 'any', type: 'image/svg+xml' } // skipped: not rasterizable
    ]
  };
  const icon = pickManifestIcon(manifest, MANIFEST_URL);
  assert.ok(icon, 'an icon is chosen');
  assert.equal(icon.src, 'https://app.example.com/icons/big.png');
  assert.equal(icon.width, 512);
  // SVG alone -> no usable icon
  assert.equal(pickManifestIcon({ icons: [{ src: 'a.svg', sizes: 'any' }] }, MANIFEST_URL), null);
  // monochrome-only icons are for UI tinting, not launchers
  assert.equal(pickManifestIcon({ icons: [{ src: 'm.png', sizes: '192x192', purpose: 'monochrome' }] }, MANIFEST_URL), null);
  // maskable icons ARE launcher icons
  assert.ok(pickManifestIcon({ icons: [{ src: 'm.png', sizes: '192x192', purpose: 'maskable' }] }, MANIFEST_URL));
  // sizes: "any" counts as scalable
  const any = pickManifestIcon({ icons: [{ src: 'any.png', sizes: 'any', type: 'image/png' }] }, MANIFEST_URL);
  assert.equal(any.src, 'https://app.example.com/any.png');
  assert.equal(pickManifestIcon({ icons: [] }, MANIFEST_URL), null);
  assert.equal(pickManifestIcon({}, MANIFEST_URL), null);
});

test('resolveStartUrl: the manifest start url resolved per spec, honest fallbacks', () => {
  assert.equal(
    resolveStartUrl({ start_url: '/home?src=pwa' }, MANIFEST_URL, PAGE),
    'https://app.example.com/home?src=pwa'
  );
  assert.equal(
    resolveStartUrl({ start_url: 'https://other.example/start' }, MANIFEST_URL, PAGE),
    'https://other.example/start'
  );
  assert.equal(resolveStartUrl({}, MANIFEST_URL, PAGE), PAGE, 'no start_url -> the page itself');
  assert.equal(resolveStartUrl({ start_url: 'javascript:alert(1)' }, MANIFEST_URL, PAGE), PAGE, 'unsafe scheme -> the page itself');
});

test('pickInstallIdentity: the SITE\u2019S OWN name/icon; honest fallbacks for non-PWA sites', () => {
  const pwa = pickInstallIdentity({
    manifest: { short_name: 'Tasks', name: 'Tasks Pro Example', icons: [{ src: '/i.png', sizes: '192x192' }], start_url: '/app', display: 'standalone', theme_color: '#123456' },
    manifestUrl: MANIFEST_URL,
    pageUrl: PAGE,
    pageTitle: 'Some page title'
  });
  assert.equal(pwa.name, 'Tasks', 'short_name wins (the launcher-appropriate name)');
  assert.equal(pwa.startUrl, 'https://app.example.com/app');
  assert.equal(pwa.iconSrc, 'https://app.example.com/i.png');
  assert.equal(pwa.display, 'standalone');
  assert.equal(pwa.themeColor, '#123456');
  assert.equal(pwa.pwa, true, 'manifest name + icon = a true PWA install');

  const nameOnly = pickInstallIdentity({ manifest: { name: 'No Icons Inc' }, manifestUrl: MANIFEST_URL, pageUrl: PAGE, pageTitle: 'T' });
  assert.equal(nameOnly.pwa, false, 'no usable icon -> not a PWA-branded install');
  assert.equal(nameOnly.name, 'No Icons Inc');

  const plain = pickInstallIdentity({ manifest: null, manifestUrl: null, pageUrl: PAGE, pageTitle: 'My Site' });
  assert.equal(plain.name, 'My Site', 'page title used for plain sites');
  assert.equal(plain.startUrl, PAGE);
  assert.equal(plain.pwa, false);

  const bare = pickInstallIdentity({ manifest: null, manifestUrl: null, pageUrl: PAGE, pageTitle: '' });
  assert.equal(bare.name, 'app.example.com', 'hostname is the last resort');
});

test('pngToIco: a valid ICO container around the PNG (Windows .lnk icons need .ico)', () => {
  // Minimal structural PNG: signature + IHDR with 512x512.
  const png = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8);              // IHDR length
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(512, 16);            // width
  png.writeUInt32BE(512, 20);            // height
  const ico = pngToIco(png);
  assert.equal(ico.readUInt16LE(0), 0, 'reserved');
  assert.equal(ico.readUInt16LE(2), 1, 'type: icon');
  assert.equal(ico.readUInt16LE(4), 1, 'one image');
  assert.equal(ico.readUInt8(6), 0, 'width 512 encodes as 0 (256+)');
  assert.equal(ico.readUInt8(7), 0, 'height 512 encodes as 0 (256+)');
  assert.equal(ico.readUInt16LE(10), 1, 'planes');
  assert.equal(ico.readUInt16LE(12), 32, 'bpp');
  assert.equal(ico.readUInt32LE(14), png.length, 'payload size');
  assert.equal(ico.readUInt32LE(18), 22, 'payload offset');
  assert.ok(ico.slice(22).equals(png), 'PNG payload intact');
  // Small icon: dimensions encoded directly.
  png.writeUInt32BE(48, 16);
  png.writeUInt32BE(48, 20);
  const small = pngToIco(png);
  assert.equal(small.readUInt8(6), 48);
  assert.equal(small.readUInt8(7), 48);
  // Non-PNG input is rejected loudly (callers fall back honestly).
  assert.throws(() => pngToIco(Buffer.from('not a png')));
});

test('magic-byte guards: Content-Type is never trusted', () => {
  const png = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  assert.equal(isPngBuffer(png), true);
  assert.equal(isIcoBuffer(png), false);
  const ico = Buffer.alloc(32);
  Buffer.from([0x00, 0x00, 0x01, 0x00]).copy(ico, 0);
  assert.equal(isIcoBuffer(ico), true);
  assert.equal(isPngBuffer(ico), false);
  assert.equal(isPngBuffer(null), false);
  assert.equal(isIcoBuffer(Buffer.alloc(4)), false);
});

test('WIRING (source pin): main.cjs runs the full identity pipeline and never blocks the install', () => {
  const src = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  assert.match(src, /require\('\.\/pwaManifest\.cjs'\)/, 'the pure module is loaded');
  const fn = src.indexOf('async function resolvePwaInstallIdentity');
  assert.ok(fn > -1, 'identity resolver exists');
  const block = src.slice(fn, src.indexOf('\n}', fn));
  assert.match(block, /extractManifestLink/, 'page HTML is scanned for the manifest');
  assert.match(block, /parseManifest/, 'the manifest is parsed');
  assert.match(block, /pickInstallIdentity/, 'the identity (name/icon/start url) is picked');
  assert.match(block, /pwa-icons/, 'the site\\u2019s own icon is stored under userData/pwa-icons');
  assert.match(block, /pngToIco/, 'PNG icons are wrapped into .ico for Windows .lnk');
  assert.match(block, /favicon\.ico/, 'non-PWA sites get their favicon.ico on Windows');
  assert.match(block, /AbortController/, 'every fetch is time-boxed - a slow site never blocks the install');
  assert.match(block, /catch \(err\)/, 'any failure is caught');
  assert.match(block, /return fallback/, 'the pipeline degrades to a plain install, never fails');
  // The handler wires it all into the install plan.
  const h = src.indexOf("ipcMain.handle('yayra:install-page-as-app'");
  const hblock = src.slice(h, h + 2000);
  assert.match(hblock, /async \(_event/, 'handler is async');
  assert.match(hblock, /await resolvePwaInstallIdentity/, 'identity resolved before planning');
  assert.match(hblock, /url: identity\.startUrl/, 'the PWA start url is what gets installed');
  assert.match(hblock, /title: identity\.name/, "the PWA's own name is the launcher name");
  assert.match(hblock, /iconPath = identity\.iconFile/, "the PWA's own icon is the launcher icon");
});

test('WIRING (source pin): the renderer announces a true PWA install as such', () => {
  const src = readFileSync(new URL('../packages/shared-ui/src/components/BrowserShell.js', import.meta.url), 'utf8');
  assert.match(src, /res\.pwa/, 'the pwa flag is consumed');
  assert.match(src, /its own icon is on your desktop/, 'the success message says it is the site\\u2019s own app');
});
