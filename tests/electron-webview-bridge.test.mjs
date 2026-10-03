import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requiresSystemBrowserAuth,
  sanitizeBounds,
  createWebviewBridge,
  WEBVIEW_EVENT_CHANNEL
} from '../electron/webviewBridge.cjs';

// --- Pure helper logic -------------------------------------------------

test('requiresSystemBrowserAuth: recognizes Google/Apple/Microsoft sign-in hosts and their subdomains', () => {
  assert.equal(requiresSystemBrowserAuth('https://accounts.google.com/signin/v2/identifier'), true);
  assert.equal(requiresSystemBrowserAuth('https://appleid.apple.com/auth/authorize'), true);
  assert.equal(requiresSystemBrowserAuth('https://login.live.com/'), true);
  assert.equal(requiresSystemBrowserAuth('https://sub.login.microsoftonline.com/'), true);
});

test('requiresSystemBrowserAuth: does not flag ordinary browsing (including other Google subdomains)', () => {
  assert.equal(requiresSystemBrowserAuth('https://www.google.com/search?q=ghana'), false);
  assert.equal(requiresSystemBrowserAuth('https://mail.google.com/mail/u/0/'), false);
  assert.equal(requiresSystemBrowserAuth('https://www.youtube.com/'), false);
  assert.equal(requiresSystemBrowserAuth('not a url'), false);
});

test('sanitizeBounds: clamps negative/missing values and rounds floats', () => {
  assert.deepEqual(sanitizeBounds({ x: -5, y: 12.6, width: 300.2, height: NaN }), { x: 0, y: 13, width: 300, height: 0 });
  assert.deepEqual(sanitizeBounds(undefined), { x: 0, y: 0, width: 0, height: 0 });
});

// --- createWebviewBridge wiring (fake Electron primitives) --------------

function createFakeWebContents() {
  const listeners = new Map();
  let windowOpenHandler = null;
  let destroyed = false;
  let backStack = [];
  let forwardStack = [];
  return {
    loadURL: async () => {},
    reload: () => {},
    stop: () => {},
    close: () => { destroyed = true; },
    isDestroyed: () => destroyed,
    canGoBack: () => backStack.length > 0,
    canGoForward: () => forwardStack.length > 0,
    goBack: () => { if (backStack.length) forwardStack.push(backStack.pop()); },
    goForward: () => { if (forwardStack.length) backStack.push(forwardStack.pop()); },
    setWindowOpenHandler: (fn) => { windowOpenHandler = fn; },
    on: (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    emit: (event, ...args) => {
      for (const fn of listeners.get(event) || []) fn(...args);
    },
    _simulateWindowOpen: (details) => windowOpenHandler(details),
    _backStack: backStack,
    _forwardStack: forwardStack
  };
}

function createFakeWebContentsView() {
  const webContents = createFakeWebContents();
  webContents.loadURL = async () => {};
  return {
    webContents,
    bounds: null,
    setBounds(b) { this.bounds = b; }
  };
}

function makeHarness({ authHosts } = {}) {
  const handlers = new Map();
  const ipcMain = {
    handle: (channel, fn) => handlers.set(channel, fn)
  };
  const sentEvents = [];
  const fakeWin = {
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    webContents: { send: (channel, payload) => sentEvents.push({ channel, payload }) },
    contentView: {
      children: [],
      addChildView(view) { this.children.push(view); },
      removeChildView(view) { this.children = this.children.filter((v) => v !== view); }
    }
  };
  const externalCalls = [];
  const shell = { openExternal: async (url) => { externalCalls.push(url); } };
  const views = [];
  const WebContentsView = function FakeWebContentsView() {
    const view = createFakeWebContentsView();
    views.push(view);
    return view;
  };

  const bridge = createWebviewBridge({
    WebContentsView,
    ipcMain,
    shell,
    getMainWindow: () => fakeWin,
    authHosts,
    logger: { error: () => {} }
  });

  return { bridge, handlers, sentEvents, fakeWin, externalCalls, views };
}

test('webview bridge: creating a tab adds a WebContentsView as a child view and loads the URL', async () => {
  const { handlers, fakeWin, views } = makeHarness();
  await handlers.get('yayra:webview-ensure')(null, { tabId: 'tab-1', url: 'https://www.google.com/' });

  assert.equal(views.length, 1, 'exactly one native view created');
  assert.equal(fakeWin.contentView.children.length, 1, 'view attached to the window content view (not an <iframe>)');
});

test('webview bridge: re-ensuring the same tab with the same URL does not reload', async () => {
  const { handlers, views } = makeHarness();
  let loadCount = 0;
  const ensure = handlers.get('yayra:webview-ensure');
  await ensure(null, { tabId: 'tab-1', url: 'https://example.com/' });
  views[0].webContents.loadURL = async () => { loadCount += 1; };
  await ensure(null, { tabId: 'tab-1', url: 'https://example.com/' });
  assert.equal(loadCount, 0, 'no second load for an unchanged URL');
  await ensure(null, { tabId: 'tab-1', url: 'https://example.com/other' });
  assert.equal(loadCount, 1, 'navigates when the URL actually changes');
});

test('webview bridge: identity-provider sign-in hosts are handed off to the system browser, never embedded', async () => {
  const { handlers, sentEvents, externalCalls, views } = makeHarness();
  const result = await handlers.get('yayra:webview-ensure')(null, { tabId: 'tab-auth', url: 'https://accounts.google.com/signin' });

  assert.equal(views.length, 0, 'no native view is ever created for an auth host');
  assert.deepEqual(externalCalls, ['https://accounts.google.com/signin']);
  assert.equal(result.handedOffToSystemBrowser, true);
  const handoffEvent = sentEvents.find((e) => e.payload.type === 'system-browser-handoff');
  assert.ok(handoffEvent, 'renderer is notified of the handoff');
  assert.equal(handoffEvent.channel, WEBVIEW_EVENT_CHANNEL);
});

test('webview bridge: popups to a sign-in host from an already-open tab are also handed off externally, not opened as a child view', async () => {
  const { handlers, views, externalCalls } = makeHarness();
  await handlers.get('yayra:webview-ensure')(null, { tabId: 'tab-1', url: 'https://mail.google.com/' });
  const guestWebContents = views[0].webContents;

  const response = guestWebContents._simulateWindowOpen({ url: 'https://accounts.google.com/signin/oauth' });
  assert.deepEqual(response, { action: 'deny' });
  assert.deepEqual(externalCalls, ['https://accounts.google.com/signin/oauth']);
});

test('webview bridge: ordinary popups are denied locally and reported to the renderer as new-window-request (opened as a Yayra tab)', async () => {
  const { handlers, views, sentEvents, externalCalls } = makeHarness();
  await handlers.get('yayra:webview-ensure')(null, { tabId: 'tab-1', url: 'https://example.com/' });
  const guestWebContents = views[0].webContents;

  const response = guestWebContents._simulateWindowOpen({ url: 'https://example.com/help' });
  assert.deepEqual(response, { action: 'deny' });
  assert.equal(externalCalls.length, 0);
  const requestEvent = sentEvents.find((e) => e.payload.type === 'new-window-request');
  assert.ok(requestEvent);
  assert.equal(requestEvent.payload.url, 'https://example.com/help');
});

test('webview bridge: did-navigate forwards URL and back/forward state to the renderer', async () => {
  const { handlers, views, sentEvents } = makeHarness();
  await handlers.get('yayra:webview-ensure')(null, { tabId: 'tab-1', url: 'https://example.com/' });
  const wc = views[0].webContents;
  wc._backStack.push('https://example.com/');

  wc.emit('did-navigate', {}, 'https://example.com/page-2');
  const navigated = sentEvents.find((e) => e.payload.type === 'navigated');
  assert.ok(navigated);
  assert.equal(navigated.payload.url, 'https://example.com/page-2');
  assert.equal(navigated.payload.canGoBack, true);
});

test('webview bridge: destroying a tab removes its view from the window and releases it', async () => {
  const { handlers, fakeWin, views } = makeHarness();
  await handlers.get('yayra:webview-ensure')(null, { tabId: 'tab-1', url: 'https://example.com/' });
  assert.equal(fakeWin.contentView.children.length, 1);

  await handlers.get('yayra:webview-destroy')(null, { tabId: 'tab-1' });
  assert.equal(fakeWin.contentView.children.length, 0);
  assert.equal(views[0].webContents.isDestroyed(), true);
});

test('webview bridge: setBounds and setVisible(false) manipulate the native view without destroying it', async () => {
  const { handlers, views } = makeHarness();
  await handlers.get('yayra:webview-ensure')(null, { tabId: 'tab-1', url: 'https://example.com/' });

  await handlers.get('yayra:webview-set-bounds')(null, { tabId: 'tab-1', bounds: { x: 10, y: 20, width: 800, height: 600 } });
  assert.deepEqual(views[0].bounds, { x: 10, y: 20, width: 800, height: 600 });

  await handlers.get('yayra:webview-set-visible')(null, { tabId: 'tab-1', visible: false });
  assert.deepEqual(views[0].bounds, { x: 0, y: 0, width: 0, height: 0 }, 'hidden by zeroing bounds, not by destroying the guest page');
  assert.equal(views[0].webContents.isDestroyed(), false);
});
