/**
 * Floating bubble input gestures + triple-click position lock.
 *
 * THE BUG THIS GUARDS AGAINST: the bubble used to be one big
 * -webkit-app-region: drag element. Electron drag regions are handled
 * natively - the renderer NEVER receives left-button mouse events inside
 * them, so click/tap/double-click silently did nothing (right-click
 * still worked because contextmenu passes through). The fix removes the
 * native drag region entirely: dragging is a manual cursor-follow loop
 * in the main process, and real pointer events drive tap gestures:
 *   1 tap  -> toggle the floating mini browser
 *   2 taps -> open/restore the full browser
 *   3 taps -> LOCK the bubble position where it is; 3 more taps unlock.
 *
 * Covered here: the gesture dispatcher, the drag loop (including its
 * refusal to move while locked), lock persistence across restarts, the
 * bubble HTML contract (no app-region drag, pointer listeners present),
 * and the right-click menu's lock entry.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOverlayBridge } from '../electron/overlayWindow.cjs';
import { createOverlayStore, DEFAULTS } from '../electron/overlayStore.cjs';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yayra-overlay-gestures-'));
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

function makeFakeBrowserWindowClass() {
  const instances = [];
  class FakeBrowserWindow {
    constructor(opts) {
      this.opts = opts;
      this.destroyed = false;
      this.movable = true;
      this.loadedUrl = null;
      this._listeners = {};
      this._position = [opts.x, opts.y];
      this.sent = [];
      this.webContents = { send: (channel, payload) => this.sent.push({ channel, payload }) };
      instances.push(this);
    }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setContentProtection() {}
    setMovable(flag) { this.movable = flag; }
    setPosition(x, y) { this._position = [x, y]; }
    getPosition() { return this._position; }
    loadURL(url) { this.loadedUrl = url; }
    on(event, cb) { this._listeners[event] = cb; }
    hide() { this.hidden = true; }
    show() { this.hidden = false; }
    focus() {}
    isVisible() { return !this.hidden; }
    close() { this.destroyed = true; this._listeners.closed?.(); }
    isDestroyed() { return this.destroyed; }
  }
  return { FakeBrowserWindow, instances };
}

function makeHarness({ cursor = { x: 500, y: 300 } } = {}) {
  const dir = makeTempDir();
  const overlayStore = createOverlayStore({ fs, userDataDir: dir });
  const { FakeBrowserWindow, instances } = makeFakeBrowserWindowClass();
  const ipcMain = fakeIpcMain();
  const screenState = { cursor };
  const mainWindowCalls = [];
  const bridge = createOverlayBridge({
    BrowserWindow: FakeBrowserWindow,
    app: { setLoginItemSettings: () => {}, getPath: () => dir },
    ipcMain,
    screen: {
      getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
      getCursorScreenPoint: () => ({ ...screenState.cursor })
    },
    path,
    preloadPath: '/fake/overlayPreload.cjs',
    mainPreloadPath: '/fake/preload.cjs',
    overlayStore,
    getMainWindow: () => { mainWindowCalls.push('get'); return null; },
    createMainWindow: () => { mainWindowCalls.push('create'); return {}; },
    platform: 'win32',
    fsImpl: { readFileSync: () => Buffer.from('png') },
    logoPath: '/fake/logo.png',
    Menu: null
  });
  return { bridge, overlayStore, instances, ipcMain, screenState, mainWindowCalls, dir };
}

/* --------------------------- bubble HTML contract --------------------------- */

test('bubble HTML: NO native drag region (it swallowed left clicks) + pointer gesture listeners', () => {
  const { bridge, instances } = makeHarness();
  bridge.ensureOverlayWindow();
  const html = decodeURIComponent(instances[0].loadedUrl.replace('data:text/html;charset=utf-8,', ''));

  assert.ok(!html.includes('-webkit-app-region'), 'native drag region must stay gone - it ate every left-button event');
  assert.ok(html.includes('pointerdown') && html.includes('pointerup'), 'manual pointer handling drives taps AND dragging');
  assert.ok(html.includes("api.tap"), 'settled tap counts are sent to the main process');
  assert.ok(html.includes('dragStart') && html.includes('dragEnd'), 'manual drag bridges present');
  assert.ok(html.includes('contextmenu'), 'right-click menu still wired');
  // Still only the logo - the no-circle contract holds.
  assert.ok(!html.includes('radial-gradient') && !html.includes('border-radius:50%'));
});

/* ------------------------------ tap gestures ------------------------------ */

test('gestures: 1 tap toggles the mini browser, 2 taps opens the full browser', () => {
  const { bridge, instances, mainWindowCalls } = makeHarness();
  bridge.ensureOverlayWindow();

  bridge.handleBubbleTap(1);
  const mini = bridge.getMiniWindow();
  assert.ok(mini, 'single tap opened yayra mini');
  bridge.handleBubbleTap(1);
  assert.equal(mini.hidden, true, 'second single-tap toggles it away');

  bridge.handleBubbleTap(2);
  assert.ok(mainWindowCalls.includes('create'), 'double tap opens/restores the FULL browser');
  assert.equal(instances[0].isDestroyed(), false, 'bubble itself stays');
});

test('gestures: 3 taps locks the position, 3 more unlocks - persisted and announced to the bubble', () => {
  const { bridge, overlayStore, instances } = makeHarness();
  bridge.ensureOverlayWindow();
  const bubble = instances[0];
  assert.equal(overlayStore.load().positionLocked, false, 'ships unlocked');

  bridge.handleBubbleTap(3);
  assert.equal(overlayStore.load().positionLocked, true, 'triple tap locks');
  assert.equal(bubble.movable, false, 'native movability off too');
  assert.deepEqual(bubble.sent.at(-1), { channel: 'yayra:overlay-lock-changed', payload: true }, 'bubble UI told to show the lock');

  bridge.handleBubbleTap(3);
  assert.equal(overlayStore.load().positionLocked, false, 'triple tap again unlocks');
  assert.deepEqual(bubble.sent.at(-1), { channel: 'yayra:overlay-lock-changed', payload: false });
});

test('gestures: lock survives a restart (new store over the same dir stays locked)', () => {
  const { bridge, dir } = makeHarness();
  bridge.ensureOverlayWindow();
  bridge.handleBubbleTap(3);

  const rebooted = createOverlayStore({ fs, userDataDir: dir });
  assert.equal(rebooted.load().positionLocked, true, 'lock state persisted to disk');
  assert.equal(DEFAULTS.positionLocked, false, 'but fresh installs ship unlocked');
});

test('gestures: IPC channels are registered for tap, drag and the settings lock toggle', () => {
  const { bridge, ipcMain, overlayStore } = makeHarness();
  bridge.ensureOverlayWindow();
  assert.ok(ipcMain.onHandlers.has('yayra:overlay-bubble-tap'));
  assert.ok(ipcMain.onHandlers.has('yayra:overlay-drag-start'));
  assert.ok(ipcMain.onHandlers.has('yayra:overlay-drag-end'));
  assert.ok(ipcMain.handlers.has('yayra:overlay-set-position-locked'));

  // The settings toggle mirrors the triple-click.
  const result = ipcMain.handlers.get('yayra:overlay-set-position-locked')(null, true);
  assert.equal(result.positionLocked, true);
  assert.equal(overlayStore.load().positionLocked, true);

  // Tap IPC routes through the same dispatcher (3 -> unlock again).
  ipcMain.onHandlers.get('yayra:overlay-bubble-tap')(null, 3);
  assert.equal(overlayStore.load().positionLocked, false);
});

/* ------------------------------ manual drag ------------------------------ */

test('drag: the bubble follows the OS cursor minus the grab offset, and persists where it lands', async () => {
  const { bridge, instances, screenState, overlayStore } = makeHarness({ cursor: { x: 500, y: 300 } });
  bridge.ensureOverlayWindow();
  const bubble = instances[0];

  const started = bridge.beginBubbleDrag({ x: 10, y: 12 });
  assert.equal(started, true);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(bubble.getPosition(), [490, 288], 'window = cursor - grab offset');

  screenState.cursor = { x: 800, y: 650 };
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(bubble.getPosition(), [790, 638], 'keeps following the cursor');

  bridge.endBubbleDrag();
  assert.deepEqual(overlayStore.load().position, { x: 790, y: 638 }, 'dropped position persisted');

  screenState.cursor = { x: 100, y: 100 };
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(bubble.getPosition(), [790, 638], 'loop fully stopped after pointerup');
});

test('drag: REFUSED while the position is locked - the bubble stays exactly where it is', async () => {
  const { bridge, instances, screenState } = makeHarness({ cursor: { x: 500, y: 300 } });
  bridge.ensureOverlayWindow();
  const bubble = instances[0];
  const before = [...bubble.getPosition()];

  bridge.handleBubbleTap(3); // lock
  const started = bridge.beginBubbleDrag({ x: 0, y: 0 });
  assert.equal(started, false, 'drag request rejected while locked');
  screenState.cursor = { x: 900, y: 900 };
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(bubble.getPosition(), before, 'bubble did not move an inch');

  bridge.handleBubbleTap(3); // unlock
  assert.equal(bridge.beginBubbleDrag({ x: 0, y: 0 }), true, 'dragging works again after unlock');
  bridge.endBubbleDrag({ persist: false });
});

test('drag: destroying the overlay stops any in-flight drag loop safely', async () => {
  const { bridge, screenState } = makeHarness();
  bridge.ensureOverlayWindow();
  bridge.beginBubbleDrag({ x: 0, y: 0 });
  bridge.destroyOverlayWindow();
  screenState.cursor = { x: 1, y: 1 };
  await new Promise((r) => setTimeout(r, 40)); // would throw if the loop still ran on a destroyed window
  assert.equal(bridge.getOverlayWindow(), null);
});
