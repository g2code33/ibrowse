/**
 * "THE X BUTTON AND REFRESH BUTTON FIX IT WELL WELL" - the stuck-X fix.
 *
 * The refresh/stop toggle is driven by loading-start/loading-stop events
 * plus an optimistic X on reload(). If a single loading-stop was EVER
 * missed (busy renderer, SPA subframe quirks, an event racing a chrome
 * re-render), the button stayed an X forever - visible on pages like
 * build.nvidia.com. Nothing reconciled the UI with the engine's truth.
 *
 * Now, three layers of self-healing, pinned here:
 *  1. The bridge exposes the ENGINE truth: yayra:webview-is-loading asks
 *     the real webContents.isLoading(); 'navigated' events carry it too.
 *  2. The renderer applies isLoading from every 'navigated' event.
 *  3. A watchdog: while any native tab claims to be loading, the real
 *     engine is polled every 2s (after a 2.5s grace) and the X snaps
 *     back to the refresh icon the moment the engine says "not loading".
 *     Self-terminates when nothing is loading.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDomShim } from './dom-shim.mjs';
import { createWebviewBridge } from '../electron/webviewBridge.cjs';

setupDomShim();
const disk = new Map();
globalThis.localStorage = {
  getItem: (k) => (disk.has(k) ? disk.get(k) : null),
  setItem: (k, v) => disk.set(k, String(v)),
  removeItem: (k) => disk.delete(k),
  key: (i) => [...disk.keys()][i] ?? null,
  get length() { return disk.size; }
};

const { BrowserShell } = await import('../packages/shared-ui/src/components/BrowserShell.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bootShell({ engineLoading }) {
  // The dom-shim window has no timers - lend it Node's so the watchdog
  // can actually run in this test.
  globalThis.window.setInterval = (...args) => setInterval(...args);
  globalThis.window.clearInterval = (id) => clearInterval(id);
  const isLoadingCalls = [];
  globalThis.window.yayra = {
    webview: {
      ensure: async () => ({}), setBounds: async () => {}, setVisible: async () => {},
      stop: async () => {}, goBack: async () => {}, goForward: async () => {},
      reload: async () => {}, destroy: async () => {}, capture: async () => ({}),
      isLoading: async (tabId) => { isLoadingCalls.push(tabId); return { isLoading: engineLoading() }; },
      onEvent: () => () => {}
    }
  };
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, platform: 'linux', isMobile: false });
  await shell.initialize();
  shell.render(container);
  return { shell, isLoadingCalls };
}

test('watchdog: a tab stuck "loading" snaps back to the refresh icon from the ENGINE truth', async () => {
  disk.clear();
  const { shell, isLoadingCalls } = await bootShell({ engineLoading: () => false });
  try {
    const tab = shell.getActiveTab();
    tab.url = 'https://build.nvidia.com/moonshotai/kimi-k3';
    shell._nativeWebviewTabIds.add(tab.id);

    // The missed-event scenario: loading-start arrived, loading-stop never did.
    shell.updateTabLoading(tab.id, true);
    assert.equal(tab.isLoading, true, 'X shown while (supposedly) loading');
    assert.ok(shell._loadingWatchdogTimer, 'watchdog armed the moment a load starts');
    tab.loadingStartedAt = Date.now() - 10_000; // past the 2.5s grace period

    await sleep(2300); // one watchdog tick
    assert.ok(isLoadingCalls.includes(tab.id), 'the REAL engine was asked');
    assert.equal(tab.isLoading, false, 'stuck X healed - button is the refresh icon again');

    await sleep(2300); // next tick sees nothing loading
    assert.equal(shell._loadingWatchdogTimer, null, 'watchdog self-terminates when idle');
  } finally {
    shell.destroy();
    delete globalThis.window.yayra;
  }
});

test('watchdog: a genuinely slow load is left alone (engine still loading = X stays, honestly)', async () => {
  disk.clear();
  const { shell } = await bootShell({ engineLoading: () => true });
  try {
    const tab = shell.getActiveTab();
    tab.url = 'https://slow.example.com/';
    shell._nativeWebviewTabIds.add(tab.id);
    shell.updateTabLoading(tab.id, true);
    tab.loadingStartedAt = Date.now() - 10_000;

    await sleep(2300);
    assert.equal(tab.isLoading, true, 'engine says loading -> the X stays, exactly like Chrome');
  } finally {
    shell.destroy();
    assert.equal(shell._loadingWatchdogTimer, null, 'destroy() clears the watchdog');
    delete globalThis.window.yayra;
  }
});

test('"navigated" events carry engine truth and clear a stuck X instantly', async () => {
  disk.clear();
  const { shell } = await bootShell({ engineLoading: () => false });
  try {
    const tab = shell.getActiveTab();
    tab.url = 'https://example.com/';
    shell._nativeWebviewTabIds.add(tab.id);
    shell.updateTabLoading(tab.id, true);

    shell.handleNativeWebviewEvent({ tabId: tab.id, type: 'navigated', url: 'https://example.com/', canGoBack: false, canGoForward: false, isLoading: false });
    assert.equal(tab.isLoading, false, 'navigation with isLoading:false heals the button with no waiting');

    // And the engine can also say "still loading" (slow main frame).
    shell.handleNativeWebviewEvent({ tabId: tab.id, type: 'navigated', url: 'https://example.com/b', canGoBack: true, canGoForward: false, isLoading: true });
    assert.equal(tab.isLoading, true, 'navigated mid-load keeps the X');
  } finally {
    shell.destroy();
    delete globalThis.window.yayra;
  }
});

test('native path never blanket-clears loading on render (static pin)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../packages/shared-ui/src/components/BrowserShell.js', import.meta.url), 'utf8');
  const nativePath = src.slice(src.indexOf('if (allowNative && tabId && this.nativeWebview) {'));
  const block = nativePath.slice(0, nativePath.indexOf('return { wrapper, iframe: null };'));
  assert.doesNotMatch(block, /typeof onLoaded === 'function'\) onLoaded\(\)/,
    'rendering the chrome must never force "loaded" onto a native tab mid-load - events + watchdog own that state');
});

// ---- bridge layer -------------------------------------------------------

function makeBridgeHarness() {
  const handlers = new Map();
  const ipcMain = { handle: (c, f) => handlers.set(c, f), on: () => {} };
  const views = [];
  const sentEvents = [];
  const WebContentsView = function FakeView() {
    const listeners = new Map();
    const view = {
      webContents: {
        loadURL: async () => {},
        on: (ev, fn) => { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); },
        once: () => {},
        emit: (ev, ...args) => { for (const fn of listeners.get(ev) || []) fn(...args); },
        setWindowOpenHandler: () => {}, setUserAgent: () => {},
        isDestroyed: () => false, close: () => {},
        isLoading: () => view.__loading
      },
      __loading: false,
      bounds: null,
      setBounds(b) { this.bounds = b; }
    };
    views.push(view);
    return view;
  };
  const fakeWin = {
    isDestroyed: () => false,
    webContents: { send: (channel, payload) => sentEvents.push(payload) },
    contentView: { children: [], addChildView(v) { this.children.push(v); }, removeChildView() {} }
  };
  createWebviewBridge({ WebContentsView, ipcMain, shell: { openExternal: async () => {} }, getMainWindow: () => fakeWin, logger: { error: () => {} } });
  return { handlers, views, sentEvents };
}

test('bridge: yayra:webview-is-loading reports the real webContents state (and false for missing views)', async () => {
  const { handlers, views } = makeBridgeHarness();
  await handlers.get('yayra:webview-ensure')(null, { tabId: 'tab-1', url: 'https://example.com/' });

  views[0].__loading = true;
  assert.deepEqual(await handlers.get('yayra:webview-is-loading')(null, { tabId: 'tab-1' }), { isLoading: true });
  views[0].__loading = false;
  assert.deepEqual(await handlers.get('yayra:webview-is-loading')(null, { tabId: 'tab-1' }), { isLoading: false });
  assert.deepEqual(await handlers.get('yayra:webview-is-loading')(null, { tabId: 'no-such-tab' }), { isLoading: false },
    'a destroyed/unknown view can never claim to be loading');
});

test('bridge: navigated events include the engine isLoading flag', async () => {
  const { handlers, views, sentEvents } = makeBridgeHarness();
  await handlers.get('yayra:webview-ensure')(null, { tabId: 'tab-1', url: 'https://example.com/' });
  views[0].__loading = true;
  views[0].webContents.emit('did-navigate', {}, 'https://example.com/next');
  const nav = sentEvents.find((e) => e.type === 'navigated');
  assert.equal(nav.isLoading, true, 'did-navigate payload carries engine truth');
  views[0].__loading = false;
  views[0].webContents.emit('did-navigate-in-page', {}, 'https://example.com/#done');
  const nav2 = sentEvents.filter((e) => e.type === 'navigated').at(-1);
  assert.equal(nav2.isLoading, false, 'in-page navigation payload too');
});
