import test from 'node:test';
import assert from 'node:assert/strict';

import { WindowsWebView2Engine } from '../packages/browser-windows/src/index.js';

test('Windows WebView2: detects Evergreen runtime availability and recovery guidance', () => {
  const engine = new WindowsWebView2Engine();

  assert.equal(engine.isRuntimeAvailable(), true);
  assert.equal(typeof engine.getRuntimeVersion(), 'string');
  assert.ok(engine.getInstallationGuidance().includes('go.microsoft.com'));

  // Test missing runtime guidance
  const missingEngine = new WindowsWebView2Engine({ runtimeAvailable: false });
  assert.equal(missingEngine.isRuntimeAvailable(), false);
  assert.ok(missingEngine.getInstallationGuidance().length > 10);
});

test('Windows WebView2: loads URLs and converts search queries', async () => {
  const sentCommands = [];
  const engine = new WindowsWebView2Engine({
    nativeBridge: {
      postMessage: (msg) => { sentCommands.push(JSON.parse(msg)); }
    }
  });

  await engine.initialize();

  // Load HTTPS URL
  await engine.loadUrl('https://wikipedia.org');
  assert.equal(engine.getCurrentUrl(), 'https://wikipedia.org/');
  assert.equal(engine.getActiveTab()?.isSecure, true);

  const navCmd = sentCommands.find((c) => c.action === 'navigate' && c.payload.url === 'https://wikipedia.org/');
  assert.ok(navCmd);

  // Search Query
  await engine.search('windows edge webview2 direct composition', 'duckduckgo');
  assert.ok(engine.getCurrentUrl().includes('duckduckgo.com/?q=windows%20edge%20webview2%20direct%20composition'));
});

test('Windows WebView2: manages back, forward, and reload navigation commands', async () => {
  const engine = new WindowsWebView2Engine();

  await engine.loadUrl('https://duckduckgo.com');
  await engine.loadUrl('https://github.com');
  await engine.loadUrl('https://news.ycombinator.com');

  assert.equal(engine.getCurrentUrl(), 'https://news.ycombinator.com/');
  assert.equal(engine.canGoBack(), true);
  assert.equal(engine.canGoForward(), false);

  // Go back to GitHub
  await engine.goBack();
  assert.equal(engine.getCurrentUrl(), 'https://github.com/');
  assert.equal(engine.canGoBack(), true);
  assert.equal(engine.canGoForward(), true);

  // Go back to DuckDuckGo
  await engine.goBack();
  assert.equal(engine.getCurrentUrl(), 'https://duckduckgo.com/');
  assert.equal(engine.canGoBack(), false);

  // Go forward to GitHub
  await engine.goForward();
  assert.equal(engine.getCurrentUrl(), 'https://github.com/');

  // Reload
  await engine.reload(false);
  assert.equal(engine.getLoadingState().status, 'loading');
});

test('Windows WebView2: supports window resizing and bounds updates', async () => {
  const sentCommands = [];
  const engine = new WindowsWebView2Engine({
    nativeBridge: {
      postMessage: (msg) => { sentCommands.push(JSON.parse(msg)); }
    }
  });

  await engine.setBounds({ x: 50, y: 50, width: 1024, height: 768 });
  const bounds = engine.getBounds();
  assert.equal(bounds.width, 1024);
  assert.equal(bounds.height, 768);

  const resizeCmd = sentCommands.find((c) => c.action === 'setBounds');
  assert.ok(resizeCmd);
  assert.equal(resizeCmd.payload.bounds.width, 1024);
});

test('Windows WebView2: manages multiple independent tabs and isolation', () => {
  const engine = new WindowsWebView2Engine();

  const tab1 = engine.getActiveTab();
  const tab2 = engine.createTab({ url: 'https://github.com' });
  const tab3 = engine.createTab({ url: 'https://duckduckgo.com', isIncognito: true });

  assert.equal(engine.getTabs().length, 3);
  assert.equal(engine.getActiveTab()?.id, tab3.id);
  assert.equal(tab3.isIncognito, true);

  // Select tab 2
  engine.selectTab(tab2.id);
  assert.equal(engine.getActiveTab()?.id, tab2.id);

  // Close tab 2
  engine.closeTab(tab2.id);
  assert.equal(engine.getTabs().length, 2);
});

test('Windows WebView2: strictly rejects TLS certificate errors without bypassing', () => {
  const sentCommands = [];
  const engine = new WindowsWebView2Engine({
    nativeBridge: {
      postMessage: (msg) => { sentCommands.push(JSON.parse(msg)); }
    }
  });

  const tab = engine.getActiveTab();
  let loadErrorFired = false;
  engine.on('load:error', () => { loadErrorFired = true; });

  engine.handleServerCertificateError(tab.id, 'https://expired.badssl.com', -1201, 'Expired SSL Certificate');

  assert.equal(loadErrorFired, true);
  assert.equal(engine.getLoadingState().status, 'failed');
  assert.equal(tab.error?.isCertError, true);
  assert.ok(tab.error?.description.includes('Expired SSL Certificate'));

  const cancelCmd = sentCommands.find((c) => c.action === 'cancelCertificateError');
  assert.ok(cancelCmd);
});

test('Windows WebView2: exports and restores complete session', () => {
  const engine1 = new WindowsWebView2Engine();
  const tabA = engine1.createTab({ url: 'https://duckduckgo.com' });
  const tabB = engine1.createTab({ url: 'https://github.com/microsoft' });

  engine1.selectTab(tabB.id);
  const session = engine1.saveSession();

  const engine2 = new WindowsWebView2Engine();
  engine2.restoreSession(session);

  assert.equal(engine2.getTabs().length, 3);
  assert.equal(engine2.getActiveTab()?.id, tabB.id);
  assert.equal(engine2.getCurrentUrl(), 'https://github.com/microsoft');
});

test('Windows WebView2: disposes COM references cleanly upon destruction and recreates surface', async () => {
  const sentCommands = [];
  const engine = new WindowsWebView2Engine({
    nativeBridge: {
      postMessage: (msg) => { sentCommands.push(JSON.parse(msg)); }
    }
  });

  await engine.destroy();
  const closeCmd = sentCommands.find((c) => c.action === 'closeWebView2');
  assert.ok(closeCmd);

  // Attempting to load on destroyed engine throws
  await assert.rejects(async () => {
    await engine.loadUrl('https://example.com');
  }, /destroyed/);

  // Re-creation works smoothly
  const recreatedEngine = new WindowsWebView2Engine();
  await recreatedEngine.loadUrl('https://example.com');
  assert.equal(recreatedEngine.getCurrentUrl(), 'https://example.com/');
});
