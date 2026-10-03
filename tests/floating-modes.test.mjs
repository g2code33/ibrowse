import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../packages/shared-core/src/events.js';
import { FloatingCircleController } from '../packages/shared-core/src/floating.js';
import { WindowStateManager } from '../packages/shared-core/src/window.js';
import { WindowsFloatingController } from '../packages/floating-windows/src/WindowsFloatingController.js';
import { LinuxFloatingController } from '../packages/floating-linux/src/LinuxFloatingController.js';

test('FloatingCircleController snaps to nearest left/right screen edge', () => {
  const bus = new EventBus();
  const circle = new FloatingCircleController(bus);

  circle.setPosition(100, 300);
  const sideLeft = circle.snapToNearestEdge(1920, 1080, 20);
  assert.equal(sideLeft, 'left');
  assert.equal(circle.getState().x, 20);

  circle.setPosition(1500, 300);
  const sideRight = circle.snapToNearestEdge(1920, 1080, 20);
  assert.equal(sideRight, 'right');
  assert.equal(circle.getState().x, 1920 - 56 - 20);
});

test('WindowsFloatingController implements Circle-first vs Browser-first desktop modes', () => {
  const bus = new EventBus();
  const circle = new FloatingCircleController(bus);
  const win = new WindowStateManager(bus);

  const controller = new WindowsFloatingController(circle, win, bus, 'circle-first');

  // In circle-first mode: circle visible, browser minimized initially
  assert.equal(circle.getState().isVisible, true);
  assert.equal(win.getState().isVisible, false);

  // User clicks circle -> expands to floating window
  controller.onCircleClicked();
  assert.equal(win.getState().isVisible, true);

  // User minimizes browser -> returns to circle
  controller.onBrowserMinimize();
  assert.equal(win.getState().isVisible, false);
  assert.equal(circle.getState().isVisible, true);

  // Switch to Browser-first mode
  controller.setMode('browser-first');
  assert.equal(controller.getMode(), 'browser-first');
  assert.equal(win.getState().isVisible, true);
  assert.equal(circle.getState().isVisible, false);

  // Minimize in browser-first mode docks into circle
  controller.onBrowserMinimize();
  assert.equal(win.getState().isVisible, false);
  assert.equal(circle.getState().isVisible, true);
});

test('LinuxFloatingController coordinates floating mode state correctly', () => {
  const bus = new EventBus();
  const circle = new FloatingCircleController(bus);
  const win = new WindowStateManager(bus);

  const controller = new LinuxFloatingController(circle, win, bus, 'browser-first');
  assert.equal(win.getState().isVisible, true);
  assert.equal(circle.getState().isVisible, false);

  controller.setMode('circle-first');
  assert.equal(win.getState().isVisible, false);
  assert.equal(circle.getState().isVisible, true);
});
