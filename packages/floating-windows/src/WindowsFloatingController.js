/**
 * Yayra Floating Browser - Windows Floating Controller
 */

import { DEFAULT_USER_SETTINGS } from '../../shared-core/src/types.js';
import { WindowsMonitorManager } from './WindowsMonitorManager.js';
import { WindowsTrayManager } from './WindowsTrayManager.js';
import { WindowsSingleInstanceManager } from './WindowsSingleInstanceManager.js';
import { WindowsNativeWindow } from './WindowsNativeWindow.js';

export class WindowsFloatingController {
  constructor(
    circleController,
    windowManager,
    eventBus,
    initialMode = 'circle-first',
    config = {}
  ) {
    this.circleController = circleController;
    this.windowManager = windowManager;
    this.eventBus = eventBus;
    this.mode = initialMode;

    this.settings = { ...DEFAULT_USER_SETTINGS, desktopFloatingMode: initialMode, ...(config.settings || {}) };
    this.settingsRepo = config.settingsRepo;
    this.monitorManager = config.monitorManager || new WindowsMonitorManager();
    this.trayManager = config.trayManager || new WindowsTrayManager(this.eventBus);
    this.singleInstanceManager = config.singleInstanceManager || new WindowsSingleInstanceManager();

    this.bubbleNativeWindow = new WindowsNativeWindow(
      'HWND_BUBBLE',
      'Yayra Floating Bubble',
      { x: 30, y: 120, width: 56, height: 56, monitorIndex: 0 },
      { isTopmost: this.settings.alwaysOnTop, isToolWindow: true, isAppWindow: false, isLayered: true },
      this.monitorManager
    );

    this.browserNativeWindow = new WindowsNativeWindow(
      'HWND_BROWSER',
      'Yayra Floating Browser',
      { x: 100, y: 100, width: 800, height: 600, monitorIndex: 0 },
      { isTopmost: this.settings.alwaysOnTop, isToolWindow: false, isAppWindow: true, isLayered: true },
      this.monitorManager
    );

    this.isShuttingDown = false;

    this.singleInstanceManager.acquireLock();
    this.singleInstanceManager.onSecondInstance(() => {
      this.onSecondInstanceLaunched();
    });

    this.initTrayMenu();
    this.applyModeRules();
  }

  getMode() {
    return this.mode;
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.settings.desktopFloatingMode = mode;
    this.applyModeRules();
    this.eventBus.emit('floating:mode-changed', { mode });
  }

  getSettings() {
    return { ...this.settings };
  }

  async updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    if (newSettings.desktopFloatingMode && newSettings.desktopFloatingMode !== this.mode) {
      this.mode = newSettings.desktopFloatingMode;
      this.applyModeRules();
      this.eventBus.emit('floating:mode-changed', { mode: this.mode });
    }

    if (newSettings.alwaysOnTop !== undefined) {
      this.setAlwaysOnTop(newSettings.alwaysOnTop);
    }

    if (this.settingsRepo) {
      await this.settingsRepo.updateSettings(this.settings);
    }
    this.eventBus.emit('settings:updated', { settings: this.settings });
  }

  applyModeRules() {
    const isTopmost = this.settings.alwaysOnTop;
    this.bubbleNativeWindow.setAlwaysOnTop(isTopmost);
    this.browserNativeWindow.setAlwaysOnTop(isTopmost);

    if (this.mode === 'circle-first') {
      this.circleController.setVisibility(true);
      this.circleController.setExpanded(false);
      this.windowManager.minimize(true);

      this.bubbleNativeWindow.show(false);
      this.browserNativeWindow.hide();
    } else {
      this.circleController.setVisibility(false);
      this.circleController.setExpanded(true);
      this.windowManager.restore();

      this.bubbleNativeWindow.hide();
      this.browserNativeWindow.show(true);
    }
  }

  setAlwaysOnTop(alwaysOnTop) {
    this.settings.alwaysOnTop = alwaysOnTop;
    this.windowManager.setAlwaysOnTop(alwaysOnTop);
    this.bubbleNativeWindow.setAlwaysOnTop(alwaysOnTop);
    this.browserNativeWindow.setAlwaysOnTop(alwaysOnTop);
  }

  isAlwaysOnTop() {
    return this.settings.alwaysOnTop;
  }

  onCircleClicked() {
    if (this.mode === 'circle-first') {
      this.circleController.setExpanded(true);
      this.windowManager.restore();

      this.bubbleNativeWindow.show(false);
      this.browserNativeWindow.show(true);
    } else {
      this.circleController.setVisibility(false);
      this.circleController.setExpanded(true);
      this.windowManager.restore();

      this.bubbleNativeWindow.hide();
      this.browserNativeWindow.show(true);
    }
  }

  onBrowserMinimize() {
    if (this.settings.minimizeToBubble) {
      this.windowManager.minimize(true);
      this.circleController.setVisibility(true);
      this.circleController.setExpanded(false);

      this.browserNativeWindow.hide();
      this.bubbleNativeWindow.show(false);
    } else {
      this.windowManager.minimize(false);
      this.browserNativeWindow.minimize();
    }
  }

  onBrowserClose() {
    if (this.settings.closeToTray) {
      this.windowManager.minimize(this.settings.minimizeToBubble);
      this.browserNativeWindow.hide();

      if (this.settings.minimizeToBubble) {
        this.circleController.setVisibility(true);
        this.circleController.setExpanded(false);
        this.bubbleNativeWindow.show(false);
      } else {
        this.circleController.setVisibility(false);
        this.bubbleNativeWindow.hide();
      }
      this.eventBus.emit('window:closed', { toTray: true });
    } else {
      this.shutdown();
    }
  }

  handleDrag(x, y, snap = true) {
    this.browserNativeWindow.setPosition(x, y, true);
    if (snap) {
      this.browserNativeWindow.snapToMonitorEdges(16);
    }
    const geom = this.browserNativeWindow.getGeometry();
    this.windowManager.setPosition(geom.x, geom.y);

    if (this.settings.rememberPosition && this.settingsRepo) {
      this.settingsRepo.saveWindowGeometry(geom);
    }
  }

  handleResize(width, height, snap = true) {
    this.browserNativeWindow.setSize(width, height, true);
    if (snap) {
      this.browserNativeWindow.snapToMonitorEdges(16);
    }
    const geom = this.browserNativeWindow.getGeometry();
    this.windowManager.setSize(geom.width, geom.height);

    if (this.settings.rememberSize && this.settingsRepo) {
      this.settingsRepo.saveWindowGeometry(geom);
    }
  }

  handleKeyboardShortcut(key, isAlt = false, isCtrl = false) {
    if (key === 'Escape') {
      if (this.browserNativeWindow.isWindowVisible()) {
        this.onBrowserMinimize();
        return true;
      }
    }
    if ((isAlt || isCtrl) && (key === 'f' || key === 'F')) {
      if (this.browserNativeWindow.isWindowVisible()) {
        this.onBrowserMinimize();
      } else {
        this.onCircleClicked();
      }
      return true;
    }
    if (key === 'Enter' || key === ' ') {
      if (this.circleController.getState().isVisible && !this.browserNativeWindow.isWindowVisible()) {
        this.onCircleClicked();
        return true;
      }
    }
    return false;
  }

  handleDisplayChange(monitors) {
    if (monitors && monitors.length > 0) {
      this.monitorManager.setMonitors(monitors);
    }
    const browserGeom = this.browserNativeWindow.getGeometry();
    const clampedBrowser = this.monitorManager.clampToMonitorWorkArea(browserGeom, browserGeom.monitorIndex);
    this.browserNativeWindow.setPosition(clampedBrowser.x, clampedBrowser.y, true);
    this.windowManager.setPosition(clampedBrowser.x, clampedBrowser.y);

    const bubbleGeom = this.bubbleNativeWindow.getGeometry();
    const clampedBubble = this.monitorManager.clampToMonitorWorkArea(bubbleGeom, bubbleGeom.monitorIndex);
    this.bubbleNativeWindow.setPosition(clampedBubble.x, clampedBubble.y, true);
    this.circleController.setPosition(clampedBubble.x, clampedBubble.y);
  }

  async restoreSavedGeometry() {
    if (!this.settingsRepo) return;
    const saved = await this.settingsRepo.loadWindowGeometry();
    if (saved) {
      const clamped = this.monitorManager.clampToMonitorWorkArea(saved, saved.monitorIndex);
      if (this.settings.rememberPosition) {
        this.browserNativeWindow.setPosition(clamped.x, clamped.y, true);
        this.windowManager.setPosition(clamped.x, clamped.y);
      }
      if (this.settings.rememberSize) {
        this.browserNativeWindow.setSize(clamped.width, clamped.height, true);
        this.windowManager.setSize(clamped.width, clamped.height);
      }
    }
  }

  getBubbleNativeWindow() {
    return this.bubbleNativeWindow;
  }

  getBrowserNativeWindow() {
    return this.browserNativeWindow;
  }

  getMonitorManager() {
    return this.monitorManager;
  }

  getTrayManager() {
    return this.trayManager;
  }

  getSingleInstanceManager() {
    return this.singleInstanceManager;
  }

  onSecondInstanceLaunched() {
    this.onCircleClicked();
    this.trayManager.showNotification({
      title: 'Yayra Floating Browser',
      message: 'Yayra is already running and brought to focus.',
      iconType: 'info'
    });
  }

  initTrayMenu() {
    this.trayManager.initTray('Yayra Floating Browser');
    this.trayManager.setContextMenu([
      {
        id: 'open-yayra',
        label: 'Open Floating Browser',
        enabled: true,
        action: () => this.onCircleClicked()
      },
      {
        id: 'toggle-always-on-top',
        label: 'Always on Top',
        enabled: true,
        checked: this.settings.alwaysOnTop,
        action: () => this.setAlwaysOnTop(!this.settings.alwaysOnTop)
      },
      {
        id: 'toggle-mode',
        label: this.mode === 'circle-first' ? 'Switch to Browser-First' : 'Switch to Circle-First',
        enabled: true,
        action: () => this.setMode(this.mode === 'circle-first' ? 'browser-first' : 'circle-first')
      },
      {
        id: 'settings',
        label: 'Settings...',
        enabled: true,
        action: () => this.eventBus.emit('settings:updated', { settings: this.settings })
      },
      {
        id: 'exit',
        label: 'Exit Yayra',
        enabled: true,
        action: () => this.shutdown()
      }
    ]);
  }

  shutdown() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    if (this.settingsRepo && (this.settings.rememberPosition || this.settings.rememberSize)) {
      const geom = this.browserNativeWindow.getGeometry();
      this.settingsRepo.saveWindowGeometry(geom);
    }

    this.bubbleNativeWindow.hide();
    this.browserNativeWindow.hide();
    this.trayManager.destroy();
    this.singleInstanceManager.release();
    this.eventBus.emit('window:closed', { toTray: false });
  }
}
