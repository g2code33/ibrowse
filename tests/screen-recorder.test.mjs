/**
 * Screen recorder behind the bubble's right-click menu.
 *
 * Contract guarded here:
 *  - PC SYSTEM SOUND is always requested (loopback getUserMedia with
 *    chromeMediaSource:'desktop' audio) - the user's only choice is
 *    whether their VOICE (microphone) is included or muted.
 *  - Encoded webm chunks stream over IPC and append to a REAL file in
 *    the save dir; stopping finalizes + reveals it. No fake alerts.
 *  - Honest degradation: an empty recording is discarded, an unwired
 *    recorder reports 'unavailable', double-start is refused.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScreenRecorder } from '../electron/screenRecorder.cjs';
import { createOverlayBridge } from '../electron/overlayWindow.cjs';
import { createOverlayStore } from '../electron/overlayStore.cjs';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yayra-recorder-'));
}

function fakeIpcMain() {
  const handlers = new Map();
  const onHandlers = new Map();
  return {
    handlers,
    onHandlers,
    handle: (channel, fn) => handlers.set(channel, fn),
    on: (channel, fn) => onHandlers.set(channel, fn),
    emit: (channel, ...args) => onHandlers.get(channel)?.(null, ...args)
  };
}

function makeFakeBrowserWindowClass() {
  const instances = [];
  class FakeBrowserWindow {
    constructor(opts) {
      this.opts = opts;
      this.destroyed = false;
      this.loadedUrl = null;
      this.sent = [];
      this.webContents = { send: (channel, payload) => this.sent.push({ channel, payload }) };
      instances.push(this);
    }
    loadURL(url) { this.loadedUrl = url; }
    on() {}
    destroy() { this.destroyed = true; }
    close() { this.destroyed = true; }
    isDestroyed() { return this.destroyed; }
  }
  return { FakeBrowserWindow, instances };
}

function makeHarness({ wired = true } = {}) {
  const dir = makeTempDir();
  const ipcMain = fakeIpcMain();
  const { FakeBrowserWindow, instances } = makeFakeBrowserWindowClass();
  const revealed = [];
  const recorder = createScreenRecorder({
    BrowserWindow: FakeBrowserWindow,
    ipcMain,
    screen: { getPrimaryDisplay: () => ({ id: 7 }) },
    path,
    desktopCapturerImpl: wired ? {
      getSources: async () => [{ id: 'screen:7:0', display_id: '7' }]
    } : null,
    fsImpl: wired ? fs : null,
    shellImpl: { showItemInFolder: (file) => revealed.push(file) },
    preloadPath: wired ? '/fake/recorderPreload.cjs' : null,
    saveDir: wired ? () => dir : null,
    logger: { log: () => {}, warn: () => {} }
  });
  return { recorder, ipcMain, instances, revealed, dir };
}

test('recorder: start spins up a hidden capture window whose page ALWAYS asks for PC system sound', async () => {
  const { recorder, instances } = makeHarness();
  const result = await recorder.start({ mic: true });
  assert.equal(result.ok, true);
  assert.ok(result.file.endsWith('.webm'), 'records to a webm file');

  const win = instances[0];
  assert.equal(win.opts.show, false, 'capture window stays hidden');
  const html = decodeURIComponent(win.loadedUrl.replace('data:text/html;charset=utf-8,', ''));
  assert.ok(html.includes("chromeMediaSource: 'desktop'"), 'desktop capture requested');
  assert.ok(html.includes("audio: { mandatory: { chromeMediaSource: 'desktop' } }"), 'SYSTEM SOUND loopback always requested');
  assert.ok(html.includes('chromeMediaSourceId'), 'pinned to the primary display source');
  assert.ok(html.includes('const WANT_MIC = true'), 'voice included when asked for');
  assert.ok(html.includes('MediaRecorder'), 'real MediaRecorder encoding');
  assert.ok(html.includes('AudioContext'), 'system sound + voice are mixed into one soundtrack');
  recorder.stop();
});

test('recorder: mic-muted start still records system sound - only the voice is off', async () => {
  const { recorder, instances } = makeHarness();
  await recorder.start({ mic: false });
  const html = decodeURIComponent(instances[0].loadedUrl.replace('data:text/html;charset=utf-8,', ''));
  assert.ok(html.includes('const WANT_MIC = false'), 'mic muted');
  assert.ok(html.includes("audio: { mandatory: { chromeMediaSource: 'desktop' } }"), 'PC sound is NOT optional');
  assert.equal(recorder.status().mic, false);
  recorder.stop();
});

test('recorder: chunks stream to a REAL file on disk; stop finalizes and reveals it', async () => {
  const { recorder, ipcMain, instances, revealed } = makeHarness();
  const { file } = await recorder.start({ mic: true });

  ipcMain.emit('yayra:rec-started', { systemAudio: true, mic: true });
  assert.equal(recorder.status().systemAudio, true, 'page reported loopback working');

  ipcMain.emit('yayra:rec-chunk', Buffer.from('webm-part-1|'));
  ipcMain.emit('yayra:rec-chunk', Buffer.from('webm-part-2'));

  const stopResult = recorder.stop();
  assert.equal(stopResult.ok, true);
  assert.equal(instances[0].sent.at(-1).channel, 'yayra:rec-stop', 'page asked to stop MediaRecorder gracefully');

  ipcMain.emit('yayra:rec-done');
  // Stream flush is async - give it a beat.
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fs.readFileSync(file, 'utf8'), 'webm-part-1|webm-part-2', 'REAL bytes on disk');
  assert.deepEqual(revealed, [file], 'finished recording revealed in the file manager');
  assert.equal(recorder.status().active, false);
});

test('recorder: honest degradation - page reporting NO system-audio loopback is surfaced in status', async () => {
  const { recorder, ipcMain } = makeHarness();
  await recorder.start({ mic: true });
  ipcMain.emit('yayra:rec-started', { systemAudio: false, mic: true });
  assert.equal(recorder.status().systemAudio, false, 'no pretending: loopback failure is visible');
  recorder.stop();
  ipcMain.emit('yayra:rec-done');
});

test('recorder: refuses double-start; unwired recorder reports unavailable; capture errors clean up', async () => {
  const { recorder, ipcMain } = makeHarness();
  await recorder.start({ mic: true });
  const second = await recorder.start({ mic: false });
  assert.deepEqual(second, { ok: false, reason: 'already-recording' });
  ipcMain.emit('yayra:rec-error', 'Permission denied');
  await new Promise((r) => setTimeout(r, 50)); // stream close is async
  assert.equal(recorder.status().active, false, 'error tears the session down');

  const { recorder: unwired } = makeHarness({ wired: false });
  assert.deepEqual(await unwired.start({ mic: true }), { ok: false, reason: 'unavailable' });
  assert.equal(unwired.isSupported(), false);
});

test('recorder: a recording that produced no data is discarded, not presented as a saved file', async () => {
  const { recorder, ipcMain, revealed } = makeHarness();
  const { file } = await recorder.start({ mic: true });
  recorder.stop();
  ipcMain.emit('yayra:rec-done');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fs.existsSync(file) && fs.statSync(file).size > 0, false, 'no empty file left behind');
  assert.deepEqual(revealed, [], 'nothing revealed');
});

/* ------------- right-click menu integration (overlay bridge) ------------- */

function makeOverlayHarness(screenRecorder) {
  const dir = makeTempDir();
  const overlayStore = createOverlayStore({ fs, userDataDir: dir });
  const { FakeBrowserWindow } = makeFakeBrowserWindowClass();
  class FakeOverlayWindow extends FakeBrowserWindow {
    constructor(opts) { super(opts); this._position = [opts.x, opts.y]; }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setContentProtection() {}
    setMovable() {}
    setPosition(x, y) { this._position = [x, y]; }
    getPosition() { return this._position; }
    setBounds(bounds) { this._position = [bounds.x, bounds.y]; }
    hide() {}
    show() {}
    focus() {}
    isVisible() { return true; }
  }
  const menus = [];
  const bridge = createOverlayBridge({
    BrowserWindow: FakeOverlayWindow,
    app: { setLoginItemSettings: () => {}, getPath: () => dir },
    ipcMain: fakeIpcMain(),
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
    path,
    preloadPath: '/fake/overlayPreload.cjs',
    mainPreloadPath: '/fake/preload.cjs',
    overlayStore,
    getMainWindow: () => null,
    createMainWindow: () => ({}),
    platform: 'win32',
    fsImpl: { readFileSync: () => Buffer.from('png') },
    logoPath: '/fake/logo.png',
    Menu: { buildFromTemplate: (template) => { menus.push(template); return { popup: () => {} }; } },
    screenRecorder
  });
  return { bridge, menus };
}

test('bubble menu: offers PC-sound+voice and mic-muted recording starts; swaps to Stop while recording', async () => {
  const { recorder } = makeHarness();
  const { bridge, menus } = makeOverlayHarness(recorder);
  bridge.ensureOverlayWindow();

  bridge.openBubbleMenu();
  const recItem = menus[0].find((item) => item.label === 'Screen recording');
  assert.ok(recItem, 'Screen recording submenu present');
  assert.deepEqual(recItem.submenu.map((s) => s.label), [
    'Record screen - PC sound + voice',
    'Record screen - PC sound only (mic muted)'
  ]);

  await recorder.start({ mic: false });
  bridge.openBubbleMenu();
  const stopItem = menus[1].find((item) => String(item.label).startsWith('Stop screen recording'));
  assert.ok(stopItem, 'active recording swaps the submenu for a Stop item');
  assert.ok(stopItem.label.includes('mic muted'), 'stop item shows the mic state');
  assert.ok(!menus[1].some((item) => item.label === 'Screen recording'), 'no second start while active');
  recorder.stop();
});

test('bubble menu: recording entries hidden entirely when the recorder is not wired', () => {
  const { bridge, menus } = makeOverlayHarness(null);
  bridge.ensureOverlayWindow();
  bridge.openBubbleMenu();
  assert.ok(!menus[0].some((item) => item.label === 'Screen recording'), 'no dead menu items');
});
