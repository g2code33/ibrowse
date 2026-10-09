import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

import { BrowserShell } from '../packages/shared-ui/src/components/BrowserShell.js';

/**
 * OFFLINE PROMPTING (user report): "when there is no internet connection,
 * it must prompt users so not to give blank pages".
 *
 * Before: opening a page while offline rendered a silent BLANK iframe
 * (the request fails, nothing explains why). After:
 *  1. A NEW page opened while offline shows an honest offline card with
 *     a Retry button - never a blank page.
 *  2. A page that is ALREADY LOADED stays live offline (the loaded-page
 *     contract is untouched).
 *  3. Going offline / coming back online is announced; the online event
 *     heals offline cards automatically WITHOUT reloading live pages
 *     (pooled live frames survive re-renders).
 */

function setOnline(v) {
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: v }, configurable: true });
}

async function boot({ url = 'https://example.com/page' } = {}) {
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, platform: 'linux', isMobile: false });
  await shell.initialize();
  shell.state.tabs[0].url = url;
  shell.render(container);
  return { shell, container };
}

test('OFFLINE: a NEW page shows the honest offline card - never a blank frame', async () => {
  setOnline(false);
  const { shell, container } = await boot();
  try {
    const card = shell.viewportElement.querySelector('.fb-offline-fallback');
    assert.ok(card, 'the offline card is shown in place of the page');
    assert.equal(shell.viewportElement.querySelector('iframe'), null, 'no blank iframe is created');
    assert.match(card.querySelector('.fb-offline-retry-btn').textContent, /Retry/);
    assert.match(card.textContent, /offline/i);
  } finally {
    setOnline(true);
    shell.destroy();
  }
});

test('OFFLINE: a page that already LOADED keeps its live frame when the connection drops', async () => {
  setOnline(true);
  const { shell, container } = await boot();
  try {
    const tabId = shell.state.tabs[0].id;
    assert.ok(shell.webFrames.has(tabId), 'the live pooled frame exists while online');
    const liveIframe = shell.webFrames.get(tabId).iframe;
    assert.ok(container.querySelector('iframe') || liveIframe, 'the page is rendered');

    setOnline(false);
    shell.render(container); // any re-render while offline
    assert.ok(shell.webFrames.has(tabId), 'the loaded frame is NEVER dropped');
    assert.equal(shell.webFrames.get(tabId).iframe, liveIframe, 'the exact same live frame object is kept');
    assert.equal(shell.viewportElement.querySelector('.fb-offline-fallback'), null,
      'a loaded page is not replaced by an offline card');
  } finally {
    setOnline(true);
    shell.destroy();
  }
});

test('OFFLINE -> ONLINE: the offline card heals automatically, without touching live pages', async () => {
  setOnline(false);
  const listeners = {};
  const origAdd = globalThis.window.addEventListener;
  globalThis.window.addEventListener = (type, fn) => { listeners[type] = fn; };
  let renders = 0;
  try {
    const container = document.createElement('div');
    const shell = new BrowserShell({ container, platform: 'linux', isMobile: false });
    await shell.initialize();
    shell.state.tabs[0].url = 'https://example.com/page';
    const realRender = shell.render.bind(shell);
    shell.render = (c) => { renders += 1; return realRender(c); };
    shell.render(container);
    assert.ok(shell.viewportElement.querySelector('.fb-offline-fallback'), 'offline card shown');
    assert.ok(listeners.online, 'the online listener is armed');

    setOnline(true);
    listeners.online(); // the connection returns
    assert.ok(renders >= 1, 'a heal re-render was triggered');
    assert.equal(shell.viewportElement.querySelector('.fb-offline-fallback'), null,
      'the offline card is gone once back online');
    shell.destroy();
  } finally {
    globalThis.window.addEventListener = origAdd;
    setOnline(true);
  }
});

test('OFFLINE EVENTS: dropping offline and coming back are announced to the user', async () => {
  setOnline(true);
  const listeners = {};
  const origAdd = globalThis.window.addEventListener;
  globalThis.window.addEventListener = (type, fn) => { listeners[type] = fn; };
  try {
    const container = document.createElement('div');
    const shell = new BrowserShell({ container, platform: 'linux', isMobile: false });
    await shell.initialize();
    const notices = [];
    shell.showTransientNotice = (msg) => notices.push(String(msg));
    assert.ok(listeners.offline && listeners.online, 'both connectivity listeners armed');

    listeners.offline();
    assert.ok(notices.some((n) => /offline/i.test(n)), 'going offline is announced');
    listeners.online();
    assert.ok(notices.some((n) => /back online/i.test(n)), 'coming back is announced');
    shell.destroy();
  } finally {
    globalThis.window.addEventListener = origAdd;
  }
});

test('SOURCE PIN: offline wins over every other frame strategy, and the retry path is wired', () => {
  const src = readFileSync(new URL('../packages/shared-ui/src/components/BrowserShell.js', import.meta.url), 'utf8');
  const fnStart = src.indexOf('createWebContentFrame(url, { frameClassName');
  const fn = src.slice(fnStart, src.indexOf('\n  }', fnStart));
  const offlineAt = fn.indexOf('buildOfflineFallback(url)');
  assert.ok(offlineAt > -1, 'the offline card exists in the frame pipeline');
  assert.ok(fn.indexOf('isKnownFrameBlockedUrl(url)') > offlineAt,
    'the offline check runs BEFORE the blocked-hosts strategy - no blank page can win');
  assert.ok(fn.indexOf('getSearchIntent(url)') > offlineAt,
    'the offline check runs BEFORE the search handoff');
  const pooled = src.indexOf('mountPooledWebFrame(webViewContainer, tab) {');
  const pooledFn = src.slice(pooled, pooled + 900);
  assert.match(pooledFn, /!this\._onLine\(\).*webFrames\?\.has\(tab\.id\)\) return false/,
    'offline blocks NEW pooled frames but never reuses-blocks LOADED ones');
});
