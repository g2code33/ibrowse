import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

import { BrowserShell } from '../packages/shared-ui/src/components/BrowserShell.js';

/**
 * Android system-wide floating bubble (YayraOverlayPlugin bridge).
 *
 * The REAL overlay - a foreground Service drawing a WindowManager
 * TYPE_APPLICATION_OVERLAY bubble above every other app - is Kotlin
 * (packages/floating-android/src/kotlin, installed into the generated
 * android/ project by scripts/ensure-capacitor-platform.mjs) and cannot
 * run here. These tests pin the JS half: feature detection, the
 * permission-then-show startup flow, the once-per-session permission
 * prompt, minimize-to-bubble handing off to the native overlay, and the
 * suppression of the duplicate in-page DOM bubble while the native one is
 * live (mirroring the Electron native-bubble suppression).
 */

function installFakeOverlayPlugin({ granted = true } = {}) {
  const calls = { hasPermission: 0, requestPermission: 0, show: 0, hide: 0, minimizeApp: 0 };
  const state = { granted };
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      YayraOverlay: {
        hasPermission: () => { calls.hasPermission += 1; return Promise.resolve({ granted: state.granted }); },
        requestPermission: () => { calls.requestPermission += 1; return Promise.resolve({ granted: state.granted }); },
        show: () => { calls.show += 1; return Promise.resolve(); },
        hide: () => { calls.hide += 1; return Promise.resolve(); },
        minimizeApp: () => { calls.minimizeApp += 1; return Promise.resolve(); }
      }
    }
  };
  return { calls, state, uninstall: () => { delete window.Capacitor; } };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('capacitorOverlay getter: absent on plain web/PWA (no window.Capacitor)', async () => {
  delete globalThis.window.Capacitor;
  const shell = new BrowserShell({ container: document.createElement('div'), platform: 'android', isMobile: true });
  await shell.initialize();
  assert.equal(shell.capacitorOverlay, null);
});

test('capacitorOverlay getter: absent when Capacitor exists but the native overlay plugin is not installed', async () => {
  window.Capacitor = { isNativePlatform: () => true, Plugins: { Browser: { open: async () => {} } } };
  try {
    const shell = new BrowserShell({ container: document.createElement('div'), platform: 'android', isMobile: true });
    await shell.initialize();
    assert.equal(shell.capacitorOverlay, null);
  } finally {
    delete window.Capacitor;
  }
});

test('permission granted: ensureSystemOverlayBubble starts the native bubble and suppresses the duplicate in-page bubble', async () => {
  const { calls, uninstall } = installFakeOverlayPlugin({ granted: true });
  try {
    const container = document.createElement('div');
    const shell = new BrowserShell({ container, platform: 'android', isMobile: true });
    await shell.initialize();
    shell.render(container);

    const active = await shell.ensureSystemOverlayBubble();
    assert.equal(active, true);
    assert.equal(calls.show, 1, 'native overlay service started');
    assert.equal(shell.state.systemBubbleActive, true);

    await settle();
    assert.equal(
      document.getElementById('yayra-persistent-assistive-bubble'),
      null,
      'in-page DOM bubble removed while the OS-level bubble is live (it already floats over Yayra itself)'
    );
  } finally {
    uninstall();
    document.getElementById('yayra-persistent-assistive-bubble')?.remove();
  }
});

test('permission NOT granted: prompts and opens the system settings page exactly once per session, never calls show()', async () => {
  const { calls, uninstall } = installFakeOverlayPlugin({ granted: false });
  try {
    const container = document.createElement('div');
    const shell = new BrowserShell({ container, platform: 'android', isMobile: true });
    await shell.initialize();

    assert.equal(await shell.ensureSystemOverlayBubble(), false);
    assert.equal(calls.show, 0, 'never starts the service without the overlay permission');
    assert.equal(calls.requestPermission, 1, 'user is taken to "Display over other apps"');
    assert.equal(shell.state.systemBubbleActive, false);

    // Second attempt in the same session must not nag again.
    assert.equal(await shell.ensureSystemOverlayBubble(), false);
    assert.equal(calls.requestPermission, 1, 'no permission nag loop');

    // In-page bubble stays as the fallback while permission is missing.
    shell.render(container);
    assert.ok(document.getElementById('yayra-persistent-assistive-bubble'), 'in-page bubble is the fallback without the permission');
  } finally {
    uninstall();
    document.getElementById('yayra-persistent-assistive-bubble')?.remove();
  }
});

test('minimizeToBubble with the native bubble active: hands off to the OS overlay and sends the app to the background', async () => {
  const { calls, uninstall } = installFakeOverlayPlugin({ granted: true });
  try {
    const container = document.createElement('div');
    const shell = new BrowserShell({ container, platform: 'android', isMobile: true });
    await shell.initialize();
    shell.render(container);
    await shell.ensureSystemOverlayBubble();

    shell.minimizeToBubble();
    await settle();

    assert.ok(calls.show >= 1, 'native bubble is (re)shown');
    assert.equal(calls.minimizeApp, 1, 'app moved to the background so the bubble floats over the next app');
    assert.equal(shell.state.isMinimizedToBubble, false, 'in-page minimized state NOT used - the OS bubble took over');
  } finally {
    uninstall();
    document.getElementById('yayra-persistent-assistive-bubble')?.remove();
  }
});
