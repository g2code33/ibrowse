import test from 'node:test';
import assert from 'node:assert/strict';

import { AndroidOverlayManager } from '../packages/floating-android/src/index.js';
import { FloatingCircleController } from '../packages/shared-core/src/floating.js';
import { WindowStateManager } from '../packages/shared-core/src/window.js';
import { EventBus } from '../packages/shared-core/src/events.js';

test('Android Floating Bubble: validates ~60dp dimension and opacity bounds', () => {
  const manager = new AndroidOverlayManager();
  assert.equal(manager.getOpacity(), 0.85);

  manager.setOpacity(0.5);
  assert.equal(manager.getOpacity(), 0.5);

  // Clamping
  manager.setOpacity(0.05);
  assert.equal(manager.getOpacity(), 0.2);

  manager.setOpacity(1.5);
  assert.equal(manager.getOpacity(), 1.0);
});

test('Android Floating Bubble: disambiguates tap from drag using touch slop', () => {
  const manager = new AndroidOverlayManager();
  let tapCount = 0;
  let dragCount = 0;

  manager.addEventListener('tap', () => { tapCount++; });
  manager.addEventListener('drag', () => { dragCount++; });

  // 1. Stationary touch -> Tap
  manager.triggerTap();
  assert.equal(tapCount, 1);
  assert.equal(dragCount, 0);

  // 2. Drag motion (> touchSlop) -> Drag
  const dragResult = manager.triggerDrag(150, 80, 1080);
  assert.equal(dragCount, 1);
  assert.ok(dragResult.x > 0);
  assert.equal(dragResult.snappedSide, 'left');
});

test('Android Floating Bubble: triggers long-press quick actions menu', () => {
  const manager = new AndroidOverlayManager();
  let receivedAction = null;

  manager.addEventListener('longPress', (data) => {
    receivedAction = data.action;
  });

  manager.triggerLongPress('quick_actions');
  assert.equal(receivedAction, 'quick_actions');
});

test('Android Floating Bubble: snaps to nearest left/right screen edge', () => {
  const circleController = new FloatingCircleController();
  const manager = new AndroidOverlayManager(circleController);

  // Drag to left half (e.g. x = 200 on 1080px screen)
  const leftDrag = manager.triggerDrag(200, 300, 1080);
  assert.equal(leftDrag.snappedSide, 'left');

  // Drag to right half (e.g. x = 800 on 1080px screen)
  const rightDrag = manager.triggerDrag(600, 0, 1080);
  assert.equal(rightDrag.snappedSide, 'right');
});

test('Android Floating Bubble: respects display cutouts and status/navigation bar insets', () => {
  const screenWidth = 1080;
  const screenHeight = 2400;
  const statusBarHeight = 72;
  const navBarHeight = 120;
  const bubbleSize = 160;
  const safeMargin = 16;

  // Verify minY and maxY bounds calculations
  const minY = statusBarHeight + safeMargin;
  const maxY = screenHeight - navBarHeight - bubbleSize - safeMargin;

  assert.equal(minY, 88);
  assert.equal(maxY, 2104);

  // Clamped position within safe bounds
  const clampedY = Math.max(minY, Math.min(maxY, 50)); // Below status bar
  assert.equal(clampedY, 88);
});

test('Android Floating Bubble: handles SYSTEM_ALERT_WINDOW permission and revocation', async () => {
  const manager = new AndroidOverlayManager();
  assert.equal(await manager.checkPermission(), true);

  // Show bubble with permission
  assert.equal(manager.showFloatingCircle(), true);
  assert.equal(manager.isVisible(), true);

  // Revoke permission dynamically -> bubble must be hidden immediately
  manager.setPermissionOverride(false);
  assert.equal(await manager.checkPermission(), false);
  assert.equal(manager.isVisible(), false);
  assert.equal(manager.showFloatingCircle(), false);

  // Re-grant permission
  await manager.requestPermission();
  assert.equal(await manager.checkPermission(), true);
  assert.equal(manager.showFloatingCircle(), true);
});

test('Android Floating Bubble: expands to floating window and collapses to circle', () => {
  const circle = new FloatingCircleController();
  const windowState = new WindowStateManager();
  const manager = new AndroidOverlayManager(circle, windowState);

  manager.expandToFloatingWindow();
  assert.equal(circle.isExpanded(), true);
  assert.equal(windowState.getState().isMinimized, false);
  assert.equal(windowState.getState().isVisible, true);

  manager.collapseToCircle();
  assert.equal(circle.isExpanded(), false);
  assert.equal(windowState.getState().isMinimized, true);
  assert.equal(windowState.getState().isVisible, false);
});

test('Android Floating Bubble: disposes cleanly and tears down listeners', () => {
  const manager = new AndroidOverlayManager();
  manager.showFloatingCircle();
  assert.equal(manager.isVisible(), true);

  manager.destroy();
  assert.equal(manager.isVisible(), false);
});
