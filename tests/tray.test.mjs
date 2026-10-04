/**
 * System tray controller: the floating bubble overlays every app on the
 * PC, so it must be visible and regulated from the OS tray as well.
 * All dependencies are injected - no GUI needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTrayController } = require('../electron/tray.cjs');

function makeHarness({ settings } = {}) {
  const state = {
    settings: {
      enabled: true,
      launchAtStartup: true,
      overlayAllApps: true,
      ...(settings || {})
    }
  };
  const overlayStore = {
    load: () => ({ ...state.settings }),
    save: (patch) => { Object.assign(state.settings, patch); return { ...state.settings }; }
  };
  const calls = { setEnabled: [], setOverlayAllApps: [], setLaunchAtStartup: [], toggleMini: 0, restoreMain: 0, quit: 0 };
  const overlayBridge = {
    setEnabled: (v) => { calls.setEnabled.push(v); state.settings.enabled = v; },
    setOverlayAllApps: (v) => { calls.setOverlayAllApps.push(v); state.settings.overlayAllApps = v; },
    setLaunchAtStartup: (v) => { calls.setLaunchAtStartup.push(v); state.settings.launchAtStartup = v; },
    toggleMiniPanel: () => { calls.toggleMini += 1; },
    restoreMainWindow: () => { calls.restoreMain += 1; }
  };
  const app = { quit: () => { calls.quit += 1; } };

  const trays = [];
  class FakeTray {
    constructor(icon) {
      this.icon = icon;
      this.tooltip = null;
      this.contextMenus = [];
      this.listeners = new Map();
      trays.push(this);
    }

    setToolTip(t) { this.tooltip = t; }
    setContextMenu(menu) { this.contextMenus.push(menu); }
    on(evt, fn) { this.listeners.set(evt, fn); }
    emit(evt) { this.listeners.get(evt)?.(); }
    destroy() { this.destroyed = true; }
  }
  const Menu = { buildFromTemplate: (template) => ({ template }) };
  const nativeImage = {
    createFromPath: (p) => ({
      path: p,
      isEmpty: () => false,
      resize: ({ width, height }) => ({ path: p, width, height })
    })
  };

  const controller = createTrayController({
    Tray: FakeTray,
    Menu,
    nativeImage,
    app,
    iconPath: '/fake/icon.png',
    overlayStore,
    overlayBridge,
    logger: { warn: () => {} }
  });

  return { controller, trays, calls, state, FakeTray };
}

function findItem(menu, label) {
  return menu.template.find((item) => item.label === label);
}

test('tray: initializes with tooltip, resized icon, and all bubble controls ON by default', () => {
  const { controller, trays } = makeHarness();
  const tray = controller.init();
  assert.ok(tray, 'tray created');
  assert.equal(trays.length, 1);
  assert.match(trays[0].tooltip, /Yayra/);
  assert.equal(trays[0].icon.width, 22, 'icon resized for tray');

  const menu = trays[0].contextMenus[0];
  assert.equal(findItem(menu, 'Floating bubble').checked, true, 'bubble ON by default');
  assert.equal(findItem(menu, 'Overlay above all apps').checked, true, 'overlay-all-apps ON by default');
  assert.equal(findItem(menu, 'Start when computer starts').checked, true, 'start-at-login ON by default');
  assert.ok(findItem(menu, 'Open Yayra browser'));
  assert.ok(findItem(menu, 'Open yayra mini'));
  assert.ok(findItem(menu, 'Quit Yayra'));
});

test('tray: checkboxes regulate the bubble through the overlay bridge and persist', () => {
  const { controller, trays, calls } = makeHarness();
  controller.init();
  const menu = trays[0].contextMenus[0];

  // User unchecks "Floating bubble" from the tray.
  const bubbleItem = findItem(menu, 'Floating bubble');
  bubbleItem.click({ checked: false });
  assert.deepEqual(calls.setEnabled, [false]);

  // Menu rebuilt after the toggle reflects the new state.
  const latest = trays[0].contextMenus.at(-1);
  assert.equal(findItem(latest, 'Floating bubble').checked, false);

  findItem(latest, 'Overlay above all apps').click({ checked: false });
  assert.deepEqual(calls.setOverlayAllApps, [false]);
  findItem(trays[0].contextMenus.at(-1), 'Start when computer starts').click({ checked: false });
  assert.deepEqual(calls.setLaunchAtStartup, [false]);
});

test('tray: open actions and quit are wired; left-click toggles the mini browser', () => {
  const { controller, trays, calls } = makeHarness();
  controller.init();
  const menu = trays[0].contextMenus[0];

  findItem(menu, 'Open Yayra browser').click();
  assert.equal(calls.restoreMain, 1);
  findItem(menu, 'Open yayra mini').click();
  assert.equal(calls.toggleMini, 1);

  trays[0].emit('click');
  assert.equal(calls.toggleMini, 2, 'tray left-click toggles mini');

  findItem(menu, 'Quit Yayra').click();
  assert.equal(calls.quit, 1);
});

test('tray: right-click refreshes checkbox state changed elsewhere (bubble menu, Settings)', () => {
  const { controller, trays, state } = makeHarness();
  controller.init();

  // Something else (bubble right-click menu) disabled the bubble.
  state.settings.enabled = false;
  trays[0].emit('right-click');
  const latest = trays[0].contextMenus.at(-1);
  assert.equal(findItem(latest, 'Floating bubble').checked, false, 'menu reflects external change');
});

test('tray: platforms without a tray degrade gracefully (never fatal)', () => {
  class ThrowingTray { constructor() { throw new Error('no tray on this session'); } }
  const { state } = makeHarness();
  const controller = createTrayController({
    Tray: ThrowingTray,
    Menu: { buildFromTemplate: (t) => ({ template: t }) },
    app: { quit: () => {} },
    overlayStore: { load: () => state.settings },
    logger: { warn: () => {} }
  });
  assert.equal(controller.init(), null, 'init returns null instead of throwing');
  controller.refresh(); // no-op, must not throw
  controller.destroy();
});
