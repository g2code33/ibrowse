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
 * Siblings on other platforms:
 *   - Android: the true system-wide "draw over other apps" overlay (the
 *     same category as Facebook Messenger's chat heads) IS implemented -
 *     `SYSTEM_ALERT_WINDOW` permission + foreground Service + WindowManager
 *     TYPE_APPLICATION_OVERLAY views in packages/floating-android/src/kotlin,
 *     bridged to the web shell by YayraOverlayPlugin.kt and installed into
 *     the generated android/ project by scripts/ensure-capacitor-platform.mjs.
 *
 * What this CANNOT honestly do, and why (do not ask for this to be faked):
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

// Square size (px) the bubble window expands to while the radial menu of
// circular action buttons is open (double-tap the bubble to toggle it).
const RADIAL_SIZE = 300;

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
  // Absolute path to the Yayra brand logo (transparent PNG). Inlined as a
  // data URL into the bubble HTML so the bubble is ONLY the logo - no
  // circular backdrop around it.
  logoPath = null,
  logger = console
}) {
  let overlayWin = null;
  let miniWin = null;
  let cachedLogoDataUrl;
  // Heartbeats that keep the bubble/mini windows genuinely above every
  // other application - see assertTopmost() for why this is needed.
  let overlayTopmostTimer = null;
  let miniTopmostTimer = null;
  // Manual drag loop (the bubble has NO native drag region - drag regions
  // swallow left-button events, which broke clicking entirely).
  let dragTimer = null;
  // AssistiveTouch-style radial menu state: double-tap expands the bubble
  // window into a ring of circular action buttons (Yayra AI, mini, full
  // browser, lock, hide, quit) and remembers the bounds to shrink back to.
  let radialOpen = false;
  let radialRestoreBounds = null;

  /**
   * Force a window back to the top of the OS z-order.
   *
   * `alwaysOnTop: 'screen-saver'` is set at creation, but on real desktops
   * it is NOT a one-shot guarantee: Windows silently strips/undercuts the
   * topmost flag in several situations (fullscreen/exclusive apps, UAC
   * desktop switches, explorer restarts, other topmost apps calling
   * SetWindowPos above us), and some Linux WMs drop the hint on workspace
   * or compositor changes. The user-visible symptom is exactly "the bubble
   * only floats over the desktop, not over the apps I open". So the
   * topmost claim is re-asserted (a) whenever the OS reports it changed,
   * and (b) on a cheap heartbeat - the same strategy chat-head/overlay
   * utilities use. Re-asserting when already topmost is a no-op for the OS,
   * so the heartbeat causes no flicker.
   */
  function assertTopmost(win) {
    if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return;
    try {
      win.setAlwaysOnTop(true, 'screen-saver');
      if (typeof win.moveTop === 'function') win.moveTop();
      if (typeof win.setVisibleOnAllWorkspaces === 'function') {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      }
    } catch {
      // Window raced destruction between the check and the call.
    }
  }

  function startTopmostGuard(win, { onEvent = true } = {}) {
    if (!win) return null;
    if (onEvent && typeof win.on === 'function') {
      // Fired when anything (OS or another app) toggles our topmost state.
      win.on('always-on-top-changed', (_e, isOnTop) => {
        if (!isOnTop) assertTopmost(win);
      });
      win.on('show', () => assertTopmost(win));
    }
    if (typeof setInterval !== 'function') return null;
    const timer = setInterval(() => assertTopmost(win), 4000);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return timer;
  }

  function stopTopmostGuard(timer) {
    if (timer) clearInterval(timer);
    return null;
  }

  function logoDataUrl() {
    if (cachedLogoDataUrl !== undefined) return cachedLogoDataUrl;
    cachedLogoDataUrl = null;
    if (logoPath && fsImpl && typeof fsImpl.readFileSync === 'function') {
      try {
        const buf = fsImpl.readFileSync(logoPath);
        cachedLogoDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
      } catch (err) {
        logger?.warn?.(`[yayra:overlay] could not inline bubble logo: ${err?.message || err}`);
      }
    }
    return cachedLogoDataUrl;
  }

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
    const logo = logoDataUrl();
    // The bubble is JUST the Yayra logo - fully transparent window, no
    // circular plate/gradient behind it. A soft drop shadow keeps the
    // logo legible over any app underneath. Fallback (logo asset
    // unavailable): a bare transparent "Y" monogram, still no circle.
    //
    // INPUT HANDLING (why there is NO -webkit-app-region: drag here):
    // Electron drag regions are handled natively by the OS window - the
    // renderer never receives left-button mouse events inside them, so
    // click/dblclick listeners on a draggable bubble silently never fire
    // (right-click still worked because contextmenu passes through).
    // That was exactly the "left click / tap / double click do nothing"
    // bug. Dragging is therefore implemented manually: pointerdown tells
    // the main process to follow the cursor (screen.getCursorScreenPoint
    // polling), and real pointer events stay available for taps:
    //   1 tap   -> toggle the floating mini browser
    //   2 taps  -> open the full browser window
    //   3 taps  -> lock the bubble where it is / unlock it again
    const bubbleContent = logo
      ? `<img id="bubble" src="${logo}" alt="" draggable="false" />`
      : `<div id="bubble"><span id="monogram">Y</span></div>`;
    // Radial ring geometry: 6 circular buttons evenly spaced around the
    // center of the RADIAL_SIZE square, AssistiveTouch-style.
    const C = RADIAL_SIZE / 2;
    const RING_R = 95;
    const BTN = 54;
    const ringPos = (index, total) => {
      const angle = (index / total) * 2 * Math.PI - Math.PI / 2; // start at top
      const x = Math.round(C + RING_R * Math.cos(angle) - BTN / 2);
      const y = Math.round(C + RING_R * Math.sin(angle) - BTN / 2);
      return `left:${x}px; top:${y}px;`;
    };
    const icons = {
      ai: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M9.5 2L8 6.5 3.5 8 8 9.5 9.5 14 11 9.5 15.5 8 11 6.5zM17.5 11l-1 3-3 1 3 1 1 3 1-3 3-1-3-1z"/></svg>',
      mini: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="7" y="3" rx="2"/><path d="M3 7v12a2 2 0 0 0 2 2h12"/></svg>',
      full: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20M12 2a14.5 14.5 0 0 1 0 20M2 12h20"/></svg>',
      lockClosed: '<svg class="ic-locked" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
      lockOpen: '<svg class="ic-unlocked" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>',
      hide: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>',
      quit: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" x2="12" y1="2" y2="12"/></svg>',
      close: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
    };
    const ringButtons = [
      { action: 'ai', label: 'Ask Yayra AI', icon: icons.ai, cls: 'radial-btn-ai' },
      { action: 'mini', label: 'Open yayra mini', icon: icons.mini, cls: '' },
      { action: 'full', label: 'Open full browser', icon: icons.full, cls: '' },
      { action: 'lock', label: 'Lock / unlock position', icon: icons.lockClosed + icons.lockOpen, cls: 'radial-btn-lock' },
      { action: 'hide', label: 'Hide bubble', icon: icons.hide, cls: '' },
      { action: 'quit', label: 'Quit Yayra', icon: icons.quit, cls: '' }
    ];
    const radialButtonsHtml = ringButtons.map((btn, i) =>
      `<button class="radial-btn ${btn.cls}" data-action="${btn.action}" title="${btn.label}" aria-label="${btn.label}" style="${ringPos(i, ringButtons.length)}">${btn.icon}</button>`
    ).join('');
    return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  html, body { margin:0; padding:0; background:transparent; overflow:hidden; }
  #bubble {
    width:100vw; height:100vh;
    display:flex; align-items:center; justify-content:center;
    background:transparent;
    object-fit:contain;
    filter:drop-shadow(0 3px 10px rgba(0,0,0,0.55));
    opacity:${settings.opacity};
    cursor:grab;
    user-select:none;
    touch-action:none;
    transition:transform 120ms ease;
  }
  #bubble.dragging { cursor:grabbing; }
  #bubble.locked { cursor:default; }
  #bubble.pulse { transform:scale(0.82); }
  #monogram {
    font:800 64px/1 system-ui, sans-serif;
    color:#4f7cff;
    text-shadow:0 2px 8px rgba(0,0,0,0.6);
    pointer-events:none;
  }
  /* --- double-tap radial menu (AssistiveTouch-style) --- */
  #radial { position:fixed; inset:0; display:none; }
  body.radial-open #bubble { display:none; }
  body.radial-open #radial { display:block; }
  .radial-btn {
    position:absolute;
    width:${BTN}px; height:${BTN}px;
    border-radius:50%;
    border:none;
    display:flex; align-items:center; justify-content:center;
    background:#f3f4f6;
    color:#1f2430;
    cursor:pointer;
    box-shadow:0 4px 14px rgba(0,0,0,0.45);
    transition:transform 120ms ease;
    animation:radial-pop 160ms ease;
  }
  .radial-btn:hover { transform:scale(1.1); }
  .radial-btn:active { transform:scale(0.92); }
  .radial-btn-ai { background:#15181f; color:#c4b5fd; }
  #radial-close {
    position:absolute;
    left:${C - 29}px; top:${C - 29}px;
    width:58px; height:58px;
    border-radius:50%;
    border:none;
    display:flex; align-items:center; justify-content:center;
    background:rgba(28, 32, 42, 0.92);
    color:#f3f4f6;
    cursor:pointer;
    box-shadow:0 4px 16px rgba(0,0,0,0.5);
    animation:radial-pop 160ms ease;
  }
  .radial-btn-lock .ic-unlocked { display:none; }
  body.pos-locked .radial-btn-lock .ic-locked { display:none; }
  body.pos-locked .radial-btn-lock .ic-unlocked { display:block; }
  body.pos-locked .radial-btn-lock { background:#fbbf24; color:#3b2f06; }
  @keyframes radial-pop { from { transform:scale(0.4); opacity:0; } to { transform:scale(1); opacity:1; } }
</style></head>
<body>
  ${bubbleContent}
  <div id="radial">
    ${radialButtonsHtml}
    <button id="radial-close" data-action="close" title="Close menu" aria-label="Close menu">${icons.close}</button>
  </div>
  <script>
    const bubbleEl = document.getElementById('bubble');
    const api = window.yayraOverlay || {};
    let locked = ${settings.positionLocked ? 'true' : 'false'};
    const TAP_SLOP_PX = 5;        // movement below this is a tap, not a drag
    const MULTI_TAP_MS = 350;     // Chrome-style multi-click settle window

    function applyLockUi() {
      bubbleEl.classList.toggle('locked', locked);
      document.body.classList.toggle('pos-locked', locked);
      bubbleEl.title = locked
        ? 'Yayra - position locked (triple-click to unlock)'
        : 'Yayra - click: mini  |  double-click: menu  |  triple-click: lock position  |  drag to move';
    }
    function pulse() {
      bubbleEl.classList.add('pulse');
      setTimeout(() => bubbleEl.classList.remove('pulse'), 140);
    }
    applyLockUi();
    if (typeof api.onLockChanged === 'function') {
      api.onLockChanged((isLocked) => { locked = Boolean(isLocked); applyLockUi(); pulse(); });
    }

    let downAt = null;   // screen coords at pointerdown
    let moved = false;
    let tapCount = 0;
    let tapTimer = null;

    function endDrag() {
      bubbleEl.classList.remove('dragging');
      if (typeof api.dragEnd === 'function') api.dragEnd();
    }
    function dispatchTaps(count) {
      tapCount = 0;
      if (typeof api.tap === 'function') api.tap(count);
      else if (count === 1 && typeof api.bubbleClick === 'function') api.bubbleClick();
      else if (typeof api.restore === 'function') api.restore();
    }

    bubbleEl.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try { bubbleEl.setPointerCapture(e.pointerId); } catch {}
      downAt = { x: e.screenX, y: e.screenY };
      moved = false;
      // Main process follows the cursor; refuses to move while locked.
      if (!locked && typeof api.dragStart === 'function') {
        api.dragStart({ x: e.clientX, y: e.clientY });
        bubbleEl.classList.add('dragging');
      }
    });
    bubbleEl.addEventListener('pointermove', (e) => {
      if (!downAt) return;
      if (Math.abs(e.screenX - downAt.x) > TAP_SLOP_PX || Math.abs(e.screenY - downAt.y) > TAP_SLOP_PX) moved = true;
    });
    bubbleEl.addEventListener('pointerup', (e) => {
      if (!downAt) return;
      const wasDrag = moved
        || Math.abs(e.screenX - downAt.x) > TAP_SLOP_PX
        || Math.abs(e.screenY - downAt.y) > TAP_SLOP_PX;
      downAt = null;
      endDrag();
      if (wasDrag) { tapCount = 0; clearTimeout(tapTimer); return; }
      pulse();
      tapCount += 1;
      clearTimeout(tapTimer);
      if (tapCount >= 3) dispatchTaps(3); // lock/unlock fires instantly
      else tapTimer = setTimeout(() => dispatchTaps(tapCount), MULTI_TAP_MS);
    });
    bubbleEl.addEventListener('pointercancel', () => { downAt = null; endDrag(); });
    bubbleEl.addEventListener('lostpointercapture', () => { if (downAt) { downAt = null; endDrag(); } });
    bubbleEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (typeof api.openMenu === 'function') api.openMenu();
    });

    // --- double-tap radial menu of circular action buttons ---
    // Opening/closing is driven by the MAIN process (it resizes this
    // window around the bubble first); buttons report their action back.
    const radialEl = document.getElementById('radial');
    if (typeof api.onRadial === 'function') {
      api.onRadial((payload) => {
        const open = Boolean(payload && payload.open);
        document.body.classList.toggle('radial-open', open);
        if (payload && typeof payload.locked === 'boolean') {
          locked = payload.locked;
          applyLockUi();
        }
      });
    }
    radialEl.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof api.radialAction === 'function') api.radialAction(btn.dataset.action);
      });
    });
    // Tapping the empty space around the ring closes the menu.
    radialEl.addEventListener('pointerdown', (e) => {
      if (e.target === radialEl && typeof api.radialAction === 'function') api.radialAction('close');
    });
    radialEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (typeof api.openMenu === 'function') api.openMenu();
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
      // Never steal keyboard focus: a focusable overlay gets pulled into
      // normal window activation ordering, which is one of the ways the
      // bubble ends up BEHIND the app the user just clicked into. A
      // non-focusable window still receives mouse clicks/drags.
      focusable: false,
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
    // Keep it above every opened app, not just the desktop: re-assert the
    // topmost claim whenever the OS drops it and on a heartbeat.
    overlayTopmostTimer = stopTopmostGuard(overlayTopmostTimer);
    overlayTopmostTimer = startTopmostGuard(overlayWin);
    overlayWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildOverlayHtml(settings))}`);

    overlayWin.on('moved', () => {
      // While the radial menu is open the window is the ENLARGED square -
      // persisting that position would teleport the bubble on restart.
      if (radialOpen) return;
      try {
        const [x, y] = overlayWin.getPosition();
        overlayStore.save({ position: { x, y } });
      } catch {
        // best-effort persistence only
      }
    });

    overlayWin.on('closed', () => {
      overlayWin = null;
      endBubbleDrag({ persist: false });
      radialOpen = false;
      radialRestoreBounds = null;
      overlayTopmostTimer = stopTopmostGuard(overlayTopmostTimer);
    });

    return overlayWin;
  }

  function destroyOverlayWindow() {
    endBubbleDrag({ persist: false });
    radialOpen = false;
    radialRestoreBounds = null;
    overlayTopmostTimer = stopTopmostGuard(overlayTopmostTimer);
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

  function ensureMiniWindow(urlOverride = null) {
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
    // The mini panel must also stay above whatever app is focused (it opens
    // from the bubble while the user is inside another application). It
    // stays focusable - it hosts a real browser that needs the keyboard -
    // so the heartbeat is what keeps it topmost after focus round-trips.
    miniTopmostTimer = stopTopmostGuard(miniTopmostTimer);
    miniTopmostTimer = startTopmostGuard(miniWin);
    miniWin.loadURL(urlOverride || miniUrl);
    miniWin.on('closed', () => {
      miniWin = null;
      miniTopmostTimer = stopTopmostGuard(miniTopmostTimer);
    });
    return miniWin;
  }

  /**
   * Open the floating mini browser directly on an internal page (e.g.
   * 'yayra://ai' from the radial menu's AI button or the bubble's
   * right-click menu). The &page= boot param is read by
   * src/browser/main.js, which starts the mini shell on that page.
   * An already-open mini is recreated - deep-linking wins over reuse.
   */
  function openMiniPanelAt(page) {
    if (!mainPreloadPath) return restoreMainWindow();
    destroyMiniWindow();
    const sep = miniUrl.includes('?') ? '&' : '?';
    return ensureMiniWindow(`${miniUrl}${sep}page=${encodeURIComponent(String(page || ''))}`);
  }

  function destroyMiniWindow() {
    miniTopmostTimer = stopTopmostGuard(miniTopmostTimer);
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

  /* -------------------------------------------------------------
   * Manual bubble dragging + tap gestures + triple-click position lock.
   *
   * The bubble window deliberately has no -webkit-app-region drag zone
   * (native drag regions eat every left-button event, so click/double-
   * click never reached the renderer - the original "using it is not
   * working" bug). Instead, pointerdown in the bubble asks the main
   * process to follow the OS cursor until pointerup. While the position
   * is LOCKED (toggled by triple-click), drag requests are refused and
   * the bubble stays exactly where it is.
   * ----------------------------------------------------------- */

  function beginBubbleDrag(offset) {
    if (!overlayWin || overlayWin.isDestroyed()) return false;
    if (radialOpen) return false; // the expanded menu never drags
    if (overlayStore.load().positionLocked) return false; // triple-click lock
    const dx = Math.round(Number(offset?.x)) || 0;
    const dy = Math.round(Number(offset?.y)) || 0;
    endBubbleDrag({ persist: false });
    if (typeof setInterval !== 'function' || typeof screen.getCursorScreenPoint !== 'function') return false;
    dragTimer = setInterval(() => {
      try {
        if (!overlayWin || overlayWin.isDestroyed()) { endBubbleDrag({ persist: false }); return; }
        const pt = screen.getCursorScreenPoint();
        overlayWin.setPosition(pt.x - dx, pt.y - dy);
      } catch {
        endBubbleDrag({ persist: false });
      }
    }, 16);
    if (dragTimer && typeof dragTimer.unref === 'function') dragTimer.unref();
    return true;
  }

  function endBubbleDrag({ persist = true } = {}) {
    if (dragTimer) clearInterval(dragTimer);
    dragTimer = null;
    if (!persist) return;
    try {
      if (overlayWin && !overlayWin.isDestroyed()) {
        const [x, y] = overlayWin.getPosition();
        overlayStore.save({ position: { x, y } });
      }
    } catch {
      // best-effort persistence only
    }
  }

  /* -------------------------------------------------------------
   * Radial menu (AssistiveTouch-style): double-tapping the bubble
   * expands its tiny always-on-top window into a RADIAL_SIZE square
   * centered on the bubble, and the renderer shows a ring of circular
   * action buttons (see buildOverlayHtml): Yayra AI, yayra mini, full
   * browser, lock/unlock position, hide bubble, quit. Closing shrinks
   * the window back to exactly where the bubble was.
   * ----------------------------------------------------------- */

  function openRadialMenu() {
    if (!overlayWin || overlayWin.isDestroyed() || radialOpen) return false;
    if (typeof overlayWin.setBounds !== 'function') return false;
    // Stop any in-flight drag WITHOUT persisting here: real moves already
    // persist via the 'moved' handler, and saving now would race the
    // expansion below.
    endBubbleDrag({ persist: false });
    const settings = overlayStore.load();
    const size = settings.size || 64;
    const [x, y] = overlayWin.getPosition();
    radialRestoreBounds = { x, y, width: size, height: size };
    // Center the expanded square on the bubble's center, clamped on-screen.
    let rx = Math.round(x + size / 2 - RADIAL_SIZE / 2);
    let ry = Math.round(y + size / 2 - RADIAL_SIZE / 2);
    try {
      const area = screen.getPrimaryDisplay().workAreaSize;
      rx = Math.min(Math.max(0, rx), Math.max(0, area.width - RADIAL_SIZE));
      ry = Math.min(Math.max(0, ry), Math.max(0, area.height - RADIAL_SIZE));
    } catch {
      // No display info (tests/headless) - keep the unclamped center.
    }
    radialOpen = true;
    overlayWin.setBounds({ x: rx, y: ry, width: RADIAL_SIZE, height: RADIAL_SIZE });
    try {
      overlayWin.webContents?.send?.('yayra:overlay-radial', {
        open: true,
        locked: Boolean(settings.positionLocked)
      });
    } catch {
      // Renderer gone mid-open.
    }
    return true;
  }

  function closeRadialMenu() {
    if (!radialOpen) return false;
    radialOpen = false;
    try {
      if (overlayWin && !overlayWin.isDestroyed()) {
        if (radialRestoreBounds && typeof overlayWin.setBounds === 'function') {
          overlayWin.setBounds(radialRestoreBounds);
        }
        overlayWin.webContents?.send?.('yayra:overlay-radial', { open: false });
      }
    } catch {
      // Renderer/window gone mid-close - state is reset either way.
    }
    radialRestoreBounds = null;
    return true;
  }

  function isRadialOpen() {
    return radialOpen;
  }

  /** A circular button in the radial menu was pressed. */
  function handleRadialAction(action) {
    switch (action) {
      case 'ai':
        closeRadialMenu();
        return openMiniPanelAt('yayra://ai');
      case 'mini':
        closeRadialMenu();
        return toggleMiniPanel();
      case 'full':
        closeRadialMenu();
        return restoreMainWindow();
      case 'lock':
        // Stays open so the button's icon flip is visible immediately.
        return togglePositionLock();
      case 'hide':
        closeRadialMenu();
        return setEnabled(false);
      case 'quit':
        try { app.quit(); } catch { /* already quitting */ }
        return null;
      case 'close':
      default:
        closeRadialMenu();
        return null;
    }
  }

  function setPositionLocked(locked) {
    const next = overlayStore.save({ positionLocked: Boolean(locked) });
    if (next.positionLocked) endBubbleDrag({ persist: true }); // a mid-drag lock freezes in place
    try {
      if (overlayWin && !overlayWin.isDestroyed() && typeof overlayWin.setMovable === 'function') {
        overlayWin.setMovable(!next.positionLocked);
      }
      // Let the bubble update its cursor/tooltip + play the lock pulse.
      overlayWin?.webContents?.send?.('yayra:overlay-lock-changed', next.positionLocked);
    } catch {
      // Renderer gone mid-toggle - state is persisted either way.
    }
    return next;
  }

  function togglePositionLock() {
    return setPositionLocked(!overlayStore.load().positionLocked);
  }

  /**
   * Gesture dispatch for the bubble (counts settled by the renderer):
   *   1 tap -> toggle the floating mini browser (or close an open radial);
   *   2 taps -> toggle the AssistiveTouch-style RADIAL MENU of circular
   *             action buttons (Yayra AI / mini / full browser / lock /
   *             hide / quit) around the bubble;
   *   3 taps -> lock the bubble's position right where it is - and
   *             triple-clicking again unlocks movement.
   */
  function handleBubbleTap(count) {
    const taps = Math.max(1, Math.round(Number(count)) || 1);
    if (taps >= 3) return togglePositionLock();
    if (taps === 2) return radialOpen ? closeRadialMenu() : openRadialMenu();
    if (radialOpen) return closeRadialMenu();
    return toggleMiniPanel();
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
    const locked = Boolean(overlayStore.load().positionLocked);
    const template = [
      { label: 'Ask Yayra AI', click: () => openMiniPanelAt('yayra://ai') },
      { type: 'separator' },
      { label: 'Open yayra mini', click: () => toggleMiniPanel() },
      { label: 'Open full browser', click: () => restoreMainWindow() },
      { type: 'separator' },
      {
        label: locked ? 'Unlock movement (or triple-click)' : 'Lock position here (or triple-click)',
        click: () => togglePositionLock()
      },
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

  // Live-resizes the floating bubble (user-adjustable from Settings).
  // The bubble HTML renders the logo at 100vw x 100vh, so resizing the
  // window is all that's needed - no reload.
  function setBubbleSize(size) {
    const px = Math.max(40, Math.min(160, Math.round(Number(size)))) || 64;
    const next = overlayStore.save({ size: px });
    if (overlayWin && !overlayWin.isDestroyed()) {
      try {
        if (typeof overlayWin.setBounds === 'function') {
          const [x, y] = overlayWin.getPosition();
          overlayWin.setBounds({ x, y, width: px, height: px });
        } else {
          destroyOverlayWindow();
          ensureOverlayWindow();
        }
      } catch {
        // Worst case the new size applies on next launch via the store.
      }
    }
    return next;
  }

  // Live-updates the bubble's opacity by re-rendering its data-URL HTML
  // with the new value baked in.
  function setBubbleOpacity(opacity) {
    const raw = Number(opacity);
    const val = Number.isFinite(raw) ? Math.max(0.2, Math.min(1, raw)) : 0.92;
    const next = overlayStore.save({ opacity: val });
    if (overlayWin && !overlayWin.isDestroyed()) {
      try {
        overlayWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildOverlayHtml(next))}`);
      } catch {
        // Applied on next launch via the store.
      }
    }
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
  ipcMain.handle('yayra:overlay-set-bubble-size', (_e, size) => setBubbleSize(size));
  ipcMain.handle('yayra:overlay-set-bubble-opacity', (_e, opacity) => setBubbleOpacity(opacity));
  ipcMain.on('yayra:overlay-restore', () => restoreMainWindow());
  // Single bubble click: toggle the floating mini browser (independent of
  // the main window). Right-click: quick menu with full-browser/quit.
  ipcMain.on('yayra:overlay-bubble-click', () => toggleMiniPanel());
  ipcMain.on('yayra:overlay-bubble-menu', () => openBubbleMenu());
  // Settled tap-count gestures from the bubble renderer: 1 = mini,
  // 2 = full browser, 3 = lock/unlock position (see handleBubbleTap).
  ipcMain.on('yayra:overlay-bubble-tap', (_e, count) => handleBubbleTap(count));
  // Manual drag loop (replaces the native drag region that swallowed all
  // left-button events): follow the OS cursor until pointerup.
  ipcMain.on('yayra:overlay-drag-start', (_e, offset) => beginBubbleDrag(offset));
  ipcMain.on('yayra:overlay-drag-end', () => endBubbleDrag());
  // A circular button in the double-tap radial menu was pressed
  // (ai / mini / full / lock / hide / quit / close).
  ipcMain.on('yayra:overlay-radial-action', (_e, action) => handleRadialAction(action));
  // Settings toggle mirrors the triple-click lock.
  ipcMain.handle('yayra:overlay-set-position-locked', (_e, locked) => setPositionLocked(locked));
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
    setBubbleSize,
    setBubbleOpacity,
    setPositionLocked,
    togglePositionLock,
    handleBubbleTap,
    beginBubbleDrag,
    endBubbleDrag,
    openRadialMenu,
    closeRadialMenu,
    isRadialOpen,
    handleRadialAction,
    openMiniPanelAt,
    initializeOnStartup,
    applyLoginItemSettings
  };
}

module.exports = { createOverlayBridge };
