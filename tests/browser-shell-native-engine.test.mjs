import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

import { BrowserShell } from '../packages/shared-ui/src/components/BrowserShell.js';

/**
 * Covers the renderer half of the native website-rendering engine (see
 * electron/webviewBridge.cjs for the main-process half). These tests verify
 * that:
 *  - without window.yayra.webview (plain web/PWA tab, or Android/iOS
 *    Capacitor WebView), the pre-existing <iframe> fallback renderer is used
 *    unchanged;
 *  - with window.yayra.webview present (Electron desktop), the main browser
 *    viewport NEVER creates an <iframe> for external content and instead
 *    drives the injected native bridge mock.
 */

function installFakeNativeWebview() {
  const calls = { ensure: [], setBounds: [], setVisible: [], destroy: [], goBack: [], goForward: [], reload: [], stop: [] };
  let eventListener = null;
  const fake = {
    ensure: (tabId, url, isPrivate) => { calls.ensure.push({ tabId, url, isPrivate }); return Promise.resolve({ handedOffToSystemBrowser: false }); },
    setBounds: (tabId, bounds) => { calls.setBounds.push({ tabId, bounds }); return Promise.resolve(); },
    setVisible: (tabId, visible) => { calls.setVisible.push({ tabId, visible }); return Promise.resolve(); },
    goBack: (tabId) => { calls.goBack.push(tabId); return Promise.resolve(); },
    goForward: (tabId) => { calls.goForward.push(tabId); return Promise.resolve(); },
    reload: (tabId) => { calls.reload.push(tabId); return Promise.resolve(); },
    stop: (tabId) => { calls.stop.push(tabId); return Promise.resolve(); },
    destroy: (tabId) => { calls.destroy.push(tabId); return Promise.resolve(); },
    onEvent: (cb) => { eventListener = cb; return () => { eventListener = null; }; },
    emit: (evt) => { if (eventListener) eventListener(evt); }
  };
  globalThis.window.yayra = { webview: fake };
  return { fake, calls, uninstall: () => { delete globalThis.window.yayra; } };
}

test('Native engine ABSENT (web/PWA fallback): external navigation still renders the existing <iframe> path', async () => {
  delete globalThis.window.yayra;
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, platform: 'linux', isMobile: false });
  await shell.initialize();
  shell.navigateActiveTab('https://example.com/');
  const el = shell.render(container);

  assert.ok(el.querySelector('iframe'), 'falls back to an <iframe> when no native bridge is present');
  assert.equal(el.querySelector('.fb-native-webview-slot'), null);
});

test('Native engine PRESENT (Electron desktop): external navigation NEVER creates an <iframe> and drives the native bridge instead', async () => {
  const { calls, uninstall } = installFakeNativeWebview();
  try {
    const container = document.createElement('div');
    const shell = new BrowserShell({ container, platform: 'linux', isMobile: false });
    await shell.initialize();
    const activeTab = shell.getActiveTab();

    shell.navigateActiveTab('https://www.google.com/search?q=ghana');
    const el = shell.rootElement;

    assert.equal(el.querySelector('iframe'), null, 'no <iframe> is used for external content when the native engine is available - this is the actual fix for the X-Frame-Options failure');
    assert.ok(el.querySelector('.fb-native-webview-slot'), 'a native engine placeholder slot is rendered instead');
    assert.ok(calls.ensure.length >= 1);
    const lastCall = calls.ensure[calls.ensure.length - 1];
    assert.equal(lastCall.tabId, activeTab.id);
    assert.equal(lastCall.url, 'https://www.google.com/search?q=ghana');
  } finally {
    uninstall();
  }
});

test('Native engine: closing a tab destroys its native view', async () => {
  const { calls, uninstall } = installFakeNativeWebview();
  try {
    const container = document.createElement('div');
    const shell = new BrowserShell({ container, platform: 'windows', isMobile: false });
    await shell.initialize();
    const firstTabId = shell.getActiveTab().id;
    shell.navigateActiveTab('https://example.com/');
    shell.render(container);

    shell.createNewTab();
    shell.render(container);

    shell.closeTab(firstTabId);
    assert.ok(calls.destroy.includes(firstTabId));
  } finally {
    uninstall();
  }
});

test('Native engine: visiting an internal yayra:// page hides the active tab\'s native surface instead of leaving it floating on top', async () => {
  const { calls, uninstall } = installFakeNativeWebview();
  try {
    const container = document.createElement('div');
    const shell = new BrowserShell({ container, platform: 'linux', isMobile: false });
    await shell.initialize();
    const tabId = shell.getActiveTab().id;

    shell.navigateActiveTab('https://example.com/');
    shell.render(container);
    assert.ok(calls.setVisible.some((c) => c.tabId === tabId && c.visible === true));

    calls.setVisible.length = 0;
    shell.navigateActiveTab('yayra://settings');
    shell.render(container);
    assert.ok(calls.setVisible.some((c) => c.tabId === tabId && c.visible === false), 'native surface must be hidden behind internal pages');
  } finally {
    uninstall();
  }
});

test('Native engine: a "navigated" event from the main process updates tab URL, security state, and back/forward state', async () => {
  const { fake, uninstall } = installFakeNativeWebview();
  try {
    const container = document.createElement('div');
    const shell = new BrowserShell({ container, platform: 'linux', isMobile: false });
    await shell.initialize();
    const tab = shell.getActiveTab();
    shell.navigateActiveTab('https://example.com/');
    shell.render(container);

    fake.emit({ tabId: tab.id, type: 'navigated', url: 'https://example.com/deep-link', canGoBack: true, canGoForward: false });

    assert.equal(tab.url, 'https://example.com/deep-link');
    assert.equal(tab.isSecure, true);
    assert.equal(tab.canGoBack, true);
    assert.equal(tab.canGoForward, false);
  } finally {
    uninstall();
  }
});

test('Native engine: a sign-in host handoff result resets the tab to the new-tab page instead of leaving a blank native slot', async () => {
  const { fake, calls, uninstall } = installFakeNativeWebview();
  try {
    fake.ensure = (tabId) => { calls.ensure.push(tabId); return Promise.resolve({ handedOffToSystemBrowser: true }); };
    const container = document.createElement('div');
    const shell = new BrowserShell({ container, platform: 'linux', isMobile: false });
    await shell.initialize();
    const tab = shell.getActiveTab();

    shell.navigateActiveTab('https://accounts.google.com/signin');
    shell.render(container);
    // Allow the ensure() promise microtask to resolve.
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(tab.url, 'yayra://newtab');
  } finally {
    uninstall();
  }
});

test('Native engine: reload() and stopLoading() delegate to the native bridge for a tab it controls', async () => {
  const { calls, uninstall } = installFakeNativeWebview();
  try {
    const container = document.createElement('div');
    const shell = new BrowserShell({ container, platform: 'linux', isMobile: false });
    await shell.initialize();
    const tabId = shell.getActiveTab().id;
    shell.navigateActiveTab('https://example.com/');
    shell.render(container);

    shell.reload();
    shell.stopLoading();

    assert.ok(calls.reload.includes(tabId));
    assert.ok(calls.stop.includes(tabId));
  } finally {
    uninstall();
  }
});
