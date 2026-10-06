import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

import { BrowserShell } from '../packages/shared-ui/src/components/BrowserShell.js';

/**
 * THE REPORTED FREEZE: "everywhere is blur and anything on the site is not
 * working, not even scrolling."
 *
 * ROOT CAUSE: the update splash (full-screen, backdrop-blur(14px),
 * z-index 2147483000) dismissed itself with a single 2.6s setTimeout -
 * and Chromium FREEZES timers in backgrounded/minimized windows. Update
 * installs relaunch the app (often while the user is elsewhere), so the
 * splash's dismissal never fired: a permanent blur wall eating every
 * click and wheel event. Its "leave" state also kept pointer-events, so
 * a throttled removal left an INVISIBLE full-screen wall (freeze with
 * nothing visible). And Esc had no power over most overlays.
 *
 * THE FIX, pinned here:
 *  1. Splash dismissal is multi-trigger (timer + visibilitychange +
 *     any pointer/key input + click), removal never hangs on one timer,
 *     hidden pages remove synchronously, and any render force-retires a
 *     splash older than 10s.
 *  2. The leaving splash stops eating input IMMEDIATELY (pointer-events).
 *  3. dismissAllOverlays(): ONE call (and one Esc press) closes every
 *     overlay - state chrome AND body-appended dialogs.
 *  4. Reader / task manager / QR actually obscure the desktop native page
 *     surface while open and restore it on close.
 */

async function makeShell() {
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, isMobile: false });
  await shell.initialize();
  shell.render(container);
  return { shell, container };
}

test('SPLASH: a stuck splash (frozen timers) is force-retired by the next render', async () => {
  const { shell, container } = await makeShell();
  try {
    shell.showUpdateSplash('9.9.9', '9.9.8');
    const splash = document.querySelector('.fb-update-splash');
    assert.ok(splash, 'splash rendered');
    assert.ok(splash.classList.contains('fb-update-splash'));
    // Simulate the exact reported failure: every dismissal trigger died
    // (background window, frozen timers) - the splash just sits there.
    // Age it past the 10s grace window and let ANY render happen.
    splash.dataset.shownAt = String(Date.now() - 20000);
    shell.render(container);
    assert.equal(document.querySelector('.fb-update-splash'), null, 'the blur wall is force-retired');
  } finally {
    shell.destroy();
  }
});

test('SPLASH: clicking it dismisses immediately - input stops being eaten the same instant', async () => {
  const { shell } = await makeShell();
  try {
    shell.showUpdateSplash('9.9.9', '9.9.8');
    const splash = document.querySelector('.fb-update-splash');
    assert.ok(splash);
    splash.click();
    assert.ok(splash.classList.contains('fb-update-splash-leave'), 'leave state applies synchronously on click');
    // The removal has a 600ms belt-and-braces timer (Node timers run fine
    // here); it must never hang longer than that.
    await new Promise((r) => setTimeout(r, 750));
    assert.equal(document.querySelector('.fb-update-splash'), null, 'splash fully removed');
  } finally {
    shell.destroy();
  }
});

test('SPLASH (source pin): dismissal has THREE independent triggers + hidden pages remove synchronously', () => {
  const src = readFileSync(new URL('../packages/shared-ui/src/components/BrowserShell.js', import.meta.url), 'utf8');
  const start = src.indexOf('showUpdateSplash(version, previousVersion = null) {');
  const block = src.slice(start, src.indexOf('getActiveTab()', start));
  assert.match(block, /visibilitychange/, 'visibilitychange trigger: the moment the user returns, the splash retires');
  assert.match(block, /addEventListener\?\.\('pointerdown', dismiss/, 'any pointer input dismisses');
  assert.match(block, /addEventListener\?\.\('keydown', dismiss/, 'any key input dismisses');
  assert.match(block, /document\.hidden === true/, 'hidden pages remove synchronously - no timer dependence');
  assert.match(block, /shownAt/, 'birth stamp for the render sweep');
});

test('SPLASH CSS (source pin): the leaving splash stops eating input IMMEDIATELY', () => {
  const css = readFileSync(new URL('../packages/shared-ui/src/theme/design-system.css', import.meta.url), 'utf8');
  const block = /\.fb-update-splash\.fb-update-splash-leave\s*\{/.exec(css);
  assert.ok(block, 'leave rule exists');
  const body = css.slice(block.index, css.indexOf('}', block.index)).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(body, /pointer-events:\s*none/, 'no click/scroll swallowing once dismissal starts');
});

test('ESCAPE HATCH: dismissAllOverlays() closes EVERY overlay at once', async () => {
  const { shell } = await makeShell();
  try {
    // Open one of everything: state chrome...
    shell.state.isSideDrawerOpen = true;
    shell.state.activeModal = 'tab-switcher';
    shell.state.isSecurityDropdownOpen = true;
    shell.state.isAccountMenuOpen = true;
    shell.state.isDownloadsDropdownOpen = true;
    shell.state.findInPage.isOpen = true;
    // ...and the body-appended dialogs (fake instances of each).
    for (const [id, cls] of [
      ['yayra-reader-overlay', 'fb-reader'],
      ['yayra-taskmgr-overlay', 'fb-taskmgr'],
      ['yayra-url-qr-overlay', 'fb-qr'],
      [null, 'fb-passkey-dialog-overlay'],
      [null, 'fb-tab-context-menu'],
      [null, 'fb-dropdown-scrim'],
      [null, 'fb-update-splash']
    ]) {
      const el = document.createElement('div');
      if (id) el.id = id;
      if (cls) el.className = cls;
      document.body.appendChild(el);
    }

    const dismissed = shell.dismissAllOverlays();
    assert.equal(dismissed, true, 'something was open, something was dismissed');
    assert.equal(shell.state.isSideDrawerOpen, false);
    assert.equal(shell.state.activeModal, null);
    assert.equal(shell.state.isSecurityDropdownOpen, false);
    assert.equal(shell.state.isAccountMenuOpen, false);
    assert.equal(shell.state.isDownloadsDropdownOpen, false);
    assert.equal(shell.state.findInPage.isOpen, false);
    assert.equal(document.getElementById('yayra-reader-overlay'), null, 'reader gone');
    assert.equal(document.getElementById('yayra-taskmgr-overlay'), null, 'task manager gone');
    assert.equal(document.getElementById('yayra-url-qr-overlay'), null, 'QR gone');
    assert.equal(document.querySelector('.fb-passkey-dialog-overlay'), null, 'passkey dialog gone');
    assert.equal(document.querySelector('.fb-tab-context-menu'), null, 'tab menu gone');
    assert.equal(document.querySelector('.fb-dropdown-scrim'), null, 'scrim gone');
    assert.equal(document.querySelector('.fb-update-splash'), null, 'splash gone');

    // Nothing open: a no-op that neither throws nor lies.
    assert.equal(shell.dismissAllOverlays(), false, 'clean UI reports nothing dismissed');
  } finally {
    shell.destroy();
  }
});

test('ESC: one key press closes a modal, the find bar and the drawer together', async () => {
  const { shell } = await makeShell();
  try {
    shell.state.activeModal = 'clear-data';
    shell.state.findInPage.isOpen = true;
    shell.state.isSideDrawerOpen = true;
    let prevented = 0;
    shell.handleGlobalKeyDown({ key: 'Escape', preventDefault() { prevented += 1; } });
    assert.equal(shell.state.activeModal, null, 'modal closed by Esc');
    assert.equal(shell.state.findInPage.isOpen, false, 'find bar closed by Esc');
    assert.equal(shell.state.isSideDrawerOpen, false, 'drawer still closed by Esc (regression)');
    assert.equal(prevented, 1, 'Esc is consumed when it dismissed something');
  } finally {
    shell.destroy();
  }
});

test('DESKTOP VISIBILITY: QR/reader/task-manager obscure the native page while open and restore it on close', async () => {
  globalThis.window.yayra = {
    webview: {
      ensure: async () => ({}), setBounds: async () => {}, setVisible: async () => {},
      stop: async () => {}, goBack: async () => {}, goForward: async () => {},
      reload: async () => {}, destroy: async () => {}, capture: async () => ({}), onEvent: () => () => {}
    }
  };
  try {
    const container = document.createElement('div');
    const shell = new BrowserShell({ container, isMobile: false });
    await shell.initialize();
    shell.state.tabs[0].url = 'https://example.com/';
    shell._nativeWebviewTabIds.add(shell.state.tabs[0].id);
    shell.render(container);

    shell.showUrlQrModal('https://example.com/');
    assert.equal(shell.state.isPageObscured, true, 'the native page surface hides so the dialog is visible');
    const qr = document.getElementById('yayra-url-qr-overlay');
    assert.ok(qr, 'QR dialog rendered');
    qr.querySelector('.fb-qr-close')?.click();
    assert.equal(shell.state.isPageObscured, false, 'the live page is restored on close');
    assert.equal(document.getElementById('yayra-url-qr-overlay'), null);
    shell.destroy();
  } finally {
    delete globalThis.window.yayra;
  }
});
