/**
 * Yayra Floating Browser - Linux Floating Controller
 * Manages GTK top-level overlay windows, WebKitGTK engine views,
 * X11 / Wayland display capabilities, multi-monitor geometry,
 * AppIndicator panel integration, and dual desktop floating modes ('circle-first' vs 'browser-first').
 */

import { DesktopFloatingMode, UserSettings, DEFAULT_USER_SETTINGS, WindowGeometry } from '../../shared-core/src/types.js';
import { FloatingCircleController } from '../../shared-core/src/floating.js';
import { WindowStateManager } from '../../shared-core/src/window.js';
import { EventBus } from '../../shared-core/src/events.js';
import { SettingsRepository } from '../../persistence/src/SettingsRepository.js';
import { LinuxDisplayCapabilityDetector, LinuxDisplayCapabilities } from './LinuxDisplayCapabilityDetector.js';
import { LinuxMonitorManager } from './LinuxMonitorManager.js';
import { LinuxAppIndicatorManager } from './LinuxAppIndicatorManager.js';
import { LinuxNativeWindow } from './LinuxNativeWindow.js';

export interface LinuxFloatingControllerConfig {
  settingsRepo?: SettingsRepository;
  monitorManager?: LinuxMonitorManager;
  indicatorManager?: LinuxAppIndicatorManager;
  capabilities?: LinuxDisplayCapabilities;
  settings?: Partial<UserSettings>;
}

export class LinuxFloatingController {
  private circleController: FloatingCircleController;
  private windowManager: WindowStateManager;
  private eventBus: EventBus;
  private mode: DesktopFloatingMode;

  private settings: UserSettings;
  private settingsRepo?: SettingsRepository;
  private capabilities: LinuxDisplayCapabilities;
  private monitorManager: LinuxMonitorManager;
  private indicatorManager: LinuxAppIndicatorManager;

  // Native GTK / X11 / Wayland window representations
  private bubbleNativeWindow: LinuxNativeWindow;
  private browserNativeWindow: LinuxNativeWindow;

  private isShuttingDown: boolean = false;

  constructor(
    circleController: FloatingCircleController,
    windowManager: WindowStateManager,
    eventBus: EventBus,
    initialMode: DesktopFloatingMode = 'circle-first',
    config: LinuxFloatingControllerConfig = {}
  ) {
    this.circleController = circleController;
    this.windowManager = windowManager;
    this.eventBus = eventBus;
    this.mode = initialMode;

    this.settings = { ...DEFAULT_USER_SETTINGS, desktopFloatingMode: initialMode, ...(config.settings || {}) };
    this.settingsRepo = config.settingsRepo;
    this.capabilities = config.capabilities || LinuxDisplayCapabilityDetector.detect();
    this.monitorManager = config.monitorManager || new LinuxMonitorManager();
    this.indicatorManager = config.indicatorManager || new LinuxAppIndicatorManager(this.eventBus);

    // Initialize native GTK window models
    this.bubbleNativeWindow = new LinuxNativeWindow(
      'GTK_BUBBLE_WINDOW',
      'Yayra Floating Circle',
      { x: 30, y: 120, width: 56, height: 56, monitorIndex: 0 },
      { isTopmost: this.settings.alwaysOnTop, isDecorated: false, skipTaskbar: true, isAppPaintable: true },
      this.monitorManager,
      this.capabilities
    );

    this.browserNativeWindow = new LinuxNativeWindow(
      'GTK_BROWSER_WINDOW',
      'Yayra Floating Browser',
      { x: 100, y: 100, width: 800, height: 600, monitorIndex: 0 },
      { isTopmost: this.settings.alwaysOnTop, isDecorated: false, skipTaskbar: false, isAppPaintable: true },
      this.monitorManager,
      this.capabilities
    );

    this.initIndicatorMenu();
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

  public getCapabilities(): LinuxDisplayCapabilities {
    return { ...this.capabilities };
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
    const isTopmost = this.settings.alwaysOnTop && this.capabilities.canKeepAbove;
    this.bubbleNativeWindow.setAlwaysOnTop(isTopmost);
    this.browserNativeWindow.setAlwaysOnTop(isTopmost);

    if (this.mode === 'circle-first') {
      // Circle-first: Native bubble is visible, browser is docked/hidden
      this.circleController.setVisibility(true);
      this.circleController.setExpanded(false);
      this.windowManager.minimize(true);

      this.bubbleNativeWindow.show();
      this.browserNativeWindow.hide();
    } else {
      // Browser-first: Browser window is visible on desktop, bubble hidden
      this.circleController.setVisibility(false);
      this.circleController.setExpanded(true);
      this.windowManager.restore();

      this.bubbleNativeWindow.hide();
      this.browserNativeWindow.show();
    }
  }

  public setAlwaysOnTop(alwaysOnTop: boolean): void {
    this.settings.alwaysOnTop = alwaysOnTop;
    const effective = alwaysOnTop && this.capabilities.canKeepAbove;
    this.windowManager.setAlwaysOnTop(effective);
    this.bubbleNativeWindow.setAlwaysOnTop(effective);
    this.browserNativeWindow.setAlwaysOnTop(effective);
  }

  public isAlwaysOnTop(): boolean {
    return this.settings.alwaysOnTop && this.capabilities.canKeepAbove;
  }

  public onCircleClicked(): void {
    if (this.mode === 'circle-first') {
      this.circleController.setExpanded(true);
      this.windowManager.restore();

      this.bubbleNativeWindow.show();
      this.browserNativeWindow.show();
    } else {
      // Browser-first restore
      this.circleController.setVisibility(false);
      this.circleController.setExpanded(true);
      this.windowManager.restore();

      this.bubbleNativeWindow.hide();
      this.browserNativeWindow.show();
    }
  }

  public onBrowserMinimize(): void {
    if (this.settings.minimizeToBubble) {
      this.windowManager.minimize(true);
      this.circleController.setVisibility(true);
      this.circleController.setExpanded(false);

      this.browserNativeWindow.hide();
      this.bubbleNativeWindow.show();
    } else {
      // Standard window minimize
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
        this.bubbleNativeWindow.show();
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
    if (snap && this.capabilities.canEdgeSnap) {
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
    if (snap && this.capabilities.canEdgeSnap) {
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
      if (this.settings.rememberPosition && this.capabilities.canGlobalPosition) {
        const clamped = this.monitorManager.clampToMonitorWorkArea(saved, saved.monitorIndex);
        this.browserNativeWindow.setPosition(clamped.x, clamped.y, true);
        this.windowManager.setPosition(clamped.x, clamped.y);
      }
      if (this.settings.rememberSize) {
        this.browserNativeWindow.setSize(saved.width, saved.height, true);
        this.windowManager.setSize(saved.width, saved.height);
      }
    }
  }

  public getBubbleNativeWindow(): LinuxNativeWindow {
    return this.bubbleNativeWindow;
  }

  public getBrowserNativeWindow(): LinuxNativeWindow {
    return this.browserNativeWindow;
  }

  public getMonitorManager(): LinuxMonitorManager {
    return this.monitorManager;
  }

  public getIndicatorManager(): LinuxAppIndicatorManager {
    return this.indicatorManager;
  }

  private initIndicatorMenu(): void {
    if (!this.capabilities.supportsAppIndicator) return;

    this.indicatorManager.initIndicator('Yayra Floating Browser', 'yayra');
    this.indicatorManager.setMenu([
      {
        id: 'open-yayra',
        label: 'Open Floating Browser',
        enabled: true,
        action: () => this.onCircleClicked()
      },
      {
        id: 'toggle-always-on-top',
        label: 'Always on Top',
        enabled: this.capabilities.canKeepAbove,
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
        id: 'quit',
        label: 'Quit Yayra',
        enabled: true,
        action: () => this.shutdown()
      }
    ]);
  }

  public shutdown(): void {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    if (this.settingsRepo && (this.settings.rememberPosition || this.settings.rememberSize)) {
      const geom = this.browserNativeWindow.getGeometry();
      this.settingsRepo.saveWindowGeometry(geom);
    }

    // Tear down windows cleanly without orphans
    this.bubbleNativeWindow.hide();
    this.browserNativeWindow.hide();
    this.indicatorManager.destroy();
    this.eventBus.emit('window:closed', { toTray: false });
  }
}
