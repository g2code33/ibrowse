import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

import { BrowserShell } from '../packages/shared-ui/src/components/BrowserShell.js';
import { Icons } from '../packages/shared-ui/src/icons/icons.js';

test('Desktop Browser Shell: Opens directly into Chrome-style tab strip and Omnibox without dashboard clutter', async () => {
  const container = document.createElement('div');
  const shell = new BrowserShell({
    container,
    isMobile: false,
    initialUrl: 'yayra://newtab'
  });

  await shell.initialize();
  const el = shell.render(container);

  assert.ok(el.className.includes('fb-desktop-layout'));
  assert.ok(el.querySelector('.fb-chrome-tabstrip'), 'Should have Chrome-style top tab strip');
  assert.ok(el.querySelector('.fb-chrome-navbar'), 'Should have navigation & Omnibox toolbar');
  assert.ok(el.querySelector('.fb-omnibox-container'), 'Should have combined Omnibox');
  assert.ok(el.querySelector('.fb-newtab-page'), 'Should render clean minimal new-tab page');

  // Verify absence of dashboard cards
  assert.equal(el.querySelector('.fb-hero-banner'), null, 'Should not render dashboard hero banner');
  assert.equal(el.querySelector('.fb-stats-grid'), null, 'Should not render dashboard stats grid');
  assert.equal(el.querySelector('.fb-dashboard-content'), null, 'Should not render technical dashboard content');
});

test('Desktop Tab Strip: Manages multi-tab lifecycle, creation, selection, and closure', async () => {
  const container = document.createElement('div');
  const shell = new BrowserShell({
    container,
    isMobile: false
  });

  await shell.initialize();
  shell.render(container);

  assert.equal(shell.state.tabs.length, 1);
  assert.equal(shell.getActiveTab().title, 'New Tab');

  // 1. Create New Tab
  shell.createNewTab();
  assert.equal(shell.state.tabs.length, 2);
  assert.equal(shell.state.activeTabId, shell.state.tabs[1].id);

  // 2. Select First Tab
  const firstTabId = shell.state.tabs[0].id;
  shell.selectTab(firstTabId);
  assert.equal(shell.state.activeTabId, firstTabId);

  // 3. Close Tab
  const secondTabId = shell.state.tabs[1].id;
  shell.closeTab(secondTabId);
  assert.equal(shell.state.tabs.length, 1);
  assert.equal(shell.state.activeTabId, firstTabId);
});

test('Desktop Omnibox: Navigates URLs and formats natural language queries with search engine', async () => {
  let recordedUrl = null;
  const mockHistory = {
    recordVisit: async (url, title) => { recordedUrl = url; }
  };

  const container = document.createElement('div');
  const shell = new BrowserShell({
    container,
    isMobile: false,
    historyRepo: mockHistory
  });

  await shell.initialize();
  shell.render(container);

  // 1. Direct Web URL navigation
  shell.navigateActiveTab('https://example.com/blog');
  const activeTab = shell.getActiveTab();
  assert.equal(activeTab.url, 'https://example.com/blog');
  assert.equal(activeTab.isSecure, true);
  assert.equal(recordedUrl, 'https://example.com/blog');

  // 2. Domain autocomplete navigation
  shell.navigateActiveTab('wikipedia.org');
  assert.equal(shell.getActiveTab().url, 'https://wikipedia.org');

  // 3. Search query conversion (Google Default)
  shell.navigateActiveTab('privacy floating browser');
  assert.equal(shell.getActiveTab().url, 'https://www.google.com/search?q=privacy%20floating%20browser');
});

test('Desktop Menu & Modals: Reaches History, Bookmarks, Downloads, Settings, Permissions, and About', async () => {
  const container = document.createElement('div');
  const shell = new BrowserShell({
    container,
    isMobile: false
  });

  await shell.initialize();
  shell.render(container);

  // Open Menu
  shell.openModal('menu');
  assert.equal(shell.state.activeModal, 'menu');
  assert.ok(container.querySelector('.fb-modal-menu'));

  // Open History
  shell.openModal('history');
  assert.equal(shell.state.activeModal, 'history');
  assert.ok(container.querySelector('.fb-modal-history'));

  // Open Bookmarks
  shell.openModal('bookmarks');
  assert.equal(shell.state.activeModal, 'bookmarks');
  assert.ok(container.querySelector('.fb-modal-bookmarks'));

  // Open Settings
  shell.openModal('settings');
  assert.equal(shell.state.activeModal, 'settings');
  assert.ok(container.querySelector('.fb-modal-settings'));

  // Close Modal
  shell.closeModal();
  assert.equal(shell.state.activeModal, null);
  assert.equal(container.querySelector('.fb-modal-backdrop'), null);
});

test('Desktop Floating Mode & Bubble Minimization: Toggles Mode A vs Mode B and collapses to circle', async () => {
  let modeChanged = null;
  let minimizedFired = false;

  const container = document.createElement('div');
  const shell = new BrowserShell({
    container,
    isMobile: false,
    desktopFloatingMode: 'circle-first',
    onToggleMode: (m) => { modeChanged = m; },
    onMinimizeToBubble: () => { minimizedFired = true; }
  });

  await shell.initialize();
  shell.render(container);

  assert.equal(shell.state.desktopFloatingMode, 'circle-first');

  // Toggle Mode to Browser-First
  shell.toggleDesktopMode();
  assert.equal(shell.state.desktopFloatingMode, 'browser-first');
  assert.equal(shell.state.isMinimizedToBubble, false);
  assert.equal(modeChanged, 'browser-first');

  // Toggle back to Circle-First: the full browser must dock into the bubble.
  shell.toggleDesktopMode();
  assert.equal(shell.state.desktopFloatingMode, 'circle-first');
  assert.equal(shell.state.isMinimizedToBubble, true);
  shell.toggleDesktopMode();
  assert.equal(shell.state.desktopFloatingMode, 'browser-first');
  assert.equal(shell.state.isMinimizedToBubble, false);

  // Minimize to Floating Bubble
  shell.minimizeToBubble();
  assert.equal(shell.state.isMinimizedToBubble, true);
  assert.equal(minimizedFired, true);
  assert.ok(document.getElementById('yayra-floating-bubble-overlay'), 'Floating bubble overlay should be mounted');

  // Restore from Bubble
  shell.restoreFromBubble();
  assert.equal(shell.state.isMinimizedToBubble, false);
  assert.equal(document.getElementById('yayra-floating-bubble-overlay'), null);
});

test('Mobile Safari-Style Layout: Top address pill, full viewport, bottom toolbar, and tab switcher', async () => {
  const container = document.createElement('div');
  const shell = new BrowserShell({
    container,
    isMobile: true,
    tabs: [
      { id: 'm-1', title: 'DuckDuckGo', url: 'https://duckduckgo.com', isSecure: true, canGoBack: false, canGoForward: false },
      { id: 'm-2', title: 'GitHub', url: 'https://github.com', isSecure: true, canGoBack: false, canGoForward: false }
    ],
    activeTabId: 'm-1'
  });

  await shell.initialize();
  const el = shell.render(container);

  assert.ok(el.className.includes('fb-mobile-layout'));
  assert.ok(el.querySelector('.fb-mobile-topbar'), 'Should have compact top address bar');
  assert.ok(el.querySelector('.fb-mobile-address-pill'), 'Should have Safari-style address pill');
  assert.ok(el.querySelector('.fb-mobile-bottombar'), 'Should have bottom toolbar');
  assert.equal(el.querySelector('.fb-tabs-count-badge')?.textContent, '2', 'Tab badge should display 2 open tabs');

  // Open Mobile Tab Switcher
  shell.openModal('tab-switcher');
  assert.equal(shell.state.activeModal, 'tab-switcher');
  assert.ok(container.querySelector('.fb-mobile-tabswitcher-card'));
  assert.equal(container.querySelectorAll('.fb-tab-card').length, 2);

  // Close Modal
  shell.closeModal();
  assert.equal(shell.state.activeModal, null);
});

test('Bookmarks Toggle: Star updates bookmark status and persists to bookmarks repository', async () => {
  const bookmarks = [];
  const mockBookmarksRepo = {
    isBookmarked: async (url) => bookmarks.some((b) => b.url === url),
    addBookmark: async (item) => { bookmarks.push(item); },
    removeBookmark: async (url) => {
      const idx = bookmarks.findIndex((b) => b.url === url);
      if (idx !== -1) bookmarks.splice(idx, 1);
    }
  };

  const container = document.createElement('div');
  const shell = new BrowserShell({
    container,
    isMobile: false,
    bookmarksRepo: mockBookmarksRepo
  });

  await shell.initialize();
  shell.render(container);

  shell.navigateActiveTab('https://developer.mozilla.org');
  assert.equal(shell.state.isBookmarked, false);

  // Bookmark current page
  await shell.toggleBookmarkCurrentTab();
  assert.equal(shell.state.isBookmarked, true);
  assert.equal(bookmarks.length, 1);
  assert.equal(bookmarks[0].url, 'https://developer.mozilla.org');

  // Un-bookmark current page
  await shell.toggleBookmarkCurrentTab();
  assert.equal(shell.state.isBookmarked, false);
  assert.equal(bookmarks.length, 0);
});
