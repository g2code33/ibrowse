/**
 * Yayra Floating Browser - Windows Floating Controller
 * Manages Win32 native overlay windows, Acrylic/Mica glassmorphism,
 * multi-monitor geometry, display scaling, taskbar/tray integration,
 * and dual desktop floating modes ('circle-first' vs 'browser-first').
 */

import { DesktopFloatingMode, UserSettings, DEFAULT_USER_SETTINGS, WindowGeometry } from '../../shared-core/src/types.js';
import { FloatingCircleController } from '../../shared-core/src/floating.js';
import { WindowStateManager } from '../../shared-core/src/window.js';
import { EventBus } from '../../shared-core/src/events.js';
import { SettingsRepository } from '../../persistence/src/SettingsRepository.js';
import { WindowsMonitorManager } from './WindowsMonitorManager.js';
import { WindowsTrayManager } from './WindowsTrayManager.js';
import { WindowsSingleInstanceManager } from './WindowsSingleInstanceManager.js';
import { WindowsNativeWindow } from './WindowsNativeWindow.js';

export interface WindowsFloatingControllerConfig {
  settingsRepo?: SettingsRepository;
  monitorManager?: WindowsMonitorManager;
  trayManager?: WindowsTrayManager;
  singleInstanceManager?: WindowsSingleInstanceManager;
  settings?: Partial<UserSettings>;
}

export class WindowsFloatingController {
  private circleController: FloatingCircleController;
  private windowManager: WindowStateManager;
  private eventBus: EventBus;
  private mode: DesktopFloatingMode;

  private settings: UserSettings;
  private settingsRepo?: SettingsRepository;
  private monitorManager: WindowsMonitorManager;
  private trayManager: WindowsTrayManager;
  private singleInstanceManager: WindowsSingleInstanceManager;

  // Native HWND representations
  private bubbleNativeWindow: WindowsNativeWindow;
  private browserNativeWindow: WindowsNativeWindow;

  private isShuttingDown: boolean = false;

  constructor(
    circleController: FloatingCircleController,
    windowManager: WindowStateManager,
    eventBus: EventBus,
    initialMode: DesktopFloatingMode = 'circle-first',
    config: WindowsFloatingControllerConfig = {}
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

    // Initialize native HWND models
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

    // Acquire single instance lock
    this.singleInstanceManager.acquireLock();
    this.singleInstanceManager.onSecondInstance(() => {
      this.onSecondInstanceLaunched();
    });

    this.initTrayMenu();
    this.applyModeRules();
  }

  public getMode(): DesktopFloatingMode {
    return this.mode;
  }

  public setMode(mode: DesktopFloatingMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.settings.desktopFloatingMode = mode;
    this.applyModeRules();
    this.eventBus.emit('floating:mode-changed', { mode });
  }

  public getSettings(): UserSettings {
    return { ...this.settings };
  }

  public async updateSettings(newSettings: Partial<UserSettings>): Promise<void> {
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

  public applyModeRules(): void {
    const isTopmost = this.settings.alwaysOnTop;
    this.bubbleNativeWindow.setAlwaysOnTop(isTopmost);
    this.browserNativeWindow.setAlwaysOnTop(isTopmost);

    if (this.mode === 'circle-first') {
      // Circle-first: Native bubble is visible on desktop, browser is initially docked/hidden
      this.circleController.setVisibility(true);
      this.circleController.setExpanded(false);
      this.windowManager.minimize(true);

      this.bubbleNativeWindow.show(false); // SWP_NOACTIVATE
      this.browserNativeWindow.hide();
    } else {
      // Browser-first: Browser floats prominently on desktop, circle is hidden ready for minimization
      this.circleController.setVisibility(false);
      this.circleController.setExpanded(true);
      this.windowManager.restore();

      this.bubbleNativeWindow.hide();
      this.browserNativeWindow.show(true);
    }
  }

  public setAlwaysOnTop(alwaysOnTop: boolean): void {
    this.settings.alwaysOnTop = alwaysOnTop;
    this.windowManager.setAlwaysOnTop(alwaysOnTop);
    this.bubbleNativeWindow.setAlwaysOnTop(alwaysOnTop);
    this.browserNativeWindow.setAlwaysOnTop(alwaysOnTop);
  }

  public isAlwaysOnTop(): boolean {
    return this.settings.alwaysOnTop;
  }

  public onCircleClicked(): void {
    if (this.mode === 'circle-first') {
      this.circleController.setExpanded(true);
      this.windowManager.restore();

      this.bubbleNativeWindow.show(false);
      this.browserNativeWindow.show(true);
    } else {
      // Browser-first restore from bubble
      this.circleController.setVisibility(false);
      this.circleController.setExpanded(true);
      this.windowManager.restore();

      this.bubbleNativeWindow.hide();
      this.browserNativeWindow.show(true);
    }
  }

  public onBrowserMinimize(): void {
    if (this.settings.minimizeToBubble) {
      this.windowManager.minimize(true);
      this.circleController.setVisibility(true);
      this.circleController.setExpanded(false);

      this.browserNativeWindow.hide();
      this.bubbleNativeWindow.show(false);
    } else {
      // Minimize to taskbar / tray directly
      this.windowManager.minimize(false);
      this.browserNativeWindow.minimize();
    }
  }

  public onBrowserClose(): void {
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

  public handleDrag(x: number, y: number, snap = true): void {
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

  public handleResize(width: number, height: number, snap = true): void {
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

  public handleKeyboardShortcut(key: string, isAlt = false, isCtrl = false): boolean {
    if (key === 'Escape') {
      if (this.browserNativeWindow.isWindowVisible()) {
        this.onBrowserMinimize();
        return true;
      }
    }
    if ((isAlt || isCtrl) && (key === 'f' || key === 'F')) {
      // Toggle floating window visibility
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

  public handleDisplayChange(monitors: any[]): void {
    if (monitors && monitors.length > 0) {
      this.monitorManager.setMonitors(monitors);
    }
    // Re-clamp both native window geometries
    const browserGeom = this.browserNativeWindow.getGeometry();
    const clampedBrowser = this.monitorManager.clampToMonitorWorkArea(browserGeom, browserGeom.monitorIndex);
    this.browserNativeWindow.setPosition(clampedBrowser.x, clampedBrowser.y, true);
    this.windowManager.setPosition(clampedBrowser.x, clampedBrowser.y);

    const bubbleGeom = this.bubbleNativeWindow.getGeometry();
    const clampedBubble = this.monitorManager.clampToMonitorWorkArea(bubbleGeom, bubbleGeom.monitorIndex);
    this.bubbleNativeWindow.setPosition(clampedBubble.x, clampedBubble.y, true);
    this.circleController.setPosition(clampedBubble.x, clampedBubble.y);
  }

  public async restoreSavedGeometry(): Promise<void> {
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

  public getBubbleNativeWindow(): WindowsNativeWindow {
    return this.bubbleNativeWindow;
  }

  public getBrowserNativeWindow(): WindowsNativeWindow {
    return this.browserNativeWindow;
  }

  public getMonitorManager(): WindowsMonitorManager {
    return this.monitorManager;
  }

  public getTrayManager(): WindowsTrayManager {
    return this.trayManager;
  }

  public getSingleInstanceManager(): WindowsSingleInstanceManager {
    return this.singleInstanceManager;
  }

  private onSecondInstanceLaunched(): void {
    // Secondary instance launched: bring floating browser window to front
    this.onCircleClicked();
    this.trayManager.showNotification({
      title: 'Yayra Floating Browser',
      message: 'Yayra is already running and brought to focus.',
      iconType: 'info'
    });
  }

  private initTrayMenu(): void {
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

  public shutdown(): void {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    // Save geometry if configured
    if (this.settingsRepo && (this.settings.rememberPosition || this.settings.rememberSize)) {
      const geom = this.browserNativeWindow.getGeometry();
      this.settingsRepo.saveWindowGeometry(geom);
    }

    // Teardown HWNDs and tray
    this.bubbleNativeWindow.hide();
    this.browserNativeWindow.hide();
    this.trayManager.destroy();
    this.singleInstanceManager.release();
    this.eventBus.emit('window:closed', { toTray: false });
  }
}
