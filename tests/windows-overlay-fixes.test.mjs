/**
 * Windows PC overlay fixes (field report):
 *  1. mini titlebar X (hide) "not working"
 *  2. bubble overlapping mini = unusual BLINKING
 *  3. "open in yayra main" (expand) "not working"
 *  4. bubble single-click opens mini but cannot hide it again
 *
 * ROOT CAUSE for 1/3/4: Chromium's always-on-top path on Windows issues
 * SetWindowPos with SWP_SHOWWINDOW - so the mini panel's 800ms topmost
 * heartbeat and blur guards RE-SHOWED the window right after every
 * hide(). All three "not working" buttons actually worked for a frame.
 * ROOT CAUSE for 2: the bubble's and the mini's out-of-phase heartbeats
 * each re-inserted their window above the other every tick.
 *
 * FIX (assertTopmost): never assert a hidden window; and while BOTH
 * overlay surfaces are visible, skip the reorder when the topmost flag
 * is already in place.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOverlayBridge } from '../electron/overlayWindow.cjs';
import { createOverlayStore } from '../electron/overlayStore.cjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yayra-win-overlay-'));
}

function fakeIpcMain() {
  const handlers = new Map();
  const onHandlers = new Map();
  return {
    handlers,
    onHandlers,
    handle: (channel, fn) => handlers.set(channel, fn),
    on: (channel, fn) => onHandlers.set(channel, fn)
  };
}

function makeFakeWindows() {
  const instances = [];
  class FakeWin {
    constructor(opts = {}) {
      this.opts = opts;
      this.destroyed = false;
      this._visible = opts.show !== false;
      this._alwaysOnTop = false;
      this.calls = [];
      this._listeners = {};
      this._position = [opts.x || 0, opts.y || 0];
      this.sent = [];
      this.webContents = {
        send: (channel, payload) => this.sent.push({ channel, payload }),
        isLoading: () => false,
        once: () => {}
      };
      instances.push(this);
    }
    setAlwaysOnTop(flag, level) {
      this.calls.push({ type: 'setAlwaysOnTop', flag, level, visibleAtCall: this._visible });
      this._alwaysOnTop = Boolean(flag);
    }
    isAlwaysOnTop() { return this._alwaysOnTop; }
    moveTop() { this.calls.push({ type: 'moveTop', visibleAtCall: this._visible }); }
    setVisibleOnAllWorkspaces() { this.calls.push({ type: 'svaw', visibleAtCall: this._visible }); }
    setContentProtection() {}
    setMovable() {}
    setBounds(b) { this.calls.push({ type: 'setBounds', b }); }
    getBounds() { return { x: this._position[0], y: this._position[1], width: 64, height: 64 }; }
    setPosition(x, y) { this._position = [x, y]; }
    getPosition() { return this._position; }
    loadURL(url) { this.loadedUrl = url; }
    on(ev, cb) { this._listeners[ev] = cb; }
    emit(ev, ...a) { this._listeners[ev]?.(...a); }
    show() { this._visible = true; this._listeners.show?.(); }
    showInactive() { this._visible = true; }
    hide() {
      this._visible = false;
      // Windows fires blur right after a focused window hides - this is
      // exactly the moment the old guard resurrected the panel.
      this._listeners.blur?.();
    }
    isVisible() { return this._visible; }
    focus() { this.calls.push({ type: 'focus' }); }
    close() { this.destroyed = true; this._listeners.closed?.(); }
    isDestroyed() { return this.destroyed; }
  }
  return { FakeWin, instances };
}

function boot({ getMainWindow = () => null } = {}) {
  const dir = makeTempDir();
  const overlayStore = createOverlayStore({ fs, userDataDir: dir });
  const { FakeWin, instances } = makeFakeWindows();
  const ipcMain = fakeIpcMain();
  const bridge = createOverlayBridge({
    BrowserWindow: FakeWin,
    app: { setLoginItemSettings: () => {}, getPath: () => dir },
    ipcMain,
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
    path,
    preloadPath: '/fake/overlayPreload.cjs',
    mainPreloadPath: '/fake/preload.cjs',
    overlayStore,
    getMainWindow
  });
  bridge.initializeOnStartup();
  return { bridge, instances, ipcMain, FakeWin };
}

const hiddenAsserts = (win) => win.calls.filter(
  (c) => (c.type === 'setAlwaysOnTop' || c.type === 'moveTop' || c.type === 'svaw') && c.visibleAtCall === false
);

test('WIN FIX 4: bubble single-click toggles the mini OPEN -> HIDDEN -> OPEN (hide actually sticks)', async () => {
  const { bridge } = boot();
  bridge.handleBubbleTap(1);
  const mini = bridge.getMiniWindow();
  assert.ok(mini, 'first click opens the mini panel');
  assert.equal(mini.isVisible(), true);

  bridge.handleBubbleTap(1);
  assert.equal(mini.isVisible(), false, 'second click hides it');
  // The blur that Windows fires after hide() + a full heartbeat period
  // must NOT resurrect it (the SWP_SHOWWINDOW re-show bug).
  mini.emit('blur');
  await sleep(1000);
  assert.equal(mini.isVisible(), false, 'mini STAYS hidden across blur + heartbeat');
  assert.deepEqual(hiddenAsserts(mini), [], 'no topmost call ever touches the window while hidden');

  bridge.handleBubbleTap(1);
  assert.equal(mini.isVisible(), true, 'third click brings it back');
});

test('WIN FIX 1: the mini titlebar X hides the panel for good', async () => {
  const { bridge, ipcMain } = boot();
  bridge.toggleMiniPanel();
  const mini = bridge.getMiniWindow();
  assert.equal(mini.isVisible(), true);

  ipcMain.onHandlers.get('yayra:overlay-mini-close')();
  assert.equal(mini.isVisible(), false, 'X hides the panel');
  await sleep(1000);
  assert.equal(mini.isVisible(), false, 'heartbeat can no longer re-show it');
  assert.deepEqual(hiddenAsserts(mini), []);
});

test('WIN FIX 3: "open in yayra main" hides the mini and surfaces the main window with the handoff', async () => {
  const { FakeWin } = makeFakeWindows();
  const mainWin = new FakeWin({ show: true });
  const { bridge, ipcMain } = boot({ getMainWindow: () => mainWin });
  bridge.toggleMiniPanel();
  const mini = bridge.getMiniWindow();

  ipcMain.onHandlers.get('yayra:overlay-mini-open-full')(null, { url: 'https://github.com/' });
  assert.equal(mini.isVisible(), false, 'mini steps aside');
  assert.ok(mainWin.calls.some((c) => c.type === 'focus'), 'main window focused');
  assert.deepEqual(mainWin.sent.at(-1), { channel: 'yayra:open-url', payload: { url: 'https://github.com/' } },
    'current site handed over to the full browser');
  await sleep(1000);
  assert.equal(mini.isVisible(), false, 'mini no longer resurrects over the main window');
});

test('WIN FIX 2: overlapping bubble + mini stop fighting - zero reorder calls once both hold the topmost flag', async () => {
  const { bridge, instances } = boot();
  const bubble = instances[0];
  bridge.toggleMiniPanel();
  const mini = bridge.getMiniWindow();
  assert.equal(bubble.isVisible() && mini.isVisible(), true, 'both surfaces on screen');
  assert.equal(bubble.isAlwaysOnTop() && mini.isAlwaysOnTop(), true, 'both already topmost');

  bubble.calls.length = 0;
  mini.calls.length = 0;
  // Blur ping-pong + both 800ms heartbeats - previously each tick
  // re-inserted one window above the other (the visible blinking).
  bubble.emit('blur');
  mini.emit('blur');
  await sleep(1000);
  const reorders = [...bubble.calls, ...mini.calls]
    .filter((c) => c.type === 'setAlwaysOnTop' || c.type === 'moveTop');
  assert.deepEqual(reorders, [], 'no z-order churn while both are visible and flagged');
});

test('static pin: the Windows re-show guard and sibling-fight damping stay in assertTopmost', () => {
  const src = fs.readFileSync(new URL('../electron/overlayWindow.cjs', import.meta.url), 'utf8');
  assert.match(src, /SWP_SHOWWINDOW/, 'the Windows re-show root cause stays documented');
  assert.match(src, /if \(typeof win\.isVisible === 'function' && !win\.isVisible\(\)\) return;/, 'hidden windows are never asserted');
  assert.match(src, /bothOverlaySurfacesVisible\(\) && typeof win\.isAlwaysOnTop === 'function' && win\.isAlwaysOnTop\(\)/, 'sibling-fight damping in place');
});
