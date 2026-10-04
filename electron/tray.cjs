// Yayra system tray controller.
//
// The floating bubble overlays EVERY app on the desktop, so it must also
// be visible and regulated from the OS's own control surface - the system
// tray / notification area. The tray:
//   - proves Yayra is running even when the main window is closed and the
//     bubble is hidden (nothing "invisible" ever runs on the user's PC);
//   - regulates the bubble: enable/disable, overlay-above-all-apps,
//     start-at-login (all ON by default, all user-switchable);
//   - gives one-click ways back in: open the mini browser, open the full
//     browser, quit entirely.
//
// Everything is dependency-injected (Tray, Menu, nativeImage, app, store,
// overlay bridge) so the whole controller is unit-testable without a GUI.

function createTrayController({
  Tray,
  Menu,
  nativeImage = null,
  app,
  iconPath = null,
  overlayStore,
  overlayBridge = null,
  getMainWindow = null,
  createMainWindow = null,
  logger = console
}) {
  let tray = null;

  function openFullBrowser() {
    if (overlayBridge && typeof overlayBridge.restoreMainWindow === 'function') {
      overlayBridge.restoreMainWindow();
      return;
    }
    const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (win && !win.isDestroyed?.()) { win.show(); win.focus?.(); return; }
    if (typeof createMainWindow === 'function') createMainWindow();
  }

  function buildMenuTemplate() {
    const settings = overlayStore.load();
    return [
      { label: 'Open Yayra browser', click: () => openFullBrowser() },
      {
        label: 'Open yayra mini',
        click: () => { overlayBridge?.toggleMiniPanel?.(); }
      },
      { type: 'separator' },
      {
        label: 'Floating bubble',
        type: 'checkbox',
        checked: Boolean(settings.enabled),
        click: (item) => { overlayBridge?.setEnabled?.(Boolean(item.checked)); refresh(); }
      },
      {
        label: 'Overlay above all apps',
        type: 'checkbox',
        checked: Boolean(settings.overlayAllApps),
        click: (item) => { overlayBridge?.setOverlayAllApps?.(Boolean(item.checked)); refresh(); }
      },
      {
        label: 'Start when computer starts',
        type: 'checkbox',
        checked: Boolean(settings.launchAtStartup),
        click: (item) => { overlayBridge?.setLaunchAtStartup?.(Boolean(item.checked)); refresh(); }
      },
      { type: 'separator' },
      { label: 'Quit Yayra', click: () => app.quit() }
    ];
  }

  function refresh() {
    if (!tray) return;
    try {
      tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate()));
    } catch (err) {
      logger?.warn?.(`[yayra:tray] could not refresh tray menu: ${err?.message || err}`);
    }
  }

  function init() {
    if (tray) return tray;
    try {
      let icon = iconPath;
      if (nativeImage && iconPath) {
        const img = nativeImage.createFromPath(iconPath);
        // Tray sizes are small; resizing avoids blurry oversized icons on
        // Linux DEs that do not scale for you.
        icon = (img && typeof img.resize === 'function' && !(typeof img.isEmpty === 'function' && img.isEmpty()))
          ? img.resize({ width: 22, height: 22 })
          : img;
      }
      tray = new Tray(icon);
      tray.setToolTip('Yayra — floating browser');
      tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate()));
      // Left-click: toggle the mini browser (the bubble's own gesture).
      tray.on?.('click', () => { overlayBridge?.toggleMiniPanel?.(); });
      // Rebuild just before the context menu shows so checkbox states
      // reflect changes made elsewhere (bubble right-click menu, Settings).
      tray.on?.('right-click', () => refresh());
    } catch (err) {
      // No tray on this platform/session (some Wayland setups without the
      // StatusNotifier extension) - never fatal: the bubble and app still
      // run, only the tray affordance is missing.
      logger?.warn?.(`[yayra:tray] system tray unavailable: ${err?.message || err}`);
      tray = null;
    }
    return tray;
  }

  function destroy() {
    try { tray?.destroy?.(); } catch { /* already gone */ }
    tray = null;
  }

  return { init, refresh, destroy, getTray: () => tray, _buildMenuTemplate: buildMenuTemplate };
}

module.exports = { createTrayController };
