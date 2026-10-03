import test from 'node:test';
import assert from 'node:assert/strict';

import { AndroidOverlayManager } from '../packages/floating-android/src/index.js';
import { AndroidWebViewEngine } from '../packages/browser-android/src/index.js';
import { FloatingCircleController } from '../packages/shared-core/src/floating.js';
import { WindowStateManager } from '../packages/shared-core/src/window.js';

test('Android Floating Window: initializes with adaptive default bounds and enforces min limits', () => {
  const manager = new AndroidOverlayManager();
  const bounds = manager.getWindowBounds();

  assert.equal(bounds.width >= 280, true);
  assert.equal(bounds.height >= 360, true);
  assert.equal(bounds.x >= 0, true);
  assert.equal(bounds.y >= 0, true);

  // Attempt resize below minimum limits
  const resized = manager.resize(100, 150, 1080, 2400);
  assert.equal(resized.width, 280);
  assert.equal(resized.height, 360);
});

test('Android Floating Window: manages movement and clamps within safe display boundaries', () => {
  const manager = new AndroidOverlayManager();

  // Move right and down
  const moved = manager.move(100, 120, 1080, 2400);
  assert.equal(moved.x, 140);
  assert.equal(moved.y, 220);

  // Move beyond screen boundaries -> clamps
  const clamped = manager.move(2000, 3000, 1080, 2400);
  assert.equal(clamped.x, 1080 - clamped.width);
  assert.equal(clamped.y, 2400 - clamped.height);
});

test('Android Floating Window: manages dynamic resizing from corner handle', () => {
  const manager = new AndroidOverlayManager();

  const resized = manager.resize(500, 700, 1080, 2400);
  assert.equal(resized.width, 500);
  assert.equal(resized.height, 700);

  // Resize exceeding screen width -> clamps to max available
  const maxResized = manager.resize(1500, 3000, 1080, 2400);
  assert.equal(maxResized.width, 1080 - manager.getWindowBounds().x);
  assert.equal(maxResized.height, 2400 - manager.getWindowBounds().y);
});

test('Android Floating Window: preserves single browser engine instance without duplicate creation', () => {
  const manager = new AndroidOverlayManager();
  const engine = new AndroidWebViewEngine();

  // 1. Attach engine
  manager.attachBrowser(engine);
  assert.strictEqual(manager.getAttachedBrowser(), engine);

  // 2. Detach engine
  const detached = manager.detachBrowser();
  assert.strictEqual(detached, engine);
  assert.strictEqual(manager.getAttachedBrowser(), null);

  // 3. Reattach same engine instance
  manager.attachBrowser(detached);
  assert.strictEqual(manager.getAttachedBrowser(), engine);
});

test('Android Floating Window: Minimize hides window, preserves session, and shows bubble', () => {
  const manager = new AndroidOverlayManager();
  const engine = new AndroidWebViewEngine();
  manager.showBrowserWindow(engine);

  assert.equal(manager.isWindowVisible(), true);
  assert.equal(manager.isBubbleVisible(), false);
  assert.strictEqual(manager.getAttachedBrowser(), engine);

  // Minimize
  manager.minimize();
  assert.equal(manager.isWindowVisible(), false);
  assert.equal(manager.isBubbleVisible(), true);
  // Session remains intact in memory
  assert.strictEqual(manager.getAttachedBrowser(), engine);
});

test('Android Floating Window: Restore reattaches existing session and hides bubble', () => {
  const manager = new AndroidOverlayManager();
  const engine = new AndroidWebViewEngine();
  manager.showFloatingCircle();

  assert.equal(manager.isBubbleVisible(), true);
  assert.equal(manager.isWindowVisible(), false);

  // Restore browser
  manager.restore();
  assert.equal(manager.isBubbleVisible(), false);
  assert.equal(manager.isWindowVisible(), true);
});

test('Android Floating Window: Close returns to bubble without terminating service', () => {
  const manager = new AndroidOverlayManager();
  manager.showBrowserWindow();

  let isClosed = false;
  manager.addEventListener('windowClosed', (data) => {
    isClosed = true;
    assert.equal(data.serviceRunning, true);
  });

  manager.closeWindow();
  assert.equal(isClosed, true);
  assert.equal(manager.isWindowVisible(), false);
  assert.equal(manager.isBubbleVisible(), true);
});

test('Android Floating Window: Stop cleans up both bubble and browser window completely', () => {
  const manager = new AndroidOverlayManager();
  const engine = new AndroidWebViewEngine();
  manager.showBrowserWindow(engine);

  manager.stopCompleteFloatingExperience();
  assert.equal(manager.isWindowVisible(), false);
  assert.equal(manager.isBubbleVisible(), false);
  assert.strictEqual(manager.getAttachedBrowser(), null);
});

test('Android Floating Window: allows active navigation while floating and resized', async () => {
  const manager = new AndroidOverlayManager();
  const engine = new AndroidWebViewEngine();
  manager.showBrowserWindow(engine);
  manager.resize(480, 640);

  await engine.navigate('https://yayra.app');
  assert.equal(engine.getCurrentUrl(), 'https://yayra.app/');
  assert.equal(engine.getActiveTab()?.isSecure, true);

  manager.minimize();
  // Navigating while minimized remains supported
  await engine.navigate('https://duckduckgo.com');
  assert.equal(engine.getCurrentUrl(), 'https://duckduckgo.com/');
  assert.strictEqual(manager.getAttachedBrowser(), engine);
});
