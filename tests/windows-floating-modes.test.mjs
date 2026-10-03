import test from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from '../packages/shared-core/src/events.js';
import { FloatingCircleController } from '../packages/shared-core/src/floating.js';
import { WindowStateManager } from '../packages/shared-core/src/window.js';
import { MemoryPersistenceAdapter } from '../packages/persistence/src/LocalFirstStore.js';
import { SettingsRepository } from '../packages/persistence/src/SettingsRepository.js';
import {
  WindowsFloatingController,
  WindowsMonitorManager,
  WindowsTrayManager,
  WindowsSingleInstanceManager,
  WindowsNativeWindow
} from '../packages/floating-windows/src/index.js';

test('Windows Floating Modes: Mode A (Circle-First) vs Mode B (Browser-First) state transitions', () => {
  const bus = new EventBus();
  const circle = new FloatingCircleController(bus);
  const win = new WindowStateManager(bus);

  const controller = new WindowsFloatingController(circle, win, bus, 'circle-first');

  // Mode A: Circle-First initialization
  assert.equal(controller.getMode(), 'circle-first');
  assert.equal(circle.getState().isVisible, true);
  assert.equal(circle.getState().isExpanded, false);
  assert.equal(win.getState().isVisible, false);
  assert.equal(controller.getBubbleNativeWindow().isWindowVisible(), true);
  assert.equal(controller.getBrowserNativeWindow().isWindowVisible(), false);

  // Bubble clicked -> expands and shows floating browser
  controller.onCircleClicked();
  assert.equal(circle.getState().isExpanded, true);
  assert.equal(win.getState().isVisible, true);
  assert.equal(controller.getBrowserNativeWindow().isWindowVisible(), true);

  // Browser minimized -> collapses back to bubble
  controller.onBrowserMinimize();
  assert.equal(win.getState().isVisible, false);
  assert.equal(circle.getState().isVisible, true);
  assert.equal(controller.getBrowserNativeWindow().isWindowVisible(), false);
  assert.equal(controller.getBubbleNativeWindow().isWindowVisible(), true);

  // Switch to Mode B: Browser-First
  controller.setMode('browser-first');
  assert.equal(controller.getMode(), 'browser-first');
  assert.equal(win.getState().isVisible, true);
  assert.equal(circle.getState().isVisible, false);
  assert.equal(controller.getBrowserNativeWindow().isWindowVisible(), true);
  assert.equal(controller.getBubbleNativeWindow().isWindowVisible(), false);

  // Minimize in Browser-First mode docks into circle
  controller.onBrowserMinimize();
  assert.equal(win.getState().isVisible, false);
  assert.equal(circle.getState().isVisible, true);
  assert.equal(controller.getBrowserNativeWindow().isWindowVisible(), false);
  assert.equal(controller.getBubbleNativeWindow().isWindowVisible(), true);

  // Clicking bubble in Browser-First mode restores browser and hides bubble
  controller.onCircleClicked();
  assert.equal(win.getState().isVisible, true);
  assert.equal(circle.getState().isVisible, false);
  assert.equal(controller.getBrowserNativeWindow().isWindowVisible(), true);
});

test('Windows Floating Settings: updates and persists all 8 desktop configuration options', async () => {
  const bus = new EventBus();
  const circle = new FloatingCircleController(bus);
  const win = new WindowStateManager(bus);
  const adapter = new MemoryPersistenceAdapter();
  const settingsRepo = new SettingsRepository(adapter);

  const controller = new WindowsFloatingController(circle, win, bus, 'circle-first', {
    settingsRepo
  });

  const defaults = controller.getSettings();
  assert.equal(defaults.desktopFloatingMode, 'circle-first');
  assert.equal(defaults.startFloatingOnLaunch, true);
  assert.equal(defaults.alwaysOnTop, true);
  assert.equal(defaults.rememberPosition, true);
  assert.equal(defaults.rememberSize, true);
  assert.equal(defaults.minimizeToBubble, true);
  assert.equal(defaults.closeToTray, true);
  assert.equal(defaults.startWithWindows, false);

  // Update settings
  await controller.updateSettings({
    desktopFloatingMode: 'browser-first',
    alwaysOnTop: false,
    minimizeToBubble: false,
    closeToTray: false,
    startWithWindows: true
  });

  const updated = controller.getSettings();
  assert.equal(updated.desktopFloatingMode, 'browser-first');
  assert.equal(updated.alwaysOnTop, false);
  assert.equal(updated.minimizeToBubble, false);
  assert.equal(updated.closeToTray, false);
  assert.equal(updated.startWithWindows, true);
  assert.equal(controller.isAlwaysOnTop(), false);

  // Verify persistence in repository
  const stored = await settingsRepo.getSettings();
  assert.equal(stored.desktopFloatingMode, 'browser-first');
  assert.equal(stored.alwaysOnTop, false);
  assert.equal(stored.startWithWindows, true);
});

test('Windows Native Window: enforces WS_EX_TOPMOST, WS_EX_TOOLWINDOW and non-focus stealing', () => {
  const monitorManager = new WindowsMonitorManager();
  const bubbleHwnd = new WindowsNativeWindow(
    'HWND_BUBBLE',
    'Yayra Floating Bubble',
    { x: 30, y: 120, width: 56, height: 56 },
    { isTopmost: true, isToolWindow: true, isAppWindow: false, isLayered: true },
    monitorManager
  );

  const styles = bubbleHwnd.getStyles();
  assert.equal(styles.isTopmost, true);
  assert.equal(styles.isToolWindow, true);
  assert.equal(styles.isAppWindow, false);
  assert.equal(styles.isLayered, true);

  // Show bubble with SWP_NOACTIVATE (activate = false)
  bubbleHwnd.show(false);
  assert.equal(bubbleHwnd.isWindowVisible(), true);
  assert.equal(bubbleHwnd.getStyles().noActivate, true);

  // Browser window is an AppWindow
  const browserHwnd = new WindowsNativeWindow(
    'HWND_BROWSER',
    'Yayra Floating Browser',
    { x: 100, y: 100, width: 800, height: 600 },
    { isTopmost: true, isToolWindow: false, isAppWindow: true },
    monitorManager
  );
  assert.equal(browserHwnd.getStyles().isToolWindow, false);
  assert.equal(browserHwnd.getStyles().isAppWindow, true);
});

test('Windows Monitor Manager: multi-monitor geometry detection and work area clamping', () => {
  const multiMonitors = [
    {
      id: 'MONITOR-0',
      index: 0,
      name: '\\\\.\\DISPLAY1 (Primary)',
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 }, // 40px taskbar
      dpi: 96,
      scaleFactor: 1.0,
      isPrimary: true
    },
    {
      id: 'MONITOR-1',
      index: 1,
      name: '\\\\.\\DISPLAY2 (Secondary)',
      bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
      workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
      dpi: 120,
      scaleFactor: 1.25,
      isPrimary: false
    }
  ];

  const manager = new WindowsMonitorManager(multiMonitors);
  assert.equal(manager.getMonitors().length, 2);
  assert.equal(manager.getPrimaryMonitor().index, 0);

  // Identify monitor for coordinates in Monitor 0
  const mon0 = manager.getMonitorForWindow({ x: 200, y: 200, width: 800, height: 600 });
  assert.equal(mon0.index, 0);

  // Identify monitor for coordinates in Monitor 1
  const mon1 = manager.getMonitorForWindow({ x: 2200, y: 300, width: 800, height: 600 });
  assert.equal(mon1.index, 1);

  // Clamp geometry attempting to escape monitor bounds
  const clamped0 = manager.clampToMonitorWorkArea({ x: -100, y: 900, width: 800, height: 600 }, 0);
  assert.equal(clamped0.x, 0);
  assert.equal(clamped0.y, 440); // 1040 - 600

  // Clamp on secondary monitor
  const clamped1 = manager.clampToMonitorWorkArea({ x: 4000, y: 1200, width: 800, height: 600 }, 1);
  assert.equal(clamped1.x, 1920 + 2560 - 800); // 3680
  assert.equal(clamped1.y, 1400 - 600); // 800
});

test('Windows Monitor Manager: Per-Monitor DPI scaling conversions', () => {
  const manager = new WindowsMonitorManager();

  // 96 DPI (100% scale)
  assert.equal(manager.logicalToPhysical(100, 96), 100);
  assert.equal(manager.physicalToLogical(100, 96), 100);

  // 120 DPI (125% scale)
  assert.equal(manager.logicalToPhysical(100, 120), 125);
  assert.equal(manager.physicalToLogical(125, 120), 100);

  // 144 DPI (150% scale)
  assert.equal(manager.logicalToPhysical(200, 144), 300);
  assert.equal(manager.physicalToLogical(300, 144), 200);

  // 192 DPI (200% scale)
  assert.equal(manager.logicalToPhysical(400, 192), 800);
  assert.equal(manager.physicalToLogical(800, 192), 400);
});

test('Windows Floating Controller: magnetic edge snapping against work area', () => {
  const bus = new EventBus();
  const circle = new FloatingCircleController(bus);
  const win = new WindowStateManager(bus);
  const controller = new WindowsFloatingController(circle, win, bus, 'browser-first');

  // Drag close to left edge (x=8 within 16px threshold) -> snaps to x=0
  controller.handleDrag(8, 200, true);
  assert.equal(controller.getBrowserNativeWindow().getGeometry().x, 0);

  // Drag close to top edge (y=10 within 16px threshold) -> snaps to y=0
  controller.handleDrag(300, 10, true);
  assert.equal(controller.getBrowserNativeWindow().getGeometry().y, 0);

  // Drag close to right edge (1920 - 800 = 1120, drag to 1112) -> snaps to 1120
  controller.handleDrag(1112, 300, true);
  assert.equal(controller.getBrowserNativeWindow().getGeometry().x, 1120);
});

test('Windows System Tray & Close-to-Tray lifecycle', () => {
  const bus = new EventBus();
  const circle = new FloatingCircleController(bus);
  const win = new WindowStateManager(bus);
  const tray = new WindowsTrayManager(bus);

  const controller = new WindowsFloatingController(circle, win, bus, 'circle-first', {
    trayManager: tray,
    settings: { closeToTray: true, minimizeToBubble: true }
  });

  assert.equal(tray.isTrayVisible(), true);
  assert.equal(tray.getContextMenu().length >= 4, true);

  // Close browser window -> closeToTray minimizes to bubble without killing app
  controller.onCircleClicked(); // Show browser
  assert.equal(controller.getBrowserNativeWindow().isWindowVisible(), true);

  controller.onBrowserClose();
  assert.equal(controller.getBrowserNativeWindow().isWindowVisible(), false);
  assert.equal(controller.getBubbleNativeWindow().isWindowVisible(), true);

  // Tray menu action: exit
  let exitFired = false;
  bus.on('window:closed', (p) => {
    if (!p.toTray) exitFired = true;
  });

  tray.triggerMenuAction('exit');
  assert.equal(exitFired, true);
  assert.equal(tray.isTrayVisible(), false);
});

test('Windows Single Instance Mutex: detects collision and restores primary window', () => {
  const mutexManager = new WindowsSingleInstanceManager('Local\\YayraFloatingBrowserSingleInstanceMutex');
  assert.equal(mutexManager.acquireLock(), true);
  assert.equal(mutexManager.isPrimaryInstance(), true);

  let secondaryNotified = false;
  mutexManager.onSecondInstance(() => {
    secondaryNotified = true;
  });

  // Second instance attempts to start and forwards launch payload
  mutexManager.handleSecondaryLaunch({
    commandLine: ['yayra.exe', '--new-tab'],
    workingDirectory: 'C:\\Users\\User\\AppData',
    timestamp: Date.now()
  });

  assert.equal(secondaryNotified, true);
});

test('Windows Keyboard Accessibility: shortcuts trigger minimize, toggle, and expand', () => {
  const bus = new EventBus();
  const circle = new FloatingCircleController(bus);
  const win = new WindowStateManager(bus);
  const controller = new WindowsFloatingController(circle, win, bus, 'circle-first');

  // Space/Enter on bubble expands browser
  const enterHandled = controller.handleKeyboardShortcut('Enter');
  assert.equal(enterHandled, true);
  assert.equal(controller.getBrowserNativeWindow().isWindowVisible(), true);

  // Escape minimizes browser window
  const escHandled = controller.handleKeyboardShortcut('Escape');
  assert.equal(escHandled, true);
  assert.equal(controller.getBrowserNativeWindow().isWindowVisible(), false);
  assert.equal(controller.getBubbleNativeWindow().isWindowVisible(), true);

  // Alt+F toggles browser window
  const altFHandled = controller.handleKeyboardShortcut('F', true, false);
  assert.equal(altFHandled, true);
  assert.equal(controller.getBrowserNativeWindow().isWindowVisible(), true);
});

test('Windows Floating Controller: window geometry persistence across restarts', async () => {
  const bus = new EventBus();
  const circle = new FloatingCircleController(bus);
  const win = new WindowStateManager(bus);
  const adapter = new MemoryPersistenceAdapter();
  const settingsRepo = new SettingsRepository(adapter);

  const controller1 = new WindowsFloatingController(circle, win, bus, 'browser-first', {
    settingsRepo,
    settings: { rememberPosition: true, rememberSize: true }
  });

  // Move and resize browser window
  controller1.handleDrag(340, 220, false);
  controller1.handleResize(920, 680, false);

  // Instantiate second controller instance simulating app reboot
  const bus2 = new EventBus();
  const circle2 = new FloatingCircleController(bus2);
  const win2 = new WindowStateManager(bus2);

  const controller2 = new WindowsFloatingController(circle2, win2, bus2, 'browser-first', {
    settingsRepo,
    settings: { rememberPosition: true, rememberSize: true }
  });

  await controller2.restoreSavedGeometry();

  const restored = controller2.getBrowserNativeWindow().getGeometry();
  assert.equal(restored.x, 340);
  assert.equal(restored.y, 220);
  assert.equal(restored.width, 920);
  assert.equal(restored.height, 680);
});
