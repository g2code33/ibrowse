import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

import { BrowserShell } from '../packages/shared-ui/src/components/BrowserShell.js';

/**
 * Android/iOS (Capacitor) run the whole app - including BrowserShell.js -
 * inside ONE system WebView. A nested <iframe> inside that WebView is
 * subject to the exact same X-Frame-Options/frame-ancestors restrictions a
 * desktop browser tab would see, and Google/Apple/Microsoft refuse to
 * complete sign-in inside ANY embedded webview on mobile too - not just
 * Electron. These tests cover the Capacitor-side handoff, which mirrors the
 * Electron main-process handoff in electron/webviewBridge.cjs without
 * requiring a real Android/iOS runtime (unavailable in this environment -
 * see the test names for what is and is not exercised).
 */

function installFakeCapacitorBrowser() {
  const opened = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      Browser: {
        open: (opts) => { opened.push(opts.url); return Promise.resolve(); }
      }
    }
  };
  return { opened, uninstall: () => { delete window.Capacitor; } };
}

test('capacitorBrowser getter: absent on plain web/PWA (no window.Capacitor)', async () => {
  delete globalThis.window.Capacitor;
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, platform: 'android', isMobile: true });
  await shell.initialize();
  assert.equal(shell.capacitorBrowser, null);
});

test('capacitorBrowser getter: absent when Capacitor is present but running in a plain mobile web browser tab (isNativePlatform() false)', async () => {
  window.Capacitor = { isNativePlatform: () => false, Plugins: { Browser: { open: async () => {} } } };
  try {
    const container = document.createElement('div');
    const shell = new BrowserShell({ container, platform: 'android', isMobile: true });
    await shell.initialize();
    assert.equal(shell.capacitorBrowser, null);
  } finally {
    delete window.Capacitor;
  }
});

test('isSystemBrowserAuthHost: matches the same identity-provider hosts as the Electron bridge', async () => {
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, platform: 'android', isMobile: true });
  await shell.initialize();

  assert.equal(shell.isSystemBrowserAuthHost('https://accounts.google.com/signin'), true);
  assert.equal(shell.isSystemBrowserAuthHost('https://appleid.apple.com/auth'), true);
  assert.equal(shell.isSystemBrowserAuthHost('https://sub.login.microsoftonline.com/'), true);
  assert.equal(shell.isSystemBrowserAuthHost('https://www.google.com/search?q=ghana'), false);
});

test('Capacitor (Android/iOS): navigating to a sign-in host opens the native in-app browser instead of an embedded iframe', async () => {
  const { opened, uninstall } = installFakeCapacitorBrowser();
  try {
    const container = document.createElement('div');
    const shell = new BrowserShell({ container, platform: 'android', isMobile: true });
    await shell.initialize();

    shell.navigateActiveTab('https://accounts.google.com/signin/v2/identifier');
    const el = shell.rootElement;

    assert.equal(el.querySelector('iframe'), null, 'sign-in is never embedded in an iframe on Capacitor either');
    // Allow the openExternally() promise microtask to resolve.
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(opened, ['https://accounts.google.com/signin/v2/identifier']);
  } finally {
    uninstall();
  }
});

test('Capacitor (Android/iOS): a google SEARCH renders real results in-app (embeddable DDG frame + banner) - searches are never a dead card', async () => {
  const { opened, uninstall } = installFakeCapacitorBrowser();
  try {
    const container = document.createElement('div');
    const shell = new BrowserShell({ container, platform: 'android', isMobile: true });
    await shell.initialize();

    shell.navigateActiveTab('https://www.google.com/search?q=ghana');
    const el = shell.rootElement;

    const frame = el.querySelector('iframe');
    assert.ok(frame, 'search results ARE rendered in-app');
    assert.equal(frame.src, 'https://lite.duckduckgo.com/lite/?q=ghana', 'same query, embeddable engine');
    assert.ok(el.querySelector('.fb-frame-serp-banner'), 'honest banner about the engine swap');
    assert.equal(el.querySelector('.fb-frame-blocked-fallback'), null, 'no dead blocked-card for searches');

    // The banner's button hands the ORIGINAL Google URL to the native
    // secure browser view.
    el.querySelector('.fb-serp-open-original').click();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(opened, ['https://www.google.com/search?q=ghana']);
  } finally {
    uninstall();
  }
});

test('Capacitor (Android/iOS): a frame-hostile NON-search site (google.com homepage) auto-opens in the native secure browser view, card stays with Open again', async () => {
  const { opened, uninstall } = installFakeCapacitorBrowser();
  try {
    const container = document.createElement('div');
    const shell = new BrowserShell({ container, platform: 'android', isMobile: true });
    await shell.initialize();

    shell.navigateActiveTab('https://www.google.com/');
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(opened, ['https://www.google.com/'], 'the user asked for google.com, so google.com OPENS - automatically');

    const el = shell.rootElement;
    const openBtn = el.querySelector('.fb-frame-blocked-open-btn');
    assert.ok(openBtn, 'fallback card remains behind with a re-open action');
    openBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(opened, ['https://www.google.com/', 'https://www.google.com/']);
  } finally {
    uninstall();
  }
});

test('Plain web/PWA (no Capacitor, no Electron): sign-in host handoff falls back to window.open', async () => {
  delete globalThis.window.Capacitor;
  const originalOpen = window.open;
  const openedUrls = [];
  window.open = (url) => { openedUrls.push(url); };
  try {
    const container = document.createElement('div');
    const shell = new BrowserShell({ container, platform: 'linux', isMobile: false });
    await shell.initialize();

    shell.navigateActiveTab('https://accounts.google.com/signin');
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(openedUrls, ['https://accounts.google.com/signin']);
  } finally {
    window.open = originalOpen;
  }
});
