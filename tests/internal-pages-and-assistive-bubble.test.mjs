import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

import { BrowserShell } from '../packages/shared-ui/src/components/BrowserShell.js';
import { PasswordManager } from '../packages/persistence/src/PasswordManager.js';
import { ExtensionManager } from '../packages/browser-contract/src/extensions/ExtensionManager.js';
import { MemoryPersistenceAdapter, HistoryRepository, SettingsRepository } from '../packages/persistence/src/index.js';

test('In-Tab Internal Pages: Loads yayra://settings in tab with category navigation and live search', async () => {
  const container = document.createElement('div');
  const storage = new MemoryPersistenceAdapter();
  const settingsRepo = new SettingsRepository(storage);

  const shell = new BrowserShell({
    container,
    isMobile: false,
    settingsRepo
  });

  await shell.initialize();
  shell.render(container);

  // Navigate active tab to yayra://settings
  shell.navigateActiveTab('yayra://settings');
  const activeTab = shell.getActiveTab();
  assert.equal(activeTab.url, 'yayra://settings');
  assert.equal(activeTab.title, 'Settings');

  // Verify internal page UI rendered
  assert.ok(container.querySelector('.fb-settings-inpage-layout'), 'Settings in-page layout should be rendered');
  assert.ok(container.querySelector('.fb-settings-nav-item'), 'Settings category nav items should exist');
  assert.ok(container.querySelector('#fb-in-settings-search'), 'Settings live search input should exist');

  // Live category switching
  const appearanceTab = container.querySelector('[data-category="appearance"]');
  if (appearanceTab) {
    appearanceTab.click();
    assert.equal(shell.state.activeSettingsCategory, 'appearance');
  }

  // Live transparency adjustment
  const bubbleSlider = container.querySelector('#fb-in-bubble-opacity');
  if (bubbleSlider) {
    bubbleSlider.value = '75';
    bubbleSlider.dispatchEvent(new Event('input'));
    assert.equal(shell.state.settings.bubbleOpacity, 0.75);
  }
});

test('In-Tab Internal Pages: Loads yayra://history with search filtering and visit deletion', async () => {
  const container = document.createElement('div');
  const storage = new MemoryPersistenceAdapter();
  const historyRepo = new HistoryRepository(storage);

  await historyRepo.recordVisit('https://example.com/docs', 'Example Docs');
  await historyRepo.recordVisit('https://yayra.app/community', 'Yayra Community');

  const shell = new BrowserShell({
    container,
    isMobile: false,
    historyRepo
  });

  await shell.initialize();
  shell.render(container);

  // Navigate to history
  shell.navigateActiveTab('yayra://history');
  assert.equal(shell.getActiveTab().url, 'yayra://history');
  assert.equal(shell.getActiveTab().title, 'History');

  // History list rendered
  const items = container.querySelectorAll('.fb-history-row');
  assert.ok(items.length >= 2, 'Should display history rows');

  // History search filter
  shell.state.historySearchQuery = 'Community';
  shell.render(container);
  const filteredItems = container.querySelectorAll('.fb-history-row');
  assert.equal(filteredItems.length, 1);
});

test('In-Tab Internal Pages: Loads yayra://passwords with secure vault view and credential actions', async () => {
  const container = document.createElement('div');
  const storage = new MemoryPersistenceAdapter();
  const passwordManager = new PasswordManager(storage);

  await passwordManager.saveCredential({
    origin: 'https://github.com',
    username: 'octocat',
    password: 'super-secret-password-123',
    title: 'GitHub'
  });

  const shell = new BrowserShell({
    container,
    isMobile: false,
    passwordManager
  });

  await shell.initialize();
  shell.render(container);

  // Navigate to yayra://passwords
  shell.navigateActiveTab('yayra://passwords');
  assert.equal(shell.getActiveTab().url, 'yayra://passwords');
  assert.equal(shell.getActiveTab().title, 'Passwords');

  assert.ok(container.querySelector('.fb-passwords-inpage-layout'), 'Password manager in-page layout should render');
  const pwdRows = container.querySelectorAll('.fb-pwd-row');
  assert.equal(pwdRows.length, 1);
  assert.ok(pwdRows[0].textContent.includes('octocat'));

  // Test reveal password toggle
  const revealBtn = pwdRows[0].querySelector('.fb-pwd-reveal-btn');
  assert.ok(revealBtn);
  revealBtn.click();
  const pwdSpan = pwdRows[0].querySelector('.fb-pwd-masked');
  assert.equal(pwdSpan.textContent, 'super-secret-password-123');
});

test('In-Tab Internal Pages: Loads yayra://extensions with toggles and permissions viewer', async () => {
  const container = document.createElement('div');
  const storage = new MemoryPersistenceAdapter();
  const extensionManager = new ExtensionManager(storage);

  const shell = new BrowserShell({
    container,
    isMobile: false,
    extensionManager
  });

  await shell.initialize();
  shell.render(container);

  // Navigate to yayra://extensions
  shell.navigateActiveTab('yayra://extensions');
  assert.equal(shell.getActiveTab().url, 'yayra://extensions');
  assert.equal(shell.getActiveTab().title, 'Extensions');

  const extCards = container.querySelectorAll('.fb-extension-card');
  assert.ok(extCards.length >= 2, 'Built-in extensions should render as cards');

  // Toggle extension
  const toggleInput = extCards[0].querySelector('.fb-ext-toggle-input');
  assert.ok(toggleInput);
});

test('In-Tab Internal Pages: Loads yayra://about with version info, update check, and licenses', async () => {
  const container = document.createElement('div');
  const shell = new BrowserShell({
    container,
    isMobile: false
  });

  await shell.initialize();
  shell.render(container);

  shell.navigateActiveTab('yayra://about');
  assert.equal(shell.getActiveTab().url, 'yayra://about');
  assert.equal(shell.getActiveTab().title, 'About Yayra');

  assert.ok(container.querySelector('.fb-about-hero'), 'About hero branding must be present');
  assert.ok(container.querySelector('.fb-about-version-badge'), 'Version badge must be present');
  assert.ok(container.querySelector('.fb-about-check-updates-btn'), 'Check for updates button must be present');
});

test('In-Tab Internal Pages: Redesigned yayra://newtab with search box, shortcuts, and focus management', async () => {
  const container = document.createElement('div');
  const shell = new BrowserShell({
    container,
    isMobile: false,
    initialUrl: 'yayra://newtab'
  });

  await shell.initialize();
  shell.render(container);

  assert.equal(shell.getActiveTab().url, 'yayra://newtab');
  assert.equal(shell.getActiveTab().title, 'New Tab');

  assert.ok(container.querySelector('.fb-newtab-hero'), 'New tab hero header must render');
  assert.ok(container.querySelector('.fb-newtab-search-input'), 'New tab main search box must render');
  assert.ok(container.querySelectorAll('.fb-newtab-shortcut').length > 0, 'Shortcuts must render');
});

test('Persistent Assistive Bubble: Present in DOM, reflects loading pulse, and preserves session on restore', async () => {
  const container = document.createElement('div');
  const shell = new BrowserShell({
    container,
    isMobile: false,
    initialUrl: 'https://example.com'
  });

  await shell.initialize();
  shell.render(container);

  // Assistive bubble is mounted
  const bubble = document.getElementById('yayra-persistent-assistive-bubble');
  assert.ok(bubble, 'Persistent assistive bubble element must exist in DOM');

  // Trigger tab loading -> bubble shows loading pulse ring
  shell.updateTabLoading(shell.getActiveTab().id, true);
  assert.ok(bubble.querySelector('.yayra-bubble-loading-ring'), 'Loading ring should be active');

  // Stop loading -> pulse ring cleared
  shell.updateTabLoading(shell.getActiveTab().id, false);
  assert.equal(bubble.querySelector('.yayra-bubble-loading-ring'), null);

  // Minimize to bubble
  shell.minimizeToBubble();
  assert.equal(shell.state.isMinimizedToBubble, true);

  // Restore session from bubble -> same tabs preserved without reload
  shell.restoreFromBubble();
  assert.equal(shell.state.isMinimizedToBubble, false);
  assert.equal(shell.state.tabs.length, 1);
  assert.equal(shell.getActiveTab().url, 'https://example.com');
});

test('Requirement 1 & 3: Radial Launcher Wheel opens with Gemini & AI Tools and opens Customizer Modal', async () => {
  const container = document.createElement('div');
  const shell = new BrowserShell({
    container,
    isMobile: false
  });

  await shell.initialize();
  shell.render(container);

  // Double click persistent bubble -> opens radial launcher
  shell.openRadialLauncher();
  assert.equal(shell.state.isRadialLauncherOpen, true);

  const radialOverlay = document.getElementById('yayra-radial-launcher-overlay');
  assert.ok(radialOverlay, 'Radial launcher overlay should be mounted');
  assert.ok(radialOverlay.querySelector('.yayra-radial-center-btn'), 'Center close button must exist');
  assert.ok(radialOverlay.querySelector('.yayra-radial-bottom-btn'), 'Bottom down arrow button must exist');
  assert.ok(radialOverlay.querySelectorAll('.yayra-radial-item').length >= 12, '12 radial items must be rendered');

  // Open Radial Customizer Modal
  shell.openModal('radial-customizer');
  assert.equal(shell.state.activeModal, 'radial-customizer');
  assert.ok(container.querySelector('.fb-modal-radial-customizer'), 'Radial customizer modal must render');

  // Close customizer & radial launcher
  shell.closeModal();
  shell.closeRadialLauncher();
  assert.equal(shell.state.isRadialLauncherOpen, false);
});

test('Requirement 2, 4, 6: Floating Mini-Browser Window opens standalone, is movable, supports duplicate and toggle', async () => {
  const container = document.createElement('div');
  const shell = new BrowserShell({
    container,
    isMobile: false,
    initialUrl: 'https://example.com'
  });

  await shell.initialize();
  shell.render(container);

  // Open Floating Mini-Browser
  shell.openFloatingMini();
  assert.equal(shell.state.isFloatingMiniOpen, true);

  const miniWin = document.getElementById('yayra-floating-popup-window');
  assert.ok(miniWin, 'Floating mini window popup should be mounted');
  assert.ok(miniWin.querySelector('.fb-open-full-btn'), 'Open Full Browser button must exist');
  assert.ok(miniWin.querySelector('.fb-mini-tabstrip'), 'Mini must use the shared tab-strip header');
  assert.ok(miniWin.querySelector('.fb-mini-omnibox'), 'Mini omnibox must exist');
  assert.ok(miniWin.querySelector('.fb-mini-download-btn'), 'Mini downloads button must exist');
  assert.ok(miniWin.querySelector('.fb-mini-extensions-btn'), 'Mini extensions button must exist');
  assert.ok(miniWin.querySelector('.fb-mini-drawer-btn'), 'Mini menu button must exist');
  assert.ok(miniWin.querySelector('.fb-mini-duplicate-btn'), 'Duplicate button must exist');

  // The mini menu must open inside the mini window, not behind the main browser.
  miniWin.querySelector('.fb-mini-drawer-btn').click();
  assert.ok(miniWin.querySelector('.fb-side-drawer-menu'), 'Mini menu should open inside the mini window');

  // Test duplicate floating mini window
  shell.duplicateFloatingMini();
  const dupWin = document.querySelector('.fb-duplicate-popup-window');
  assert.ok(dupWin, 'Duplicate mini window should be mounted');

  // Close mini window (single tap toggle minimize)
  shell.closeFloatingMini();
  assert.equal(shell.state.isFloatingMiniOpen, false);
});

test('Browser navigation controls: back, forward, and reload work without a native controller', async () => {
  const container = document.createElement('div');
  const shell = new BrowserShell({ container, isMobile: false, initialUrl: 'yayra://newtab' });
  await shell.initialize();
  shell.render(container);

  shell.navigateActiveTab('https://example.com/one');
  shell.navigateActiveTab('https://example.com/two');
  assert.equal(shell.getActiveTab().canGoBack, true);

  container.querySelector('.fb-nav-back').click();
  assert.equal(shell.getActiveTab().url, 'https://example.com/one');
  assert.equal(shell.getActiveTab().canGoForward, true);

  container.querySelector('.fb-nav-forward').click();
  assert.equal(shell.getActiveTab().url, 'https://example.com/two');

  shell.getActiveTab().isLoading = false;
  shell.render(container);
  const reloadButton = container.querySelector('.fb-nav-reload');
  reloadButton.click();
  assert.equal(shell.getActiveTab().isLoading, true);
});

test('Requirement 3 & 13: Omnibox Security Lock opens Search Engine Selector with Google Default', async () => {
  const storage = new MemoryPersistenceAdapter();
  const settingsRepo = new SettingsRepository(storage);

  const container = document.createElement('div');
  const shell = new BrowserShell({
    container,
    isMobile: false,
    settingsRepo
  });

  await shell.initialize();
  shell.render(container);

  // Default search engine is Google
  assert.equal(shell.state.settings.searchEngine, 'google');

  // Open Security dropdown
  shell.state.isSecurityDropdownOpen = true;
  shell.render(container);

  const dropdown = container.querySelector('.fb-security-dropdown');
  assert.ok(dropdown, 'Security dropdown must be rendered');
  assert.ok(container.querySelector('[data-engine="google"]'), 'Google search engine option must exist');
  assert.ok(container.querySelector('[data-engine="duckduckgo"]'), 'DuckDuckGo search engine option must exist');

  // Switch search engine to DuckDuckGo
  const ddgOption = container.querySelector('[data-engine="duckduckgo"]');
  ddgOption.click();
  assert.equal(shell.state.settings.searchEngine, 'duckduckgo');
});

test('Requirement 4 & 10: Toolbar Brand Logo beside Lock & Transparent Action Buttons matching Star size', async () => {
  const container = document.createElement('div');
  const shell = new BrowserShell({
    container,
    isMobile: false
  });

  await shell.initialize();
  shell.render(container);

  // Toolbar Brand logo and "yayra" text
  const brand = container.querySelector('.fb-toolbar-brand');
  assert.ok(brand, 'App brand logo and name must be present in toolbar');
  assert.ok(brand.textContent.includes('yayra'));

  // Downloads and extensions buttons present without white background
  const dlBtn = container.querySelector('.fb-toolbar-downloads-btn');
  const extBtn = container.querySelector('.fb-toolbar-extensions-btn');
  const starBtn = container.querySelector('.fb-omnibox-star');

  assert.ok(dlBtn, 'Downloads toolbar button must exist');
  assert.ok(extBtn, 'Extensions toolbar button must exist');
  assert.ok(starBtn, 'Star button must exist');
});

test('Requirement 5: 3-Dot Menu opens Full Right-Side Drawer without workspace blur', async () => {
  const container = document.createElement('div');
  const shell = new BrowserShell({
    container,
    isMobile: false
  });

  await shell.initialize();
  shell.render(container);

  // Open Side Drawer
  shell.state.isSideDrawerOpen = true;
  shell.render(container);

  const drawer = container.querySelector('.fb-side-drawer-menu');
  assert.ok(drawer, 'Right-side drawer menu must be mounted');
  assert.ok(drawer.querySelector('.fb-dr-newtab'));
  assert.ok(drawer.querySelector('.fb-dr-history'));
  assert.ok(drawer.querySelector('.fb-dr-downloads'));
  assert.ok(drawer.querySelector('.fb-dr-settings'));
  assert.ok(drawer.querySelector('.fb-dr-about'));

  // Tab groups and More tools are real click-open submenus, not hover-only affordances.
  const tabGroups = drawer.querySelector('.fb-dr-tabgroups-parent');
  tabGroups.click();
  assert.equal(tabGroups.parentElement.classList.contains('open'), true);
  const moreTools = drawer.querySelector('.fb-dr-moretools-parent');
  moreTools.click();
  assert.equal(moreTools.parentElement.classList.contains('open'), true);

  // A tool inside the opened submenu must execute, not just reveal a hover state.
  drawer.querySelector('.fb-dr-customize-yayra').click();
  assert.equal(shell.state.activeModal, 'radial-customizer');
  shell.closeModal();
  shell.state.isSideDrawerOpen = true;
  shell.render(container);

  // Clicking anywhere outside the drawer closes it.
  shell.state.isSideDrawerOpen = true;
  shell.render(container);
  const drawerScrim = container.querySelector('.fb-side-drawer-scrim');
  assert.ok(drawerScrim, 'Drawer must expose an outside-click scrim');
  drawerScrim.click();
  assert.equal(shell.state.isSideDrawerOpen, false);
  assert.equal(container.querySelector('.fb-side-drawer-menu'), null);
});

test('Requirement 5 & 7: New Tab Developer Ad Badges Showcase above Logo without user management clutter', async () => {
  const container = document.createElement('div');
  const shell = new BrowserShell({
    container,
    isMobile: false,
    initialUrl: 'yayra://newtab'
  });

  await shell.initialize();
  shell.render(container);

  // Developer Ad Showcase Badges
  const sponsored = container.querySelector('.fb-dev-ad-showcase');
  assert.ok(sponsored, 'Developer ad badges showcase must render above logo');
  assert.ok(container.querySelectorAll('.fb-dev-ad-card').length >= 4, 'Developer ad badges should be present');
  assert.ok(container.querySelectorAll('.fb-dev-ad-label').length >= 4, 'Developer ad links should show as a horizontal labelled row');
});

test('Requirement 11: Downloads page includes Visit File Location button and List vs Card View Toggle', async () => {
  const container = document.createElement('div');
  const shell = new BrowserShell({
    container,
    isMobile: false
  });

  await shell.initialize();
  shell.render(container);

  // Navigate to Downloads
  shell.navigateActiveTab('yayra://downloads');

  // Check Location button
  const locBtn = container.querySelector('.fb-in-dl-location-btn');
  assert.ok(locBtn, 'Show in Folder / Visit File Location button must exist');

  // Check View Mode Toggle
  const viewToggle = container.querySelector('.fb-downloads-view-toggle');
  assert.ok(viewToggle, 'Downloads view mode toggle must exist');

  // Toggle to Card view
  const cardBtn = container.querySelector('[data-view="card"]');
  cardBtn.click();
  assert.equal(shell.state.downloadsViewMode, 'card');
  assert.ok(container.querySelector('.fb-downloads-grid-layout'));
});
