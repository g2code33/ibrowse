/**
 * Smart, environment-aware loading UI.
 *
 * The reload button must KNOW the page state:
 *  - site loading  -> X (stop) that actually quits the load;
 *  - fully loaded  -> back to the refresh sign;
 * and the tab's icon slot shows a "time sign" (animated hourglass) the
 * moment loading starts, flipping back to the favicon when done.
 *
 * Regression being pinned: updateTabLoading() used to mutate
 * tab.isLoading WITHOUT touching the DOM, so loading-stop events from
 * native views / iframe load events left the toolbar stuck on the wrong
 * icon (an X on a fully loaded page) until some unrelated full render.
 * The fix updates the button and tab icon surgically in place - no
 * full re-render, no flicker.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

import { BrowserShell } from '../packages/shared-ui/src/components/BrowserShell.js';

async function makeShell() {
  delete globalThis.window.yayra;
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, platform: 'linux', isMobile: false });
  await shell.initialize();
  const el = shell.render(container);
  return { shell, container, el };
}

function findTabIcon(el, tabId) {
  for (const tabEl of el.querySelectorAll('.fb-tab-item')) {
    const id = (tabEl.dataset && tabEl.dataset.tabId) || tabEl.getAttribute?.('data-tab-id');
    if (id === tabId) return tabEl.querySelector('.fb-tab-favicon');
  }
  return null;
}

test('loading starts: reload button becomes an X (stop) and the tab shows the hourglass time sign', async () => {
  const { shell, el } = await makeShell();
  const tab = shell.getActiveTab();

  shell.updateTabLoading(tab.id, true);

  const btn = el.querySelector('.fb-nav-reload');
  assert.equal(btn.getAttribute('aria-label'), 'Stop', 'button flips to Stop while loading');
  assert.match(btn.innerHTML, /line x1="18"/, 'X (stop) icon shown');
  const icon = findTabIcon(el, tab.id);
  assert.ok(icon, 'tab icon slot found');
  assert.match(icon.innerHTML, /fb-tab-loading-hourglass/, 'hourglass time sign while loading');
});

test('fully loaded: button flips BACK to the refresh sign in place (the stuck-X regression)', async () => {
  const { shell, el } = await makeShell();
  const tab = shell.getActiveTab();

  shell.updateTabLoading(tab.id, true);
  // This is how native loading-stop events and iframe load events arrive -
  // WITHOUT any full re-render around them.
  shell.updateTabLoading(tab.id, false);

  const btn = el.querySelector('.fb-nav-reload');
  assert.equal(btn.getAttribute('aria-label'), 'Reload', 'button returns to Reload when fully loaded');
  assert.doesNotMatch(btn.innerHTML, /line x1="18"/, 'no X anymore');
  assert.match(btn.innerHTML, /M21 12a9 9/, 'refresh icon restored');
  const icon = findTabIcon(el, tab.id);
  assert.doesNotMatch(icon.innerHTML, /fb-tab-loading-hourglass/, 'hourglass gone once loaded');
});

test('clicking the X while loading stops the load and restores the refresh sign immediately', async () => {
  const { shell, el } = await makeShell();
  const tab = shell.getActiveTab();

  shell.updateTabLoading(tab.id, true);
  const btn = el.querySelector('.fb-nav-reload');
  btn.click(); // acts as STOP because the page is loading

  assert.equal(tab.isLoading, false, 'load quit');
  assert.equal(btn.getAttribute('aria-label'), 'Reload', 'back to refresh immediately, not stuck as X');
});

test('environment-aware stop: native Electron tabs get a real webContents stop()', async () => {
  const stops = [];
  globalThis.window.yayra = {
    webview: {
      ensure: async () => ({}),
      setBounds: async () => {},
      setVisible: async () => {},
      stop: async (tabId) => { stops.push(tabId); },
      goBack: async () => {}, goForward: async () => {}, reload: async () => {},
      destroy: async () => {}, capture: async () => ({}),
      onEvent: () => () => {}
    }
  };
  try {
    const container = document.createElement('div');
    const shell = new BrowserShell({ container, platform: 'linux', isMobile: false });
    await shell.initialize();
    shell.render(container);
    const tab = shell.getActiveTab();
    shell._nativeWebviewTabIds.add(tab.id);
    shell.updateTabLoading(tab.id, true);

    shell.stopLoading();

    assert.deepEqual(stops, [tab.id], 'native stop() invoked for the native view');
    assert.equal(tab.isLoading, false, 'UI state flips immediately, without waiting for the event');
  } finally {
    delete globalThis.window.yayra;
  }
});

test('only a REAL state change touches the DOM (no churn on repeated identical events)', async () => {
  const { shell, el } = await makeShell();
  const tab = shell.getActiveTab();
  shell.updateTabLoading(tab.id, true);
  const btn = el.querySelector('.fb-nav-reload');
  btn.innerHTML = 'SENTINEL';
  // Same state again -> must NOT rewrite the button.
  shell.updateTabLoading(tab.id, true);
  assert.equal(btn.innerHTML, 'SENTINEL', 'identical loading events are no-ops for the DOM');
});
