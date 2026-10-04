/**
 * P35 follow-ups:
 *  1. Background tabs auto-refresh on a cadence (stale "looks stuck
 *     until I manually refresh" pages are reloaded in place), with the
 *     active tab untouched and a Settings kill-switch.
 *  2. Reload smoothness: a same-URL 'navigated' event (what a reload
 *     reports) must NOT trigger a full chrome re-render (the "blink"),
 *     and 'title-updated' updates the tab label surgically.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

import { BrowserShell } from '../packages/shared-ui/src/components/BrowserShell.js';

function makeNativeWebviewFake(calls) {
  return {
    ensure: async () => ({}),
    setBounds: async () => {},
    setVisible: async () => {},
    stop: async () => {},
    goBack: async () => {},
    goForward: async () => {},
    reload: async (tabId) => { calls.push(tabId); },
    destroy: async () => {},
    capture: async () => ({}),
    onEvent: () => () => {}
  };
}

async function makeShell(reloadCalls) {
  globalThis.window.yayra = { webview: makeNativeWebviewFake(reloadCalls) };
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, platform: 'linux', isMobile: false });
  await shell.initialize();
  shell.render(container);
  return shell;
}

test('background tabs older than the cadence are reloaded; the ACTIVE tab is never touched', async () => {
  const reloads = [];
  const shell = await makeShell(reloads);
  const activeTab = shell.getActiveTab();
  activeTab.url = 'https://news.example.com/';
  activeTab.lastLoadCompletedAt = Date.now() - 10 * 60 * 1000; // stale but ACTIVE
  shell._nativeWebviewTabIds.add(activeTab.id);

  shell.createNewTab();
  const bgTab = shell.getActiveTab();
  shell.state.activeTabId = activeTab.id; // first tab active again
  bgTab.url = 'https://scores.example.com/';
  bgTab.isLoading = false;
  bgTab.lastLoadCompletedAt = Date.now() - 10 * 60 * 1000; // stale AND background
  shell._nativeWebviewTabIds.add(bgTab.id);

  shell.autoRefreshBackgroundTabs();

  assert.deepEqual(reloads, [bgTab.id], 'only the stale BACKGROUND tab reloads');
  assert.ok(Date.now() - bgTab.lastLoadCompletedAt < 5000, 'cadence restarts after the refresh');

  // Fresh tabs are left alone on the next tick.
  shell.autoRefreshBackgroundTabs();
  assert.deepEqual(reloads, [bgTab.id], 'no double-reload inside the cadence window');
  delete globalThis.window.yayra;
});

test('Settings kill-switch: autoRefreshBackgroundTabs=false stops all background reloading', async () => {
  const reloads = [];
  const shell = await makeShell(reloads);
  shell.state.settings.autoRefreshBackgroundTabs = false;
  shell.createNewTab();
  const bgTab = shell.getActiveTab();
  shell.state.activeTabId = shell.state.tabs[0].id;
  bgTab.url = 'https://scores.example.com/';
  bgTab.lastLoadCompletedAt = Date.now() - 60 * 60 * 1000;
  shell._nativeWebviewTabIds.add(bgTab.id);

  shell.autoRefreshBackgroundTabs();
  assert.deepEqual(reloads, [], 'setting off = never reloads anything');
  delete globalThis.window.yayra;
});

test('internal/non-http tabs and still-loading tabs are never auto-refreshed', async () => {
  const reloads = [];
  const shell = await makeShell(reloads);
  shell.createNewTab();
  const internalTab = shell.getActiveTab(); // stays yayra://newtab
  shell.createNewTab();
  const loadingTab = shell.getActiveTab();
  shell.state.activeTabId = shell.state.tabs[0].id;
  internalTab.lastLoadCompletedAt = Date.now() - 60 * 60 * 1000;
  loadingTab.url = 'https://slow.example.com/';
  loadingTab.isLoading = true;
  loadingTab.lastLoadCompletedAt = Date.now() - 60 * 60 * 1000;
  shell._nativeWebviewTabIds.add(internalTab.id);
  shell._nativeWebviewTabIds.add(loadingTab.id);

  shell.autoRefreshBackgroundTabs();
  assert.deepEqual(reloads, [], 'internal pages and in-flight loads are skipped');
  delete globalThis.window.yayra;
});

test('reload smoothness: a same-URL navigated event does NOT full-render (no blink), a real URL change does', async () => {
  const reloads = [];
  const shell = await makeShell(reloads);
  const tab = shell.getActiveTab();
  tab.url = 'https://example.com/';
  tab.isPrivate = true; // keep history recording out of this test

  let renders = 0;
  const originalRender = shell.render.bind(shell);
  shell.render = (...args) => { renders += 1; return originalRender(...args); };

  shell.handleNativeWebviewEvent({ tabId: tab.id, type: 'navigated', url: 'https://example.com/', canGoBack: true, canGoForward: false });
  assert.equal(renders, 0, 'reload (same URL) must not rebuild the chrome');

  shell.handleNativeWebviewEvent({ tabId: tab.id, type: 'navigated', url: 'https://example.com/other', canGoBack: true, canGoForward: false });
  assert.equal(renders, 1, 'a real navigation still renders fully');
  delete globalThis.window.yayra;
});

test('title-updated patches the tab label in place instead of re-rendering everything', async () => {
  const reloads = [];
  const shell = await makeShell(reloads);
  const tab = shell.getActiveTab();

  let renders = 0;
  const originalRender = shell.render.bind(shell);
  shell.render = (...args) => { renders += 1; return originalRender(...args); };

  shell.handleNativeWebviewEvent({ tabId: tab.id, type: 'title-updated', title: 'Fresh Title' });
  assert.equal(renders, 0, 'no full render for a title tick');
  assert.equal(tab.title, 'Fresh Title');
  delete globalThis.window.yayra;
});
