'use strict';

/**
 * Yayra's system-wide floating overlay bubble (desktop).
 *
 * This is the real, Apple-AssistiveTouch-style always-on-top circle the
 * product spec asks for: a SEPARATE native OS window (not a <div> inside
 * the main browser window), so it keeps floating above every other
 * application on the desktop even while the main Yayra window is closed,
 * minimized, or was never opened this session at all.
 *
 * What this honestly achieves, using only public Electron/OS APIs:
 *   - `alwaysOnTop: 'screen-saver'` is the highest window level Electron
 *     exposes; combined with `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`
 *     it sits above ordinary windows AND other virtual desktops/Spaces and
 *     fullscreen apps on macOS. This is the same technique sticky-note /
 *     chat-head style always-on-top utilities use; it is not a kernel-level
 *     overlay, so a handful of other apps that also request top-level OS
 *     overlay status (e.g. the Windows Task Manager, or another
 *     screen-saver-level app) can still end up above it - there is no
 *     public desktop API that guarantees literally first in the Z-order
 *     over everything, including other overlay apps.
 *   - `app.setLoginItemSettings({ openAtLogin: true })` registers Yayra to
 *     launch at OS login (Windows/macOS). On Linux this depends on desktop
 *     environment autostart support, which Electron proxies through the
 *     same API where available.
 *   - It is created directly in `app.whenReady()`, independent of whether
 *     `createWindow()` (the full browser) ever runs - so it genuinely does
 *     not require opening the Yayra app, and shows up the moment Electron
 *     itself starts (including right after a fresh install's first launch,
 *     and after every subsequent reboot once login-item autostart is on).
 *
 * What this CANNOT honestly do, and why (do not ask for this to be faked):
 *   - Android: a true system-wide "draw over other apps" overlay (the same
 *     category as Facebook Messenger's chat heads) requires the
 *     `SYSTEM_ALERT_WINDOW` runtime permission plus a native foreground
 *     `Service` written in Kotlin/Java and registered in
 *     AndroidManifest.xml. Capacitor's WebView shell has no public API for
 *     this; it needs a real native plugin, which does not exist in this
 *     repo yet. See native/android/ for where that work would live.
 *   - iOS: Apple does not expose ANY API, public or private-but-App-Store-safe,
 *     that lets a third-party app draw above other apps or the home screen -
 *     AssistiveTouch is a first-party OS accessibility feature, not a
 *     capability any app can opt into. This is a platform policy wall, not
 *     a missing feature - the same category of hard limit documented for
 *     Google's embedded-webview sign-in block in docs/GOOGLE_SIGNIN.md.
 *
 * Fully dependency-injected so the pure parts (settings defaults, enable/
 * disable bookkeeping) are unit-testable without a real Electron runtime -
 * see tests/overlay-window.test.mjs.
 */

function createOverlayBridge({
  BrowserWindow,
  app,
  ipcMain,
  screen,
  path,
  preloadPath,
  overlayStore,
  getMainWindow,
  logger = console
}) {
  let overlayWin = null;

  function applyLoginItemSettings(enabled) {
    try {
      app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
    } catch (err) {
      // Not supported in some sandboxed/CI/Linux-without-autostart
      // environments - never fatal, just means this one convenience is
      // unavailable there.
      logger?.warn?.(`[yayra:overlay] could not set login item: ${err?.message || err}`);
    }
  }

  function defaultPosition() {
    try {
      const { width, height } = screen.getPrimaryDisplay().workAreaSize;
      const size = overlayStore.load().size;
      return { x: width - size - 24, y: height - size - 96 };
    } catch {
      return { x: 40, y: 40 };
    }
  }

  function buildOverlayHtml(settings) {
    return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  html, body { margin:0; padding:0; background:transparent; overflow:hidden; }
  #bubble {
    width:100vw; height:100vh; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    background:radial-gradient(circle at 35% 30%, #4f7cff, #172554);
    box-shadow:0 4px 18px rgba(0,0,0,0.45);
    opacity:${settings.opacity};
    -webkit-app-region: drag;
    cursor:grab;
    user-select:none;
  }
  #bubble:active { cursor:grabbing; }
  svg { width:55%; height:55%; pointer-events:none; }
</style></head>
<body>
  <div id="bubble" title="Open Yayra">
    <svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9"></circle>
      <path d="M8 12h8M12 8v8"></path>
    </svg>
  </div>
  <script>
    document.getElementById('bubble').addEventListener('click', () => {
      window.yayraOverlay?.restore();
    });
  </script>
</body></html>`;
  }

  function ensureOverlayWindow() {
    const settings = overlayStore.load();
    if (!settings.enabled) return null;
    if (overlayWin && !overlayWin.isDestroyed()) return overlayWin;

    const size = settings.size || 64;
    const pos = settings.position || defaultPosition();

    overlayWin = new BrowserWindow({
      width: size,
      height: size,
      x: pos.x,
      y: pos.y,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    // 'screen-saver' is the highest always-on-top level Electron exposes -
    // see the module-level doc comment for exactly what this does and does
    // not guarantee.
    overlayWin.setAlwaysOnTop(true, 'screen-saver');
    if (typeof overlayWin.setVisibleOnAllWorkspaces === 'function') {
      overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    overlayWin.setContentProtection(false);
    overlayWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildOverlayHtml(settings))}`);

    overlayWin.on('moved', () => {
      try {
        const [x, y] = overlayWin.getPosition();
        overlayStore.save({ position: { x, y } });
      } catch {
        // best-effort persistence only
      }
    });

    overlayWin.on('closed', () => {
      overlayWin = null;
    });

    return overlayWin;
  }

  function destroyOverlayWindow() {
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.close();
    }
    overlayWin = null;
  }

  function getOverlayWindow() {
    return overlayWin;
  }

  function setEnabled(enabled) {
    const next = overlayStore.save({ enabled: Boolean(enabled) });
    if (next.enabled) ensureOverlayWindow();
    else destroyOverlayWindow();
    return next;
  }

  function setLaunchAtStartup(enabled) {
    const next = overlayStore.save({ launchAtStartup: Boolean(enabled) });
    applyLoginItemSettings(next.launchAtStartup);
    return next;
  }

  function setOverlayAllApps(enabled) {
    const next = overlayStore.save({ overlayAllApps: Boolean(enabled) });
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.setAlwaysOnTop(Boolean(enabled), 'screen-saver');
      if (typeof overlayWin.setVisibleOnAllWorkspaces === 'function') {
        overlayWin.setVisibleOnAllWorkspaces(Boolean(enabled), { visibleOnFullScreen: true });
      }
    }
    return next;
  }

  /**
   * Called once from app.whenReady(), independent of createWindow(), so the
   * bubble exists whether or not the user ever opens the full browser this
   * session - including the very first launch right after installation.
   */
  function initializeOnStartup() {
    const settings = overlayStore.load();
    // First run: nothing has been saved yet beyond the in-memory defaults,
    // so explicitly commit the "launch at startup" default to the OS once,
    // rather than only taking effect after the user visits Settings.
    applyLoginItemSettings(settings.launchAtStartup);
    if (settings.enabled) ensureOverlayWindow();
  }

  ipcMain.handle('yayra:overlay-get-settings', () => overlayStore.load());
  ipcMain.handle('yayra:overlay-set-enabled', (_e, enabled) => setEnabled(enabled));
  ipcMain.handle('yayra:overlay-set-launch-at-startup', (_e, enabled) => setLaunchAtStartup(enabled));
  ipcMain.handle('yayra:overlay-set-overlay-all-apps', (_e, enabled) => setOverlayAllApps(enabled));
  ipcMain.on('yayra:overlay-restore', () => {
    const win = getMainWindow?.();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  ipcMain.on('yayra:overlay-moved', (_e, position) => {
    if (position && typeof position.x === 'number' && typeof position.y === 'number') {
      overlayStore.save({ position });
    }
  });

  return {
    ensureOverlayWindow,
    destroyOverlayWindow,
    getOverlayWindow,
    setEnabled,
    setLaunchAtStartup,
    setOverlayAllApps,
    initializeOnStartup,
    applyLoginItemSettings
  };
}

module.exports = { createOverlayBridge };
