/**
 * Floating bubble input gestures + triple-click position lock.
 *
 * THE BUG THIS GUARDS AGAINST: the bubble used to be one big
 * -webkit-app-region: drag element. Electron drag regions are handled
 * natively - the renderer NEVER receives left-button mouse events inside
 * them, so click/tap/double-click silently did nothing (right-click
 * still worked because contextmenu passes through). The fix removes the
 * native drag region entirely: dragging is manual - the renderer streams
 * pointermove screen coordinates to the main process once the pointer
 * leaves the tap slop (NEVER cursor polling, and NEVER movement on a
 * mere pointerdown - that was the v1.0.4 regression) - and real pointer
 * events drive tap gestures:
 *   1 tap  -> toggle the floating mini browser
 *   2 taps -> toggle the AssistiveTouch-style RADIAL MENU of circular
 *             action buttons (Yayra AI / mini / full / lock / hide / quit)
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
    setBounds(bounds) {
      this.bounds = { ...bounds };
      this._position = [bounds.x, bounds.y];
      this._listeners.moved?.();
    }
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

function makeHarness({ cursor = { x: 500, y: 300 }, withMenu = false, screenshot = false } = {}) {
  const dir = makeTempDir();
  const overlayStore = createOverlayStore({ fs, userDataDir: dir });
  const { FakeBrowserWindow, instances } = makeFakeBrowserWindowClass();
  const ipcMain = fakeIpcMain();
  const screenState = { cursor };
  const mainWindowCalls = [];
  // Right-click menu capture (openBubbleMenu test).
  const menus = [];
  const Menu = withMenu
    ? { buildFromTemplate: (template) => { menus.push(template); return { popup: () => {} }; } }
    : null;
  // Real-screenshot fakes: a capturer that returns one screen source and
  // a shell that records the reveal call. Files land in the temp dir.
  const revealed = [];
  const screenshotDeps = screenshot
    ? {
      desktopCapturerImpl: {
        getSources: async () => [{
          display_id: '7',
          thumbnail: { isEmpty: () => false, toPNG: () => Buffer.from('fake-png-bytes') }
        }]
      },
      shellImpl: { showItemInFolder: (file) => revealed.push(file) },
      screenshotDir: () => dir
    }
    : {};
  const bridge = createOverlayBridge({
    BrowserWindow: FakeBrowserWindow,
    app: { setLoginItemSettings: () => {}, getPath: () => dir },
    ipcMain,
    screen: {
      getPrimaryDisplay: () => ({
        workAreaSize: { width: 1920, height: 1080 },
        size: { width: 1920, height: 1080 },
        scaleFactor: 1,
        id: 7
      }),
      getCursorScreenPoint: () => ({ ...screenState.cursor })
    },
    path,
    preloadPath: '/fake/overlayPreload.cjs',
    mainPreloadPath: '/fake/preload.cjs',
    overlayStore,
    getMainWindow: () => { mainWindowCalls.push('get'); return null; },
    createMainWindow: () => { mainWindowCalls.push('create'); return {}; },
    platform: 'win32',
    fsImpl: screenshot ? fs : { readFileSync: () => Buffer.from('png') },
    logoPath: screenshot ? null : '/fake/logo.png',
    Menu,
    ...screenshotDeps
  });
  return { bridge, overlayStore, instances, ipcMain, screenState, mainWindowCalls, dir, menus, revealed };
}

/* --------------------------- bubble HTML contract --------------------------- */

test('bubble HTML: NO native drag region (it swallowed left clicks) + pointer gesture listeners', () => {
  const { bridge, instances } = makeHarness();
  bridge.ensureOverlayWindow();
  const html = decodeURIComponent(instances[0].loadedUrl.replace('data:text/html;charset=utf-8,', ''));

  assert.ok(!html.includes('-webkit-app-region'), 'native drag region must stay gone - it ate every left-button event');
  assert.ok(html.includes('pointerdown') && html.includes('pointerup'), 'manual pointer handling drives taps AND dragging');
  assert.ok(html.includes("api.tap"), 'settled tap counts are sent to the main process');
  assert.ok(html.includes('dragStart') && html.includes('dragMove') && html.includes('dragEnd'), 'manual drag bridges present');
  assert.ok(html.includes('contextmenu'), 'right-click menu still wired');
  // Still only the logo - the no-circle contract holds for the BUBBLE
  // (the radial menu's circular buttons are a separate hidden layer).
  const bubbleRule = /#bubble\s*\{[^}]*\}/.exec(html)?.[0] || '';
  assert.ok(!html.includes('radial-gradient') && bubbleRule && !bubbleRule.includes('border-radius'));
});

/* ------------------------------ tap gestures ------------------------------ */

test('gestures: 1 tap toggles the mini browser, 2 taps opens the RADIAL circular-button menu', () => {
  const { bridge, instances } = makeHarness();
  bridge.ensureOverlayWindow();
  const bubble = instances[0];

  bridge.handleBubbleTap(1);
  const mini = bridge.getMiniWindow();
  assert.ok(mini, 'single tap opened yayra mini');
  bridge.handleBubbleTap(1);
  assert.equal(mini.hidden, true, 'second single-tap toggles it away');

  const before = [...bubble.getPosition()];
  bridge.handleBubbleTap(2);
  assert.equal(bridge.isRadialOpen(), true, 'double tap opens the radial menu');
  assert.equal(bubble.bounds.width, 340, 'window expanded to host the ring of buttons');
  assert.deepEqual(bubble.sent.at(-1).channel, 'yayra:overlay-radial', 'renderer told to show the ring');
  assert.equal(bubble.sent.at(-1).payload.open, true);

  bridge.handleBubbleTap(2);
  assert.equal(bridge.isRadialOpen(), false, 'double tap again closes it');
  assert.equal(bubble.bounds.width, 64, 'window shrank back to bubble size');
  assert.deepEqual(bubble.getPosition(), before, 'bubble back exactly where it was');
  assert.equal(bubble.isDestroyed(), false, 'bubble itself stays');
});

test('radial: single tap while open just closes the menu (no accidental mini)', () => {
  const { bridge } = makeHarness();
  bridge.ensureOverlayWindow();
  bridge.handleBubbleTap(2);
  assert.equal(bridge.isRadialOpen(), true);
  bridge.handleBubbleTap(1);
  assert.equal(bridge.isRadialOpen(), false);
  assert.equal(bridge.getMiniWindow(), null, 'mini did NOT open from the closing tap');
});

test('radial: the AI button opens yayra mini directly on the yayra://ai page', () => {
  const { bridge } = makeHarness();
  bridge.ensureOverlayWindow();
  bridge.handleBubbleTap(2);

  bridge.handleRadialAction('ai');
  assert.equal(bridge.isRadialOpen(), false, 'menu closes');
  const mini = bridge.getMiniWindow();
  assert.ok(mini, 'mini opened');
  assert.ok(mini.loadedUrl.includes('page=yayra%3A%2F%2Fai'), `mini deep-links to the AI page: ${mini.loadedUrl}`);
});

test('radial: full/mini/lock/hide buttons all do their real actions', () => {
  const { bridge, mainWindowCalls, overlayStore } = makeHarness();
  bridge.ensureOverlayWindow();

  bridge.handleBubbleTap(2);
  bridge.handleRadialAction('full');
  assert.ok(mainWindowCalls.includes('create'), 'full-browser button opens/restores the main window');
  assert.equal(bridge.isRadialOpen(), false);

  bridge.handleBubbleTap(2);
  bridge.handleRadialAction('mini');
  assert.ok(bridge.getMiniWindow(), 'mini button opens yayra mini');

  bridge.handleBubbleTap(2);
  bridge.handleRadialAction('lock');
  assert.equal(overlayStore.load().positionLocked, true, 'lock button = the triple-click lock');
  assert.equal(bridge.isRadialOpen(), true, 'menu stays open so the icon flip is visible');
  bridge.handleRadialAction('lock');
  assert.equal(overlayStore.load().positionLocked, false);

  bridge.handleRadialAction('hide');
  assert.equal(bridge.getOverlayWindow(), null, 'hide button disables the bubble');
  assert.equal(overlayStore.load().enabled, false);
});

test('radial: bubble HTML renders the ring - Yayra AI button included - and wires the actions', () => {
  const { bridge, instances } = makeHarness();
  bridge.ensureOverlayWindow();
  const html = decodeURIComponent(instances[0].loadedUrl.replace('data:text/html;charset=utf-8,', ''));

  assert.ok(html.includes('id="radial"'), 'radial container present');
  for (const action of ['ai', 'mini', 'full', 'lock', 'hide', 'quit', 'close']) {
    assert.ok(html.includes(`data-action="${action}"`), `circular button for "${action}"`);
  }
  assert.ok(html.includes('Ask Yayra AI'), 'AI button labelled');
  assert.ok(html.includes('radialAction'), 'buttons report back to the main process');
  assert.ok(html.includes('onRadial'), 'renderer listens for open/close from the main process');
});

test('radial: dragging is refused while the menu is open, and the enlarged position is never persisted', async () => {
  const { bridge, overlayStore, screenState } = makeHarness({ cursor: { x: 500, y: 300 } });
  bridge.ensureOverlayWindow();
  const savedBefore = overlayStore.load().position;

  bridge.handleBubbleTap(2);
  assert.equal(bridge.beginBubbleDrag({ x: 0, y: 0 }), false, 'no dragging the expanded menu');
  screenState.cursor = { x: 900, y: 900 };
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(overlayStore.load().position, savedBefore, 'radial setBounds did not pollute the saved bubble position');

  bridge.handleBubbleTap(2); // close
  assert.equal(bridge.beginBubbleDrag({ x: 0, y: 0 }), true, 'dragging works again once closed');
  bridge.endBubbleDrag({ persist: false });
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
  assert.ok(ipcMain.onHandlers.has('yayra:overlay-drag-move'));
  assert.ok(ipcMain.onHandlers.has('yayra:overlay-drag-end'));
  assert.ok(ipcMain.onHandlers.has('yayra:overlay-radial-action'));
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

test('drag: the window follows RENDERER-streamed pointer coordinates minus the grab offset, and persists where it lands', () => {
  // Regression contract for the v1.0.4 bug: the main process must NEVER
  // poll the cursor or move the window on a mere pointerdown - it only
  // repositions in response to streamed pointermove screen coordinates.
  const { bridge, instances, overlayStore } = makeHarness();
  bridge.ensureOverlayWindow();
  const bubble = instances[0];
  const before = [...bubble.getPosition()];

  const started = bridge.beginBubbleDrag({ x: 10, y: 12 });
  assert.equal(started, true);
  assert.deepEqual(bubble.getPosition(), before, 'pointerdown alone must NOT move the window');

  bridge.moveBubbleDrag({ x: 500, y: 300 });
  assert.deepEqual(bubble.getPosition(), [490, 288], 'window = streamed pointer - grab offset');

  bridge.moveBubbleDrag({ x: 800, y: 650 });
  assert.deepEqual(bubble.getPosition(), [790, 638], 'keeps following the streamed pointer');

  bridge.endBubbleDrag();
  assert.deepEqual(overlayStore.load().position, { x: 790, y: 638 }, 'dropped position persisted');

  assert.equal(bridge.moveBubbleDrag({ x: 100, y: 100 }), false, 'moves after pointerup are ignored');
  assert.deepEqual(bubble.getPosition(), [790, 638], 'drag fully stopped after pointerup');
});

test('drag: garbage streamed coordinates are ignored mid-drag', () => {
  const { bridge, instances } = makeHarness();
  bridge.ensureOverlayWindow();
  const bubble = instances[0];
  bridge.beginBubbleDrag({ x: 0, y: 0 });
  bridge.moveBubbleDrag({ x: 50, y: 60 });
  assert.equal(bridge.moveBubbleDrag({ x: 'NaN', y: null }), false);
  assert.equal(bridge.moveBubbleDrag(null), false);
  assert.deepEqual(bubble.getPosition(), [50, 60], 'position untouched by malformed payloads');
  bridge.endBubbleDrag({ persist: false });
});

test('drag: REFUSED while the position is locked - the bubble stays exactly where it is', () => {
  const { bridge, instances } = makeHarness();
  bridge.ensureOverlayWindow();
  const bubble = instances[0];
  const before = [...bubble.getPosition()];

  bridge.handleBubbleTap(3); // lock
  const started = bridge.beginBubbleDrag({ x: 0, y: 0 });
  assert.equal(started, false, 'drag request rejected while locked');
  assert.equal(bridge.moveBubbleDrag({ x: 900, y: 900 }), false, 'streamed moves ignored too');
  assert.deepEqual(bubble.getPosition(), before, 'bubble did not move an inch');

  bridge.handleBubbleTap(3); // unlock
  assert.equal(bridge.beginBubbleDrag({ x: 0, y: 0 }), true, 'dragging works again after unlock');
  bridge.endBubbleDrag({ persist: false });
});

test('drag: destroying the overlay stops any in-flight drag safely', () => {
  const { bridge } = makeHarness();
  bridge.ensureOverlayWindow();
  bridge.beginBubbleDrag({ x: 0, y: 0 });
  bridge.destroyOverlayWindow();
  // Would throw if a move still touched the destroyed window.
  assert.equal(bridge.moveBubbleDrag({ x: 1, y: 1 }), false);
  assert.equal(bridge.getOverlayWindow(), null);
});

/* ------------------- restored v1.0.2 wheel features (P26) ------------------- */

test('radial: the ring restores every classic v1.0.2 assistant + screenshot + shields alongside the newer actions', () => {
  const { bridge, instances } = makeHarness();
  bridge.ensureOverlayWindow();
  const html = decodeURIComponent(instances[0].loadedUrl.replace('data:text/html;charset=utf-8,', ''));
  for (const action of ['ai', 'chatgpt', 'gemini', 'claude', 'perplexity', 'screenshot', 'mini', 'full', 'shields', 'lock', 'hide', 'quit']) {
    assert.ok(html.includes(`data-action="${action}"`), `ring button present: ${action}`);
  }
  // The labels users knew from the old in-app wheel.
  assert.ok(html.includes('Ask ChatGPT'), 'classic ChatGPT label restored');
  assert.ok(html.includes('Rephrase with Gemini'), 'classic Gemini label restored');
  assert.ok(html.includes('Claude Assistant') && html.includes('Perplexity Search'));
});

test('radial: assistant buttons open yayra mini on the right external page; shields opens yayra://extensions', () => {
  const cases = [
    ['chatgpt', 'https://chatgpt.com'],
    ['gemini', 'https://gemini.google.com'],
    ['claude', 'https://claude.ai'],
    ['perplexity', 'https://perplexity.ai'],
    ['shields', 'yayra://extensions']
  ];
  for (const [action, page] of cases) {
    const { bridge } = makeHarness();
    bridge.ensureOverlayWindow();
    bridge.handleBubbleTap(2);
    bridge.handleRadialAction(action);
    assert.equal(bridge.isRadialOpen(), false, `${action}: radial closed`);
    const mini = bridge.getMiniWindow();
    assert.ok(mini, `${action}: mini window opened`);
    assert.ok(mini.loadedUrl.includes(`page=${encodeURIComponent(page)}`), `${action}: deep-linked to ${page}`);
  }
});

test('screenshot: REALLY captures the primary display to a PNG in the downloads dir and reveals it (no fake alert)', async () => {
  const { bridge, instances, dir, revealed } = makeHarness({ screenshot: true });
  bridge.ensureOverlayWindow();
  const bubble = instances[0];

  const result = await bridge.captureScreenshot();
  assert.equal(result.ok, true, 'capture succeeded');
  assert.ok(result.file.startsWith(dir) && result.file.endsWith('.png'), 'PNG saved into the screenshot dir');
  assert.deepEqual(fs.readFileSync(result.file), Buffer.from('fake-png-bytes'), 'REAL image bytes written to disk');
  assert.deepEqual(revealed, [result.file], 'file revealed in the file manager');
  assert.equal(bubble.hidden, false, 'bubble shown again after the grab');
});

test('screenshot: reports itself unavailable when the capturer is not wired - never fakes success', async () => {
  const { bridge } = makeHarness();
  bridge.ensureOverlayWindow();
  const result = await bridge.captureScreenshot();
  assert.deepEqual(result, { ok: false, reason: 'unavailable' });
});

test('right-click menu: classic items restored - AI assistants submenu, Capture screenshot, Security & Shields', () => {
  const { bridge, menus } = makeHarness({ withMenu: true });
  bridge.ensureOverlayWindow();
  bridge.openBubbleMenu();
  assert.equal(menus.length, 1, 'menu popped');
  const labels = menus[0].map((item) => item.label).filter(Boolean);
  assert.ok(labels.includes('Ask Yayra AI'));
  assert.ok(labels.includes('AI assistants'));
  assert.ok(labels.includes('Capture screenshot'));
  assert.ok(labels.includes('Security & Shields'));
  assert.ok(labels.includes('Open yayra mini') && labels.includes('Open full browser'));
  assert.ok(labels.includes('Quit Yayra'));
  const sub = menus[0].find((item) => item.label === 'AI assistants').submenu.map((s) => s.label);
  assert.deepEqual(sub, ['Ask ChatGPT', 'Rephrase with Gemini', 'Claude Assistant', 'Perplexity Search']);
});
