import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

import { BrowserShell } from '../packages/shared-ui/src/components/BrowserShell.js';

/**
 * Pins the three Android/web fixes:
 *  1. APK launcher logo: the COMPLETE adaptive icon set ships (foreground
 *     per density + round + legacy) and ensure-capacitor-platform.mjs
 *     installs every layer incl. the anydpi-v26 adaptive XMLs - on
 *     Android 8+ the adaptive XML wins over ic_launcher.png, which is
 *     exactly why the logo never showed before.
 *  2. Floating bubble overlay: after the user grants "Display over other
 *     apps" in system Settings, the bubble starts BY ITSELF - a grant
 *     watcher polls/listens and calls show() the moment permission lands.
 *  3. Google on Android/web: blocked Google/Bing/Yahoo SERPs render
 *     embeddable DuckDuckGo results for the SAME query in-app; other
 *     frame-blocked sites auto-open in the Capacitor secure browser view
 *     exactly once per tab+url.
 */

/* ------------------------- 1. launcher icons ------------------------- */

const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test('ICON FIX: every density ships ic_launcher + ic_launcher_round + ic_launcher_foreground as real PNGs', () => {
  for (const d of DENSITIES) {
    for (const f of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      const p = new URL(`../native-assets/android/mipmap-${d}/${f}`, import.meta.url).pathname;
      assert.equal(existsSync(p), true, `${d}/${f} exists`);
      const head = readFileSync(p).subarray(0, 4);
      assert.deepEqual(head, PNG_MAGIC, `${d}/${f} is a real PNG`);
    }
  }
});

test('ICON FIX: ensure-capacitor-platform installs the adaptive icon layers (anydpi-v26 XML + background colour + foreground copies)', () => {
  const src = readFileSync(new URL('../scripts/ensure-capacitor-platform.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('ic_launcher_foreground.png'), 'copies the adaptive foreground PNGs');
  assert.ok(src.includes('ic_launcher_round.png'), 'copies the round PNGs');
  assert.ok(src.includes('mipmap-anydpi-v26'), 'writes the adaptive icon XML directory');
  assert.ok(src.includes('@mipmap/ic_launcher_foreground'), 'adaptive XML references the brand foreground');
  assert.ok(src.includes('ic_launcher_background'), 'writes the brand background colour');
});

/* --------------------- 2. overlay grant watcher ---------------------- */

function makeShell({ platform = 'android' } = {}) {
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, platform, isMobile: true });
  shell.render(container);
  return { shell, container };
}

test('OVERLAY FIX: bubble starts BY ITSELF once "Display over other apps" is granted in Settings (grant watcher)', async () => {
  let granted = false;
  const calls = { show: 0, request: 0 };
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      YayraOverlay: {
        isSupported: async () => ({ supported: true }),
        hasPermission: async () => ({ granted }),
        requestPermission: async () => { calls.request += 1; return { granted }; },
        show: async () => { calls.show += 1; },
        hide: async () => {}
      }
    }
  };
  const { shell } = makeShell();
  try {
    const first = await shell.ensureSystemOverlayBubble();
    assert.equal(first, false, 'not granted yet - cannot show');
    assert.equal(calls.request, 1, 'user sent to the system Settings page');
    assert.equal(calls.show, 0);
    assert.equal(shell._overlayGrantWatchActive, true, 'grant watcher armed');

    // User grants the permission on the Settings page...
    granted = true;
    // ...the bounded 1.5s poll notices and starts the bubble on its own.
    await new Promise((r) => setTimeout(r, 1700));
    // The shell's own startup re-ensure may land a second show() alongside
    // the watcher's - harmless (the native service/bubble attach is
    // idempotent); what matters is it fired WITHOUT any extra user action.
    assert.ok(calls.show >= 1, 'show() fired WITHOUT any extra user action');
    assert.equal(shell.state.systemBubbleActive, true, 'bubble state active');
    assert.equal(shell._overlayGrantWatchActive, false, 'watcher stood down after the grant');
  } finally {
    shell.destroy();
    delete window.Capacitor;
  }
});

test('OVERLAY FIX: watcher is idempotent and destroy() stops it (no leaked intervals)', async () => {
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      YayraOverlay: {
        hasPermission: async () => ({ granted: false }),
        requestPermission: async () => ({ granted: false }),
        show: async () => {}
      }
    }
  };
  const { shell } = makeShell();
  try {
    await shell.ensureSystemOverlayBubble();
    shell._watchOverlayPermissionGrant();
    shell._watchOverlayPermissionGrant(); // second arm is a no-op
    assert.equal(shell._overlayGrantWatchActive, true);
  } finally {
    shell.destroy();
    assert.equal(shell._overlayGrantWatchActive, false, 'destroy() stopped the watcher');
    delete window.Capacitor;
  }
});

/* ------------------- 3. Google on Android and web -------------------- */

test('GOOGLE FIX: search urls from every major engine are recognised (engine + query)', () => {
  const { shell } = makeShell();
  const g = shell.getSearchIntent('https://www.google.com/search?q=accra%20weather');
  assert.ok(g, 'google SERP recognised');
  assert.equal(g.engine, 'Google');
  assert.equal(g.query, 'accra weather');
  assert.equal(shell.getSearchIntent('https://www.bing.com/search?q=yayra').engine, 'Bing');
  assert.equal(shell.getSearchIntent('https://search.yahoo.com/search?p=kimi%20k3').query, 'kimi k3');
  assert.equal(shell.getSearchIntent('https://www.startpage.com/do/dsearch?query=privacy').engine, 'Startpage');
  assert.equal(shell.getSearchIntent('https://duckduckgo.com/?q=embeddable').engine, 'DuckDuckGo');
  assert.equal(shell.getSearchIntent('https://www.google.com/'), null, 'google homepage is NOT a SERP');
  assert.equal(shell.getSearchIntent('https://example.com/search?q=x'), null, 'unknown hosts untouched');
  shell.destroy();
});

test('GOOGLE FIX (Oct 2026): no engine allows embedded results anymore - a search OPENS outside the frame, never a dead DDG iframe', async () => {
  // VERIFIED: lite.duckduckgo.com and html.duckduckgo.com now send
  // X-Frame-Options: SAMEORIGIN + CSP frame-ancestors 'self' - the old
  // "render DuckDuckGo results in the frame" fallback produced a blank
  // refused frame ("the website is not working for google").
  const opened = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { Browser: { open: async ({ url }) => { opened.push(url); } } }
  };
  const { shell } = makeShell();
  try {
    const { wrapper, iframe } = shell.createWebContentFrame('https://www.google.com/search?q=ghana', { tabId: 'tab-s1', allowNative: false });
    assert.equal(iframe, null, 'no embedded results frame (every engine refuses framing now)');
    await Promise.resolve();
    assert.deepEqual(opened, ['https://www.google.com/search?q=ghana'],
      'the REAL google search opens in the secure browser view');
    const card = wrapper.querySelector('.fb-serp-handoff-fallback');
    assert.ok(card, 'honest search-handoff card stays in the tab');
    assert.match(card.querySelector('.fb-frame-blocked-open-btn').textContent, /Open search/);

    // Re-render of the same tab+url must NOT reopen.
    shell.createWebContentFrame('https://www.google.com/search?q=ghana', { tabId: 'tab-s1', allowNative: false });
    await Promise.resolve();
    assert.equal(opened.length, 1, 'strictly once per tab+url');
  } finally {
    shell.destroy();
    delete window.Capacitor;
  }
});

test('GOOGLE FIX (web): the search handoff never dead-ends without Capacitor - one click always opens it', () => {
  delete window.Capacitor;
  const { shell } = makeShell({ platform: 'linux' });
  const { wrapper, iframe } = shell.createWebContentFrame('https://www.google.com/search?q=accra', { tabId: 'tab-s2', allowNative: false });
  assert.equal(iframe, null);
  const card = wrapper.querySelector('.fb-serp-handoff-fallback');
  assert.ok(card, 'search-handoff card shown');
  assert.match(card.querySelector('.fb-frame-blocked-open-btn').textContent, /Open search/);
  shell.destroy();
});

test('GOOGLE FIX: on Capacitor, google.com (and other blocked sites) AUTO-OPEN in the secure browser view exactly once per tab+url', async () => {
  const opened = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { Browser: { open: async ({ url }) => { opened.push(url); } } }
  };
  const { shell } = makeShell();
  try {
    const first = shell.createWebContentFrame('https://www.google.com/', { tabId: 'tab-1', allowNative: false });
    await Promise.resolve();
    assert.deepEqual(opened, ['https://www.google.com/'], 'opened automatically - the user asked for google, google opens');
    const card = first.wrapper.querySelector('.fb-frame-blocked-fallback');
    assert.ok(card, 'card remains behind the custom tab');
    assert.ok(card.querySelector('.fb-frame-blocked-open-btn'), 'with an Open-again button');

    // Re-render of the same tab+url must NOT reopen the custom tab.
    shell.createWebContentFrame('https://www.google.com/', { tabId: 'tab-1', allowNative: false });
    await Promise.resolve();
    assert.equal(opened.length, 1, 'strictly once per tab+url');

    // A different tab may open it again.
    shell.createWebContentFrame('https://www.google.com/', { tabId: 'tab-2', allowNative: false });
    await Promise.resolve();
    assert.equal(opened.length, 2);
  } finally {
    shell.destroy();
    delete window.Capacitor;
  }
});

test('GOOGLE FIX: on plain web (no Capacitor) blocked sites keep the explicit open-in-new-tab card (popup blockers forbid auto-open)', () => {
  delete window.Capacitor;
  const { shell } = makeShell({ platform: 'linux' });
  const { wrapper, iframe } = shell.createWebContentFrame('https://www.facebook.com/', { tabId: 'tab-9', allowNative: false });
  assert.equal(iframe, null);
  const card = wrapper.querySelector('.fb-frame-blocked-fallback');
  assert.ok(card, 'card shown');
  assert.match(card.querySelector('.fb-frame-blocked-open-btn').textContent, /Open in new tab/);
  shell.destroy();
});
