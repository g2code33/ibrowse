import test from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from '../packages/shared-core/src/events.js';
import { FloatingCircleController } from '../packages/shared-core/src/floating.js';
import { WindowStateManager } from '../packages/shared-core/src/window.js';
import { MemoryPersistenceAdapter } from '../packages/persistence/src/LocalFirstStore.js';
import { SettingsRepository } from '../packages/persistence/src/SettingsRepository.js';
import {
  LinuxFloatingController,
  LinuxDisplayCapabilityDetector,
  LinuxMonitorManager,
  LinuxAppIndicatorManager,
  LinuxNativeWindow
} from '../packages/floating-linux/src/index.js';

test('Linux Floating Modes: Mode A (Circle-First) vs Mode B (Browser-First) state transitions', () => {
  const bus = new EventBus();
  const circle = new FloatingCircleController(bus);
  const win = new WindowStateManager(bus);

  const controller = new LinuxFloatingController(circle, win, bus, 'circle-first');

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

  // Restoring from bubble returns to floating browser
  controller.onCircleClicked();
  assert.equal(win.getState().isVisible, true);
  assert.equal(circle.getState().isVisible, false);
  assert.equal(controller.getBrowserNativeWindow().isWindowVisible(), true);
});

test('Linux Display Capabilities: X11 vs GNOME Wayland vs wlroots layer-shell detection', () => {
  // X11 Session
  const x11Caps = LinuxDisplayCapabilityDetector.detect({
    XDG_SESSION_TYPE: 'x11',
    XDG_CURRENT_DESKTOP: 'ubuntu:GNOME'
  });
  assert.equal(x11Caps.server, 'x11');
  assert.equal(x11Caps.isWayland, false);
  assert.equal(x11Caps.canGlobalPosition, true);
  assert.equal(x11Caps.canKeepAbove, true);
  assert.equal(x11Caps.canEdgeSnap, true);
  assert.equal(x11Caps.canInteractiveMove, true);

  // GNOME Wayland Session
  const gnomeWaylandCaps = LinuxDisplayCapabilityDetector.detect({
    WAYLAND_DISPLAY: 'wayland-0',
    XDG_SESSION_TYPE: 'wayland',
    XDG_CURRENT_DESKTOP: 'ubuntu:GNOME'
  });
  assert.equal(gnomeWaylandCaps.server, 'wayland-gnome');
  assert.equal(gnomeWaylandCaps.isWayland, true);
  assert.equal(gnomeWaylandCaps.canGlobalPosition, false); // Mutter security boundary
  assert.equal(gnomeWaylandCaps.canKeepAbove, true);
  assert.equal(gnomeWaylandCaps.canInteractiveMove, true); // Interactive drag is supported
  assert.equal(gnomeWaylandCaps.canInteractiveResize, true);
  assert.ok(gnomeWaylandCaps.warningMessage);

  // Sway / wlroots Layer Shell Session
  const swayCaps = LinuxDisplayCapabilityDetector.detect({
    WAYLAND_DISPLAY: 'wayland-1',
    XDG_SESSION_TYPE: 'wayland',
    XDG_CURRENT_DESKTOP: 'sway'
  });
  assert.equal(swayCaps.server, 'wayland-wlroots');
  assert.equal(swayCaps.supportsLayerShell, true);
  assert.equal(swayCaps.canGlobalPosition, true);
  assert.equal(swayCaps.canKeepAbove, true);
});

test('Linux Wayland: handles restricted positioning gracefully without full-screen degradation', () => {
  const bus = new EventBus();
  const circle = new FloatingCircleController(bus);
  const win = new WindowStateManager(bus);

  const gnomeWaylandCaps = LinuxDisplayCapabilityDetector.detect({
    WAYLAND_DISPLAY: 'wayland-0',
    XDG_SESSION_TYPE: 'wayland',
    XDG_CURRENT_DESKTOP: 'ubuntu:GNOME'
  });

  const controller = new LinuxFloatingController(circle, win, bus, 'browser-first', {
    capabilities: gnomeWaylandCaps
  });

  assert.equal(controller.getCapabilities().canGlobalPosition, false);
  // Ensure browser window remains floating (not full-screen maximized)
  assert.equal(win.getState().isMaximized, false);
  assert.equal(controller.getBrowserNativeWindow().isWindowVisible(), true);

  // Interactive move and resize grabs remain functional
  assert.equal(controller.getBrowserNativeWindow().beginInteractiveMove(), true);
  assert.equal(controller.getBrowserNativeWindow().beginInteractiveResize(0), true);
});

test('Linux Monitor Manager: multi-monitor geometry and work area clamping', () => {
  const multiMonitors = [
    {
      index: 0,
      name: 'eDP-1',
      geometry: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 28, width: 1920, height: 1052 }, // Top GNOME panel 28px
      scaleFactor: 1.0,
      isPrimary: true
    },
    {
      index: 1,
      name: 'HDMI-1',
      geometry: { x: 1920, y: 0, width: 2560, height: 1440 },
      workArea: { x: 1920, y: 0, width: 2560, height: 1440 },
      scaleFactor: 1.25,
      isPrimary: false
    }
  ];

  const manager = new LinuxMonitorManager(multiMonitors);
  assert.equal(manager.getMonitors().length, 2);

  // Locate monitor by coordinate center
  const mon0 = manager.getMonitorForWindow({ x: 400, y: 400, width: 800, height: 600 });
  assert.equal(mon0.index, 0);

  const mon1 = manager.getMonitorForWindow({ x: 2300, y: 300, width: 800, height: 600 });
  assert.equal(mon1.index, 1);

  // Clamp geometry attempting to escape monitor bounds or occlude top panel
  const clamped0 = manager.clampToMonitorWorkArea({ x: -100, y: 10, width: 800, height: 600 }, 0);
  assert.equal(clamped0.x, 0);
  assert.equal(clamped0.y, 28); // Clamped below 28px GNOME panel

  // Clamp on external monitor
  const clamped1 = manager.clampToMonitorWorkArea({ x: 4500, y: 1200, width: 800, height: 600 }, 1);
  assert.equal(clamped1.x, 1920 + 2560 - 800); // 3680
  assert.equal(clamped1.y, 1440 - 600); // 840
});

test('Linux Floating Controller: magnetic edge snapping against work area', () => {
  const bus = new EventBus();
  const circle = new FloatingCircleController(bus);
  const win = new WindowStateManager(bus);

  const x11Caps = LinuxDisplayCapabilityDetector.detect({ XDG_SESSION_TYPE: 'x11' });
  const controller = new LinuxFloatingController(circle, win, bus, 'browser-first', {
    capabilities: x11Caps
  });

  // Snap to left edge (x=10 within 16px threshold) -> snaps to x=0
  controller.handleDrag(10, 200, true);
  assert.equal(controller.getBrowserNativeWindow().getGeometry().x, 0);

  // Snap to top work area (y=34 within 16px threshold of GNOME top bar 28px) -> snaps to y=28
  controller.handleDrag(300, 34, true);
  assert.equal(controller.getBrowserNativeWindow().getGeometry().y, 28);
});

test('Linux AppIndicator & Close-to-Tray lifecycle', () => {
  const bus = new EventBus();
  const circle = new FloatingCircleController(bus);
  const win = new WindowStateManager(bus);
  const indicator = new LinuxAppIndicatorManager(bus);

  const controller = new LinuxFloatingController(circle, win, bus, 'circle-first', {
    indicatorManager: indicator,
    settings: { closeToTray: true, minimizeToBubble: true }
  });

  assert.equal(indicator.isIndicatorVisible(), true);
  assert.equal(indicator.getMenu().length >= 4, true);

  // Close browser window -> closeToTray minimizes to bubble without killing process
  controller.onCircleClicked();
  assert.equal(controller.getBrowserNativeWindow().isWindowVisible(), true);

  controller.onBrowserClose();
  assert.equal(controller.getBrowserNativeWindow().isWindowVisible(), false);
  assert.equal(controller.getBubbleNativeWindow().isWindowVisible(), true);

  // Trigger quit menu action
  let quitFired = false;
  bus.on('window:closed', (p) => {
    if (!p.toTray) quitFired = true;
  });

  indicator.triggerMenuAction('quit');
  assert.equal(quitFired, true);
  assert.equal(indicator.isIndicatorVisible(), false);
});

test('Linux Keyboard Accessibility: shortcuts trigger minimize, toggle, and expand', () => {
  const bus = new EventBus();
  const circle = new FloatingCircleController(bus);
  const win = new WindowStateManager(bus);
  const controller = new LinuxFloatingController(circle, win, bus, 'circle-first');

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

test('Linux Floating Controller: window geometry persistence across restarts', async () => {
  const bus = new EventBus();
  const circle = new FloatingCircleController(bus);
  const win = new WindowStateManager(bus);
  const adapter = new MemoryPersistenceAdapter();
  const settingsRepo = new SettingsRepository(adapter);

  const x11Caps = LinuxDisplayCapabilityDetector.detect({ XDG_SESSION_TYPE: 'x11' });

  const controller1 = new LinuxFloatingController(circle, win, bus, 'browser-first', {
    settingsRepo,
    capabilities: x11Caps,
    settings: { rememberPosition: true, rememberSize: true }
  });

  controller1.handleDrag(420, 260, false);
  controller1.handleResize(880, 640, false);

  // Simulate reboot
  const bus2 = new EventBus();
  const circle2 = new FloatingCircleController(bus2);
  const win2 = new WindowStateManager(bus2);

  const controller2 = new LinuxFloatingController(circle2, win2, bus2, 'browser-first', {
    settingsRepo,
    capabilities: x11Caps,
    settings: { rememberPosition: true, rememberSize: true }
  });

  await controller2.restoreSavedGeometry();

  const restored = controller2.getBrowserNativeWindow().getGeometry();
  assert.equal(restored.x, 420);
  assert.equal(restored.y, 260);
  assert.equal(restored.width, 880);
  assert.equal(restored.height, 640);
});
