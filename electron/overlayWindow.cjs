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
  // --- all optional (keeps older tests/callers working unchanged) ---
  // Preload for the floating mini-browser window (the full window.yayra API,
  // NOT the tiny overlay preload) - when absent, the mini window feature is
  // disabled and bubble clicks fall back to restoring the main window.
  mainPreloadPath = null,
  // URL the mini window loads (the dist shell in compact mini mode).
  miniUrl = 'yayra://app/index.html?shell=mini',
  // Electron Menu class for the bubble's right-click menu.
  Menu = null,
  // Recreates the main browser window after it was closed - this is what
  // makes the bubble genuinely independent of the main window's lifetime.
  createMainWindow = null,
  // Linux autostart fallback dependencies (fs + home dir), injectable for
  // tests. app.setLoginItemSettings historically only covers Win/macOS, so
  // on Linux we also write a freedesktop autostart .desktop entry.
  fsImpl = null,
  homeDir = null,
  platform = process.platform,
  logger = console
}) {
  let overlayWin = null;
  let miniWin = null;

  function linuxAutostartFile() {
    if (!homeDir) return null;
    return path.join(homeDir, '.config', 'autostart', 'yayra.desktop');
  }

  function applyLinuxAutostart(enabled) {
    if (platform !== 'linux' || !fsImpl) return;
    const file = linuxAutostartFile();
    if (!file) return;
    try {
      if (enabled) {
        const execPath = process.env.APPIMAGE || process.execPath;
        // --yayra-autostart tells main.cjs this is a boot launch: start the
        // bubble + tray only, WITHOUT popping the main browser window over
        // whatever the user is doing right after login.
        const desktop = [
          '[Desktop Entry]',
          'Type=Application',
          'Name=Yayra',
          'Comment=Yayra floating browser bubble',
          `Exec=${JSON.stringify(execPath)} --yayra-autostart`,
          'X-GNOME-Autostart-enabled=true',
          'Terminal=false'
        ].join('\n') + '\n';
        fsImpl.mkdirSync(path.dirname(file), { recursive: true });
        fsImpl.writeFileSync(file, desktop, { mode: 0o644 });
      } else if (fsImpl.existsSync(file)) {
        fsImpl.unlinkSync(file);
      }
    } catch (err) {
      logger?.warn?.(`[yayra:overlay] could not write Linux autostart entry: ${err?.message || err}`);
    }
  }

  function applyLoginItemSettings(enabled) {
    try {
      // args: boot launches carry --yayra-autostart so only the bubble +
      // tray appear at login (never a surprise main window).
      app.setLoginItemSettings({ openAtLogin: Boolean(enabled), args: ['--yayra-autostart'] });
    } catch (err) {
      // Not supported in some sandboxed/CI/Linux-without-autostart
      // environments - never fatal, just means this one convenience is
      // unavailable there.
      logger?.warn?.(`[yayra:overlay] could not set login item: ${err?.message || err}`);
    }
    // Linux desktop environments use XDG autostart, which Electron's
    // setLoginItemSettings does not reliably cover - write the .desktop
    // entry ourselves so "start right from booting" is true on Linux too.
    applyLinuxAutostart(Boolean(enabled));
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
    const bubbleEl = document.getElementById('bubble');
    bubbleEl.addEventListener('click', () => {
      if (window.yayraOverlay?.bubbleClick) window.yayraOverlay.bubbleClick();
      else window.yayraOverlay?.restore();
    });
    bubbleEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.yayraOverlay?.openMenu?.();
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
    // The mini panel is anchored to the bubble - no bubble, no mini panel.
    destroyMiniWindow();
  }

  function getOverlayWindow() {
    return overlayWin;
  }

  /* -------------------------------------------------------------
   * Floating "yayra mini" panel - a REAL native always-on-top window
   * (not a <div> inside the main renderer), so it works even when the
   * main browser window is closed or was never opened. Single click on
   * the bubble toggles it, exactly like AssistiveTouch expanding.
   * ----------------------------------------------------------- */

  function miniDefaultBounds() {
    const width = 420;
    const height = 640;
    try {
      const area = screen.getPrimaryDisplay().workAreaSize;
      let x = area.width - width - 24;
      let y = area.height - height - 48;
      if (overlayWin && !overlayWin.isDestroyed() && typeof overlayWin.getPosition === 'function') {
        const [bx, by] = overlayWin.getPosition();
        const size = overlayStore.load().size || 64;
        x = Math.min(Math.max(12, bx + size - width), Math.max(12, area.width - width - 12));
        y = Math.min(Math.max(12, by - height - 12), Math.max(12, area.height - height - 12));
      }
      return { x, y, width, height };
    } catch {
      return { x: 80, y: 80, width, height };
    }
  }

  function ensureMiniWindow() {
    if (!mainPreloadPath) return null;
    if (miniWin && !miniWin.isDestroyed()) return miniWin;
    const bounds = miniDefaultBounds();
    miniWin = new BrowserWindow({
      ...bounds,
      frame: false,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: true,
      backgroundColor: '#101218',
      webPreferences: {
        preload: mainPreloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    miniWin.setAlwaysOnTop(true, 'screen-saver');
    if (typeof miniWin.setVisibleOnAllWorkspaces === 'function') {
      miniWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    miniWin.loadURL(miniUrl);
    miniWin.on('closed', () => { miniWin = null; });
    return miniWin;
  }

  function destroyMiniWindow() {
    if (miniWin && !miniWin.isDestroyed()) miniWin.close();
    miniWin = null;
  }

  function getMiniWindow() {
    return miniWin;
  }

  function toggleMiniPanel() {
    if (!mainPreloadPath) {
      restoreMainWindow();
      return null;
    }
    if (miniWin && !miniWin.isDestroyed()) {
      if (typeof miniWin.isVisible === 'function' && miniWin.isVisible()) {
        miniWin.hide();
      } else {
        miniWin.show?.();
        miniWin.focus?.();
      }
      return miniWin;
    }
    return ensureMiniWindow();
  }

  function restoreMainWindow() {
    const win = getMainWindow?.();
    if (win && !win.isDestroyed()) {
      if (win.isMinimized?.()) win.restore();
      win.show();
      win.focus();
      return win;
    }
    // Main window was closed (or never opened): the bubble must still be
    // able to open the full browser - this is what "the bubble does not
    // rely on yayra main" means in practice.
    if (typeof createMainWindow === 'function') {
      try {
        return createMainWindow();
      } catch (err) {
        logger?.warn?.(`[yayra:overlay] could not recreate main window: ${err?.message || err}`);
      }
    }
    return null;
  }

  function openBubbleMenu() {
    if (!Menu || !overlayWin || overlayWin.isDestroyed()) return;
    const template = [
      { label: 'Open yayra mini', click: () => toggleMiniPanel() },
      { label: 'Open full browser', click: () => restoreMainWindow() },
      { type: 'separator' },
      { label: 'Hide bubble (re-enable from Settings)', click: () => setEnabled(false) },
      { type: 'separator' },
      { label: 'Quit Yayra', click: () => { try { app.quit(); } catch { /* already quitting */ } } }
    ];
    Menu.buildFromTemplate(template).popup({ window: overlayWin });
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
  ipcMain.on('yayra:overlay-restore', () => restoreMainWindow());
  // Single bubble click: toggle the floating mini browser (independent of
  // the main window). Right-click: quick menu with full-browser/quit.
  ipcMain.on('yayra:overlay-bubble-click', () => toggleMiniPanel());
  ipcMain.on('yayra:overlay-bubble-menu', () => openBubbleMenu());
  // Sent from the mini shell's own chrome (close / expand buttons).
  ipcMain.on('yayra:overlay-mini-close', () => {
    if (miniWin && !miniWin.isDestroyed()) miniWin.hide();
  });
  ipcMain.on('yayra:overlay-mini-open-full', () => {
    if (miniWin && !miniWin.isDestroyed()) miniWin.hide();
    restoreMainWindow();
  });
  // "Minimize to bubble" from the main window: hide the whole OS window;
  // the native bubble (always present) is the way back in.
  ipcMain.on('yayra:overlay-minimize-main', () => {
    const win = getMainWindow?.();
    if (win && !win.isDestroyed()) win.hide();
    ensureOverlayWindow();
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
    ensureMiniWindow,
    destroyMiniWindow,
    getMiniWindow,
    toggleMiniPanel,
    restoreMainWindow,
    openBubbleMenu,
    setEnabled,
    setLaunchAtStartup,
    setOverlayAllApps,
    initializeOnStartup,
    applyLoginItemSettings
  };
}

module.exports = { createOverlayBridge };
