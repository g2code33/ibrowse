import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UrlInterpreter,
  defaultUrlInterpreter,
  BrowserNavigationManager,
  createBrowserTab,
  createBrowserSession,
  createDefaultBrowserSettings,
  createHistoryEntry,
  createBookmark,
  createDownloadRecord,
  createWebsitePermission,
  BaseDownloadManager,
  BasePermissionManager
} from '../packages/browser-contract/src/index.js';

test('URL Interpretation: handles valid HTTP and HTTPS URLs', () => {
  const interpreter = new UrlInterpreter();

  const httpsResult = interpreter.interpret('https://duckduckgo.com');
  assert.equal(httpsResult.isSearchQuery, false);
  assert.equal(httpsResult.isSecure, true);
  assert.equal(httpsResult.normalizedUrl, 'https://duckduckgo.com/');
  assert.equal(httpsResult.hostname, 'duckduckgo.com');

  const httpResult = interpreter.interpret('http://example.com/test?id=123');
  assert.equal(httpResult.isSearchQuery, false);
  assert.equal(httpResult.isSecure, false);
  assert.equal(httpResult.normalizedUrl, 'http://example.com/test?id=123');
  assert.equal(httpResult.hostname, 'example.com');

  const localhostResult = interpreter.interpret('localhost:3000');
  assert.equal(localhostResult.isSearchQuery, false);
  assert.equal(localhostResult.normalizedUrl, 'http://localhost:3000/');
});

test('URL Interpretation: converts natural language queries to search engine URLs', () => {
  const interpreter = new UrlInterpreter({ defaultSearchEngine: 'duckduckgo' });

  const queryResult = interpreter.interpret('how to build a glassmorphism browser');
  assert.equal(queryResult.isSearchQuery, true);
  assert.equal(queryResult.isSecure, true);
  assert.ok(queryResult.normalizedUrl.includes('duckduckgo.com/?q=how%20to%20build%20a%20glassmorphism%20browser'));

  // SearXNG engine override
  const searxUrl = interpreter.buildSearchUrl('privacy search', 'searx');
  assert.equal(searxUrl, 'https://searx.be/search?q=privacy%20search');

  // Custom engine template
  const customInterpreter = new UrlInterpreter({
    defaultSearchEngine: 'custom',
    customSearchUrl: 'https://kagi.com/search?q={query}'
  });
  const customResult = customInterpreter.interpret('autonomous agent');
  assert.equal(customResult.normalizedUrl, 'https://kagi.com/search?q=autonomous%20agent');
});

test('URL Interpretation: sanitizes malformed URLs and blocks dangerous schemes', () => {
  const interpreter = new UrlInterpreter();

  // JavaScript execution in URL bar is blocked and treated as safe search query
  const jsResult = interpreter.interpret('javascript:alert(document.cookie)');
  assert.equal(jsResult.isBlockedScheme, true);
  assert.equal(jsResult.isSearchQuery, true);
  assert.ok(jsResult.normalizedUrl.includes('google.com/search?q=javascript%3Aalert(document.cookie)'));

  // Data URLs blocked for top-level navigation
  const dataResult = interpreter.interpret('data:text/html,<h1>Hacked</h1>');
  assert.equal(dataResult.isBlockedScheme, true);
  assert.equal(dataResult.isSearchQuery, true);

  // File protocol blocked
  const fileResult = interpreter.interpret('file:///etc/passwd');
  assert.equal(fileResult.isBlockedScheme, true);

  // Trailing whitespace and dots stripped
  const domainWithDots = interpreter.interpret('   github.com...   ');
  assert.equal(domainWithDots.isSearchQuery, false);
  assert.equal(domainWithDots.normalizedUrl, 'https://github.com/');
});

test('URL Interpretation: preserves internal special schemes and supports IDN Unicode domains', () => {
  const interpreter = new UrlInterpreter();

  // Special schemes
  const blankResult = interpreter.interpret('about:blank');
  assert.equal(blankResult.isSpecialScheme, true);
  assert.equal(blankResult.normalizedUrl, 'about:blank');

  const settingsResult = interpreter.interpret('yayra://settings');
  assert.equal(settingsResult.isSpecialScheme, true);
  assert.equal(settingsResult.normalizedUrl, 'yayra://settings');

  // Internationalized Domain Names (IDN)
  const idnResult = interpreter.interpret('https://münchen.de/kultur');
  assert.equal(idnResult.isSearchQuery, false);
  assert.ok(idnResult.normalizedUrl.includes('münchen.de') || idnResult.normalizedUrl.includes('xn--mnchen-3ya'));
});

test('Browser State Transitions: tracks loading lifecycles, progress, and errors', () => {
  const navManager = new BrowserNavigationManager();
  const tab = navManager.getActiveTab();
  assert.ok(tab);

  // Initial state
  assert.equal(navManager.getLoadingState().status, 'idle');
  assert.equal(navManager.getLoadingProgress(), 0);

  // Navigate started
  navManager.loadUrl('https://news.ycombinator.com');
  assert.equal(navManager.getLoadingState().status, 'loading');
  assert.ok(navManager.getLoadingProgress() > 0);

  // Committed
  navManager.reportNavigationCommitted(tab.id, 'https://news.ycombinator.com');
  assert.equal(navManager.getLoadingState().status, 'committed');

  // Completed
  navManager.reportNavigationCompleted(tab.id, 'https://news.ycombinator.com', 200);
  assert.equal(navManager.getLoadingState().status, 'loaded');
  assert.equal(navManager.getLoadingProgress(), 100);

  // Error transition
  navManager.reportNavigationError(tab.id, 'https://news.ycombinator.com', -105, 'NAME_NOT_RESOLVED');
  assert.equal(navManager.getLoadingState().status, 'failed');
  assert.equal(tab.error?.code, -105);
  assert.equal(tab.error?.description, 'NAME_NOT_RESOLVED');
});

test('Tab Management: creates, selects, closes, and restores tabs with focus tracking', () => {
  const navManager = new BrowserNavigationManager();

  // Create tabs
  const tab1 = navManager.getActiveTab();
  const tab2 = navManager.createTab({ url: 'https://github.com', title: 'GitHub' });
  const tab3 = navManager.createTab({ url: 'https://wikipedia.org', title: 'Wikipedia', select: false });

  assert.equal(navManager.getTabs().length, 3);
  assert.equal(navManager.getActiveTab()?.id, tab2.id);

  // Select tab
  navManager.selectTab(tab3.id);
  assert.equal(navManager.getActiveTab()?.id, tab3.id);

  // Close tab with adjacent selection
  navManager.closeTab(tab3.id);
  assert.equal(navManager.getTabs().length, 2);
  assert.equal(navManager.getActiveTab()?.id, tab2.id);

  // Undo close tab
  const restored = navManager.undoCloseTab();
  assert.ok(restored);
  assert.equal(restored.url, 'https://wikipedia.org');
  assert.equal(navManager.getActiveTab()?.id, restored.id);

  // Closing all tabs auto-generates a fallback new tab
  navManager.closeTab(tab1.id);
  navManager.closeTab(tab2.id);
  navManager.closeTab(restored.id);
  assert.equal(navManager.getTabs().length, 1);
  assert.ok(navManager.getActiveTab());
});

test('Navigation Commands: manages history traversal, reload, and inspection', async () => {
  const navManager = new BrowserNavigationManager();
  const tab = navManager.getActiveTab();

  // Step 1: initial page
  navManager.reportNavigationCommitted(tab.id, 'https://duckduckgo.com');
  navManager.reportNavigationCompleted(tab.id, 'https://duckduckgo.com');

  // Step 2: second page
  navManager.reportNavigationCommitted(tab.id, 'https://github.com');
  navManager.reportNavigationCompleted(tab.id, 'https://github.com');

  // Step 3: third page
  navManager.reportNavigationCommitted(tab.id, 'https://eff.org');
  navManager.reportNavigationCompleted(tab.id, 'https://eff.org');

  assert.equal(navManager.getCurrentUrl(), 'https://eff.org');
  assert.equal(tab.canGoBack, true);
  assert.equal(tab.canGoForward, false);

  // Go Back to GitHub
  await navManager.goBack();
  assert.equal(navManager.getCurrentUrl(), 'https://github.com');
  assert.equal(tab.canGoBack, true);
  assert.equal(tab.canGoForward, true);

  // Go Back to DuckDuckGo
  await navManager.goBack();
  assert.equal(navManager.getCurrentUrl(), 'https://duckduckgo.com');
  assert.equal(tab.canGoBack, false);
  assert.equal(tab.canGoForward, true);

  // Go Forward to GitHub
  await navManager.goForward();
  assert.equal(navManager.getCurrentUrl(), 'https://github.com');

  // Navigate Home
  await navManager.navigateHome();
  assert.ok(navManager.getCurrentUrl().startsWith('https://duckduckgo.com'));
});

test('Session Restoration: exports and restores complete browser session state', () => {
  const navManager = new BrowserNavigationManager();
  navManager.createTab({ url: 'https://duckduckgo.com', title: 'Search' });
  const tab2 = navManager.createTab({ url: 'https://github.com', title: 'GitHub' });
  navManager.reportNavigationCommitted(tab2.id, 'https://github.com');
  navManager.reportNavigationCommitted(tab2.id, 'https://github.com/trending');

  const snapshot = navManager.exportSession();
  assert.equal(snapshot.tabs.length, 3);
  assert.equal(snapshot.activeTabId, tab2.id);

  // Restore into a fresh manager
  const restoredManager = new BrowserNavigationManager();
  restoredManager.restoreSession(snapshot);

  assert.equal(restoredManager.getTabs().length, 3);
  assert.equal(restoredManager.getActiveTab()?.id, tab2.id);
  assert.equal(restoredManager.getCurrentUrl(), 'https://github.com/trending');
  assert.equal(restoredManager.getActiveTab()?.canGoBack, true);
});

test('Download & Website Permission Managers: fulfill contract interfaces', async () => {
  // Download Manager
  const dlManager = new BaseDownloadManager();
  let dlStarted = false;
  let dlCompleted = false;

  dlManager.on('download:started', () => { dlStarted = true; });
  dlManager.on('download:completed', () => { dlCompleted = true; });

  const record = await dlManager.startDownload('https://example.com/file.zip', 'file.zip');
  assert.ok(record.id);
  assert.equal(record.state, 'in-progress');
  assert.equal(dlStarted, true);

  await dlManager.pauseDownload(record.id);
  assert.equal(record.state, 'paused');

  await dlManager.resumeDownload(record.id);
  assert.equal(record.state, 'in-progress');

  await dlManager.cancelDownload(record.id);
  assert.equal(record.state, 'cancelled');

  // Permission Manager
  const permManager = new BasePermissionManager();
  await permManager.setPermission('https://example.com', 'geolocation', 'granted');
  const permState = await permManager.getPermission('https://example.com', 'geolocation');
  assert.equal(permState, 'granted');

  const unsetPerm = await permManager.getPermission('https://untrusted.com', 'camera');
  assert.equal(unsetPerm, 'prompt');
});
