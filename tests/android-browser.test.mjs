import test from 'node:test';
import assert from 'node:assert/strict';

import { AndroidWebViewEngine } from '../packages/browser-android/src/index.js';

test('Android Browser: navigates to HTTPS and HTTP websites', async () => {
  const sentCommands = [];
  const engine = new AndroidWebViewEngine({
    nativeBridge: {
      postMessage: (msg) => { sentCommands.push(JSON.parse(msg)); }
    }
  });

  await engine.initialize();

  // Test HTTPS Navigation
  await engine.loadUrl('https://eff.org');
  assert.equal(engine.getCurrentUrl(), 'https://eff.org/');
  assert.equal(engine.getActiveTab()?.isSecure, true);
  assert.equal(engine.getLoadingState().status, 'loading');

  // Verify command dispatch to native Android bridge
  const loadCmd = sentCommands.find((c) => c.action === 'loadUrl' && c.payload.url === 'https://eff.org/');
  assert.ok(loadCmd);

  // Test HTTP Navigation
  await engine.loadUrl('http://example.com');
  assert.equal(engine.getCurrentUrl(), 'http://example.com/');
  assert.equal(engine.getActiveTab()?.isSecure, false);
});

test('Android Browser: executes search queries via configured search engines', async () => {
  const sentCommands = [];
  const engine = new AndroidWebViewEngine({
    nativeBridge: {
      postMessage: (msg) => { sentCommands.push(JSON.parse(msg)); }
    }
  });

  // Google Search query
  await engine.search('android native webview glassmorphism', 'google');
  assert.ok(engine.getCurrentUrl().includes('google.com/search?q=android%20native%20webview%20glassmorphism'));

  // DuckDuckGo Search query
  await engine.search('privacy browser local first', 'duckduckgo');
  assert.ok(engine.getCurrentUrl().includes('duckduckgo.com/?q=privacy%20browser%20local%20first'));
});

test('Android Browser: coordinates back, forward, and reload navigation commands', async () => {
  const engine = new AndroidWebViewEngine();

  // Navigate through 3 pages
  await engine.loadUrl('https://duckduckgo.com');
  await engine.loadUrl('https://wikipedia.org');
  await engine.loadUrl('https://github.com');

  assert.equal(engine.getCurrentUrl(), 'https://github.com/');
  assert.equal(engine.canGoBack(), true);
  assert.equal(engine.canGoForward(), false);

  // Go back to Wikipedia
  const backed1 = await engine.goBack();
  assert.equal(backed1, true);
  assert.equal(engine.getCurrentUrl(), 'https://wikipedia.org/');
  assert.equal(engine.canGoBack(), true);
  assert.equal(engine.canGoForward(), true);

  // Go back to DuckDuckGo
  const backed2 = await engine.goBack();
  assert.equal(backed2, true);
  assert.equal(engine.getCurrentUrl(), 'https://duckduckgo.com/');
  assert.equal(engine.canGoBack(), false);

  // Forward to Wikipedia
  const fwd1 = await engine.goForward();
  assert.equal(fwd1, true);
  assert.equal(engine.getCurrentUrl(), 'https://wikipedia.org/');

  // Reload
  await engine.reload(true);
  assert.equal(engine.getLoadingState().status, 'loading');
});

test('Android Browser: manages multiple independent tabs with view isolation', () => {
  const engine = new AndroidWebViewEngine();

  // Initial tab
  const tab1 = engine.getActiveTab();
  assert.ok(tab1);

  // Create tab 2 and tab 3
  const tab2 = engine.createTab({ url: 'https://news.ycombinator.com' });
  const tab3 = engine.createTab({ url: 'https://archive.org', isIncognito: true });

  assert.equal(engine.getTabs().length, 3);
  assert.equal(engine.getActiveTab()?.id, tab3.id);
  assert.equal(tab3.isIncognito, true);

  // Switch to Tab 2
  engine.selectTab(tab2.id);
  assert.equal(engine.getActiveTab()?.id, tab2.id);
  assert.equal(engine.getCurrentUrl(), 'https://news.ycombinator.com');

  // Close Tab 2
  engine.closeTab(tab2.id);
  assert.equal(engine.getTabs().length, 2);
  assert.ok(engine.getActiveTab());
});

test('Android Browser: switches Desktop and Mobile website User-Agent modes', () => {
  const sentCommands = [];
  const engine = new AndroidWebViewEngine({
    nativeBridge: {
      postMessage: (msg) => { sentCommands.push(JSON.parse(msg)); }
    }
  });

  assert.equal(engine.isDesktopMode(), false);

  // Enable Desktop mode
  engine.setDesktopMode(true);
  assert.equal(engine.isDesktopMode(), true);

  const desktopCmd = sentCommands.find((c) => c.action === 'setUserAgent' && c.payload.isDesktop === true);
  assert.ok(desktopCmd);
  assert.ok(desktopCmd.payload.userAgent.includes('X11; Linux x86_64'));

  // Switch back to Mobile mode
  engine.setDesktopMode(false);
  assert.equal(engine.isDesktopMode(), false);
  const mobileCmd = sentCommands.find((c) => c.action === 'setUserAgent' && c.payload.isDesktop === false);
  assert.ok(mobileCmd.payload.userAgent.includes('Android'));
});

test('Android Browser: strictly cancels SSL errors and renders security warning', () => {
  const sentCommands = [];
  const engine = new AndroidWebViewEngine({
    nativeBridge: {
      postMessage: (msg) => { sentCommands.push(JSON.parse(msg)); }
    }
  });

  const activeTab = engine.getActiveTab();
  let errorEmitted = false;
  engine.on('load:error', () => { errorEmitted = true; });

  // Simulate SSL certificate authority failure from native WebViewClient
  engine.handleSslError(activeTab.id, 'https://self-signed.badssl.com', -1200, 'Untrusted Root CA');

  assert.equal(errorEmitted, true);
  assert.equal(engine.getLoadingState().status, 'failed');
  assert.equal(activeTab.error?.isCertError, true);
  assert.ok(activeTab.error?.description.includes('Untrusted Root CA'));

  // Verify safe local error HTML was loaded without bypassing
  const loadDataCmd = sentCommands.find((c) => c.action === 'loadData');
  assert.ok(loadDataCmd);
  assert.ok(loadDataCmd.payload.data.includes('Security Warning: Untrusted Certificate'));
});

test('Android Browser: preserves and restores complete multi-tab browsing session', () => {
  const engine1 = new AndroidWebViewEngine();
  const tabA = engine1.createTab({ url: 'https://duckduckgo.com' });
  const tabB = engine1.createTab({ url: 'https://github.com/topics' });

  engine1.selectTab(tabB.id);
  const savedSession = engine1.saveSession();

  assert.equal(savedSession.tabs.length, 3);
  assert.equal(savedSession.activeTabId, tabB.id);

  // Restore in fresh engine
  const engine2 = new AndroidWebViewEngine();
  engine2.restoreSession(savedSession);

  assert.equal(engine2.getTabs().length, 3);
  assert.equal(engine2.getActiveTab()?.id, tabB.id);
  assert.equal(engine2.getCurrentUrl(), 'https://github.com/topics');
});

test('Android Browser: recovers gracefully from renderer process termination', () => {
  const sentCommands = [];
  const engine = new AndroidWebViewEngine({
    nativeBridge: {
      postMessage: (msg) => { sentCommands.push(JSON.parse(msg)); }
    }
  });

  const tab = engine.getActiveTab();
  engine.handleRendererCrashed(tab.id, true);

  assert.equal(engine.getLoadingState().status, 'failed');
  assert.ok(tab.error?.description.includes('Renderer process terminated'));

  const recreateCmd = sentCommands.find((c) => c.action === 'recreateWebView' && c.payload.tabId === tab.id);
  assert.ok(recreateCmd);
});
