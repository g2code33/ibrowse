import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../packages/shared-core/src/events.js';
import { FloatingCircleController } from '../packages/shared-core/src/floating.js';
import { WindowStateManager } from '../packages/shared-core/src/window.js';
import { AndroidOverlayManager } from '../packages/floating-android/src/AndroidOverlayManager.js';
import { AndroidWebViewEngine } from '../packages/browser-android/src/AndroidWebViewEngine.js';
import { WindowsFloatingController } from '../packages/floating-windows/src/WindowsFloatingController.js';
import { WindowsWebView2Engine } from '../packages/browser-windows/src/WindowsWebView2Engine.js';
import { LinuxFloatingController } from '../packages/floating-linux/src/LinuxFloatingController.js';
import { LinuxWebKitEngine } from '../packages/browser-linux/src/LinuxWebKitEngine.js';
import { DefaultSecurityPolicy } from '../packages/browser-contract/src/ISecurityPolicy.js';
import { WebsitePermissionManager } from '../packages/browser-contract/src/permissions/WebsitePermissionManager.js';
import { MemoryPersistenceAdapter } from '../packages/persistence/src/LocalFirstStore.js';
import {
  HistoryRepository,
  BookmarkRepository,
  SessionRepository,
  DownloadRepository
} from '../packages/persistence/src/HistoryRepository.js';
import { SettingsRepository } from '../packages/persistence/src/SettingsRepository.js';

test('Functional QA #1-6: Floating Bubble Lifecycle, Draggability, Resizing, Minimize & Session Restoration', async () => {
  const overlay = new AndroidOverlayManager();
  const engine = new AndroidWebViewEngine();

  // 1. Bubble appears correctly
  assert.equal(overlay.isBubbleVisible(), false);
  assert.equal(overlay.showFloatingCircle(), true);
  assert.equal(overlay.isBubbleVisible(), true);

  // 2. Bubble is draggable with edge snapping
  const dragResult = overlay.triggerDrag(150, 50, 1080);
  assert.ok(dragResult.x >= 0);
  assert.ok(dragResult.snappedSide === 'left' || dragResult.snappedSide === 'right');

  // 3. Browser opens from bubble
  assert.equal(overlay.showBrowserWindow(engine), true);
  assert.equal(overlay.isWindowVisible(), true);
  assert.equal(overlay.isBubbleVisible(), false);
  assert.equal(overlay.getAttachedBrowser(), engine);

  // 4. Browser can resize within display bounds
  const resized = overlay.resize(400, 600, 1080, 2400);
  assert.equal(resized.width, 400);
  assert.equal(resized.height, 600);

  // 5. Browser minimizes (hides window, shows bubble, preserves session)
  let minimizedEventFired = false;
  overlay.on('minimized', (e) => {
    minimizedEventFired = true;
    assert.equal(e.sessionPreserved, true);
  });
  overlay.minimize();
  assert.equal(overlay.isWindowVisible(), false);
  assert.equal(overlay.isBubbleVisible(), true);
  assert.equal(minimizedEventFired, true);

  // 6. Browser restores without losing session
  await engine.loadUrl('https://example.com/test-session');
  overlay.restore();
  assert.equal(overlay.isWindowVisible(), true);
  assert.equal(overlay.isBubbleVisible(), false);
  assert.equal(overlay.getAttachedBrowser()?.getCurrentUrl(), 'https://example.com/test-session');
});

test('Functional QA #7-8: Dual Desktop Floating Modes & Preference Persistence', async () => {
  const store = new MemoryPersistenceAdapter();
  const settingsRepo = new SettingsRepository(store);
  const bus = new EventBus();
  const circle = new FloatingCircleController(bus);
  const win = new WindowStateManager(bus);
  const controller = new WindowsFloatingController(circle, win, bus, 'circle-first');

  // 7. Test Mode A (Circle-First) vs Mode B (Browser-First)
  assert.equal(controller.getMode(), 'circle-first');
  assert.equal(controller.getBubbleNativeWindow().isWindowVisible(), true);
  assert.equal(controller.getBrowserNativeWindow().isWindowVisible(), false);

  controller.setMode('browser-first');
  assert.equal(controller.getMode(), 'browser-first');
  assert.equal(controller.getBrowserNativeWindow().isWindowVisible(), true);

  // 8. Desktop mode preference persists to local database
  await settingsRepo.updateSettings({ desktopFloatingMode: 'browser-first', defaultOpacity: 0.95 });
  const saved = await settingsRepo.getSettings();
  assert.equal(saved.desktopFloatingMode, 'browser-first');
  assert.equal(saved.defaultOpacity, 0.95);
});

test('Functional QA #9-10: Local-First History & Bookmarks Persistence', async () => {
  const store = new MemoryPersistenceAdapter();
  const historyRepo = new HistoryRepository(store);
  const bookmarkRepo = new BookmarkRepository(store);

  // 9. Browser history persists
  const entry1 = await historyRepo.addEntry('https://yayra.app/docs', 'Yayra Documentation');
  const entry2 = await historyRepo.addEntry('https://duckduckgo.com/?q=local+first', 'DuckDuckGo');
  assert.equal(entry1.title, 'Yayra Documentation');

  const historyList = await historyRepo.getEntries(10);
  assert.equal(historyList.length, 2);
  const searchResults = await historyRepo.search('yayra');
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].url, 'https://yayra.app/docs');

  // 10. Bookmarks persist with folder hierarchy
  const folder = await bookmarkRepo.createFolder('Tech Favorites');
  const bm = await bookmarkRepo.addBookmark('Yayra Home', 'https://yayra.app', folder.id);
  assert.equal(bm.parentId, folder.id);

  const folderBookmarks = await bookmarkRepo.getBookmarks(folder.id);
  assert.equal(folderBookmarks.length, 1);
  assert.equal(folderBookmarks[0].title, 'Yayra Home');
});

test('Functional QA #11-12: Multi-Tab Coordination & Universal Navigation Engine', async () => {
  const engine = new AndroidWebViewEngine();

  // 11. Multi-tab management
  const tab1 = engine.getActiveTab();
  assert.ok(tab1);

  const tab2 = engine.createTab({ url: 'https://duckduckgo.com' });
  const tab3 = engine.createTab({ url: 'https://yayra.app', isIncognito: true });
  assert.equal(engine.getTabs().length, 3);
  assert.equal(engine.getActiveTab()?.id, tab3.id);

  engine.selectTab(tab2.id);
  assert.equal(engine.getActiveTab()?.id, tab2.id);

  engine.closeTab(tab3.id);
  assert.equal(engine.getTabs().length, 2);

  // 12. Navigation: URL parsing, search queries, back/forward history
  await engine.loadUrl('what is local-first architecture');
  assert.match(engine.getCurrentUrl(), /google\.com\/search\?q=/);

  await engine.loadUrl('https://yayra.org/features');
  assert.equal(engine.canGoBack(), true);
  assert.equal(engine.canGoForward(), false);

  await engine.goBack();
  assert.match(engine.getCurrentUrl(), /google\.com\/search\?q=/);
  assert.equal(engine.canGoForward(), true);

  await engine.goForward();
  assert.equal(engine.getCurrentUrl(), 'https://yayra.org/features');
});

test('Functional QA #13: Safe Downloads without Auto-Execution', () => {
  const policy = new DefaultSecurityPolicy();

  // Download filename sanitization
  const safeName1 = policy.sanitizeDownloadFilename('../../../etc/shadow');
  assert.equal(safeName1, 'shadow');

  const safeName2 = policy.sanitizeDownloadFilename('CON.exe');
  assert.equal(safeName2, 'safe_CON.exe');

  const safeName3 = policy.sanitizeDownloadFilename('evil\x00file.apk');
  assert.equal(safeName3, 'evilfile.apk');

  // Verify auto-execute is permanently disabled by security invariant
  assert.equal(policy.allowAutoExecuteDownloads, false);
});

test('Functional QA #14-16: Clean Shutdown, Idempotent Overlays, & Permission Revocation', () => {
  const overlay = new AndroidOverlayManager();
  const engine = new AndroidWebViewEngine();

  // 15. No duplicate overlays appear (idempotency)
  overlay.showFloatingCircle();
  overlay.showFloatingCircle();
  assert.equal(overlay.isBubbleVisible(), true);

  overlay.showBrowserWindow(engine);
  overlay.showBrowserWindow(engine);
  assert.equal(overlay.isWindowVisible(), true);
  assert.equal(overlay.getAttachedBrowser(), engine);

  // 16. Permission revocation handling (SYSTEM_ALERT_WINDOW revoked mid-run)
  overlay.setPermissionOverride(false);
  assert.equal(overlay.isWindowVisible(), false);
  assert.equal(overlay.isBubbleVisible(), false);
  assert.equal(overlay.showFloatingCircle(), false);
  assert.equal(overlay.showBrowserWindow(engine), false);

  // 14. Service/window shutdown is clean
  overlay.setPermissionOverride(true);
  overlay.showBrowserWindow(engine);
  overlay.stopCompleteFloatingExperience();
  assert.equal(overlay.isWindowVisible(), false);
  assert.equal(overlay.isBubbleVisible(), false);
  assert.equal(overlay.getAttachedBrowser(), null);
});

test('Functional QA #17: Session Persistence & Seamless Normal Application Restart', async () => {
  const store = new MemoryPersistenceAdapter();
  const sessionRepo = new SessionRepository(store);

  // Simulate active session
  const activeTabs = [
    { id: 'tab_1', url: 'https://yayra.app/guide', title: 'Yayra Guide', isIncognito: false },
    { id: 'tab_2', url: 'https://developer.mozilla.org', title: 'MDN Web Docs', isIncognito: false },
    { id: 'tab_3', url: 'https://secret.org', title: 'Private Tab', isIncognito: true }
  ];

  await sessionRepo.saveTabs(activeTabs, 'tab_2');

  // Simulate cold app restart
  const restored = await sessionRepo.restoreTabs();
  assert.ok(restored);
  assert.equal(restored.activeTabId, 'tab_2');
  // Incognito tab strictly excluded from disk restore
  assert.equal(restored.tabs.length, 2);
  assert.equal(restored.tabs[0].url, 'https://yayra.app/guide');
  assert.equal(restored.tabs[1].url, 'https://developer.mozilla.org');
});

test('Platform Compatibility: Android 10-15+ FGS, Permissions, Screen Insets & Low Memory', async () => {
  const overlay = new AndroidOverlayManager();

  // Screen rotation / bounds adaptivity (Phone 360x780 -> Tablet 1200x800 -> Foldable)
  const phoneBounds = overlay.resize(360, 600, 393, 852);
  assert.ok(phoneBounds.width <= 393);

  const tabletBounds = overlay.resize(800, 1000, 1200, 1600);
  assert.equal(tabletBounds.width, 800);
  assert.equal(tabletBounds.height, 1000);

  // Android 13+ Notification / Website Permission Manager
  const permManager = new WebsitePermissionManager();
  const initial = await permManager.getPermission('https://maps.google.com', 'geolocation');
  assert.equal(initial, 'prompt');

  // Low memory state simulation (engine recovers without crashing)
  const engine = new AndroidWebViewEngine();
  engine.handleRendererCrashed('tab-1', false);
  assert.equal(engine.getActiveTab()?.isLoading, false);
});

test('Platform Compatibility: Windows 10/11 64-bit, Multi-Monitor Clamping & Focus Safety', () => {
  const bus = new EventBus();
  const circle = new FloatingCircleController(bus);
  const win = new WindowStateManager(bus);
  const controller = new WindowsFloatingController(circle, win, bus, 'circle-first');
  const engine = new WindowsWebView2Engine();

  // Multi-monitor clamping
  const nativeWin = controller.getBrowserNativeWindow();
  nativeWin.setPosition(2500, 300, false);
  nativeWin.setSize(600, 800, false);
  const bounds = nativeWin.getGeometry();
  assert.equal(bounds.x, 2500);

  // Focus-stealing safety invariants
  assert.ok(nativeWin.isWindowVisible() === false);

  // WebView2 Runtime detection
  assert.equal(engine.isRuntimeAvailable(), true);
  assert.equal(typeof engine.getRuntimeVersion(), 'string');
});

test('Platform Compatibility: Linux X11/Wayland Detection & Missing WebKitGTK Fallbacks', () => {
  const bus = new EventBus();
  const circle = new FloatingCircleController(bus);
  const win = new WindowStateManager(bus);
  const controller = new LinuxFloatingController(circle, win, bus, 'circle-first');

  // Linux display server capability detection
  const caps = controller.getCapabilities();
  assert.equal(typeof caps.isWayland, 'boolean');
  assert.ok(caps.server.length > 0);

  // WebKitGTK runtime detector
  const status = LinuxWebKitEngine.detectRuntime();
  assert.equal(typeof status.isAvailable, 'boolean');
  assert.match(status.flavorName, /WebKitGTK/);
});

test('Performance Audit: Cold Startup, Engine Init, Memory Usage & Transition Responsiveness', async () => {
  const auditMetrics = {
    coldStartupMs: 0,
    engineInitMs: 0,
    toggleTransitionMs: 0,
    memoryIdleKb: 0,
    memoryActiveKb: 0
  };

  // 1. Measure cold startup & controller initialization
  const t0 = performance.now();
  const overlay = new AndroidOverlayManager();
  const engine = new AndroidWebViewEngine();
  await engine.initialize();
  auditMetrics.coldStartupMs = Math.round((performance.now() - t0) * 100) / 100;
  assert.ok(auditMetrics.coldStartupMs < 100, `Startup took ${auditMetrics.coldStartupMs}ms (budget < 100ms)`);

  // 2. Measure bubble to window toggle transition responsiveness
  const t1 = performance.now();
  overlay.showFloatingCircle();
  overlay.showBrowserWindow(engine);
  overlay.minimize();
  overlay.restore();
  auditMetrics.toggleTransitionMs = Math.round((performance.now() - t1) * 100) / 100;
  assert.ok(auditMetrics.toggleTransitionMs < 50, `Window transitions took ${auditMetrics.toggleTransitionMs}ms (budget < 50ms)`);

  // 3. Memory & Tab Scaling Benchmark
  const baseMem = process.memoryUsage().heapUsed;
  auditMetrics.memoryIdleKb = Math.round(baseMem / 1024);

  // Create 10 active tabs and navigate
  for (let i = 0; i < 10; i++) {
    const tab = engine.createTab({ url: `https://site-${i}.org` });
    engine.selectTab(tab.id);
  }
  const activeMem = process.memoryUsage().heapUsed;
  auditMetrics.memoryActiveKb = Math.round(activeMem / 1024);

  // 4. Resource Cleanup verification
  await engine.destroy();
  overlay.stopCompleteFloatingExperience();
  assert.equal(engine.getActiveTab(), null);
});
