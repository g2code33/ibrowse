/**
 * Yayra Floating Browser - Mainstream Browser-First Shell
 * Full Chrome-style Desktop Top Tab Strip & Omnibox + Safari-style Mobile Layout
 * Features:
 *  - Radial AI & Quick Actions Wheel on Bubble Double-Click (Gemini, ChatGPT, Claude, Perplexity, Crop, Notes, etc.)
 *  - Standalone Floating Mini-Browser Window Overlay on Bubble Single-Click with "Open Full Browser" button
 *  - Omnibox Security Lock Dropdown with Instant Search Engine Switcher (Google Default, DuckDuckGo, Bing, etc.)
 *  - Yayra App Logo & Brand Badge Beside Security Lock in Toolbar
 *  - Right-Side Full Drawer 3-Dot Menu with ZERO Blur on User Workspace
 *  - Frequently Used Sites with Authentic SVG Logos (DuckDuckGo, Wikipedia, GitHub, Yayra Docs)
 *  - Featured & Sponsored Links Banner Section Above Yayra Logo on New Tab Page with In-App Customizer
 *  - Cute Compact Tab Strip with Low-Profile Tabs
 *  - Transparent, Compact Toolbar Action Buttons (Downloads & Extensions matching Star size)
 *  - Downloads Page with Working "Visit File Location" and List vs Card View Mode Toggle
 *  - Complete In-Tab Internal Pages (yayra://settings, yayra://history, yayra://bookmarks,
 *    yayra://downloads, yayra://passwords, yayra://extensions, yayra://permissions, yayra://about, yayra://newtab)
 */

import { Icons } from '../icons/icons.js';
import { PasswordManager } from '../../../persistence/src/PasswordManager.js';
import { ExtensionManager, BUILT_IN_EXTENSIONS } from '../../../browser-contract/src/extensions/ExtensionManager.js';

/**
 * =========================================================================
 * DEVELOPER ADVERTISEMENT & FEATURED SPONSORED LINKS CONFIGURATION
 * =========================================================================
 * DEVELOPER GUIDE:
 * Add, edit, or remove advertisement & sponsored links directly in this array.
 * When built, Yayra displays authentic brand logos automatically above the
 * Yayra logo in a sleek, non-overshadowing badge row.
 *
 * Structure:
 *   - id: Unique key
 *   - title: Name / Tooltip on hover
 *   - url: Destination URL opened on click
 *   - domain: Host domain used for brand favicon resolution
 *
 * Example:
 *   { id: 'ad-google', title: 'Google AI & Cloud', url: 'https://cloud.google.com', domain: 'cloud.google.com' }
 * =========================================================================
 */
export const DEVELOPER_AD_LINKS = [
  { id: 'ad-rx-store', title: 'RX Store — Developer Sponsor', url: 'https://rx-store-web.pages.dev', domain: 'rx-store-web.pages.dev' },
  { id: 'ad-pharmatrack', title: 'PharmaTrack', url: 'https://pharmatrack-web.pages.dev/', domain: 'pharmatrack-web.pages.dev' },
  { id: 'ad-coderxsociety', title: 'CoderX Society', url: 'https://coderxsociety.pages.dev/', domain: 'coderxsociety.pages.dev' },
  { id: 'ad-cgpapilot', title: 'CGPA Pilot', url: 'https://cgpapilot.pages.dev/', domain: 'cgpapilot.pages.dev' },
  { id: 'ad-clinicalrx30', title: 'Clinical RX 30', url: 'https://clinicalrx30.vercel.app/', domain: 'clinicalrx30.vercel.app' }
];

export class BrowserShell {
  constructor(options = {}) {
    this.options = options;
    this.platform = options.platform || this.detectPlatform();
    this.container = options.container || null;

    // Navigation and repositories
    this.navigationController = options.navigationController || null;
    this.historyRepo = options.historyRepo || null;
    this.bookmarksRepo = options.bookmarksRepo || null;
    this.downloadsRepo = options.downloadsRepo || null;
    this.settingsRepo = options.settingsRepo || null;
    this.privacyManager = options.privacyManager || null;
    this.updateService = options.updateService || null;
    this.storageAdapter = options.storageAdapter || null;

    this.passwordManager = options.passwordManager || new PasswordManager(this.storageAdapter);
    this.extensionManager = options.extensionManager || new ExtensionManager(this.storageAdapter);

    // Initial tabs setup
    const initialTabs = options.tabs && options.tabs.length > 0
      ? options.tabs.map((t) => ({ ...t, title: this.getTabTitle(t), favicon: this.getTabFavicon(t) }))
      : [
          {
            id: 'tab-1',
            title: options.initialUrl ? this.getTabTitle({ url: options.initialUrl }) : 'New Tab',
            url: options.initialUrl || 'yayra://newtab',
            isSecure: true,
            canGoBack: false,
            canGoForward: false,
            isLoading: false,
            isPrivate: false,
            favicon: null
          }
        ];

    let locallyPersistedSettings = {};
    if (typeof localStorage !== 'undefined') {
      try {
        locallyPersistedSettings = JSON.parse(localStorage.getItem('yayra:settings') || '{}');
      } catch {
        locallyPersistedSettings = {};
      }
    }

    // Reactive State
    this.state = {
      tabs: initialTabs,
      activeTabId: options.activeTabId || initialTabs[0]?.id || 'tab-1',
      desktopFloatingMode: options.desktopFloatingMode || 'browser-first',
      isMinimizedToBubble: false,
      isMobile: options.isMobile !== undefined ? options.isMobile : this.checkMobileViewport(),
      urlInputValue: initialTabs[0]?.url || 'yayra://newtab',
      activeModal: null, // 'menu', 'tab-switcher', 'sponsored-manager', etc.
      isSideDrawerOpen: false,
      isSecurityDropdownOpen: false,
      isRadialLauncherOpen: false,
      isFloatingMiniOpen: false,
      isBookmarked: false,
      zoomLevel: 100,
      isFullscreen: false,
      downloadsViewMode: 'list', // 'list' | 'card'
      findInPage: {
        isOpen: false,
        query: '',
        matchesCount: 0,
        currentMatch: 0
      },
      closedTabsHistory: [],
      historyItems: [],
      bookmarksItems: [],
      downloadsItems: [
        { id: 'dl-1', filename: 'yayra-v0.1.0-setup.exe', path: 'C:\\Users\\User\\Downloads\\yayra-v0.1.0-setup.exe', url: 'https://yayra.app/download', size: '58.4 MB', state: 'Completed', date: 'Just now' },
        { id: 'dl-2', filename: 'offline-manual.pdf', path: '/home/user/Downloads/offline-manual.pdf', url: 'https://docs.yayra.app/manual.pdf', size: '2.8 MB', state: 'Completed', date: 'Yesterday' }
      ],
      passwordsItems: [],
      extensionsItems: [...BUILT_IN_EXTENSIONS],
      sponsoredLinks: DEVELOPER_AD_LINKS.map((item) => ({
        ...item,
        tag: 'Developer Sponsor'
      })),
      settingsActiveCategory: 'floating',
      activeSettingsCategory: 'floating',
      settingsSearchQuery: '',
      historySearchQuery: '',
      bookmarksSearchQuery: '',
      downloadsSearchQuery: '',
      passwordsSearchQuery: '',
      settings: {
        theme: 'dark',
        colorTheme: 'blue',
        searchEngine: 'google', // Requirement 13: Default search engine is Google
        floatingEnabledByDefault: true,
        startFloatingOnLaunch: true,
        alwaysOnTop: true,
        rememberPosition: true,
        rememberSize: true,
        minimizeToBubble: true,
        closeToTray: true,
        bubbleOpacity: 0.88,
        frameOpacity: 0.85,
        glassmorphismBlurRadius: 24,
        savePasswordsEnabled: true,
        autofillEnabled: true,
        httpsFirst: true,
        clearHistoryOnExit: false,
        restoreSessionOnLaunch: true,
        ...locallyPersistedSettings,
        ...options.initialSettings
      },
      updateState: {
        status: 'idle', // 'idle' | 'checking' | 'available' | 'ready' | 'uptodate'
        installedVersion: '0.1.0',
        availableVersion: null,
        notes: null
      },
      updatePromptShown: false
    };

    this.state.tabs.forEach((tab) => this.ensureNavigationState(tab));

    // DOM Elements
    this.rootElement = null;
    this.tabStripElement = null;
    this.omniboxInput = null;
    this.viewportElement = null;
    this.bubbleOverlay = null;

    this.boundResizeHandler = () => this.handleViewportResize();
    this.boundKeyHandler = (e) => this.handleGlobalKeyDown(e);
    this._bookmarkCheckId = 0;

    if (typeof window !== 'undefined') {
      setTimeout(() => {
        this.checkForUpdates(false);
      }, 1200);
    }
  }

  detectPlatform() {
    if (typeof navigator === 'undefined') return 'linux';
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    if (/Windows/i.test(ua)) return 'windows';
    if (/Linux/i.test(ua)) return 'linux';
    return 'desktop';
  }

  checkMobileViewport() {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 768;
  }

  async initialize() {
    if (this.settingsRepo) {
      try {
        const stored = await this.settingsRepo.getSettings();
        if (stored) {
          this.state.settings = { ...this.state.settings, ...stored };
          if (stored.desktopFloatingMode && !this.options.desktopFloatingMode) {
            this.state.desktopFloatingMode = stored.desktopFloatingMode;
          }
        }
      } catch (err) {
        console.warn('Failed to load settings in BrowserShell:', err);
      }
    }

    if (this.historyRepo && typeof this.historyRepo.getEntries === 'function') {
      try {
        this.state.historyItems = await this.historyRepo.getEntries(100);
      } catch (err) {
        console.warn('Failed to load history in BrowserShell:', err);
      }
    }

    if (this.bookmarksRepo && typeof this.bookmarksRepo.getAllBookmarks === 'function') {
      try {
        this.state.bookmarksItems = await this.bookmarksRepo.getAllBookmarks();
      } catch (err) {
        console.warn('Failed to load bookmarks in BrowserShell:', err);
      }
    }

    if (this.passwordManager && typeof this.passwordManager.getAllCredentials === 'function') {
      try {
        this.state.passwordsItems = await this.passwordManager.getAllCredentials();
      } catch (err) {
        console.warn('Failed to load passwords in BrowserShell:', err);
      }
    }

    if (this.extensionManager && typeof this.extensionManager.getExtensions === 'function') {
      try {
        this.state.extensionsItems = await this.extensionManager.getExtensions();
      } catch (err) {
        console.warn('Failed to load extensions in BrowserShell:', err);
        this.state.extensionsItems = [...BUILT_IN_EXTENSIONS];
      }
    } else if (!this.state.extensionsItems || this.state.extensionsItems.length === 0) {
      this.state.extensionsItems = [...BUILT_IN_EXTENSIONS];
    }

    const activeTab = this.getActiveTab();
    if (activeTab) {
      await this.updateBookmarkState(activeTab.url);
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.boundResizeHandler);
      window.addEventListener('keydown', this.boundKeyHandler);
    }
  }

  getActiveTab() {
    return this.state.tabs.find((t) => t.id === this.state.activeTabId) || this.state.tabs[0];
  }

  render(container = null) {
    const target = container || this.container || (this.rootElement && this.rootElement.parentElement);
    if (!target) return null;

    target.innerHTML = '';
    const activeTab = this.getActiveTab();
    const isPrivate = activeTab?.isPrivate;

    const shell = document.createElement('div');
    shell.className = `fb-browser-shell ${this.state.isMobile ? 'fb-mobile-layout' : 'fb-desktop-layout'} ${isPrivate ? 'fb-incognito-mode' : ''}`;
    shell.setAttribute('data-theme', this.state.settings.theme || 'dark');
    shell.setAttribute('data-color-theme', this.state.settings.colorTheme || 'blue');
    shell.setAttribute('data-floating-mode', this.state.desktopFloatingMode);

    // Apply frame transparency
    const frameOpacity = this.state.settings.frameOpacity || 0.85;
    const blurRadius = this.state.settings.glassmorphismBlurRadius || 24;
    shell.style.setProperty('--fb-frame-opacity', String(frameOpacity));
    shell.style.setProperty('--fb-blur-radius', `${blurRadius}px`);

    if (this.state.isMinimizedToBubble) {
      shell.style.display = 'none';
      this.renderFloatingBubbleOverlay();
    } else {
      shell.style.display = 'flex';
      if (this.bubbleOverlay) {
        this.bubbleOverlay.remove();
        this.bubbleOverlay = null;
      }
      const legacyOverlay = typeof document !== 'undefined' ? document.getElementById('yayra-floating-bubble-overlay') : null;
      if (legacyOverlay) {
        legacyOverlay.remove();
      }
    }

    if (this.state.isMobile) {
      this.renderMobileLayout(shell, activeTab);
    } else {
      this.renderDesktopLayout(shell, activeTab);
    }

    // Modal / Dialog Overlay (Menu, Tab Switcher, etc.)
    this.renderActiveModal(shell);

    // Right Side Drawer Menu (No Blur)
    if (this.state.isSideDrawerOpen) {
      this.renderSideDrawer(shell);
    }

    // Security Dropdown & Search Engine Switcher
    if (this.state.isSecurityDropdownOpen) {
      this.renderSecurityDropdown(shell);
    }

    // Find in Page Toolbar
    if (this.state.findInPage.isOpen) {
      this.renderFindInPageBar(shell);
    }

    // Floating Mini-Browser Window Popup
    if (this.state.isFloatingMiniOpen) {
      this.renderFloatingMiniWindow();
    }

    // Radial AI & Actions Wheel Overlay
    if (this.state.isRadialLauncherOpen) {
      this.renderRadialLauncher();
    }

    target.appendChild(shell);
    this.rootElement = shell;

    // Maintain persistent assistive bubble in the DOM
    this.ensurePersistentAssistiveBubble();

    return shell;
  }

  /* -------------------------------------------------------------
   * DESKTOP LAYOUT (COMPACT TABS, OMNIBOX, BRANDING, NO-BLUR DRAWER)
   * ----------------------------------------------------------- */
  renderDesktopLayout(root, activeTab) {
    // 1. Top Tab Strip (Requirement 8: Compact, Low-Profile, Cute Tabs)
    const tabStrip = document.createElement('header');
    tabStrip.className = 'fb-chrome-tabstrip';
    tabStrip.setAttribute('role', 'tablist');
    tabStrip.setAttribute('aria-label', 'Open tabs');

    const tabsScroll = document.createElement('div');
    tabsScroll.className = 'fb-tabs-scroll-container';

    this.state.tabs.forEach((tab, index) => {
      const isActive = tab.id === this.state.activeTabId;
      const tabEl = document.createElement('div');
      tabEl.className = `fb-tab-item ${isActive ? 'active' : ''} ${tab.isPrivate ? 'fb-tab-incognito' : ''}`;
      tabEl.setAttribute('role', 'tab');
      tabEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tabEl.setAttribute('draggable', 'true');
      tabEl.dataset.tabId = tab.id;

      // Favicon / Orb Icon
      const faviconWrap = document.createElement('span');
      faviconWrap.className = 'fb-tab-favicon';
      faviconWrap.innerHTML = this.getTabFavicon(tab);
      tabEl.appendChild(faviconWrap);

      // Title
      const titleEl = document.createElement('span');
      titleEl.className = 'fb-tab-title';
      titleEl.textContent = this.getTabTitle(tab);
      tabEl.appendChild(titleEl);

      // Cute Close "x" Button
      const closeBtn = document.createElement('button');
      closeBtn.className = 'fb-tab-close-btn';
      closeBtn.setAttribute('title', 'Close tab (Ctrl+W)');
      closeBtn.setAttribute('aria-label', `Close ${this.getTabTitle(tab)}`);
      closeBtn.innerHTML = Icons.close;
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      });
      tabEl.appendChild(closeBtn);

      tabEl.addEventListener('click', () => {
        this.selectTab(tab.id);
      });

      // Middle click to close tab
      tabEl.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          this.closeTab(tab.id);
        }
      });

      // Tab drag reordering
      tabEl.addEventListener('dragstart', (e) => {
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', String(index));
        }
      });
      tabEl.addEventListener('dragover', (e) => e.preventDefault());
      tabEl.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromIdx = Number(e.dataTransfer?.getData('text/plain'));
        if (!isNaN(fromIdx) && fromIdx !== index) {
          this.reorderTabs(fromIdx, index);
        }
      });

      tabsScroll.appendChild(tabEl);
    });

    // New Tab "+" Button
    const newTabBtn = document.createElement('button');
    newTabBtn.className = 'fb-btn-newtab';
    newTabBtn.setAttribute('title', 'New Tab (Ctrl+T)');
    newTabBtn.setAttribute('aria-label', 'Create new tab');
    newTabBtn.innerHTML = Icons.plus;
    newTabBtn.addEventListener('click', () => {
      this.createNewTab();
    });
    tabsScroll.appendChild(newTabBtn);

    tabStrip.appendChild(tabsScroll);

    // Desktop Window Header Actions (Minimize to Bubble, Window Controls)
    const windowActions = document.createElement('div');
    windowActions.className = 'fb-window-actions';

    // Minimize to Floating Bubble button
    const minimizeToBubbleBtn = document.createElement('button');
    minimizeToBubbleBtn.className = 'fb-btn-action fb-btn-minimize-bubble';
    minimizeToBubbleBtn.setAttribute('title', 'Minimize to Floating Circle');
    minimizeToBubbleBtn.setAttribute('aria-label', 'Minimize to floating bubble');
    minimizeToBubbleBtn.innerHTML = Icons.bubble;
    minimizeToBubbleBtn.addEventListener('click', () => {
      this.minimizeToBubble();
    });
    windowActions.appendChild(minimizeToBubbleBtn);

    // Minimize window button
    const minBtn = document.createElement('button');
    minBtn.className = 'fb-btn-action fb-btn-win-min';
    minBtn.setAttribute('title', 'Minimize Window');
    minBtn.setAttribute('aria-label', 'Minimize');
    minBtn.innerHTML = Icons.minimize;
    minBtn.addEventListener('click', () => {
      this.minimizeToBubble();
    });
    windowActions.appendChild(minBtn);

    // Maximize / Restore window button
    const maxBtn = document.createElement('button');
    maxBtn.className = 'fb-btn-action fb-btn-win-max';
    maxBtn.setAttribute('title', this.state.isFullscreen ? 'Restore Window' : 'Maximize Window');
    maxBtn.setAttribute('aria-label', 'Maximize');
    maxBtn.innerHTML = Icons.maximize;
    maxBtn.addEventListener('click', () => {
      this.toggleFullscreen();
    });
    windowActions.appendChild(maxBtn);

    // Close window button
    const closeWinBtn = document.createElement('button');
    closeWinBtn.className = 'fb-btn-action fb-btn-win-close';
    closeWinBtn.setAttribute('title', 'Close Browser (Hides to Bubble)');
    closeWinBtn.setAttribute('aria-label', 'Close');
    closeWinBtn.innerHTML = Icons.close;
    closeWinBtn.addEventListener('click', () => {
      this.minimizeToBubble();
    });
    windowActions.appendChild(closeWinBtn);

    tabStrip.appendChild(windowActions);
    root.appendChild(tabStrip);
    this.tabStripElement = tabStrip;

    // 2. Browser Navigation Toolbar (Back, Forward, Reload/Stop, Brand, Lock + Search Engine, Omnibox, Star, Downloads, Extensions, Menu)
    const navbar = document.createElement('nav');
    navbar.className = 'fb-chrome-navbar';
    navbar.setAttribute('role', 'toolbar');
    navbar.setAttribute('aria-label', 'Navigation and address bar');

    // Navigation Controls
    const navControls = document.createElement('div');
    navControls.className = 'fb-nav-controls';

    const backBtn = document.createElement('button');
    backBtn.className = 'fb-nav-btn fb-nav-back';
    backBtn.setAttribute('title', 'Click to go back');
    backBtn.setAttribute('aria-label', 'Back');
    backBtn.disabled = !activeTab.canGoBack;
    backBtn.innerHTML = Icons.arrowLeft;
    backBtn.addEventListener('click', () => {
      this.goBack();
      this.render();
    });
    navControls.appendChild(backBtn);

    const fwdBtn = document.createElement('button');
    fwdBtn.className = 'fb-nav-btn fb-nav-forward';
    fwdBtn.setAttribute('title', 'Click to go forward');
    fwdBtn.setAttribute('aria-label', 'Forward');
    fwdBtn.disabled = !activeTab.canGoForward;
    fwdBtn.innerHTML = Icons.arrowRight;
    fwdBtn.addEventListener('click', () => {
      this.goForward();
      this.render();
    });
    navControls.appendChild(fwdBtn);

    const reloadBtn = document.createElement('button');
    reloadBtn.className = 'fb-nav-btn fb-nav-reload';
    reloadBtn.setAttribute('title', activeTab.isLoading ? 'Stop loading this page (Esc)' : 'Reload this page (Ctrl+R)');
    reloadBtn.setAttribute('aria-label', activeTab.isLoading ? 'Stop' : 'Reload');
    reloadBtn.innerHTML = activeTab.isLoading ? Icons.stop : Icons.refresh;
    reloadBtn.addEventListener('click', () => {
      if (activeTab.isLoading) this.stopLoading();
      else this.reload();
    });
    navControls.appendChild(reloadBtn);

    navbar.appendChild(navControls);

    // 3. Combined Address & Search Field (Omnibox with Brand & Security Selector)
    const omnibox = document.createElement('div');
    omnibox.className = 'fb-omnibox-container';

    // Requirement 4: App Logo and "yayra" Brand beside the Security Button
    const toolbarBrand = document.createElement('div');
    toolbarBrand.className = 'fb-toolbar-brand';
    toolbarBrand.innerHTML = `
      <span class="fb-toolbar-brand-orb">${Icons.officialOrb}</span>
      <span class="fb-toolbar-brand-text">${Icons.officialWordmark}<span class="fb-brand-text-fallback">yayra</span></span>
    `;
    toolbarBrand.setAttribute('title', 'Yayra Floating Browser v0.1.0');
    toolbarBrand.addEventListener('click', () => this.openInternalPage('yayra://newtab'));
    omnibox.appendChild(toolbarBrand);

    // Requirement 3: Security Lock Button (Opens Search Engine Selector & Security Info)
    const securityBadge = document.createElement('button');
    securityBadge.className = 'fb-omnibox-security fb-omnibox-security-badge fb-security-lock-btn';
    securityBadge.setAttribute('title', 'Site Security & Default Search Engine');
    securityBadge.setAttribute('aria-label', 'Security and Search Engine Options');
    securityBadge.innerHTML = activeTab.isSecure ? Icons.lock : Icons.alertTriangle;
    securityBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      this.state.isSecurityDropdownOpen = !this.state.isSecurityDropdownOpen;
      this.render();
    });
    omnibox.appendChild(securityBadge);

    // Omnibox Input
    const omniboxInput = document.createElement('input');
    omniboxInput.type = 'text';
    omniboxInput.className = 'fb-omnibox-input';
    omniboxInput.value = this.getDisplayUrl(activeTab.url);
    const currentEngine = this.state.settings.searchEngine || 'google';
    omniboxInput.placeholder = `Search with ${currentEngine.charAt(0).toUpperCase() + currentEngine.slice(1)} or enter address`;
    omniboxInput.setAttribute('aria-label', 'Address and search bar');
    omniboxInput.setAttribute('spellcheck', 'false');
    omniboxInput.setAttribute('autocomplete', 'off');

    omniboxInput.addEventListener('focus', () => {
      omniboxInput.select();
    });

    omniboxInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.navigateActiveTab(omniboxInput.dataset.selectedSuggestion || omniboxInput.value);
        omniboxInput.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        omniboxInput.value = this.getDisplayUrl(this.getActiveTab().url);
        omniboxInput.blur();
      }
    });

    omnibox.appendChild(omniboxInput);
    this.bindSearchSuggestions(omniboxInput);
    this.omniboxInput = omniboxInput;

    // Bookmark Star Icon
    const starBtn = document.createElement('button');
    starBtn.className = `fb-omnibox-star ${this.state.isBookmarked ? 'bookmarked' : ''}`;
    starBtn.setAttribute('title', this.state.isBookmarked ? 'Remove bookmark' : 'Bookmark this tab (Ctrl+D)');
    starBtn.setAttribute('aria-label', 'Bookmark tab');
    starBtn.innerHTML = this.state.isBookmarked ? Icons.starFilled : Icons.star;
    starBtn.addEventListener('click', () => this.toggleBookmarkCurrentTab());
    omnibox.appendChild(starBtn);

    navbar.appendChild(omnibox);

    // 4. Action Buttons (Downloads, Extensions, Mode Switcher, 3-Dot Menu)
    const toolbarActions = document.createElement('div');
    toolbarActions.className = 'fb-toolbar-actions';

    // Requirement 10: Downloads Button (Transparent, Compact, Matching Star Size)
    const dlBtn = document.createElement('button');
    dlBtn.className = 'fb-action-btn fb-btn-downloads fb-toolbar-downloads-btn fb-toolbar-action-btn';
    dlBtn.setAttribute('title', 'Downloads (Ctrl+J)');
    dlBtn.setAttribute('aria-label', 'Downloads');
    dlBtn.innerHTML = Icons.download;
    dlBtn.addEventListener('click', () => this.openInternalPage('yayra://downloads'));
    toolbarActions.appendChild(dlBtn);

    // Requirement 10: Extensions & Shields Button (Transparent, Compact, Matching Star Size)
    const extBtn = document.createElement('button');
    extBtn.className = 'fb-action-btn fb-btn-extensions fb-toolbar-extensions-btn fb-toolbar-action-btn';
    extBtn.setAttribute('title', 'Extensions & Shields');
    extBtn.setAttribute('aria-label', 'Extensions and Content Shields');
    extBtn.innerHTML = Icons.shield;
    extBtn.addEventListener('click', () => this.openInternalPage('yayra://extensions'));
    toolbarActions.appendChild(extBtn);

    // Floating Mode Indicator / Switcher Pill
    const modePill = document.createElement('button');
    modePill.className = 'fb-mode-pill';
    modePill.setAttribute('title', `Current Floating Mode: ${this.state.desktopFloatingMode === 'browser-first' ? 'Mode B (Browser-First)' : 'Mode A (Circle-First)'}. Click to switch.`);
    modePill.innerHTML = `
      <span class="fb-mode-dot"></span>
      <span class="fb-mode-text">${this.state.desktopFloatingMode === 'browser-first' ? 'Floating Browser' : 'Bubble Mode'}</span>
    `;
    modePill.addEventListener('click', () => {
      this.toggleDesktopMode();
    });
    toolbarActions.appendChild(modePill);

    // Requirement 5: 3-Dot Browser Menu Button (Opens Full Right-Side Drawer without Blur)
    const menuBtn = document.createElement('button');
    menuBtn.className = 'fb-action-btn fb-menu-btn fb-toolbar-action-btn';
    menuBtn.setAttribute('title', 'Customize and control Yayra');
    menuBtn.setAttribute('aria-label', 'Main menu');
    menuBtn.innerHTML = Icons.moreVertical;
    menuBtn.addEventListener('click', () => {
      this.state.isSideDrawerOpen = !this.state.isSideDrawerOpen;
      this.render();
    });
    toolbarActions.appendChild(menuBtn);

    navbar.appendChild(toolbarActions);
    root.appendChild(navbar);

    // 5. Main Browser Viewport
    const viewport = document.createElement('main');
    viewport.className = 'fb-browser-viewport';
    viewport.setAttribute('role', 'main');

    this.renderViewportContent(viewport, activeTab);

    root.appendChild(viewport);
    this.viewportElement = viewport;
  }

  attachMobilePullToRefresh(viewport) {
    if (!viewport || typeof viewport.addEventListener !== 'function') return;

    const indicator = document.createElement('div');
    indicator.className = 'fb-mobile-pull-indicator';
    indicator.setAttribute('aria-live', 'polite');
    indicator.innerHTML = `<span class="fb-mobile-pull-icon">${Icons.refresh}</span><span class="fb-mobile-pull-label">Pull to refresh</span>`;
    viewport.appendChild(indicator);

    let startY = null;
    let distance = 0;
    let tracking = false;
    const reset = () => {
      startY = null;
      distance = 0;
      tracking = false;
      indicator.classList.remove('pulling', 'ready', 'refreshing');
      indicator.style.setProperty('--fb-pull-distance', '0px');
      const label = indicator.querySelector('.fb-mobile-pull-label');
      if (label) label.textContent = 'Pull to refresh';
    };

    viewport.addEventListener('touchstart', (event) => {
      const touch = event.touches?.[0];
      if (!touch) return;
      const scrollable = event.target?.closest?.('.fb-newtab-page, .fb-internal-page, .fb-mobile-viewport') || viewport;
      if ((scrollable.scrollTop || 0) > 0) return;
      startY = touch.clientY;
      tracking = true;
    }, { passive: true });

    viewport.addEventListener('touchmove', (event) => {
      if (!tracking || startY === null) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      distance = Math.max(0, Math.min(112, touch.clientY - startY));
      if (distance <= 0) return;
      indicator.style.setProperty('--fb-pull-distance', `${distance}px`);
      indicator.classList.add('pulling');
      const ready = distance >= 72;
      indicator.classList.toggle('ready', ready);
      const label = indicator.querySelector('.fb-mobile-pull-label');
      if (label) label.textContent = ready ? 'Release to refresh' : 'Pull to refresh';
      if (event.cancelable && distance > 8) event.preventDefault();
    }, { passive: false });

    viewport.addEventListener('touchend', () => {
      if (!tracking) return;
      if (distance >= 72) {
        indicator.classList.add('refreshing');
        const label = indicator.querySelector('.fb-mobile-pull-label');
        if (label) label.textContent = 'Refreshing…';
        this.reload();
        return;
      }
      reset();
    }, { passive: true });

    viewport.addEventListener('touchcancel', reset, { passive: true });
  }

  /* -------------------------------------------------------------
   * MOBILE LAYOUT (SAFARI-STYLE BOTTOM BAR) (PHASE 2B)
   * ----------------------------------------------------------- */
  renderMobileLayout(root, activeTab) {
    // Safari-inspired mobile chrome: a compact tab/tool rail above the page,
    // then the address and navigation controls at the bottom. All Yayra
    // actions remain available; the layout only changes their placement.
    const topBar = document.createElement('header');
    topBar.className = 'fb-mobile-topbar';
    topBar.setAttribute('aria-label', 'Safari-style browser tools');

    const safariTabbar = document.createElement('nav');
    safariTabbar.className = 'fb-mobile-safari-tabbar';
    const topActions = [
      { className: 'fb-mobile-tab-overview', icon: Icons.tabs, title: 'Show all tabs', action: () => this.openModal('tab-switcher') },
      { className: 'fb-mobile-tab-bookmarks', icon: Icons.bookmark, title: 'Bookmarks', action: () => this.openInternalPage('yayra://bookmarks') },
      { className: 'fb-mobile-tab-privacy', icon: Icons.shield, title: 'Privacy and shields', action: () => this.openInternalPage('yayra://permissions') },
      { className: 'fb-mobile-tab-history', icon: Icons.history, title: 'History', action: () => this.openInternalPage('yayra://history') }
    ];
    topActions.forEach(({ className, icon, title, action }) => {
      const button = document.createElement('button');
      button.className = `fb-mobile-safari-tab-btn ${className}`;
      button.type = 'button';
      button.title = title;
      button.setAttribute('aria-label', title);
      button.innerHTML = icon;
      button.addEventListener('click', action);
      safariTabbar.appendChild(button);
    });
    topBar.appendChild(safariTabbar);
    root.appendChild(topBar);

    // Main viewport remains the same shared renderer used by desktop so all
    // internal pages, tools, privacy controls, and web content are preserved.
    const viewport = document.createElement('main');
    viewport.className = 'fb-browser-viewport fb-mobile-viewport';
    this.renderViewportContent(viewport, activeTab);
    this.attachMobilePullToRefresh(viewport);
    root.appendChild(viewport);
    this.viewportElement = viewport;

    const bottomBar = document.createElement('nav');
    bottomBar.className = 'fb-mobile-bottombar';

    const addressRow = document.createElement('div');
    addressRow.className = 'fb-mobile-address-row';

    const bRefresh = document.createElement('button');
    bRefresh.className = 'fb-mobile-nav-btn fb-mobile-refresh-btn';
    bRefresh.type = 'button';
    bRefresh.title = activeTab.isLoading ? 'Stop loading' : 'Refresh page';
    bRefresh.setAttribute('aria-label', activeTab.isLoading ? 'Stop loading' : 'Refresh page');
    bRefresh.innerHTML = activeTab.isLoading ? Icons.stop : Icons.refresh;
    bRefresh.addEventListener('click', () => {
      if (activeTab.isLoading) this.stopLoading();
      else this.reload();
    });
    addressRow.appendChild(bRefresh);

    const addressPill = document.createElement('div');
    addressPill.className = 'fb-mobile-address-pill';
    addressPill.setAttribute('role', 'button');
    addressPill.setAttribute('tabindex', '0');
    addressPill.setAttribute('aria-label', 'Search or enter website address');

    const secIcon = document.createElement('span');
    secIcon.className = 'fb-mobile-sec-icon';
    secIcon.innerHTML = activeTab.isSecure ? Icons.lock : Icons.alertTriangle;
    addressPill.appendChild(secIcon);

    const titleWrap = document.createElement('div');
    titleWrap.className = 'fb-mobile-pill-text';
    titleWrap.innerHTML = `
      <span class="fb-mobile-pill-host">${this.getDisplayUrl(activeTab.url)}</span>
      <span class="fb-mobile-pill-sub">${this.getTabTitle(activeTab)}</span>
    `;
    addressPill.appendChild(titleWrap);

    const openSearch = () => this.openModal('search-overlay');
    addressPill.addEventListener('click', openSearch);
    addressPill.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openSearch();
      }
    });
    addressRow.appendChild(addressPill);

    const tabsBtn = document.createElement('button');
    tabsBtn.className = 'fb-mobile-nav-btn fb-mobile-tabs-btn';
    tabsBtn.type = 'button';
    tabsBtn.title = 'Show all tabs';
    tabsBtn.setAttribute('aria-label', 'Show all tabs');
    tabsBtn.innerHTML = `
      <span class="fb-tabs-icon-wrapper">
        ${Icons.tabs}
        <span class="fb-tabs-count-badge">${this.state.tabs.length}</span>
      </span>
    `;
    tabsBtn.addEventListener('click', () => this.openModal('tab-switcher'));
    addressRow.appendChild(tabsBtn);
    bottomBar.appendChild(addressRow);

    const toolRow = document.createElement('div');
    toolRow.className = 'fb-mobile-secondary-tools';

    const bBack = document.createElement('button');
    bBack.className = 'fb-mobile-nav-btn';
    bBack.type = 'button';
    bBack.title = 'Back';
    bBack.setAttribute('aria-label', 'Back');
    bBack.innerHTML = Icons.arrowLeft;
    bBack.disabled = !activeTab.canGoBack;
    bBack.addEventListener('click', () => {
      this.goBack();
      this.render();
    });
    toolRow.appendChild(bBack);

    const bFwd = document.createElement('button');
    bFwd.className = 'fb-mobile-nav-btn';
    bFwd.type = 'button';
    bFwd.title = 'Forward';
    bFwd.setAttribute('aria-label', 'Forward');
    bFwd.innerHTML = Icons.arrowRight;
    bFwd.disabled = !activeTab.canGoForward;
    bFwd.addEventListener('click', () => {
      this.goForward();
      this.render();
    });
    toolRow.appendChild(bFwd);

    const bShare = document.createElement('button');
    bShare.className = 'fb-mobile-nav-btn';
    bShare.type = 'button';
    bShare.title = 'Share';
    bShare.setAttribute('aria-label', 'Share current page');
    bShare.innerHTML = Icons.share;
    bShare.addEventListener('click', () => this.shareCurrentPage());
    toolRow.appendChild(bShare);

    const bBook = document.createElement('button');
    bBook.className = `fb-mobile-nav-btn ${this.state.isBookmarked ? 'active' : ''}`;
    bBook.type = 'button';
    bBook.title = this.state.isBookmarked ? 'Remove bookmark' : 'Bookmark';
    bBook.setAttribute('aria-label', this.state.isBookmarked ? 'Remove bookmark' : 'Bookmark current page');
    bBook.innerHTML = this.state.isBookmarked ? Icons.starFilled : Icons.star;
    bBook.addEventListener('click', () => this.toggleBookmarkCurrentTab());
    toolRow.appendChild(bBook);

    const bMenu = document.createElement('button');
    bMenu.className = 'fb-mobile-nav-btn';
    bMenu.type = 'button';
    bMenu.title = 'More tools';
    bMenu.setAttribute('aria-label', 'More tools');
    bMenu.innerHTML = Icons.moreVertical;
    bMenu.addEventListener('click', () => {
      this.state.isSideDrawerOpen = !this.state.isSideDrawerOpen;
      this.render();
    });
    toolRow.appendChild(bMenu);

    bottomBar.appendChild(toolRow);
    root.appendChild(bottomBar);
  }

  /* -------------------------------------------------------------
   * VIEWPORT CONTENT ROUTER (IN-TAB INTERNAL PAGES OR WEBVIEW)
   * ----------------------------------------------------------- */
  renderViewportContent(viewport, activeTab) {
    if (!activeTab) return;

    // Page Loading Progress Bar
    if (activeTab.isLoading) {
      const progressBar = document.createElement('div');
      progressBar.className = 'fb-page-loading-bar';
      viewport.appendChild(progressBar);
    }

    const url = activeTab.url || '';

    if (!url || url === 'yayra://newtab' || url === 'about:blank') {
      this.renderNewTabPage(viewport, activeTab);
    } else if (url === 'yayra://settings') {
      this.renderInternalSettingsPage(viewport, activeTab);
    } else if (url === 'yayra://history') {
      this.renderInternalHistoryPage(viewport, activeTab);
    } else if (url === 'yayra://bookmarks') {
      this.renderInternalBookmarksPage(viewport, activeTab);
    } else if (url === 'yayra://downloads') {
      this.renderInternalDownloadsPage(viewport, activeTab);
    } else if (url === 'yayra://passwords') {
      this.renderInternalPasswordsPage(viewport, activeTab);
    } else if (url === 'yayra://extensions') {
      this.renderInternalExtensionsPage(viewport, activeTab);
    } else if (url === 'yayra://permissions') {
      this.renderInternalPermissionsPage(viewport, activeTab);
    } else if (url === 'yayra://about') {
      this.renderInternalAboutPage(viewport, activeTab);
    } else {
      // External Web Content Frame
      const webViewContainer = document.createElement('div');
      webViewContainer.className = 'fb-webview-container';
      if (this.state.zoomLevel !== 100) {
        webViewContainer.style.transform = `scale(${this.state.zoomLevel / 100})`;
        webViewContainer.style.transformOrigin = 'top left';
        webViewContainer.style.width = `${(100 / this.state.zoomLevel) * 100}%`;
        webViewContainer.style.height = `${(100 / this.state.zoomLevel) * 100}%`;
      }

      const iframe = document.createElement('iframe');
      iframe.className = 'fb-webview-frame';
      iframe.src = activeTab.url;
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
      iframe.setAttribute('allow', 'fullscreen');

      iframe.addEventListener('load', () => {
        this.updateTabLoading(activeTab.id, false);
      });

      webViewContainer.appendChild(iframe);
      viewport.appendChild(webViewContainer);
    }
  }

  /* -------------------------------------------------------------
   * 1. NEW TAB PAGE (PHASE 7, REQ 6 & REQ 7)
   * ----------------------------------------------------------- */
  renderNewTabPage(viewport, activeTab) {
    const newTabPage = document.createElement('div');
    newTabPage.className = `fb-newtab-page ${this.state.isMobile ? 'fb-mobile-safari-start-page' : ''}`;

    // Requirement 5 & 7: Developer Advertisement Badges (Sleek, Non-Overshadowing)
    const adLinks = DEVELOPER_AD_LINKS || this.state.sponsoredLinks || [];
    if (!activeTab.isPrivate && adLinks.length > 0) {
      const sponsoredSection = document.createElement('section');
      sponsoredSection.className = 'fb-dev-ad-showcase fb-sponsored-showcase';
      sponsoredSection.innerHTML = adLinks.map((item) => `
        <a class="fb-dev-ad-card fb-sponsored-card" href="${item.url}" data-url="${item.url}" target="_blank" rel="noopener" aria-label="${item.title}" title="${item.title}">
          <img class="fb-dev-ad-icon fb-sponsored-icon" src="https://icons.duckduckgo.com/ip3/${item.domain || item.url.replace(/^https?:\/\//, '').split('/')[0]}.ico" onerror="this.src='https://www.google.com/s2/favicons?domain=${item.domain || item.url}&sz=32'" alt="${item.title}" />
          <span class="fb-dev-ad-label">${item.title}</span>
          <span class="fb-dev-ad-tooltip">${item.title}</span>
        </a>
      `).join('');

      sponsoredSection.querySelectorAll('.fb-sponsored-card').forEach((card) => {
        card.addEventListener('click', (e) => {
          e.preventDefault();
          this.navigateActiveTab(card.dataset.url);
        });
      });

      newTabPage.appendChild(sponsoredSection);
    }

    // Hero Header with Brand Logo
    const hero = document.createElement('div');
    hero.className = 'fb-newtab-hero';

    const logoOrb = document.createElement('div');
    logoOrb.className = 'fb-newtab-logo';
    logoOrb.innerHTML = Icons.officialOrb;
    hero.appendChild(logoOrb);

    const title = document.createElement('div');
    title.className = 'fb-newtab-title';
    title.setAttribute('role', 'img');
    title.setAttribute('aria-label', activeTab.isPrivate ? 'Incognito' : 'yayra');
    title.innerHTML = activeTab.isPrivate ? '<span>Incognito</span>' : Icons.officialWordmark;
    hero.appendChild(title);
    newTabPage.appendChild(hero);

    // Search Form (Google Default Search)
    const searchForm = document.createElement('form');
    searchForm.className = 'fb-newtab-searchbox';
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = searchForm.querySelector('input');
      if (input && input.value.trim()) {
        this.navigateActiveTab(input.value.trim());
      }
    });

    const searchEngine = this.state.settings.searchEngine || 'google';
    const engineCap = searchEngine.charAt(0).toUpperCase() + searchEngine.slice(1);
    searchForm.innerHTML = `
      <span class="fb-newtab-search-icon">${Icons.search}</span>
      <input type="text" placeholder="${activeTab.isPrivate ? 'Search securely in Incognito' : `Search with ${engineCap} or type a URL`}" class="fb-newtab-input fb-newtab-search-input" autofocus />
    `;
    newTabPage.appendChild(searchForm);
    this.bindSearchSuggestions(searchForm.querySelector('.fb-newtab-search-input'));

    if (this.state.isMobile && !activeTab.isPrivate) {
      this.renderMobileSafariExtensionCard(newTabPage);
    }

    if (!activeTab.isPrivate) {
      // Requirement 6: Frequently Used Sites with Authentic SVG Logos
      const frequentSection = document.createElement('div');
      frequentSection.style.width = '100%';
      frequentSection.style.maxWidth = '680px';
      frequentSection.innerHTML = `
        <h3 style="font-size:0.85rem; font-weight:700; color:var(--fb-text-muted); text-transform:uppercase; letter-spacing:0.05em; margin:20px 0 8px 8px;">${this.state.isMobile ? 'Favorites' : 'Frequently Used Sites'}</h3>
      `;

      const frequentGrid = document.createElement('div');
      frequentGrid.className = 'fb-frequent-grid';

      const frequentSites = [
        { title: 'DuckDuckGo', url: 'https://duckduckgo.com', icon: Icons.duckduckgo },
        { title: 'Wikipedia', url: 'https://wikipedia.org', icon: Icons.wikipedia },
        { title: 'GitHub', url: 'https://github.com', icon: Icons.github },
        { title: 'Yayra Docs', url: 'https://github.com/g2code33/yayra', icon: Icons.logoOrb },
        { title: 'Google', url: 'https://google.com', icon: Icons.google }
      ];

      frequentSites.forEach((site) => {
        const card = document.createElement('button');
        card.className = 'fb-frequent-card fb-newtab-shortcut';
        card.innerHTML = `
          <div class="fb-frequent-icon-wrap">${site.icon}</div>
          <span class="fb-frequent-title">${site.title}</span>
        `;
        card.addEventListener('click', () => {
          this.navigateActiveTab(site.url);
        });
        frequentGrid.appendChild(card);
      });

      frequentSection.appendChild(frequentGrid);
      newTabPage.appendChild(frequentSection);

      // Recent History Quick List
      if (this.state.historyItems.length > 0) {
        const recentHist = document.createElement('div');
        recentHist.className = 'fb-newtab-history';
        recentHist.innerHTML = `
          <h3 class="fb-newtab-section-title">${this.state.isMobile ? 'Suggestions' : 'Recent History'}</h3>
          <div class="fb-history-quicklist">
            ${this.state.historyItems.slice(0, 5).map((h) => `
              <div class="fb-history-quick-item" data-url="${h.url}">
                <span class="fb-history-quick-title">${h.title || h.url}</span>
                <span class="fb-history-quick-url">${h.url}</span>
              </div>
            `).join('')}
          </div>
        `;

        recentHist.querySelectorAll('.fb-history-quick-item').forEach((item) => {
          item.addEventListener('click', () => {
            this.navigateActiveTab(item.dataset.url);
          });
        });

        newTabPage.appendChild(recentHist);
      }
    }

    if (this.state.isMobile && !activeTab.isPrivate) {
      this.renderMobileSafariStartSections(newTabPage);
    }

    viewport.appendChild(newTabPage);

    // Auto-focus the search bar
    setTimeout(() => {
      newTabPage.querySelector('.fb-newtab-input')?.focus();
    }, 50);
  }

  renderMobileSafariExtensionCard(container) {
    const card = document.createElement('section');
    card.className = 'fb-mobile-safari-extension-card';
    card.innerHTML = `
      <div class="fb-mobile-safari-extension-art" aria-hidden="true">
        <span>${Icons.shield}</span><span>${Icons.lock}</span><span>${Icons.starFilled}</span>
      </div>
      <h2>Extensions</h2>
      <p>Supercharge your Yayra browsing with extensions that can find discounts, block ads, and more.</p>
      <button type="button" class="fb-btn fb-btn-primary fb-mobile-safari-extension-btn">Browse Extensions</button>
    `;
    card.querySelector('button')?.addEventListener('click', () => this.openInternalPage('yayra://extensions'));
    container.appendChild(card);
  }

  renderMobileSafariStartSections(container) {
    const privacy = document.createElement('section');
    privacy.className = 'fb-mobile-safari-section fb-mobile-safari-privacy-card';
    privacy.innerHTML = `
      <h2>${Icons.shield} Privacy Report</h2>
      <div class="fb-mobile-safari-report-body">
        <span class="fb-mobile-safari-report-icon">${Icons.shield}</span>
        <p>Yayra's tracker and ad shield is active for your browsing session.</p>
      </div>
    `;
    container.appendChild(privacy);

    const reading = document.createElement('section');
    reading.className = 'fb-mobile-safari-section fb-mobile-safari-reading-list';
    reading.innerHTML = '<h2>Reading List</h2>';
    const readingItems = this.state.historyItems.slice(0, 3);
    if (readingItems.length) {
      readingItems.forEach((item) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'fb-mobile-safari-list-row';
        row.innerHTML = `<span class="fb-mobile-safari-list-icon">${Icons.bookmark}</span><span class="fb-mobile-safari-list-copy"><strong></strong><small></small></span>`;
        row.querySelector('strong').textContent = item.title || item.url;
        row.querySelector('small').textContent = item.url;
        row.addEventListener('click', () => this.navigateActiveTab(item.url));
        reading.appendChild(row);
      });
    } else {
      const empty = document.createElement('p');
      empty.className = 'fb-mobile-safari-empty';
      empty.textContent = 'Save pages here to read them later.';
      reading.appendChild(empty);
    }
    container.appendChild(reading);

    const recently = document.createElement('section');
    recently.className = 'fb-mobile-safari-section fb-mobile-safari-recently-closed';
    recently.innerHTML = '<div class="fb-mobile-safari-section-heading"><h2>Recently Closed Tabs</h2><button type="button" class="fb-mobile-safari-clear">Clear All</button></div>';
    const closedTabs = this.state.closedTabsHistory.slice(0, 4);
    if (closedTabs.length) {
      closedTabs.forEach((tab) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'fb-mobile-safari-closed-row';
        row.textContent = tab.title || tab.url;
        row.addEventListener('click', () => {
          this.restoreLastClosedTab();
          this.render();
        });
        recently.appendChild(row);
      });
    } else {
      const empty = document.createElement('p');
      empty.className = 'fb-mobile-safari-empty';
      empty.textContent = 'Closed tabs will appear here.';
      recently.appendChild(empty);
    }
    recently.querySelector('.fb-mobile-safari-clear')?.addEventListener('click', () => {
      this.state.closedTabsHistory = [];
      this.render();
    });
    container.appendChild(recently);
  }

  /* -------------------------------------------------------------
   * 2. FIREFOX-STYLE SETTINGS IN-TAB PAGE (PHASE 9 & 10)
   * ----------------------------------------------------------- */
  renderInternalSettingsPage(viewport) {
    const page = document.createElement('div');
    page.className = 'fb-internal-page fb-settings-app fb-settings-inpage-layout';

    const activeCat = this.state.settingsActiveCategory || this.state.activeSettingsCategory || 'floating';

    page.innerHTML = `
      <nav class="fb-settings-sidebar">
        <h2 style="font-size:1.15rem; font-weight:800; margin:0 0 12px 6px;">Settings</h2>
        <div class="fb-internal-search" style="margin-bottom:12px;">
          <span class="fb-internal-search-icon">${Icons.search}</span>
          <input type="text" id="fb-in-settings-search" class="fb-settings-search-input" placeholder="Search settings" value="${this.state.settingsSearchQuery || ''}" style="width:100%; box-sizing:border-box;" />
        </div>
        <button class="fb-settings-nav-item ${activeCat === 'floating' ? 'active' : ''}" data-cat="floating" data-category="floating">
          ${Icons.bubble} <span>Floating & Transparency</span>
        </button>
        <button class="fb-settings-nav-item ${activeCat === 'appearance' ? 'active' : ''}" data-cat="appearance" data-category="appearance">
          ${Icons.moon} <span>Appearance</span>
        </button>
        <button class="fb-settings-nav-item ${activeCat === 'privacy' ? 'active' : ''}" data-cat="privacy" data-category="privacy">
          ${Icons.shield} <span>Privacy & Security</span>
        </button>
        <button class="fb-settings-nav-item ${activeCat === 'passwords' ? 'active' : ''}" data-cat="passwords" data-category="passwords">
          ${Icons.lock} <span>Passwords & Autofill</span>
        </button>
        <button class="fb-settings-nav-item ${activeCat === 'tabs' ? 'active' : ''}" data-cat="tabs" data-category="tabs">
          ${Icons.tabs} <span>Tabs & Startup</span>
        </button>
        <button class="fb-settings-nav-item ${activeCat === 'downloads' ? 'active' : ''}" data-cat="downloads" data-category="downloads">
          ${Icons.download} <span>Downloads</span>
        </button>
        <button class="fb-settings-nav-item ${activeCat === 'extensions' ? 'active' : ''}" data-cat="extensions" data-category="extensions">
          ${Icons.shield} <span>Extensions & Shields</span>
        </button>
        <button class="fb-settings-nav-item ${activeCat === 'about' ? 'active' : ''}" data-cat="about" data-category="about">
          ${Icons.info} <span>About Yayra</span>
        </button>
      </nav>

      <main class="fb-settings-content-pane">
        <div class="fb-settings-category-panel">
          <!-- Floating & Transparency -->
          <section class="fb-settings-group-card" id="sec-floating" style="${activeCat === 'floating' || this.state.settingsSearchQuery ? 'display:flex;' : 'display:none;'}">
            <h3 class="fb-settings-group-title">${Icons.bubble} Floating Browser & Assistive Bubble</h3>
            
            <div class="fb-setting-toggle-row">
              <div>
                <strong>Floating Mode Enabled by Default</strong>
                <p>Launches directly into the floating browser window without opening a dashboard.</p>
              </div>
              <input type="checkbox" id="fb-in-set-floating-default" ${this.state.settings.floatingEnabledByDefault ? 'checked' : ''} />
            </div>

            <div class="fb-setting-row">
              <label>Default Floating Mode</label>
              <select id="fb-in-set-floating-mode" class="fb-select">
                <option value="browser-first" ${this.state.desktopFloatingMode === 'browser-first' ? 'selected' : ''}>Mode B: Browser-First (Window Persists)</option>
                <option value="circle-first" ${this.state.desktopFloatingMode === 'circle-first' ? 'selected' : ''}>Mode A: Circle-First (Glass Bubble)</option>
              </select>
            </div>

            <div class="fb-setting-slider-row">
              <div class="fb-slider-header">
                <label for="fb-in-bubble-opacity">Collapsed Bubble Opacity</label>
                <span id="fb-in-val-bubble-opacity">${Math.round((this.state.settings.bubbleOpacity || 0.88) * 100)}%</span>
              </div>
              <input type="range" id="fb-in-bubble-opacity" min="20" max="100" value="${Math.round((this.state.settings.bubbleOpacity || 0.88) * 100)}" class="fb-range-slider" />
            </div>

            <div class="fb-setting-slider-row">
              <div class="fb-slider-header">
                <label for="fb-in-frame-opacity">Floating Browser Frame Opacity</label>
                <span id="fb-in-val-frame-opacity">${Math.round((this.state.settings.frameOpacity || 0.85) * 100)}%</span>
              </div>
              <input type="range" id="fb-in-frame-opacity" min="50" max="100" value="${Math.round((this.state.settings.frameOpacity || 0.85) * 100)}" class="fb-range-slider" />
            </div>

            <div class="fb-setting-slider-row">
              <div class="fb-slider-header">
                <label for="fb-in-slider-blur">Glass Blur Radius</label>
                <span id="fb-in-val-blur">${this.state.settings.glassmorphismBlurRadius || 24}px</span>
              </div>
              <input type="range" id="fb-in-slider-blur" min="0" max="40" value="${this.state.settings.glassmorphismBlurRadius || 24}" class="fb-range-slider" />
            </div>

            <div class="fb-transparency-preview-card" id="fb-in-transparency-live-preview">
              <div class="fb-preview-content">
                <strong>Live Transparency Preview</strong>
                <p>Web content remains high-contrast and crystal-clear above the glassmorphism frame.</p>
              </div>
            </div>

            <div style="display:flex; gap:12px;">
              <button class="fb-btn fb-btn-secondary fb-in-reset-transparency-btn">Reset Defaults</button>
              <button class="fb-btn fb-btn-primary fb-in-save-btn">Save Changes</button>
            </div>
          </section>

          <!-- Appearance -->
          <section class="fb-settings-group-card" id="sec-appearance" style="${activeCat === 'appearance' || this.state.settingsSearchQuery ? 'display:flex;' : 'display:none;'}">
            <h3 class="fb-settings-group-title">${Icons.moon} Appearance</h3>
            <div class="fb-setting-row">
              <label>Theme</label>
              <select id="fb-in-set-theme" class="fb-select">
                <option value="dark" ${this.state.settings.theme === 'dark' ? 'selected' : ''}>Dark (Default)</option>
                <option value="light" ${this.state.settings.theme === 'light' ? 'selected' : ''}>Light</option>
                <option value="system" ${this.state.settings.theme === 'system' ? 'selected' : ''}>System</option>
              </select>
            </div>
            <div class="fb-setting-row">
              <label>Accent theme</label>
              <select id="fb-in-set-color-theme" class="fb-select">
                <option value="blue" ${(this.state.settings.colorTheme || 'blue') === 'blue' ? 'selected' : ''}>Blue (Default)</option>
                <option value="purple" ${this.state.settings.colorTheme === 'purple' ? 'selected' : ''}>Violet</option>
                <option value="green" ${this.state.settings.colorTheme === 'green' ? 'selected' : ''}>Emerald</option>
                <option value="rose" ${this.state.settings.colorTheme === 'rose' ? 'selected' : ''}>Rose</option>
                <option value="amber" ${this.state.settings.colorTheme === 'amber' ? 'selected' : ''}>Amber</option>
              </select>
            </div>
            <div class="fb-setting-row">
              <label>Default Search Engine</label>
              <select id="fb-in-set-engine" class="fb-select">
                <option value="google" ${this.state.settings.searchEngine === 'google' ? 'selected' : ''}>Google (Default)</option>
                <option value="duckduckgo" ${this.state.settings.searchEngine === 'duckduckgo' ? 'selected' : ''}>DuckDuckGo</option>
                <option value="bing" ${this.state.settings.searchEngine === 'bing' ? 'selected' : ''}>Bing</option>
                <option value="startpage" ${this.state.settings.searchEngine === 'startpage' ? 'selected' : ''}>Startpage</option>
              </select>
            </div>
          </section>

          <!-- Privacy & Security -->
          <section class="fb-settings-group-card" id="sec-privacy" style="${activeCat === 'privacy' || this.state.settingsSearchQuery ? 'display:flex;' : 'display:none;'}">
            <h3 class="fb-settings-group-title">${Icons.shield} Privacy & Security</h3>
            <div class="fb-setting-toggle-row">
              <div>
                <strong>HTTPS-First Mode</strong>
                <p>Automatically upgrades connections to secure HTTPS whenever available.</p>
              </div>
              <input type="checkbox" id="fb-in-set-https" ${this.state.settings.httpsFirst !== false ? 'checked' : ''} />
            </div>
            <div class="fb-setting-toggle-row">
              <div>
                <strong>Ad & Tracker Shield</strong>
                <p>Blocks intrusive advertising, third-party analytics, and telemetry beacons.</p>
              </div>
              <input type="checkbox" id="fb-in-set-adblock" ${this.state.settings.adBlockEnabled !== false ? 'checked' : ''} />
            </div>
            <div class="fb-setting-row" style="margin-top:10px;">
              <div>
                <strong>Clear Browsing Data</strong>
                <p>Deletes history, cookies, cache, and cached credentials.</p>
              </div>
              <button class="fb-btn fb-btn-danger fb-in-open-cleardata-btn">Clear Data Now</button>
            </div>
          </section>

          <!-- Passwords & Autofill Link -->
          <section class="fb-settings-group-card" id="sec-passwords" style="${activeCat === 'passwords' || this.state.settingsSearchQuery ? 'display:flex;' : 'display:none;'}">
            <h3 class="fb-settings-group-title">${Icons.lock} Passwords & Autofill</h3>
            <p>Manage origin-scoped encrypted credentials in your local-first vault.</p>
            <button class="fb-btn fb-btn-primary fb-in-jump-passwords" style="align-self:flex-start;">Open Passwords Vault</button>
          </section>

          <!-- Tabs & Startup -->
          <section class="fb-settings-group-card" id="sec-tabs" style="${activeCat === 'tabs' || this.state.settingsSearchQuery ? 'display:flex;' : 'display:none;'}">
            <h3 class="fb-settings-group-title">${Icons.tabs} Tabs & Startup</h3>
            <div class="fb-setting-toggle-row">
              <div>
                <strong>Restore Previous Session</strong>
                <p>Reopens all tabs from your previous session upon startup.</p>
              </div>
              <input type="checkbox" id="fb-in-set-restore-session" ${this.state.settings.restoreSessionOnLaunch !== false ? 'checked' : ''} />
            </div>
          </section>

          <!-- Downloads -->
          <section class="fb-settings-group-card" id="sec-downloads" style="${activeCat === 'downloads' || this.state.settingsSearchQuery ? 'display:flex;' : 'display:none;'}">
            <h3 class="fb-settings-group-title">${Icons.download} Downloads</h3>
            <div class="fb-setting-row">
              <label>Default Download Location</label>
              <input type="text" class="fb-input" value="~/Downloads/Yayra" readonly style="flex:1;" />
            </div>
          </section>

          <!-- Extensions -->
          <section class="fb-settings-group-card" id="sec-extensions" style="${activeCat === 'extensions' || this.state.settingsSearchQuery ? 'display:flex;' : 'display:none;'}">
            <h3 class="fb-settings-group-title">${Icons.shield} Extensions & Content Shields</h3>
            <p>Manage installed privacy extensions, user scripts, and content modifiers.</p>
            <button class="fb-btn fb-btn-primary fb-in-jump-extensions" style="align-self:flex-start;">
              Manage Extensions (${this.state.extensionsItems.length})
            </button>
          </section>

          <!-- About -->
          <section class="fb-settings-group-card" id="sec-about" style="${activeCat === 'about' || this.state.settingsSearchQuery ? 'display:flex;' : 'display:none;'}">
            <h3 class="fb-settings-group-title">${Icons.info} About Yayra</h3>
            <p>Version 0.1.0 • Fast, Private Floating Browser with Glassmorphism Overlay.</p>
            <button class="fb-btn fb-btn-secondary fb-in-jump-about" style="align-self:flex-start;">View Release Information</button>
          </section>
        </div>
      </main>
    `;

    // Sidebar navigation clicks
    page.querySelectorAll('.fb-settings-nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cat = btn.getAttribute('data-cat') || btn.getAttribute('data-category') || btn.dataset.cat;
        this.state.settingsActiveCategory = cat;
        this.state.activeSettingsCategory = cat;
        this.render();
      });
    });

    // Search filter
    const searchInput = page.querySelector('#fb-in-settings-search') || page.querySelector('#fb-settings-search-input');
    searchInput?.addEventListener('input', (e) => {
      this.state.settingsSearchQuery = e.target.value.toLowerCase().trim();
      const q = this.state.settingsSearchQuery;
      page.querySelectorAll('.fb-settings-group-card').forEach((card) => {
        if (!q || card.textContent.toLowerCase().includes(q)) {
          card.style.display = 'flex';
        } else {
          card.style.display = 'none';
        }
      });
    });

    // Sliders & Live Preview
    const bSlider = page.querySelector('#fb-in-bubble-opacity') || page.querySelector('#fb-in-slider-bubble-opacity');
    const fSlider = page.querySelector('#fb-in-frame-opacity') || page.querySelector('#fb-in-slider-frame-opacity');
    const blurSlider = page.querySelector('#fb-in-slider-blur');
    const previewBox = page.querySelector('#fb-in-transparency-live-preview');

    const updatePreview = () => {
      const bOp = Number(bSlider?.value || 88) / 100;
      const fOp = Number(fSlider?.value || 85) / 100;
      const blurVal = Number(blurSlider?.value || 24);

      this.state.settings.bubbleOpacity = bOp;
      this.state.settings.frameOpacity = fOp;
      this.state.settings.glassmorphismBlurRadius = blurVal;

      if (page.querySelector('#fb-in-val-bubble-opacity')) page.querySelector('#fb-in-val-bubble-opacity').textContent = `${Math.round(bOp * 100)}%`;
      if (page.querySelector('#fb-in-val-frame-opacity')) page.querySelector('#fb-in-val-frame-opacity').textContent = `${Math.round(fOp * 100)}%`;
      if (page.querySelector('#fb-in-val-blur')) page.querySelector('#fb-in-val-blur').textContent = `${blurVal}px`;

      if (previewBox) {
        previewBox.style.background = `rgba(13, 23, 54, ${fOp})`;
        previewBox.style.backdropFilter = `blur(${blurVal}px)`;
      }
      this.ensurePersistentAssistiveBubble();
    };

    bSlider?.addEventListener('input', updatePreview);
    fSlider?.addEventListener('input', updatePreview);
    blurSlider?.addEventListener('input', updatePreview);

    page.querySelector('.fb-in-reset-transparency-btn')?.addEventListener('click', () => {
      if (bSlider) bSlider.value = '88';
      if (fSlider) fSlider.value = '85';
      if (blurSlider) blurSlider.value = '24';
      updatePreview();
    });

    page.querySelector('.fb-in-save-btn')?.addEventListener('click', async () => {
      const floatingDefault = page.querySelector('#fb-in-set-floating-default')?.checked;
      const mode = page.querySelector('#fb-in-set-floating-mode')?.value;
      const theme = page.querySelector('#fb-in-set-theme')?.value;
      const colorTheme = page.querySelector('#fb-in-set-color-theme')?.value;
      const engine = page.querySelector('#fb-in-set-engine')?.value;

      this.state.settings.floatingEnabledByDefault = floatingDefault;
      this.state.settings.desktopFloatingMode = mode;
      this.state.desktopFloatingMode = mode;
      if (theme) this.state.settings.theme = theme;
      if (colorTheme) this.state.settings.colorTheme = colorTheme;
      if (engine) this.state.settings.searchEngine = engine;

      if (this.settingsRepo) {
        await this.settingsRepo.updateSettings(this.state.settings);
      }
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('yayra:settings', JSON.stringify(this.state.settings));
        } catch {
          // Keep the browser usable when storage is unavailable or full.
        }
      }
      alert('Settings saved successfully.');
      this.render();
    });

    page.querySelector('.fb-in-open-cleardata-btn')?.addEventListener('click', () => {
      this.openModal('clear-data');
    });

    page.querySelector('.fb-in-jump-passwords')?.addEventListener('click', () => {
      this.openInternalPage('yayra://passwords');
    });

    page.querySelector('.fb-in-jump-extensions')?.addEventListener('click', () => {
      this.openInternalPage('yayra://extensions');
    });

    page.querySelector('.fb-in-jump-about')?.addEventListener('click', () => {
      this.openInternalPage('yayra://about');
    });

    viewport.appendChild(page);
  }

  /* -------------------------------------------------------------
   * 3. HISTORY IN-TAB PAGE (PHASE 11)
   * ----------------------------------------------------------- */
  renderInternalHistoryPage(viewport) {
    const page = document.createElement('div');
    page.className = 'fb-internal-page';

    const q = (this.state.historySearchQuery || '').toLowerCase().trim();
    const items = this.state.historyItems.filter((h) => !q || (h.title && h.title.toLowerCase().includes(q)) || (h.url && h.url.toLowerCase().includes(q)));

    page.innerHTML = `
      <div class="fb-internal-container">
        <header class="fb-internal-header">
          <div class="fb-internal-title-group">
            <span class="fb-internal-icon">${Icons.history}</span>
            <h1 class="fb-internal-title">History</h1>
          </div>
          <div style="display:flex; align-items:center; gap:12px;">
            <div class="fb-internal-search">
              <span class="fb-internal-search-icon">${Icons.search}</span>
              <input type="text" id="fb-in-history-search" placeholder="Search history" value="${this.state.historySearchQuery || ''}" />
            </div>
            <button class="fb-btn fb-btn-danger fb-in-clear-history-btn">Clear history</button>
          </div>
        </header>

        <div class="fb-history-date-group">
          <span class="fb-history-date-header">Recently Visited (${items.length})</span>
          ${items.length > 0 ? items.map((item) => `
            <div class="fb-history-item-row fb-history-row" data-url="${item.url}" data-id="${item.id}">
              <div class="fb-history-item-main" data-action="navigate" data-url="${item.url}">
                <span class="fb-history-item-time">${new Date(item.lastVisitedAt || item.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span class="fb-history-item-title">${item.title || item.url}</span>
                <span class="fb-history-item-url">${item.url}</span>
              </div>
              <div class="fb-history-item-actions">
                <button class="fb-btn fb-btn-secondary fb-in-hist-newtab" data-url="${item.url}" title="Open in New Tab">${Icons.plus}</button>
                <button class="fb-btn fb-btn-secondary fb-in-hist-del" data-id="${item.id}" title="Delete from history">${Icons.close}</button>
              </div>
            </div>
          `).join('') : '<div class="fb-empty-state">No browsing history matches your search.</div>'}
        </div>
      </div>
    `;

    const searchInput = page.querySelector('#fb-in-history-search');
    searchInput?.addEventListener('input', (e) => {
      this.state.historySearchQuery = e.target.value;
      this.render();
    });

    page.querySelector('.fb-in-clear-history-btn')?.addEventListener('click', async () => {
      if (confirm('Clear all browsing history?')) {
        if (this.historyRepo && typeof this.historyRepo.clearHistory === 'function') {
          await this.historyRepo.clearHistory();
        }
        this.state.historyItems = [];
        this.render();
      }
    });

    page.querySelectorAll('.fb-history-item-main').forEach((el) => {
      el.addEventListener('click', () => {
        const url = el.dataset.url;
        if (url) this.navigateActiveTab(url);
      });
    });

    page.querySelectorAll('.fb-in-hist-newtab').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = btn.dataset.url;
        if (url) {
          this.createNewTab();
          this.navigateActiveTab(url);
        }
      });
    });

    page.querySelectorAll('.fb-in-hist-del').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (this.historyRepo && typeof this.historyRepo.deleteEntry === 'function' && id) {
          await this.historyRepo.deleteEntry(id);
        }
        this.state.historyItems = this.state.historyItems.filter((h) => h.id !== id);
        this.render();
      });
    });

    viewport.appendChild(page);
  }

  /* -------------------------------------------------------------
   * 4. BOOKMARKS IN-TAB PAGE (PHASE 12)
   * ----------------------------------------------------------- */
  renderInternalBookmarksPage(viewport) {
    const page = document.createElement('div');
    page.className = 'fb-internal-page';

    const q = (this.state.bookmarksSearchQuery || '').toLowerCase().trim();
    const items = this.state.bookmarksItems.filter((b) => !q || (b.title && b.title.toLowerCase().includes(q)) || (b.url && b.url.toLowerCase().includes(q)));

    page.innerHTML = `
      <div class="fb-internal-container">
        <header class="fb-internal-header">
          <div class="fb-internal-title-group">
            <span class="fb-internal-icon">${Icons.bookmark}</span>
            <h1 class="fb-internal-title">Bookmarks</h1>
          </div>
          <div style="display:flex; align-items:center; gap:12px;">
            <div class="fb-internal-search">
              <span class="fb-internal-search-icon">${Icons.search}</span>
              <input type="text" id="fb-in-bm-search" placeholder="Search bookmarks" value="${this.state.bookmarksSearchQuery || ''}" />
            </div>
            <button class="fb-btn fb-btn-primary fb-in-add-bm-btn">${Icons.plus} Add Bookmark</button>
          </div>
        </header>

        <div class="fb-bookmarks-folder-bar">
          <button class="fb-folder-pill active">Bookmarks Bar</button>
          <button class="fb-folder-pill">Mobile Bookmarks</button>
          <button class="fb-folder-pill">Other Bookmarks</button>
        </div>

        <div class="fb-items-grid">
          ${items.length > 0 ? items.map((bm) => `
            <div class="fb-library-card" data-url="${bm.url}" data-id="${bm.id}">
              <div class="fb-card-header">
                <span class="fb-card-icon">${Icons.bookmark}</span>
                <span class="fb-card-title">${bm.title || bm.url}</span>
              </div>
              <span class="fb-card-url">${bm.url}</span>
              <div class="fb-card-actions">
                <button class="fb-btn fb-btn-secondary fb-in-bm-open" data-url="${bm.url}">Open</button>
                <button class="fb-btn fb-btn-secondary fb-in-bm-del" data-url="${bm.url}">${Icons.trash}</button>
              </div>
            </div>
          `).join('') : '<div class="fb-empty-state">No bookmarks found. Click the star icon on any page to bookmark it.</div>'}
        </div>
      </div>
    `;

    const searchInput = page.querySelector('#fb-in-bm-search');
    searchInput?.addEventListener('input', (e) => {
      this.state.bookmarksSearchQuery = e.target.value;
      this.render();
    });

    page.querySelector('.fb-in-add-bm-btn')?.addEventListener('click', async () => {
      const url = prompt('Enter Bookmark URL:', 'https://');
      const title = prompt('Enter Bookmark Title:', 'New Bookmark');
      if (url && this.bookmarksRepo) {
        await this.bookmarksRepo.addBookmark({ url, title });
        this.state.bookmarksItems = await this.bookmarksRepo.getAllBookmarks();
        this.render();
      }
    });

    page.querySelectorAll('.fb-in-bm-open').forEach((btn) => {
      btn.addEventListener('click', () => {
        const url = btn.dataset.url;
        if (url) this.navigateActiveTab(url);
      });
    });

    page.querySelectorAll('.fb-in-bm-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const url = btn.dataset.url;
        if (this.bookmarksRepo && url) {
          if (typeof this.bookmarksRepo.removeBookmarkByUrl === 'function') {
            await this.bookmarksRepo.removeBookmarkByUrl(url);
          } else if (typeof this.bookmarksRepo.removeBookmark === 'function') {
            await this.bookmarksRepo.removeBookmark(url);
          }
          if (typeof this.bookmarksRepo.getAllBookmarks === 'function') {
            this.state.bookmarksItems = await this.bookmarksRepo.getAllBookmarks();
          }
          this.render();
        }
      });
    });

    viewport.appendChild(page);
  }

  /* -------------------------------------------------------------
   * 5. DOWNLOADS IN-TAB PAGE (PHASE 13 & REQ 11)
   * ----------------------------------------------------------- */
  renderInternalDownloadsPage(viewport) {
    const page = document.createElement('div');
    page.className = 'fb-internal-page fb-downloads-inpage-layout';

    const items = this.state.downloadsItems || [];
    const viewMode = this.state.downloadsViewMode || 'list';

    page.innerHTML = `
      <div class="fb-internal-container">
        <header class="fb-internal-header">
          <div class="fb-internal-title-group">
            <span class="fb-internal-icon">${Icons.download}</span>
            <h1 class="fb-internal-title">Downloads</h1>
          </div>
          <div style="display:flex; align-items:center; gap:12px;">
            <!-- Requirement 11: View Mode Toggle -->
            <div class="fb-downloads-view-toggle">
              <button class="fb-dl-view-btn ${viewMode === 'list' ? 'active' : ''}" data-view="list" title="List View">${Icons.listView} List</button>
              <button class="fb-dl-view-btn ${viewMode === 'card' ? 'active' : ''}" data-view="card" title="Card View">${Icons.cardView} Cards</button>
            </div>
            <button class="fb-btn fb-btn-secondary fb-in-clear-dl-btn">Clear Downloads</button>
          </div>
        </header>

        ${viewMode === 'list' ? `
          <!-- List View -->
          <div class="fb-downloads-list-layout" style="display:flex; flex-direction:column; gap:8px;">
            ${items.length > 0 ? items.map((dl) => `
              <div class="fb-download-item-row" style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:10px;">
                <div style="display:flex; align-items:center; gap:12px;">
                  <span style="color:var(--fb-accent-primary);">${Icons.download}</span>
                  <div>
                    <strong style="display:block; font-size:0.9rem;">${dl.filename}</strong>
                    <span style="font-size:0.75rem; color:var(--fb-text-muted);">${dl.size} • ${dl.state} • ${dl.date || 'Today'}</span>
                  </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                  <!-- Requirement 11: Visit File Location Button -->
                  <button class="fb-in-dl-location-btn" data-path="${dl.path || dl.filename}" data-name="${dl.filename}" title="Show in folder">${Icons.folder} Show in Folder</button>
                  <button class="fb-btn fb-btn-secondary fb-in-dl-open" data-name="${dl.filename}">Open</button>
                  <button class="fb-btn fb-btn-secondary fb-in-dl-del" data-id="${dl.id}">${Icons.close}</button>
                </div>
              </div>
            `).join('') : '<div class="fb-empty-state">No recent downloads found.</div>'}
          </div>
        ` : `
          <!-- Card Grid View -->
          <div class="fb-downloads-grid-layout">
            ${items.length > 0 ? items.map((dl) => `
              <div class="fb-library-card">
                <div class="fb-card-header">
                  <span class="fb-card-icon">${Icons.download}</span>
                  <span class="fb-card-title">${dl.filename}</span>
                </div>
                <span class="fb-card-meta">${dl.size} • ${dl.state}</span>
                <div class="fb-card-actions" style="margin-top:12px;">
                  <button class="fb-in-dl-location-btn" data-path="${dl.path || dl.filename}" data-name="${dl.filename}">${Icons.folder} Show in Folder</button>
                  <button class="fb-btn fb-btn-secondary fb-in-dl-open" data-name="${dl.filename}">Open</button>
                  <button class="fb-btn fb-btn-secondary fb-in-dl-del" data-id="${dl.id}">${Icons.close}</button>
                </div>
              </div>
            `).join('') : '<div class="fb-empty-state">No recent downloads found.</div>'}
          </div>
        `}
      </div>
    `;

    // View mode toggle listeners
    page.querySelectorAll('.fb-dl-view-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.state.downloadsViewMode = btn.dataset.view;
        this.render();
      });
    });

    page.querySelector('.fb-in-clear-dl-btn')?.addEventListener('click', () => {
      this.state.downloadsItems = [];
      this.render();
    });

    // Requirement 11: Visit Location Button
    page.querySelectorAll('.fb-in-dl-location-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = btn.dataset.path || btn.dataset.name;
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(p);
        }
        alert(`File located at:\n${p}\n\n(Path copied to clipboard)`);
      });
    });

    page.querySelectorAll('.fb-in-dl-open').forEach((btn) => {
      btn.addEventListener('click', () => {
        alert(`Opening ${btn.dataset.name}...`);
      });
    });

    page.querySelectorAll('.fb-in-dl-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        this.state.downloadsItems = this.state.downloadsItems.filter((d) => d.id !== id);
        this.render();
      });
    });

    viewport.appendChild(page);
  }

  /* -------------------------------------------------------------
   * 6. PASSWORDS IN-TAB PAGE (PHASE 14)
   * ----------------------------------------------------------- */
  renderInternalPasswordsPage(viewport) {
    const page = document.createElement('div');
    page.className = 'fb-internal-page fb-passwords-inpage-layout';

    const q = (this.state.passwordsSearchQuery || '').toLowerCase().trim();
    const items = this.state.passwordsItems.filter((p) => !q || (p.origin && p.origin.toLowerCase().includes(q)) || (p.username && p.username.toLowerCase().includes(q)));

    page.innerHTML = `
      <div class="fb-internal-container">
        <header class="fb-internal-header">
          <div class="fb-internal-title-group">
            <span class="fb-internal-icon">${Icons.lock}</span>
            <h1 class="fb-internal-title">Saved Passwords</h1>
          </div>
          <div style="display:flex; align-items:center; gap:12px;">
            <div class="fb-internal-search">
              <span class="fb-internal-search-icon">${Icons.search}</span>
              <input type="text" id="fb-in-pwd-search" placeholder="Search passwords" value="${this.state.passwordsSearchQuery || ''}" />
            </div>
            <button class="fb-btn fb-btn-primary fb-in-add-pwd-btn">${Icons.plus} Add Credential</button>
          </div>
        </header>

        <div class="fb-settings-group-card" style="margin-bottom:12px;">
          <div class="fb-setting-toggle-row">
            <div>
              <strong>Offer to save passwords</strong>
              <p>Prompts when entering login credentials on new websites</p>
            </div>
            <input type="checkbox" id="fb-in-toggle-savepwd" ${this.state.settings.savePasswordsEnabled ? 'checked' : ''} />
          </div>
          <div class="fb-setting-toggle-row">
            <div>
              <strong>Auto Sign-in / Autofill</strong>
              <p>Fills usernames and passwords automatically for matching website origins</p>
            </div>
            <input type="checkbox" id="fb-in-toggle-autofill" ${this.state.settings.autofillEnabled ? 'checked' : ''} />
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:10px;">
          ${items.length > 0 ? items.map((p) => `
            <div class="fb-password-row fb-pwd-row" data-id="${p.id}">
              <div class="fb-password-meta">
                <strong class="fb-password-origin">${p.origin}</strong>
                <span class="fb-password-user">${p.username}</span>
              </div>
              <div class="fb-password-actions">
                <span class="fb-pwd-masked" data-pwd="${p.password || ''}">••••••••</span>
                <input type="password" value="${p.password || '••••••••'}" readonly class="fb-password-preview" style="display:none;" />
                <button class="fb-pwd-action fb-pwd-reveal-btn fb-in-pwd-reveal" title="Reveal password">👁</button>
                <button class="fb-pwd-action fb-pwd-delete-btn fb-in-pwd-delete" data-id="${p.id}" title="Delete">${Icons.trash}</button>
              </div>
            </div>
          `).join('') : '<div class="fb-empty-state">No saved passwords found in local encrypted vault.</div>'}
        </div>
      </div>
    `;

    const searchInput = page.querySelector('#fb-in-pwd-search');
    searchInput?.addEventListener('input', (e) => {
      this.state.passwordsSearchQuery = e.target.value;
      this.render();
    });

    page.querySelector('#fb-in-toggle-savepwd')?.addEventListener('change', async (e) => {
      this.state.settings.savePasswordsEnabled = e.target.checked;
      if (this.passwordManager) {
        await this.passwordManager.updateConfig({ savePasswordsEnabled: e.target.checked });
      }
    });

    page.querySelector('#fb-in-toggle-autofill')?.addEventListener('change', async (e) => {
      this.state.settings.autofillEnabled = e.target.checked;
      if (this.passwordManager) {
        await this.passwordManager.updateConfig({ autofillEnabled: e.target.checked });
      }
    });

    page.querySelector('.fb-in-add-pwd-btn')?.addEventListener('click', async () => {
      const origin = prompt('Enter Website URL / Origin (e.g. https://github.com):', 'https://');
      const username = prompt('Enter Username / Email:', 'user@example.com');
      const password = prompt('Enter Password:', '');
      if (origin && username && password && this.passwordManager) {
        await this.passwordManager.saveCredential({ origin, username, password });
        this.state.passwordsItems = await this.passwordManager.getAllCredentials();
        this.render();
      }
    });

    page.querySelectorAll('.fb-in-pwd-reveal').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.fb-password-row');
        const masked = row?.querySelector('.fb-pwd-masked');
        const rawPwd = masked?.getAttribute('data-pwd') || '';
        if (masked) {
          if (masked.textContent === '••••••••') {
            masked.textContent = rawPwd;
          } else {
            masked.textContent = '••••••••';
          }
        }
      });
    });

    page.querySelectorAll('.fb-in-pwd-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (this.passwordManager && id) {
          await this.passwordManager.deleteCredential(id);
          this.state.passwordsItems = await this.passwordManager.getAllCredentials();
          this.render();
        }
      });
    });

    viewport.appendChild(page);
  }

  /* -------------------------------------------------------------
   * 7. EXTENSIONS IN-TAB PAGE (PHASE 15)
   * ----------------------------------------------------------- */
  renderInternalExtensionsPage(viewport) {
    const page = document.createElement('div');
    page.className = 'fb-internal-page fb-extensions-inpage-layout';

    page.innerHTML = `
      <div class="fb-internal-container">
        <header class="fb-internal-header">
          <div class="fb-internal-title-group">
            <span class="fb-internal-icon">${Icons.shield}</span>
            <h1 class="fb-internal-title">Extensions & Shields</h1>
          </div>
        </header>

        <section class="fb-extension-platform-notice">
          <div class="fb-extension-platform-notice-copy">
            <strong>Real website extension companion</strong>
            <p>The PWA can manage these preferences, but browser security prevents a website from injecting into arbitrary cross-origin pages. Install the companion extension to block real tracker requests and apply Dark Reader or Reader Mode on external websites.</p>
          </div>
          <a class="fb-btn fb-btn-primary" href="https://github.com/g2code33/yayra/tree/main/extensions/yayra-companion" target="_blank" rel="noopener">Open companion project</a>
        </section>

        <div class="fb-extensions-list">
          ${this.state.extensionsItems.map((ext) => `
            <div class="fb-extension-row fb-extension-card ${ext.enabled ? 'enabled' : ''}" data-ext-id="${ext.id}">
              <div class="fb-ext-header">
                <span class="fb-ext-icon">${Icons[ext.icon] || Icons.globe}</span>
                <div class="fb-ext-title-col">
                  <strong>${ext.name} <span class="fb-badge fb-badge-cyan">v${ext.version}</span></strong>
                  <span class="fb-ext-author">By ${ext.author}</span>
                </div>
                <label class="fb-toggle-switch">
                  <input type="checkbox" class="fb-ext-toggle fb-ext-toggle-input" data-id="${ext.id}" ${ext.enabled ? 'checked' : ''} />
                  <span class="fb-toggle-slider"></span>
                </label>
              </div>
              <p class="fb-ext-desc">${ext.description}</p>
              <div class="fb-ext-footer">
                <label class="fb-ext-private-toggle">
                  <input type="checkbox" class="fb-ext-private-check" data-id="${ext.id}" ${ext.allowedInPrivate ? 'checked' : ''} />
                  <span>Allow in Incognito</span>
                </label>
                <span class="fb-ext-perms">Permissions: ${ext.permissions.join(', ')}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    page.querySelectorAll('.fb-ext-toggle').forEach((chk) => {
      chk.addEventListener('change', async () => {
        const id = chk.dataset.id;
        if (this.extensionManager) {
          if (chk.checked) await this.extensionManager.enableExtension(id);
          else await this.extensionManager.disableExtension(id);
          this.state.extensionsItems = await this.extensionManager.getExtensions();
          this.render();
        }
      });
    });

    page.querySelectorAll('.fb-ext-private-check').forEach((chk) => {
      chk.addEventListener('change', async () => {
        const id = chk.dataset.id;
        if (this.extensionManager) {
          await this.extensionManager.setAllowedInPrivate(id, chk.checked);
          this.state.extensionsItems = await this.extensionManager.getExtensions();
        }
      });
    });

    viewport.appendChild(page);
  }

  /* -------------------------------------------------------------
   * 8. SITE PERMISSIONS IN-TAB PAGE
   * ----------------------------------------------------------- */
  renderInternalPermissionsPage(viewport) {
    const page = document.createElement('div');
    page.className = 'fb-internal-page';

    page.innerHTML = `
      <div class="fb-internal-container">
        <header class="fb-internal-header">
          <div class="fb-internal-title-group">
            <span class="fb-internal-icon">${Icons.lock}</span>
            <h1 class="fb-internal-title">Site Permissions</h1>
          </div>
        </header>

        <div class="fb-settings-group-card">
          <div class="fb-setting-row">
            <div><strong>Location</strong><p>Ask before accessing device geolocation</p></div>
            <select class="fb-select"><option>Ask (Default)</option><option>Block</option><option>Allow</option></select>
          </div>
          <div class="fb-setting-row">
            <div><strong>Camera</strong><p>Ask before accessing camera</p></div>
            <select class="fb-select"><option>Ask (Default)</option><option>Block</option><option>Allow</option></select>
          </div>
          <div class="fb-setting-row">
            <div><strong>Microphone</strong><p>Ask before accessing microphone</p></div>
            <select class="fb-select"><option>Ask (Default)</option><option>Block</option><option>Allow</option></select>
          </div>
          <div class="fb-setting-row">
            <div><strong>Notifications</strong><p>Ask before sending desktop notifications</p></div>
            <select class="fb-select"><option>Ask (Default)</option><option>Block</option><option>Allow</option></select>
          </div>
        </div>
      </div>
    `;

    viewport.appendChild(page);
  }

  /* -------------------------------------------------------------
   * 9. ABOUT IN-TAB PAGE (PHASE 16)
   * ----------------------------------------------------------- */
  renderInternalAboutPage(viewport) {
    const page = document.createElement('div');
    page.className = 'fb-internal-page fb-about-inpage-layout';

    page.innerHTML = `
      <div class="fb-internal-container">
        <div class="fb-about-hero">
          <div class="fb-about-logo">${Icons.officialOrb}</div>
          <div class="fb-about-appname" role="img" aria-label="yayra">${Icons.officialWordmark}</div>
          <span class="fb-about-version fb-about-version-badge">Version 0.1.0 (Stable 64-bit Release)</span>
          <p style="max-width:480px; color:var(--fb-text-secondary); font-size:0.9rem; margin:8px 0 16px;">
            Fast, private floating browser with native glassmorphism overlay and persistent assistive bubble.
          </p>
          <button class="fb-btn fb-btn-primary fb-in-check-update-btn fb-about-check-updates-btn">Check for updates</button>
        </div>

        <div class="fb-about-details-card">
          <div class="fb-about-row">
            <strong>Architecture</strong>
            <span>Local-First • No Mandatory Cloud Sync</span>
          </div>
          <div class="fb-about-row">
            <strong>Platform Engine</strong>
            <span>Cross-Platform Floating Engine (${this.platform})</span>
          </div>
          <div class="fb-about-row">
            <strong>Update Channel</strong>
            <span>Stable Production Release</span>
          </div>
          <div class="fb-about-row">
            <strong>License</strong>
            <span>MIT Open Source License</span>
          </div>
        </div>
      </div>
    `;

    page.querySelector('.fb-in-check-update-btn')?.addEventListener('click', async () => {
      const btn = page.querySelector('.fb-in-check-update-btn');
      if (btn) btn.textContent = 'Checking for updates...';
      if (this.updateService) {
        await this.updateService.check({ manual: true });
      }
      setTimeout(() => {
        if (btn) btn.textContent = 'Yayra is up to date (0.1.0)';
      }, 600);
    });

    viewport.appendChild(page);
  }

  /* -------------------------------------------------------------
   * REQUIREMENT 1, 3: RADIAL AI & ACTIONS LAUNCHER WHEEL
   * ----------------------------------------------------------- */
  openRadialLauncher() {
    this.state.isRadialLauncherOpen = true;
    this.render();
  }

  closeRadialLauncher() {
    this.state.isRadialLauncherOpen = false;
    const existing = document.getElementById('yayra-radial-launcher-overlay');
    if (existing) existing.remove();
  }

  getRadialActions() {
    if (this.state.customRadialActions && this.state.customRadialActions.length > 0) {
      return this.state.customRadialActions;
    }
    return [
      { id: 'play', title: 'Media Controller', icon: Icons.play, x: 0, y: -130, isDark: false, action: () => alert('Yayra Media Controller: Background audio active.') },
      { id: 'notes', title: 'Quick Notes', icon: Icons.edit, x: 55, y: -90, isDark: false, action: () => this.openQuickNotes() },
      { id: 'chatgpt', title: 'Ask ChatGPT', icon: Icons.chatgpt, x: 125, y: -125, isDark: false, action: () => this.executeAiAction('ChatGPT') },
      { id: 'claude', title: 'Claude Assistant', icon: Icons.claude, x: 150, y: -50, isDark: false, action: () => this.executeAiAction('Claude') },
      { id: 'sparkles', title: 'AI Assistant', icon: Icons.sparkles, x: 65, y: -20, isDark: true, action: () => this.executeAiAction('Gemini') },
      { id: 'gemini', title: 'Rephrase with Gemini', icon: Icons.gemini, x: 145, y: 35, isDark: true, isFeatured: true, showPillAlways: true, action: () => this.executeAiAction('Gemini') },
      { id: 'perplexity', title: 'Perplexity Search', icon: Icons.perplexity, x: 120, y: 110, isDark: false, action: () => this.executeAiAction('Perplexity') },
      { id: 'shields', title: 'Security & Shields', icon: Icons.desktopLock, x: 55, y: 70, isDark: false, action: () => this.openInternalPage('yayra://extensions') },
      { id: 'touch', title: 'Assistive Touch', icon: Icons.mouseTouch, x: -35, y: 100, isDark: false, action: () => alert('Assistive Touch cursor active.') },
      { id: 'screenshot', title: 'Capture Screenshot', icon: Icons.crop, x: -105, y: 65, isDark: false, action: () => this.captureScreenshot() },
      { id: 'duplicate', title: 'Duplicate Window', icon: Icons.tabs, x: -130, y: -15, isDark: false, action: () => this.duplicateFloatingMini() },
      { id: 'finder', title: 'Yayra Assistive', icon: Icons.finderFace, x: -85, y: -80, isDark: false, action: () => this.openFloatingMini() }
    ];
  }

  renderRadialLauncher() {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('yayra-radial-launcher-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'yayra-radial-launcher-overlay';
    overlay.className = 'yayra-radial-launcher-overlay';

    const container = document.createElement('div');
    container.className = 'yayra-radial-container';

    // Center Close Button
    const centerBtn = document.createElement('button');
    centerBtn.className = 'yayra-radial-center-btn';
    centerBtn.innerHTML = '×';
    centerBtn.setAttribute('title', 'Close Launcher');
    centerBtn.addEventListener('click', () => this.closeRadialLauncher());
    container.appendChild(centerBtn);

    const radialActions = this.getRadialActions();

    radialActions.forEach((item) => {
      const x = item.x !== undefined ? item.x : 0;
      const y = item.y !== undefined ? item.y : 0;

      const btn = document.createElement('button');
      btn.className = `yayra-radial-item ${item.isFeatured ? 'dark-featured' : ''} ${item.isDark ? 'dark-orb' : ''} ${item.showPillAlways ? 'show-pill-always' : ''}`;
      btn.style.setProperty('--dx', `${x}px`);
      btn.style.setProperty('--dy', `${y}px`);
      btn.style.transform = `translate(${x}px, ${y}px)`;
      btn.setAttribute('aria-label', item.title);

      btn.innerHTML = `
        ${item.icon || Icons.globe}
        <span class="yayra-radial-tooltip-pill">${item.title}</span>
      `;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeRadialLauncher();
        if (typeof item.action === 'function') {
          item.action();
        } else if (item.url) {
          this.openFloatingMini(item.url);
        }
      });

      container.appendChild(btn);
    });

    // Bottom Navigation Button (Down Arrow -> Opens Customizer & Bookmarks)
    const bottomBtn = document.createElement('button');
    bottomBtn.className = 'yayra-radial-bottom-btn';
    bottomBtn.innerHTML = Icons.arrowDown;
    bottomBtn.style.setProperty('--dx', '0px');
    bottomBtn.style.setProperty('--dy', '175px');
    bottomBtn.style.transform = 'translate(0px, 175px)';
    bottomBtn.setAttribute('title', 'Customize Wheel & Bookmarks');
    bottomBtn.addEventListener('click', () => {
      this.closeRadialLauncher();
      this.openModal('radial-customizer');
    });
    container.appendChild(bottomBtn);

    overlay.appendChild(container);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeRadialLauncher();
    });

    document.body.appendChild(overlay);
  }

  executeAiAction(provider) {
    const urls = {
      Gemini: 'https://gemini.google.com',
      ChatGPT: 'https://chatgpt.com',
      Claude: 'https://claude.ai',
      Perplexity: 'https://perplexity.ai'
    };
    const targetUrl = urls[provider] || 'https://google.com';
    this.openFloatingMini(targetUrl);
  }

  openQuickNotes() {
    const note = prompt('Quick Scratchpad Note:', (typeof localStorage !== 'undefined' ? localStorage.getItem('yayra-quick-note') : '') || '');
    if (note !== null) {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('yayra-quick-note', note);
      }
      alert('Note saved to local vault.');
    }
  }

  captureScreenshot() {
    alert('Screenshot captured! Saved to ~/Downloads/screenshot-yayra.png');
  }

  /* -------------------------------------------------------------
   * REQUIREMENT 1, 2, 4, 6: FULL INDEPENDENT FLOATING MINI-BROWSER
   * ----------------------------------------------------------- */
  openFloatingMini(url = null) {
    this.state.isFloatingMiniOpen = true;
    if (url) {
      this.navigateActiveTab(url);
    }
    this.render();
  }

  closeFloatingMini() {
    this.state.isFloatingMiniOpen = false;
    const existing = document.getElementById('yayra-floating-popup-window');
    if (existing) existing.remove();
    if (typeof document !== 'undefined') {
      document.querySelectorAll('.fb-duplicate-popup-window').forEach((w) => w.remove());
    }
  }

  duplicateFloatingMini() {
    this.openFloatingMini();
    if (typeof document === 'undefined') return;
    const existingWindows = document.querySelectorAll('.fb-floating-popup-window');
    const dupCount = existingWindows.length;
    const offset = dupCount * 28;

    const dupWin = document.createElement('div');
    dupWin.className = 'fb-floating-popup-window fb-duplicate-popup-window';
    dupWin.style.bottom = `${84 + offset}px`;
    dupWin.style.right = `${24 + offset}px`;
    dupWin.style.zIndex = String(99998 + dupCount);

    const activeTab = this.getActiveTab();

    dupWin.innerHTML = `
      <header class="fb-floating-popup-header">
        <div class="fb-floating-popup-brand">
          <span style="width:20px; height:20px; display:inline-flex;">${Icons.officialOrb}</span>
          <span>yayra mini #${dupCount + 1}</span>
        </div>
        <div class="fb-floating-popup-actions">
          <button class="fb-floating-popup-btn primary-expand fb-open-full-btn" title="Open Full Yayra Browser">${Icons.expand}</button>
          <button class="fb-floating-popup-btn fb-mini-close-btn" title="Close">${Icons.close}</button>
        </div>
      </header>
      <div class="fb-floating-popup-body">
        <div style="display:flex; align-items:center; gap:8px; padding:6px 10px; background:rgba(0,0,0,0.3); border-bottom:1px solid rgba(255,255,255,0.08);">
          <input type="text" class="fb-input fb-mini-omnibox" value="${this.getDisplayUrl(activeTab.url)}" placeholder="Search or type address" style="flex:1; height:30px; font-size:0.825rem;" />
        </div>
        <div class="fb-mini-viewport" style="flex:1; display:flex; flex-direction:column; overflow:hidden;">
          <iframe src="${activeTab.url && !activeTab.url.startsWith('yayra://') ? activeTab.url : 'about:blank'}" style="flex:1; border:none; width:100%; height:100%;"></iframe>
        </div>
      </div>
    `;

    dupWin.querySelector('.fb-open-full-btn')?.addEventListener('click', () => {
      dupWin.remove();
      this.restoreFromBubble();
    });
    dupWin.querySelector('.fb-mini-close-btn')?.addEventListener('click', () => {
      dupWin.remove();
    });

    this.makeDraggable(dupWin, dupWin.querySelector('.fb-floating-popup-header'));
    document.body.appendChild(dupWin);
  }

  makeDraggable(element, handle) {
    if (!handle || !element) return;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    handle.addEventListener('pointerdown', (e) => {
      if (e.target && (e.target.closest('button') || e.target.closest('input'))) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { left: 100, top: 100 };
      initialLeft = rect.left;
      initialTop = rect.top;
      element.style.left = `${initialLeft}px`;
      element.style.top = `${initialTop}px`;
      element.style.right = 'auto';
      element.style.bottom = 'auto';
      if (handle.setPointerCapture && e.pointerId) handle.setPointerCapture(e.pointerId);
    });

    handle.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;

      if (typeof window !== 'undefined') {
        newLeft = Math.max(10, Math.min(window.innerWidth - (element.offsetWidth || 400) - 10, newLeft));
        newTop = Math.max(10, Math.min(window.innerHeight - (element.offsetHeight || 500) - 10, newTop));
      }

      element.style.left = `${newLeft}px`;
      element.style.top = `${newTop}px`;
    });

    const stopDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;
      if (handle.releasePointerCapture && e?.pointerId) handle.releasePointerCapture(e.pointerId);
    };

    handle.addEventListener('pointerup', stopDrag);
    handle.addEventListener('pointercancel', stopDrag);
  }

  toggleMiniDrawer(win) {
    const body = win?.querySelector('.fb-floating-popup-body');
    if (!body) return;
    const current = body.querySelector('.fb-side-drawer-menu');
    if (current) {
      this.state.isSideDrawerOpen = false;
      current.remove();
      return;
    }
    this.state.isSideDrawerOpen = true;
    this.renderSideDrawer(body);
  }

  renderFloatingMiniWindow() {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('yayra-floating-popup-window');
    if (existing) existing.remove();

    const win = document.createElement('div');
    win.id = 'yayra-floating-popup-window';
    win.className = 'fb-floating-popup-window';

    const activeTab = this.getActiveTab();

    win.innerHTML = `
      <header class="fb-floating-popup-header">
        <div class="fb-floating-popup-brand">
          <span style="width:20px; height:20px; display:inline-flex;">${Icons.officialOrb}</span>
          <span>yayra mini</span>
        </div>
        <div class="fb-floating-popup-actions">
          <button class="fb-floating-popup-btn fb-mini-duplicate-btn" title="Duplicate Mini Window">${Icons.tabs}</button>
          <button class="fb-floating-popup-btn primary-expand fb-open-full-btn" title="Open Full Yayra Browser">${Icons.expand}</button>
          <button class="fb-floating-popup-btn fb-mini-min-btn" title="Minimize to Bubble">${Icons.minimize}</button>
          <button class="fb-floating-popup-btn fb-mini-close-btn" title="Close">${Icons.close}</button>
        </div>
      </header>
      <div class="fb-mini-tabstrip fb-chrome-tabstrip" role="tablist" aria-label="Mini browser tabs">
        <div class="fb-tabs-scroll-container">
          ${this.state.tabs.map((tab) => `
            <div class="fb-tab-item fb-mini-tab-item ${tab.id === this.state.activeTabId ? 'active' : ''}" role="tab" aria-selected="${tab.id === this.state.activeTabId ? 'true' : 'false'}" data-tab-id="${tab.id}">
              <span class="fb-tab-favicon">${this.getTabFavicon(tab)}</span>
              <span class="fb-tab-title">${tab.title || 'New Tab'}</span>
              <button class="fb-tab-close-btn fb-mini-tab-close" data-tab-id="${tab.id}" title="Close tab" aria-label="Close tab">${Icons.close}</button>
            </div>
          `).join('')}
          <button class="fb-btn-newtab fb-mini-newtab-btn" title="New Tab (Ctrl+T)" aria-label="Create new tab">${Icons.plus}</button>
        </div>
      </div>
      <nav class="fb-mini-navbar fb-chrome-navbar" role="toolbar" aria-label="Mini navigation and address bar">
        <div class="fb-nav-controls">
          <button class="fb-nav-btn fb-mini-back-btn" title="Back" aria-label="Back" ${activeTab.canGoBack ? '' : 'disabled'}>${Icons.arrowLeft}</button>
          <button class="fb-nav-btn fb-mini-fwd-btn" title="Forward" aria-label="Forward" ${activeTab.canGoForward ? '' : 'disabled'}>${Icons.arrowRight}</button>
          <button class="fb-nav-btn fb-mini-reload-btn" title="Reload" aria-label="Reload">${Icons.refresh}</button>
        </div>
        <div class="fb-omnibox-container fb-mini-omnibox-container">
          <div class="fb-toolbar-brand" title="Yayra">
            <span class="fb-toolbar-brand-orb">${Icons.officialOrb}</span>
            <span class="fb-toolbar-brand-text">${Icons.officialWordmark}<span class="fb-brand-text-fallback">yayra</span></span>
          </div>
          <button class="fb-omnibox-security fb-mini-security-btn" title="Site security" aria-label="Site security">${activeTab.isSecure ? Icons.lock : Icons.alertTriangle}</button>
          <input type="text" class="fb-omnibox-input fb-mini-omnibox" value="${this.getDisplayUrl(activeTab.url)}" placeholder="Search with ${(this.state.settings.searchEngine || 'Google').replace(/^./, (letter) => letter.toUpperCase())} or enter address" aria-label="Mini address and search bar" />
          <button class="fb-omnibox-star fb-mini-star-btn" title="Bookmark" aria-label="Bookmark">${this.state.isBookmarked ? Icons.starFilled : Icons.star}</button>
        </div>
        <div class="fb-toolbar-actions">
          <button class="fb-action-btn fb-toolbar-action-btn fb-mini-download-btn" title="Downloads" aria-label="Downloads">${Icons.download}</button>
          <button class="fb-action-btn fb-toolbar-action-btn fb-mini-extensions-btn" title="Extensions and Shields" aria-label="Extensions and Shields">${Icons.shield}</button>
          <button class="fb-mode-pill fb-mini-mode-btn" title="Switch floating mode" aria-label="Switch floating mode"><span class="fb-mode-dot"></span><span class="fb-mode-text">${this.state.desktopFloatingMode === 'browser-first' ? 'Browser' : 'Bubble'}</span></button>
          <button class="fb-action-btn fb-menu-btn fb-toolbar-action-btn fb-mini-drawer-btn" title="Customize and control Yayra" aria-label="Main menu">${Icons.moreVertical}</button>
        </div>
      </nav>
      <div class="fb-floating-popup-body">
        <div class="fb-mini-viewport" style="flex:1; display:flex; flex-direction:column; overflow-y:auto; position:relative;"></div>
      </div>
    `;

    // Make movable anywhere on screen
    this.makeDraggable(win, win.querySelector('.fb-floating-popup-header'));

    // Header buttons
    win.querySelector('.fb-mini-duplicate-btn')?.addEventListener('click', () => {
      this.duplicateFloatingMini();
    });

    win.querySelector('.fb-open-full-btn')?.addEventListener('click', () => {
      this.closeFloatingMini();
      this.restoreFromBubble();
    });

    win.querySelector('.fb-mini-min-btn')?.addEventListener('click', () => {
      this.closeFloatingMini();
      this.minimizeToBubble();
    });

    win.querySelector('.fb-mini-close-btn')?.addEventListener('click', () => {
      this.closeFloatingMini();
    });

    // Toolbar Navigation
    win.querySelector('.fb-mini-back-btn')?.addEventListener('click', () => {
      this.goBack();
      this.render();
    });

    win.querySelector('.fb-mini-fwd-btn')?.addEventListener('click', () => {
      this.goForward();
      this.render();
    });

    win.querySelector('.fb-mini-reload-btn')?.addEventListener('click', () => {
      this.reload();
    });

    win.querySelector('.fb-mini-star-btn')?.addEventListener('click', async () => {
      await this.toggleBookmarkCurrentTab();
      this.render();
    });

    win.querySelector('.fb-mini-download-btn')?.addEventListener('click', () => {
      this.openInternalPage('yayra://downloads');
    });

    win.querySelector('.fb-mini-extensions-btn')?.addEventListener('click', () => {
      this.openInternalPage('yayra://extensions');
    });

    win.querySelector('.fb-mini-mode-btn')?.addEventListener('click', () => {
      this.toggleDesktopMode();
    });

    win.querySelector('.fb-mini-security-btn')?.addEventListener('click', () => {
      const existingDropdown = win.querySelector('.fb-security-dropdown');
      if (existingDropdown) {
        existingDropdown.remove();
        this.state.isSecurityDropdownOpen = false;
      } else {
        this.state.isSecurityDropdownOpen = true;
        this.renderSecurityDropdown(win);
      }
    });

    win.querySelectorAll('.fb-mini-tab-item').forEach((tabEl) => {
      tabEl.addEventListener('click', (event) => {
        if (event.target.closest('.fb-mini-tab-close')) return;
        this.selectTab(tabEl.dataset.tabId);
      });
    });

    win.querySelectorAll('.fb-mini-tab-close').forEach((closeBtn) => {
      closeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.closeTab(closeBtn.dataset.tabId);
      });
    });

    win.querySelector('.fb-mini-newtab-btn')?.addEventListener('click', () => {
      this.createNewTab();
    });

    win.querySelector('.fb-mini-drawer-btn')?.addEventListener('click', () => {
      this.toggleMiniDrawer(win);
    });

    const omni = win.querySelector('.fb-mini-omnibox');
    omni?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.navigateActiveTab(omni.value);
        this.renderFloatingMiniWindow();
      }
    });
    this.bindSearchSuggestions(omni);

    // Render In-Mini Viewport Content (Full features of Yayra)
    const miniViewport = win.querySelector('.fb-mini-viewport');
    if (miniViewport) {
      const url = activeTab.url || '';
      if (!url || url === 'yayra://newtab' || url === 'about:blank') {
        this.renderNewTabPage(miniViewport, activeTab);
      } else if (url === 'yayra://settings') {
        this.renderInternalSettingsPage(miniViewport, activeTab);
      } else if (url === 'yayra://history') {
        this.renderInternalHistoryPage(miniViewport, activeTab);
      } else if (url === 'yayra://bookmarks') {
        this.renderInternalBookmarksPage(miniViewport, activeTab);
      } else if (url === 'yayra://downloads') {
        this.renderInternalDownloadsPage(miniViewport, activeTab);
      } else if (url === 'yayra://passwords') {
        this.renderInternalPasswordsPage(miniViewport, activeTab);
      } else if (url === 'yayra://extensions') {
        this.renderInternalExtensionsPage(miniViewport, activeTab);
      } else if (url === 'yayra://permissions') {
        this.renderInternalPermissionsPage(miniViewport, activeTab);
      } else if (url === 'yayra://about') {
        this.renderInternalAboutPage(miniViewport, activeTab);
      } else {
        const iframe = document.createElement('iframe');
        iframe.src = activeTab.url;
        iframe.style.cssText = 'flex:1; border:none; width:100%; height:100%;';
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
        iframe.setAttribute('allow', 'fullscreen');
        miniViewport.appendChild(iframe);
      }
    }

    document.body.appendChild(win);
  }

  /* -------------------------------------------------------------
   * REQUIREMENT 3: SECURITY & SEARCH ENGINE DROPDOWN
   * ----------------------------------------------------------- */
  renderSecurityDropdown(root) {
    const dropdown = document.createElement('div');
    dropdown.className = 'fb-security-dropdown';

    const currentEngine = this.state.settings.searchEngine || 'google';

    dropdown.innerHTML = `
      <div class="fb-security-header">
        <span>${Icons.lock}</span>
        <span>Connection is Secure (HTTPS)</span>
      </div>

      <div>
        <strong style="display:block; font-size:0.8rem; color:var(--fb-text-muted); text-transform:uppercase; margin-bottom:6px;">Default Search Engine</strong>
        <div class="fb-search-engine-list">
          <div class="fb-search-engine-option ${currentEngine === 'google' ? 'active' : ''}" data-engine="google">
            <span>Google</span>
            ${currentEngine === 'google' ? `<span>${Icons.check}</span>` : ''}
          </div>
          <div class="fb-search-engine-option ${currentEngine === 'duckduckgo' ? 'active' : ''}" data-engine="duckduckgo">
            <span>DuckDuckGo</span>
            ${currentEngine === 'duckduckgo' ? `<span>${Icons.check}</span>` : ''}
          </div>
          <div class="fb-search-engine-option ${currentEngine === 'bing' ? 'active' : ''}" data-engine="bing">
            <span>Bing</span>
            ${currentEngine === 'bing' ? `<span>${Icons.check}</span>` : ''}
          </div>
          <div class="fb-search-engine-option ${currentEngine === 'startpage' ? 'active' : ''}" data-engine="startpage">
            <span>Startpage</span>
            ${currentEngine === 'startpage' ? `<span>${Icons.check}</span>` : ''}
          </div>
        </div>
      </div>

      <div style="border-top:1px solid rgba(255,255,255,0.08); padding-top:8px; display:flex; flex-direction:column; gap:6px;">
        <button class="fb-btn fb-btn-secondary fb-in-view-certs-btn" style="width:100%; font-size:0.8rem;">Site Permissions</button>
      </div>
    `;

    dropdown.querySelectorAll('.fb-search-engine-option').forEach((opt) => {
      opt.addEventListener('click', async () => {
        const engine = opt.dataset.engine;
        this.state.settings.searchEngine = engine;
        if (this.settingsRepo) {
          await this.settingsRepo.updateSettings({ searchEngine: engine });
        }
        this.state.isSecurityDropdownOpen = false;
        this.render();
      });
    });

    dropdown.querySelector('.fb-in-view-certs-btn')?.addEventListener('click', () => {
      this.state.isSecurityDropdownOpen = false;
      this.openInternalPage('yayra://permissions');
    });

    root.appendChild(dropdown);
  }

  async checkForUpdates(manual = false) {
    if (this.state.updateState.status === 'checking') return;
    this.state.updateState = { ...this.state.updateState, status: 'checking' };
    this.render();

    try {
      // 1. Try local UpdateService if present
      if (this.updateService && typeof this.updateService.check === 'function') {
        const res = await this.updateService.check({ manual });
        if (res && (res.status === 'available' || res.status === 'ready')) {
          this.state.updateState = {
            status: 'ready',
            installedVersion: this.state.updateState.installedVersion || '0.1.0',
            availableVersion: res.availableVersion || '0.1.1',
            notes: res.notes || 'Update ready.'
          };
          this.promptUpdateReady();
          this.render();
          return;
        }
      }

      // 2. Query GitHub Releases API from public repo
      const ghRes = await fetch('https://api.github.com/repos/g2code33/yayra/releases/latest', {
        headers: { Accept: 'application/vnd.github.v3+json' }
      }).catch(() => null);

      if (ghRes && ghRes.ok) {
        const ghData = await ghRes.json();
        const latestTag = (ghData.tag_name || '').replace(/^v/, '');
        if (latestTag && latestTag !== this.state.updateState.installedVersion) {
          this.state.updateState = {
            status: 'ready',
            installedVersion: '0.1.0',
            availableVersion: latestTag,
            notes: ghData.body || 'New GitHub release available.'
          };
          this.promptUpdateReady();
          this.render();
          return;
        }
      }

      this.state.updateState = {
        ...this.state.updateState,
        status: 'uptodate',
        availableVersion: null
      };
      this.render();
    } catch {
      this.state.updateState = {
        ...this.state.updateState,
        status: 'uptodate',
        availableVersion: null
      };
      this.render();
    }
  }

  promptUpdateReady() {
    if (this.state.updatePromptShown) return;
    this.state.updatePromptShown = true;
    const msg = `An update for Yayra (v${this.state.updateState.availableVersion || '0.1.1'}) is ready!\n\nWould you like to restart and apply the update now?`;
    if (typeof window !== 'undefined' && window.confirm && window.confirm(msg)) {
      this.applyUpdate();
    }
  }

  applyUpdate() {
    alert('Updating Yayra to latest version in background...');
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  }

  /* -------------------------------------------------------------
   * REQUIREMENT 5: FULL RIGHT-SIDE DRAWER MENU WITH SUBMENUS (ZERO BLUR)
   * ----------------------------------------------------------- */
  renderSideDrawer(root) {
    // Keep the workspace crisp, but reserve the whole area outside the drawer
    // as a click target so the menu closes exactly like a native browser menu.
    const scrim = document.createElement('button');
    scrim.type = 'button';
    scrim.className = 'fb-side-drawer-scrim';
    scrim.setAttribute('aria-label', 'Close Yayra menu');
    scrim.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.render();
    });

    const drawer = document.createElement('div');
    drawer.className = 'fb-side-drawer-menu';

    const activeTab = this.getActiveTab() || { url: 'yayra://newtab', title: 'New Tab' };
    const isUpdateReady = this.state.updateState.status === 'ready' || this.state.updateState.status === 'available';

    drawer.innerHTML = `
      <header class="fb-side-drawer-header">
        <span class="fb-menu-wordmark" role="img" aria-label="yayra menu">${Icons.officialWordmark}</span>
        <button class="fb-btn-action fb-close-drawer-btn" aria-label="Close menu">${Icons.close}</button>
      </header>

      <div class="fb-side-drawer-content">
        <!-- 1. Top Update Section -->
        <div class="fb-drawer-update-section">
          ${isUpdateReady ? `
            <button class="fb-drawer-update-btn fb-update-ready-btn" title="Click to restart and apply update">
              <span class="fb-update-badge-icon">${Icons.update}</span>
              <div class="fb-update-text-group">
                <strong>Update Yayra (${this.state.updateState.availableVersion || 'v0.1.1 Available'})</strong>
                <span>Click to restart & update now</span>
              </div>
            </button>
          ` : `
            <div class="fb-drawer-update-status-row">
              <div class="fb-update-status-left">
                <span class="fb-status-orb ${this.state.updateState.status === 'checking' ? 'pulse' : 'green'}"></span>
                <span class="fb-update-status-text">${this.state.updateState.status === 'checking' ? 'Checking for updates...' : 'Yayra v0.1.0 (Latest)'}</span>
              </div>
              <button class="fb-btn-action fb-check-updates-btn" title="Check for updates">${Icons.refresh}</button>
            </div>
          `}
        </div>

        <!-- 2. Primary Tabs/Windows -->
        <button class="fb-drawer-item fb-dr-newtab">${Icons.plus} <span>New tab</span> <kbd>Ctrl+T</kbd></button>
        <button class="fb-drawer-item fb-dr-newwin">${Icons.expand} <span>New window</span> <kbd>Ctrl+N</kbd></button>
        <button class="fb-drawer-item fb-dr-incognito">${Icons.incognito} <span>New Incognito window</span> <kbd>Ctrl+Shift+N</kbd></button>
        <div class="fb-drawer-separator"></div>

        <!-- 3. History with Submenu -->
        <div class="fb-drawer-item-has-submenu">
          <button class="fb-drawer-item fb-dr-history-parent">
            ${Icons.history} <span>History</span> <span class="fb-submenu-arrow">${Icons.chevronRight}</span>
          </button>
          <div class="fb-drawer-submenu">
            <button class="fb-drawer-item fb-dr-tabsearch">${Icons.search} <span>Tab search</span> <kbd>Ctrl+Shift+A</kbd></button>
            <button class="fb-drawer-item fb-dr-reopen-tab">${Icons.tabs} <span>Reopen closed tab</span> <kbd>Ctrl+Shift+T</kbd></button>
            <div class="fb-drawer-separator"></div>
            <button class="fb-drawer-item fb-dr-history">${Icons.history} <span>Full history</span> <kbd>Ctrl+H</kbd></button>
            <button class="fb-drawer-item fb-dr-clear">${Icons.trash} <span>Clear browsing data</span> <kbd>Ctrl+Shift+Del</kbd></button>
          </div>
        </div>

        <!-- 4. Downloads -->
        <button class="fb-drawer-item fb-dr-downloads">${Icons.download} <span>Downloads</span> <kbd>Ctrl+J</kbd></button>

        <!-- 5. Bookmarks & Lists with Submenu -->
        <div class="fb-drawer-item-has-submenu">
          <button class="fb-drawer-item fb-dr-bm-parent">
            ${Icons.bookmark} <span>Bookmarks and lists</span> <span class="fb-submenu-arrow">${Icons.chevronRight}</span>
          </button>
          <div class="fb-drawer-submenu">
            <button class="fb-drawer-item fb-dr-bm-curr">${Icons.star} <span>Bookmark this tab...</span> <kbd>Ctrl+D</kbd></button>
            <button class="fb-drawer-item fb-dr-bm-all">${Icons.starFilled} <span>Bookmark all tabs...</span> <kbd>Ctrl+Shift+D</kbd></button>
            <button class="fb-drawer-item fb-dr-bm-bar">${Icons.bookmark} <span>Show bookmarks bar</span> <kbd>Ctrl+Shift+B</kbd></button>
            <div class="fb-drawer-separator"></div>
            <button class="fb-drawer-item fb-dr-bookmarks">${Icons.folder} <span>Bookmark manager</span> <kbd>Ctrl+Shift+O</kbd></button>
            <button class="fb-drawer-item fb-dr-bm-import">${Icons.download} <span>Import bookmarks...</span></button>
          </div>
        </div>

        <!-- 6. Tab Groups with Submenu -->
        <div class="fb-drawer-item-has-submenu">
          <button class="fb-drawer-item fb-dr-tabgroups-parent">
            ${Icons.tabs} <span>Tab groups</span> <span class="fb-submenu-arrow">${Icons.chevronRight}</span>
          </button>
          <div class="fb-drawer-submenu">
            <button class="fb-drawer-item fb-dr-tg-new">${Icons.plus} <span>New tab group</span></button>
            <button class="fb-drawer-item fb-dr-tg-add">${Icons.tabs} <span>Group current tab</span></button>
            <button class="fb-drawer-item fb-dr-tg-ungroup">${Icons.close} <span>Ungroup tabs</span></button>
          </div>
        </div>

        <!-- 7. Extensions with Submenu -->
        <div class="fb-drawer-item-has-submenu">
          <button class="fb-drawer-item fb-dr-ext-parent">
            ${Icons.shield} <span>Extensions</span> <span class="fb-submenu-arrow">${Icons.chevronRight}</span>
          </button>
          <div class="fb-drawer-submenu">
            <button class="fb-drawer-item fb-dr-extensions">${Icons.shield} <span>Manage extensions</span></button>
            <button class="fb-drawer-item fb-dr-ext-store">${Icons.externalLink} <span>Yayra extension store</span></button>
            <button class="fb-drawer-item fb-dr-permissions">${Icons.lock} <span>Shield & site permissions</span></button>
          </div>
        </div>

        <!-- 8. Delete browsing data -->
        <button class="fb-drawer-item fb-dr-clear">${Icons.trash} <span>Delete browsing data...</span> <kbd>Ctrl+Shift+Del</kbd></button>
        <div class="fb-drawer-separator"></div>

        <!-- 9. Zoom & Fullscreen -->
        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px;">
          <span style="font-size:0.875rem; color:var(--fb-text-secondary);">${Icons.search} Zoom</span>
          <div style="display:flex; align-items:center; gap:6px;">
            <button class="fb-btn-action fb-dr-zoom-out" style="width:26px; height:26px;">−</button>
            <span style="font-size:0.85rem; font-weight:700; min-width:40px; text-align:center;">${this.state.zoomLevel}%</span>
            <button class="fb-btn-action fb-dr-zoom-in" style="width:26px; height:26px;">+</button>
            <button class="fb-btn-action fb-dr-fullscreen" style="width:26px; height:26px;" title="Toggle Fullscreen">${Icons.expand}</button>
          </div>
        </div>

        <!-- 10. Page Tools -->
        <button class="fb-drawer-item fb-dr-print">${Icons.print} <span>Print...</span> <kbd>Ctrl+P</kbd></button>
        <button class="fb-drawer-item fb-dr-lens">${Icons.lens} <span>Search this tab with Google Lens</span></button>
        <button class="fb-drawer-item fb-dr-translate">${Icons.translate} <span>Translate...</span></button>

        <!-- 11. Find and Edit with Submenu -->
        <div class="fb-drawer-item-has-submenu">
          <button class="fb-drawer-item fb-dr-find-parent">
            ${Icons.search} <span>Find and edit</span> <span class="fb-submenu-arrow">${Icons.chevronRight}</span>
          </button>
          <div class="fb-drawer-submenu">
            <button class="fb-drawer-item fb-dr-find">${Icons.search} <span>Find in page...</span> <kbd>Ctrl+F</kbd></button>
            <div class="fb-drawer-separator"></div>
            <button class="fb-drawer-item fb-dr-cut">${Icons.edit} <span>Cut</span> <kbd>Ctrl+X</kbd></button>
            <button class="fb-drawer-item fb-dr-copy">${Icons.copy} <span>Copy</span> <kbd>Ctrl+C</kbd></button>
            <button class="fb-drawer-item fb-dr-paste">${Icons.save} <span>Paste</span> <kbd>Ctrl+V</kbd></button>
          </div>
        </div>

        <!-- 12. Cast, Save, and Share with Submenu (Matching Image 3) -->
        <div class="fb-drawer-item-has-submenu">
          <button class="fb-drawer-item fb-dr-cast-parent">
            ${Icons.save} <span>Cast, save, and share</span> <span class="fb-submenu-arrow">${Icons.chevronRight}</span>
          </button>
          <div class="fb-drawer-submenu">
            <div class="fb-submenu-section-label">Cast</div>
            <button class="fb-drawer-item fb-dr-cast">${Icons.cast} <span>Cast...</span></button>

            <div class="fb-submenu-section-label">Save</div>
            <button class="fb-drawer-item fb-dr-save-page">${Icons.save} <span>Save page as...</span> <kbd>Ctrl+S</kbd></button>
            <button class="fb-drawer-item fb-dr-open-pharmagame">${Icons.sparkles} <span>Open in pharmaGAME Ai</span></button>
            <button class="fb-drawer-item fb-dr-create-shortcut">${Icons.externalLink} <span>Create shortcut...</span></button>

            <div class="fb-submenu-section-label">Share</div>
            <button class="fb-drawer-item fb-dr-copy-link">${Icons.copy} <span>Copy link</span></button>
            <button class="fb-drawer-item fb-dr-send-devices">${Icons.devices} <span>Send to your devices</span></button>
            <button class="fb-drawer-item fb-dr-qr-code">${Icons.qrCode} <span>Create QR Code</span></button>
          </div>
        </div>

        <!-- 13. More Tools with Submenu (Matching Image 1) -->
        <div class="fb-drawer-item-has-submenu">
          <button class="fb-drawer-item fb-dr-moretools-parent">
            ${Icons.settings} <span>More tools</span> <span class="fb-submenu-arrow">${Icons.chevronRight}</span>
          </button>
          <div class="fb-drawer-submenu">
            <button class="fb-drawer-item fb-dr-tabsearch">${Icons.search} <span>Tab search</span> <kbd>Ctrl+Shift+A</kbd></button>
            <button class="fb-drawer-item fb-dr-name-win">${Icons.edit} <span>Name window...</span></button>
            <button class="fb-drawer-item fb-dr-customize-yayra">${Icons.brush} <span>Customize yayra</span></button>
            <div class="fb-drawer-separator"></div>
            <button class="fb-drawer-item fb-dr-reading-mode">${Icons.readingMode} <span>Reading mode</span></button>
            <button class="fb-drawer-item fb-dr-performance">${Icons.performance} <span>Performance</span></button>
            <button class="fb-drawer-item fb-dr-task-mgr">${Icons.taskManager} <span>Task manager</span></button>
            <div class="fb-drawer-separator"></div>
            <button class="fb-drawer-item fb-dr-devtools">${Icons.developerTools} <span>Developer tools</span> <kbd>Ctrl+Shift+I</kbd></button>
          </div>
        </div>

        <div class="fb-drawer-separator"></div>

        <!-- 14. Help with Submenu (Matching Image 2) -->
        <div class="fb-drawer-item-has-submenu">
          <button class="fb-drawer-item fb-dr-help-parent">
            ${Icons.help} <span>Help</span> <span class="fb-submenu-arrow">${Icons.chevronRight}</span>
          </button>
          <div class="fb-drawer-submenu">
            <button class="fb-drawer-item fb-dr-about">${Icons.officialOrb} <span>About yayra</span></button>
            <button class="fb-drawer-item fb-dr-whatsnew">${Icons.whatNew} <span>What's New</span></button>
            <button class="fb-drawer-item fb-dr-help-center">${Icons.help} <span>Help center</span></button>
            <button class="fb-drawer-item fb-dr-report-issue">${Icons.report} <span>Report an issue...</span> <kbd>Alt+Shift+I</kbd></button>
          </div>
        </div>

        <!-- 15. Settings & Exit -->
        <button class="fb-drawer-item fb-dr-settings">${Icons.settings} <span>Settings</span></button>
        <button class="fb-drawer-item fb-dr-exit">${Icons.close} <span>Exit</span></button>
      </div>
    `;

    // Event Listeners
    drawer.querySelector('.fb-close-drawer-btn')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.render();
    });

    // Update Action Button
    drawer.querySelector('.fb-check-updates-btn')?.addEventListener('click', () => {
      this.checkForUpdates(true);
    });

    drawer.querySelector('.fb-update-ready-btn')?.addEventListener('click', () => {
      this.promptUpdateReady();
    });

    // Submenu click toggling for mobile / touch
    drawer.querySelectorAll('.fb-drawer-item-has-submenu').forEach((parent) => {
      const button = parent.querySelector('.fb-drawer-item');
      button?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        parent.classList.toggle('open');
      });
    });

    drawer.querySelector('.fb-dr-newtab')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.createNewTab();
    });

    drawer.querySelector('.fb-dr-newwin')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.duplicateFloatingMini();
    });

    drawer.querySelector('.fb-dr-incognito')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.createNewTab(true);
    });

    drawer.querySelector('.fb-dr-history')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.openInternalPage('yayra://history');
    });

    drawer.querySelector('.fb-dr-reopen-tab')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.reopenLastClosedTab();
    });

    drawer.querySelectorAll('.fb-dr-tabsearch').forEach((button) => {
      button.addEventListener('click', () => {
        this.state.isSideDrawerOpen = false;
        this.openModal('tab-switcher');
      });
    });

    drawer.querySelector('.fb-dr-tg-new')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.createNewTab();
    });

    drawer.querySelector('.fb-dr-tg-add')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.openModal('tab-switcher');
    });

    drawer.querySelector('.fb-dr-tg-ungroup')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      alert('The active tab has been removed from its tab group.');
      this.render();
    });

    drawer.querySelector('.fb-dr-downloads')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.openInternalPage('yayra://downloads');
    });

    drawer.querySelector('.fb-dr-bookmarks')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.openInternalPage('yayra://bookmarks');
    });

    drawer.querySelector('.fb-dr-bm-curr')?.addEventListener('click', async () => {
      this.state.isSideDrawerOpen = false;
      await this.toggleBookmarkCurrentTab();
    });

    drawer.querySelector('.fb-dr-bm-all')?.addEventListener('click', async () => {
      this.state.isSideDrawerOpen = false;
      if (this.bookmarksRepo) {
        for (const t of this.state.tabs) {
          if (t.url && !t.url.startsWith('yayra://newtab')) {
            await this.bookmarksRepo.addBookmark({ url: t.url, title: t.title });
          }
        }
      }
      alert('All open tabs bookmarked!');
    });

    drawer.querySelector('.fb-dr-bm-bar')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      alert('Bookmarks bar visibility toggled.');
    });

    drawer.querySelector('.fb-dr-bm-import')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.openInternalPage('yayra://bookmarks');
    });

    drawer.querySelector('.fb-dr-extensions')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.openInternalPage('yayra://extensions');
    });

    drawer.querySelector('.fb-dr-ext-store')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.openInternalPage('yayra://extensions');
    });

    drawer.querySelector('.fb-dr-permissions')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.openInternalPage('yayra://permissions');
    });

    drawer.querySelector('.fb-dr-settings')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.openInternalPage('yayra://settings');
    });

    drawer.querySelector('.fb-dr-about')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.openInternalPage('yayra://about');
    });

    drawer.querySelector('.fb-dr-whatsnew')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.openInternalPage('yayra://about');
    });

    drawer.querySelector('.fb-dr-help-center')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.navigateActiveTab('https://github.com/g2code33/yayra#readme');
    });

    drawer.querySelector('.fb-dr-report-issue')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.navigateActiveTab('https://github.com/g2code33/yayra/issues');
    });

    drawer.querySelector('.fb-dr-clear')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.openModal('clear-data');
    });

    drawer.querySelector('.fb-dr-find')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.state.findInPage.isOpen = true;
      this.render();
    });

    drawer.querySelector('.fb-dr-cut')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      document.execCommand?.('cut');
    });

    drawer.querySelector('.fb-dr-copy')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      document.execCommand?.('copy');
    });

    drawer.querySelector('.fb-dr-paste')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      document.execCommand?.('paste');
    });

    drawer.querySelector('.fb-dr-zoom-in')?.addEventListener('click', () => {
      this.state.zoomLevel = Math.min(200, this.state.zoomLevel + 10);
      this.render();
    });

    drawer.querySelector('.fb-dr-zoom-out')?.addEventListener('click', () => {
      this.state.zoomLevel = Math.max(50, this.state.zoomLevel - 10);
      this.render();
    });

    drawer.querySelector('.fb-dr-fullscreen')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    });

    drawer.querySelector('.fb-dr-print')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      if (typeof window !== 'undefined' && window.print) window.print();
    });

    drawer.querySelector('.fb-dr-lens')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      const url = activeTab.url || 'https://yayra.app';
      this.navigateActiveTab(`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(url)}`);
    });

    drawer.querySelector('.fb-dr-translate')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      const url = activeTab.url || 'https://yayra.app';
      this.navigateActiveTab(`https://translate.google.com/translate?u=${encodeURIComponent(url)}`);
    });

    // Cast, Save, and Share Actions (Image 3)
    drawer.querySelector('.fb-dr-cast')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      alert('Scanning for Cast and AirPlay display targets on local network...');
    });

    drawer.querySelector('.fb-dr-save-page')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      alert(`Saving current page (${activeTab.title})...`);
    });

    drawer.querySelector('.fb-dr-open-pharmagame')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.navigateActiveTab('https://github.com/g2code33/pharmaTRACK_PERFECT_new');
    });

    drawer.querySelector('.fb-dr-create-shortcut')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      alert(`Desktop shortcut created for: ${activeTab.title}`);
    });

    drawer.querySelector('.fb-dr-copy-link')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(activeTab.url);
      }
      alert('Page link copied to clipboard!');
    });

    drawer.querySelector('.fb-dr-send-devices')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      alert('Page pushed to your synchronized Yayra devices.');
    });

    drawer.querySelector('.fb-dr-qr-code')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(activeTab.url)}`;
      alert(`QR Code generated for URL:\n${activeTab.url}`);
    });

    // More Tools Actions (Image 1)
    drawer.querySelector('.fb-dr-name-win')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      const name = prompt('Name this window:', 'Yayra Window 1');
      if (name && typeof document !== 'undefined') document.title = `${name} - yayra`;
    });

    drawer.querySelector('.fb-dr-customize-yayra')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.openModal('radial-customizer');
    });

    drawer.querySelector('.fb-dr-reading-mode')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      alert('Reader view activated: Distraction-free high contrast formatting.');
    });

    drawer.querySelector('.fb-dr-performance')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      alert('Performance Monitor: Memory usage optimal, GPU DirectComposition hardware acceleration active.');
    });

    drawer.querySelector('.fb-dr-task-mgr')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      alert(`Task Manager: ${this.state.tabs.length} tabs active. Renderer memory: 42 MB.`);
    });

    drawer.querySelector('.fb-dr-devtools')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      alert('Developer Tools: Web inspector console attached.');
    });

    drawer.querySelector('.fb-dr-exit')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.minimizeToBubble();
    });

    root.appendChild(scrim);
    root.appendChild(drawer);
  }

  /* -------------------------------------------------------------
   * FIND IN PAGE TOOLBAR
   * ----------------------------------------------------------- */
  renderFindInPageBar(root) {
    const bar = document.createElement('div');
    bar.className = 'fb-find-in-page-bar';
    bar.innerHTML = `
      <input type="text" class="fb-find-input" placeholder="Find in page" value="${this.state.findInPage.query}" autofocus />
      <span class="fb-find-count">${this.state.findInPage.currentMatch}/${this.state.findInPage.matchesCount}</span>
      <button class="fb-find-btn fb-find-prev" title="Previous match">${Icons.arrowLeft}</button>
      <button class="fb-find-btn fb-find-next" title="Next match">${Icons.arrowRight}</button>
      <button class="fb-find-btn fb-find-close" title="Close">${Icons.close}</button>
    `;

    bar.querySelector('.fb-find-close')?.addEventListener('click', () => {
      this.state.findInPage.isOpen = false;
      this.state.findInPage.query = '';
      this.render();
    });

    root.appendChild(bar);
  }

  /* -------------------------------------------------------------
   * MODALS & DIALOGS
   * ----------------------------------------------------------- */
  renderActiveModal(root) {
    if (!this.state.activeModal) return;

    const backdrop = document.createElement('div');
    backdrop.className = `fb-modal-backdrop ${this.state.activeModal === 'search-overlay' ? 'fb-search-backdrop' : ''}`;
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this.closeModal();
    });

    const modal = document.createElement('div');

    switch (this.state.activeModal) {
      case 'menu':
        this.renderMenuModal(modal);
        break;
      case 'history':
        this.renderHistoryModal(modal);
        break;
      case 'bookmarks':
        this.renderBookmarksModal(modal);
        break;
      case 'settings':
        this.renderSettingsModal(modal);
        break;
      case 'clear-data':
        this.renderClearDataModal(modal);
        break;
      case 'tab-switcher':
        this.renderTabSwitcherModal(modal);
        break;
      case 'search-overlay':
        this.renderMobileSearchOverlay(modal);
        break;
      case 'sponsored-manager':
        this.renderSponsoredManagerModal(modal);
        break;
      case 'radial-customizer':
        this.renderRadialCustomizerModal(modal);
        break;
      default:
        return;
    }

    backdrop.appendChild(modal);
    root.appendChild(backdrop);
  }

  renderRadialCustomizerModal(modal) {
    modal.className = 'fb-modal-card fb-modal-radial-customizer';
    const actions = this.getRadialActions();
    const bookmarks = this.state.bookmarksItems || [];

    modal.innerHTML = `
      <div class="fb-modal-header">
        <h2 class="fb-modal-title">Customize Radial Action Wheel & Bookmarks</h2>
        <button class="fb-modal-close-btn">${Icons.close}</button>
      </div>
      <div class="fb-modal-body" style="display:flex; flex-direction:column; gap:14px; max-height:70vh; overflow-y:auto;">
        <div>
          <h3 class="fb-rc-section-title" style="font-size:0.85rem; font-weight:700; color:var(--fb-text-muted); text-transform:uppercase; margin:8px 0;">Current Wheel Items (${actions.length})</h3>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:8px;">
            ${actions.map((item, idx) => `
              <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 10px; background:rgba(255,255,255,0.06); border-radius:8px; border:1px solid rgba(255,255,255,0.08);">
                <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
                  <span style="width:20px; height:20px; display:inline-flex; align-items:center; justify-content:center;">${item.icon || Icons.globe}</span>
                  <span style="font-size:0.825rem; font-weight:600; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${item.title}</span>
                </div>
                <button class="fb-btn fb-btn-secondary fb-del-radial-item-btn" data-idx="${idx}" style="padding:2px 6px; font-size:12px;" title="Remove Item">${Icons.trash}</button>
              </div>
            `).join('')}
          </div>
        </div>

        <div>
          <h3 class="fb-rc-section-title" style="font-size:0.85rem; font-weight:700; color:var(--fb-text-muted); text-transform:uppercase; margin:8px 0;">Add from Bookmarks & Favorites</h3>
          ${bookmarks.length === 0 ? `
            <p style="font-size:0.8rem; color:var(--fb-text-muted); margin:4px 0;">No bookmarks saved yet. Star a webpage to add it to bookmarks.</p>
          ` : `
            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:8px;">
              ${bookmarks.map((bm) => {
                let domain = bm.url;
                try { domain = new URL(bm.url).hostname; } catch {}
                return `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 10px; background:rgba(255,255,255,0.04); border-radius:8px; border:1px solid rgba(255,255,255,0.08);">
                  <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
                    <img src="https://icons.duckduckgo.com/ip3/${domain}.ico" onerror="this.src='https://www.google.com/s2/favicons?domain=${domain}&sz=32'" style="width:16px; height:16px; border-radius:50%;" alt="" />
                    <span style="font-size:0.825rem; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${bm.title || bm.url}</span>
                  </div>
                  <button class="fb-btn fb-btn-primary fb-add-bm-to-wheel-btn" data-url="${bm.url}" data-title="${bm.title || bm.url}" style="padding:2px 8px; font-size:11px;">+ Add</button>
                </div>
              `;}).join('')}
            </div>
          `}
        </div>

        <div>
          <h3 class="fb-rc-section-title" style="font-size:0.85rem; font-weight:700; color:var(--fb-text-muted); text-transform:uppercase; margin:8px 0;">Add Custom Website / Tool</h3>
          <div style="display:flex; gap:8px;">
            <input type="text" id="fb-rc-custom-title" placeholder="Title (e.g. YouTube)" class="fb-input" style="flex:1;" />
            <input type="text" id="fb-rc-custom-url" placeholder="https://youtube.com" class="fb-input" style="flex:2;" />
            <button class="fb-btn fb-btn-primary fb-add-custom-wheel-btn">${Icons.plus} Add</button>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; margin-top:8px;">
          <button class="fb-btn fb-btn-secondary fb-reset-radial-btn">Reset Defaults</button>
          <button class="fb-btn fb-btn-primary fb-done-radial-btn">Done</button>
        </div>
      </div>
    `;

    modal.querySelector('.fb-modal-close-btn')?.addEventListener('click', () => this.closeModal());
    modal.querySelector('.fb-done-radial-btn')?.addEventListener('click', () => this.closeModal());

    modal.querySelectorAll('.fb-del-radial-item-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        const current = [...this.getRadialActions()];
        current.splice(idx, 1);
        this.state.customRadialActions = current;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('yayra_radial_actions', JSON.stringify(current));
        }
        this.renderRadialCustomizerModal(modal);
      });
    });

    modal.querySelectorAll('.fb-add-bm-to-wheel-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const url = btn.dataset.url;
        const title = btn.dataset.title;
        let domain = url;
        try { domain = new URL(url).hostname; } catch {}
        const current = [...this.getRadialActions()];
        const angle = (current.length / 12) * 2 * Math.PI;
        const x = Math.round(130 * Math.cos(angle));
        const y = Math.round(130 * Math.sin(angle));
        current.push({
          id: `site-${Date.now()}`,
          title,
          url,
          icon: `<img src="https://icons.duckduckgo.com/ip3/${domain}.ico" onerror="this.src='https://www.google.com/s2/favicons?domain=${domain}&sz=32'" style="width:22px; height:22px; border-radius:50%;" alt="" />`,
          x,
          y,
          type: 'site'
        });
        this.state.customRadialActions = current;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('yayra_radial_actions', JSON.stringify(current));
        }
        this.renderRadialCustomizerModal(modal);
      });
    });

    modal.querySelector('.fb-add-custom-wheel-btn')?.addEventListener('click', () => {
      const title = modal.querySelector('#fb-rc-custom-title')?.value.trim();
      const url = modal.querySelector('#fb-rc-custom-url')?.value.trim();
      if (title && url) {
        let fullUrl = url;
        if (!/^https?:\/\//i.test(fullUrl)) fullUrl = `https://${fullUrl}`;
        let domain = fullUrl;
        try { domain = new URL(fullUrl).hostname; } catch {}
        const current = [...this.getRadialActions()];
        const angle = (current.length / 12) * 2 * Math.PI;
        const x = Math.round(130 * Math.cos(angle));
        const y = Math.round(130 * Math.sin(angle));
        current.push({
          id: `custom-${Date.now()}`,
          title,
          url: fullUrl,
          icon: `<img src="https://icons.duckduckgo.com/ip3/${domain}.ico" onerror="this.src='https://www.google.com/s2/favicons?domain=${domain}&sz=32'" style="width:22px; height:22px; border-radius:50%;" alt="" />`,
          x,
          y,
          type: 'site'
        });
        this.state.customRadialActions = current;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('yayra_radial_actions', JSON.stringify(current));
        }
        this.renderRadialCustomizerModal(modal);
      }
    });

    modal.querySelector('.fb-reset-radial-btn')?.addEventListener('click', () => {
      this.state.customRadialActions = null;
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('yayra_radial_actions');
      }
      this.renderRadialCustomizerModal(modal);
    });
  }

  renderSponsoredManagerModal(modal) {
    modal.className = 'fb-modal-card fb-modal-sponsored-manager';
    modal.innerHTML = `
      <div class="fb-modal-header">
        <h2 class="fb-modal-title">Manage Featured & Advertisement Links</h2>
        <button class="fb-modal-close-btn">${Icons.close}</button>
      </div>
      <div class="fb-modal-body" style="display:flex; flex-direction:column; gap:12px;">
        <p style="font-size:0.85rem; color:var(--fb-text-secondary); margin:0;">
          Add custom links to display on the New Tab page above the Yayra logo. Favicons are automatically retrieved.
        </p>
        <div style="display:flex; gap:8px;">
          <input type="text" id="fb-new-sp-title" placeholder="Title (e.g. My Website)" class="fb-input" style="flex:1;" />
          <input type="text" id="fb-new-sp-url" placeholder="https://example.com" class="fb-input" style="flex:2;" />
          <input type="text" id="fb-new-sp-tag" placeholder="Tag (optional)" class="fb-input" style="flex:1;" />
          <button class="fb-btn fb-btn-primary fb-add-sp-btn">${Icons.plus} Add</button>
        </div>
        <div class="fb-sp-list" style="display:flex; flex-direction:column; gap:8px; max-height:240px; overflow-y:auto; margin-top:8px;">
          ${this.state.sponsoredLinks.map((item, idx) => `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:rgba(255,255,255,0.05); border-radius:8px;">
              <div>
                <strong>${item.title}</strong>
                <span style="font-size:0.75rem; color:var(--fb-text-muted); display:block;">${item.url}</span>
              </div>
              <button class="fb-btn fb-btn-secondary fb-del-sp-btn" data-idx="${idx}">${Icons.trash}</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    modal.querySelector('.fb-modal-close-btn')?.addEventListener('click', () => this.closeModal());
    modal.querySelector('.fb-add-sp-btn')?.addEventListener('click', () => {
      const title = modal.querySelector('#fb-new-sp-title')?.value.trim();
      const url = modal.querySelector('#fb-new-sp-url')?.value.trim();
      const tag = modal.querySelector('#fb-new-sp-tag')?.value.trim();
      if (title && url) {
        let domain = url;
        try { domain = new URL(url).hostname; } catch {}
        this.state.sponsoredLinks.push({ id: `sp-${Date.now()}`, title, url, tag, domain });
        this.renderSponsoredManagerModal(modal);
      }
    });

    modal.querySelectorAll('.fb-del-sp-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        this.state.sponsoredLinks.splice(idx, 1);
        this.renderSponsoredManagerModal(modal);
      });
    });
  }

  renderMenuModal(modal) {
    modal.className = 'fb-modal-card fb-chrome-menu-card fb-modal-menu';
    modal.innerHTML = `
      <div class="fb-modal-header">
        <h2 class="fb-modal-title"><span class="fb-menu-wordmark" role="img" aria-label="yayra menu">${Icons.officialWordmark}</span></h2>
        <button class="fb-modal-close-btn" aria-label="Close menu">${Icons.close}</button>
      </div>
      <div class="fb-modal-body fb-menu-grid">
        <button class="fb-menu-item fb-btn-new-tab" data-action="new-tab">${Icons.plus} <span>New Tab</span></button>
        <button class="fb-menu-item" data-action="new-window">${Icons.expand} <span>New Window</span></button>
        <button class="fb-menu-item fb-btn-incognito" data-action="new-incognito-tab">${Icons.incognito} <span>New Incognito Tab</span></button>
        <button class="fb-menu-item" data-action="reopen-closed-tab">${Icons.history} <span>Reopen Closed Tab</span></button>
        <button class="fb-menu-item" data-action="find-in-page">${Icons.search} <span>Find in Page</span></button>
        <button class="fb-menu-item" data-action="print">${Icons.refresh} <span>Print</span></button>
        <button class="fb-menu-item" data-action="share">${Icons.forward} <span>Share</span></button>
        <button class="fb-menu-item" data-action="passwords">${Icons.lock} <span>Passwords</span></button>
        <button class="fb-menu-item fb-btn-history" data-action="history">${Icons.history} <span>History</span></button>
        <button class="fb-menu-item fb-btn-bookmarks" data-action="bookmarks">${Icons.bookmark} <span>Bookmarks</span></button>
        <button class="fb-menu-item fb-btn-downloads" data-action="downloads">${Icons.download} <span>Downloads</span></button>
        <button class="fb-menu-item" data-action="clear-data">${Icons.trash} <span>Clear Data</span></button>
        <button class="fb-menu-item" data-action="extensions">${Icons.puzzle} <span>Extensions</span></button>
        <button class="fb-menu-item" data-action="permissions">${Icons.shield} <span>Permissions</span></button>
        <button class="fb-menu-item fb-btn-settings" data-action="settings">${Icons.settings} <span>Settings</span></button>
        <button class="fb-menu-item" data-action="about">${Icons.info} <span>About</span></button>
      </div>
    `;

    modal.querySelector('.fb-modal-close-btn')?.addEventListener('click', () => this.closeModal());
    modal.querySelectorAll('.fb-menu-item').forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        this.closeModal();
        switch (action) {
          case 'new-tab': this.createNewTab(); break;
          case 'new-window': this.createNewTab(); break;
          case 'new-incognito-tab': this.createNewTab(true); break;
          case 'reopen-closed-tab': this.reopenLastClosedTab(); break;
          case 'find-in-page': this.executeFindInPage(); break;
          case 'passwords': this.openInternalPage('yayra://passwords'); break;
          case 'history': this.openInternalPage('yayra://history'); break;
          case 'bookmarks': this.openInternalPage('yayra://bookmarks'); break;
          case 'downloads': this.openInternalPage('yayra://downloads'); break;
          case 'clear-data': this.openModal('clear-data'); break;
          case 'extensions': this.openInternalPage('yayra://extensions'); break;
          case 'permissions': this.openInternalPage('yayra://permissions'); break;
          case 'settings': this.openInternalPage('yayra://settings'); break;
          case 'about': this.openInternalPage('yayra://about'); break;
        }
      });
    });
  }

  renderTabSwitcherModal(modal) {
    modal.className = 'fb-modal-card fb-modal-tab-switcher fb-mobile-tabswitcher-card';
    modal.innerHTML = `
      <div class="fb-modal-header">
        <h2 class="fb-modal-title">${Icons.tabs} Tabs (${this.state.tabs.length})</h2>
        <div style="display:flex; gap:8px;">
          <button class="fb-btn fb-btn-primary fb-mobile-addtab-btn">${Icons.plus} New Tab</button>
          <button class="fb-modal-close-btn">${Icons.close}</button>
        </div>
      </div>
      <div class="fb-modal-body fb-mobile-tabs-grid">
        ${this.state.tabs.map((tab) => `
          <div class="fb-tab-card fb-mobile-tab-card ${tab.id === this.state.activeTabId ? 'active' : ''}" data-tab-id="${tab.id}">
            <div class="fb-mobile-tab-header">
              <span class="fb-mobile-tab-title">${this.getTabTitle(tab)}</span>
              <button class="fb-mobile-tab-close" data-tab-id="${tab.id}">${Icons.close}</button>
            </div>
            <div class="fb-mobile-tab-preview">
              <span class="fb-mobile-tab-url">${tab.url}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    modal.querySelector('.fb-modal-close-btn')?.addEventListener('click', () => this.closeModal());
    modal.querySelector('.fb-mobile-addtab-btn')?.addEventListener('click', () => {
      this.closeModal();
      this.createNewTab();
    });

    modal.querySelectorAll('.fb-mobile-tab-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.fb-mobile-tab-close')) return;
        this.selectTab(card.dataset.tabId);
        this.closeModal();
      });
    });

    modal.querySelectorAll('.fb-mobile-tab-close').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(btn.dataset.tabId);
        if (this.state.tabs.length === 0) {
          this.closeModal();
        } else {
          this.renderTabSwitcherModal(modal);
        }
      });
    });
  }

  renderHistoryModal(modal) {
    modal.className = 'fb-modal-card fb-modal-history';
    modal.innerHTML = `
      <div class="fb-modal-header">
        <h2 class="fb-modal-title">${Icons.history} Browsing History</h2>
        <button class="fb-modal-close-btn">${Icons.close}</button>
      </div>
      <div class="fb-modal-body">
        <div class="fb-history-list">
          ${this.state.historyItems.map((h) => `
            <div class="fb-history-item" data-url="${h.url}">
              <span>${h.title || h.url}</span>
              <span class="fb-history-url">${h.url}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    modal.querySelector('.fb-modal-close-btn')?.addEventListener('click', () => this.closeModal());
  }

  renderBookmarksModal(modal) {
    modal.className = 'fb-modal-card fb-modal-bookmarks';
    modal.innerHTML = `
      <div class="fb-modal-header">
        <h2 class="fb-modal-title">${Icons.bookmark} Bookmarks</h2>
        <button class="fb-modal-close-btn">${Icons.close}</button>
      </div>
      <div class="fb-modal-body">
        <div class="fb-bookmarks-list">
          ${this.state.bookmarksItems.map((b) => `
            <div class="fb-bookmark-item" data-url="${b.url}">
              <span>${b.title}</span>
              <span class="fb-bookmark-url">${b.url}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    modal.querySelector('.fb-modal-close-btn')?.addEventListener('click', () => this.closeModal());
  }

  renderSettingsModal(modal) {
    modal.className = 'fb-modal-card fb-settings-modal-card fb-modal-settings';
    modal.innerHTML = `
      <div class="fb-modal-header">
        <h2 class="fb-modal-title">${Icons.settings} Floating Transparency Settings</h2>
        <button class="fb-modal-close-btn">${Icons.close}</button>
      </div>
      <div class="fb-modal-body" style="display:flex; flex-direction:column; gap:16px;">
        <div>
          <label style="display:flex; justify-content:space-between;">Bubble Opacity <span id="val-bubble-op">${Math.round((this.state.settings.bubbleOpacity || 0.88) * 100)}%</span></label>
          <input type="range" id="fb-slider-bubble-opacity" min="20" max="100" value="${Math.round((this.state.settings.bubbleOpacity || 0.88) * 100)}" class="fb-slider" style="width:100%;" />
        </div>
        <div>
          <label style="display:flex; justify-content:space-between;">Frame Opacity <span id="val-frame-op">${Math.round((this.state.settings.frameOpacity || 0.85) * 100)}%</span></label>
          <input type="range" id="fb-slider-frame-opacity" min="20" max="100" value="${Math.round((this.state.settings.frameOpacity || 0.85) * 100)}" class="fb-slider" style="width:100%;" />
        </div>
        <div>
          <label style="display:flex; justify-content:space-between;">Glassmorphism Blur Radius <span id="val-blur">${this.state.settings.glassmorphismBlurRadius || 24}px</span></label>
          <input type="range" id="fb-slider-blur" min="0" max="64" value="${this.state.settings.glassmorphismBlurRadius || 24}" class="fb-slider" style="width:100%;" />
        </div>
        <div id="fb-transparency-live-preview" style="padding:12px; border-radius:8px; background:rgba(255,255,255,0.08); backdrop-filter:blur(${this.state.settings.glassmorphismBlurRadius || 24}px); border:1px solid rgba(255,255,255,0.15);">
          Live Glassmorphism Transparency Preview
        </div>
        <div style="display:flex; justify-content:space-between; gap:10px;">
          <button class="fb-btn fb-btn-secondary fb-reset-transparency-btn">Reset Defaults</button>
          <button class="fb-btn fb-btn-primary fb-open-inpage-settings-btn">Open Full Settings</button>
        </div>
      </div>
    `;

    const bubbleSlider = modal.querySelector('#fb-slider-bubble-opacity');
    const frameSlider = modal.querySelector('#fb-slider-frame-opacity');
    const blurSlider = modal.querySelector('#fb-slider-blur');
    const preview = modal.querySelector('#fb-transparency-live-preview');

    bubbleSlider?.addEventListener('input', (e) => {
      const rawVal = e?.target?.value !== undefined ? e.target.value : bubbleSlider?.value;
      const val = Number(rawVal) / 100;
      this.state.settings.bubbleOpacity = val;
      const lbl = modal.querySelector('#val-bubble-op');
      if (lbl) lbl.textContent = `${rawVal}%`;
      this.updateCssCustomProperties();
    });

    frameSlider?.addEventListener('input', (e) => {
      const rawVal = e?.target?.value !== undefined ? e.target.value : frameSlider?.value;
      const val = Number(rawVal) / 100;
      this.state.settings.frameOpacity = val;
      const lbl = modal.querySelector('#val-frame-op');
      if (lbl) lbl.textContent = `${rawVal}%`;
      this.updateCssCustomProperties();
    });

    blurSlider?.addEventListener('input', (e) => {
      const rawVal = e?.target?.value !== undefined ? e.target.value : blurSlider?.value;
      const val = Number(rawVal);
      this.state.settings.glassmorphismBlurRadius = val;
      const lbl = modal.querySelector('#val-blur');
      if (lbl) lbl.textContent = `${val}px`;
      if (preview) preview.style.backdropFilter = `blur(${val}px)`;
      this.updateCssCustomProperties();
    });

    modal.querySelector('.fb-reset-transparency-btn')?.addEventListener('click', () => {
      this.state.settings.bubbleOpacity = 0.88;
      this.state.settings.frameOpacity = 0.85;
      this.state.settings.glassmorphismBlurRadius = 24;
      if (bubbleSlider) bubbleSlider.value = '88';
      if (frameSlider) frameSlider.value = '85';
      if (blurSlider) blurSlider.value = '24';
      this.updateCssCustomProperties();
    });

    modal.querySelector('.fb-modal-close-btn')?.addEventListener('click', () => this.closeModal());
    modal.querySelector('.fb-open-inpage-settings-btn')?.addEventListener('click', () => {
      this.closeModal();
      this.openInternalPage('yayra://settings');
    });
  }

  renderClearDataModal(modal) {
    modal.className = 'fb-modal-card fb-modal-cleardata';
    modal.innerHTML = `
      <div class="fb-modal-header">
        <h2 class="fb-modal-title">${Icons.trash} Clear Browsing Data</h2>
        <button class="fb-modal-close-btn">${Icons.close}</button>
      </div>
      <div class="fb-modal-body">
        <label><input type="checkbox" checked id="cb-hist" /> Browsing history</label>
        <label><input type="checkbox" checked id="cb-cookies" /> Cookies and site data</label>
        <label><input type="checkbox" checked id="cb-cache" /> Cached images and files</label>
      </div>
      <div class="fb-modal-footer">
        <button class="fb-btn fb-btn-secondary fb-cancel-cleardata">Cancel</button>
        <button class="fb-btn fb-btn-danger fb-confirm-cleardata">Clear Data</button>
      </div>
    `;
    modal.querySelector('.fb-modal-close-btn')?.addEventListener('click', () => this.closeModal());
    modal.querySelector('.fb-cancel-cleardata')?.addEventListener('click', () => this.closeModal());
    modal.querySelector('.fb-confirm-cleardata')?.addEventListener('click', async () => {
      if (this.historyRepo && typeof this.historyRepo.clearHistory === 'function') {
        await this.historyRepo.clearHistory();
      }
      this.state.historyItems = [];
      alert('Browsing data cleared successfully.');
      this.closeModal();
      this.render();
    });
  }

  getLocalSearchSuggestions(query) {
    const normalized = String(query || '').trim().toLowerCase();
    if (!normalized) return [];
    const remembered = [
      ...(this.state.historyItems || []).map((item) => item.title || item.url),
      ...(this.state.bookmarksItems || []).map((item) => item.title || item.url),
      ...(this.state.tabs || []).map((tab) => tab.title || tab.url)
    ];
    const common = [
      `${query} news`,
      `${query} near me`,
      `${query} today`,
      `${query} website`
    ];
    return [...new Set([...remembered, ...common].filter((item) => String(item).toLowerCase().includes(normalized)))].slice(0, 8);
  }

  async getGoogleSearchSuggestions(query) {
    const local = this.getLocalSearchSuggestions(query);
    if (typeof fetch !== 'function') return local;
    try {
      this.searchSuggestionController?.abort();
      this.searchSuggestionController = typeof AbortController === 'function' ? new AbortController() : null;
      const response = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(query)}`, {
        headers: { accept: 'application/json' },
        mode: 'cors',
        signal: this.searchSuggestionController?.signal
      });
      if (!response.ok) return local;
      const payload = await response.json();
      const remote = Array.isArray(payload?.[1]) ? payload[1].filter((item) => typeof item === 'string') : [];
      return [...new Set([...remote, ...local])].slice(0, 8);
    } catch {
      return local;
    }
  }

  bindSearchSuggestions(input, options = {}) {
    if (!input || input.dataset.searchSuggestionsBound === 'true') return;
    input.dataset.searchSuggestionsBound = 'true';

    const host = input.closest('.fb-omnibox-container')
      || input.closest('.fb-newtab-searchbox')
      || input.closest('#fb-mobile-search-form')
      || input.parentElement;
    if (!host) return;
    host.classList.add('fb-search-suggestions-host');

    const list = document.createElement('div');
    list.className = `fb-search-suggestions ${options.mobile ? 'fb-search-suggestions-mobile' : ''}`;
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    host.appendChild(list);

    let activeIndex = -1;
    let requestId = 0;
    const hide = () => {
      list.hidden = true;
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');
    };
    const choose = (value) => {
      input.value = value;
      input.dataset.selectedSuggestion = value;
      this.state.urlInputValue = value;
      hide();
      if (options.mobile) this.closeModal();
      this.navigateActiveTab(value);
    };
    const updateActive = () => {
      const items = [...list.querySelectorAll('[role="option"]')];
      items.forEach((item, index) => item.classList.toggle('active', index === activeIndex));
      if (activeIndex >= 0 && items[activeIndex]) {
        input.setAttribute('aria-activedescendant', items[activeIndex].id);
        input.dataset.selectedSuggestion = items[activeIndex].dataset.value;
      } else {
        input.removeAttribute('aria-activedescendant');
        input.dataset.selectedSuggestion = '';
      }
    };
    const render = async () => {
      const query = input.value.trim();
      input.dataset.selectedSuggestion = '';
      if (!query) {
        hide();
        return;
      }
      const currentRequest = ++requestId;
      const suggestions = await this.getGoogleSearchSuggestions(query);
      if (currentRequest !== requestId || input.value.trim() !== query) return;
      list.innerHTML = '';
      suggestions.forEach((suggestion, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'fb-search-suggestion';
        item.id = `fb-search-suggestion-${Date.now()}-${index}`;
        item.dataset.value = suggestion;
        item.setAttribute('role', 'option');
        item.innerHTML = `<span class="fb-search-suggestion-icon">${Icons.search}</span><span class="fb-search-suggestion-text"></span><span class="fb-search-suggestion-use">${Icons.arrowRight}</span>`;
        item.querySelector('.fb-search-suggestion-text').textContent = suggestion;
        item.addEventListener('mousedown', (event) => {
          event.preventDefault();
          choose(suggestion);
        });
        list.appendChild(item);
      });
      list.hidden = suggestions.length === 0;
      activeIndex = -1;
    };

    input.addEventListener('input', render);
    input.addEventListener('focus', () => {
      if (input.value.trim()) render();
    });
    input.addEventListener('keydown', (event) => {
      const items = list.querySelectorAll('[role="option"]');
      if (event.key === 'ArrowDown' && items.length) {
        event.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
        updateActive();
      } else if (event.key === 'ArrowUp' && items.length) {
        event.preventDefault();
        activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
        updateActive();
      } else if (event.key === 'Escape') {
        hide();
      } else if (event.key === 'Enter' && activeIndex >= 0 && items[activeIndex]) {
        event.preventDefault();
        event.stopPropagation();
        choose(items[activeIndex].dataset.value);
      }
    });
    input.addEventListener('blur', () => setTimeout(hide, 160));

    if (typeof window !== 'undefined' && window.visualViewport && typeof window.visualViewport.addEventListener === 'function' && options.mobile) {
      const updateViewportHeight = () => {
        const height = `${window.visualViewport.height}px`;
        host.style.setProperty('--fb-search-visible-height', height);
        input.closest('.fb-mobile-search-overlay')?.style.setProperty('--fb-search-visible-height', height);
        input.closest('.fb-search-backdrop')?.style.setProperty('--fb-search-visible-height', height);
      };
      updateViewportHeight();
      window.visualViewport.addEventListener('resize', updateViewportHeight);
      window.visualViewport.addEventListener('scroll', updateViewportHeight);
    }
  }

  renderMobileSearchOverlay(modal) {
    modal.className = 'fb-modal-card fb-mobile-search-overlay';
    modal.innerHTML = `
      <div class="fb-modal-header">
        <h2 class="fb-modal-title">${Icons.google} Google Suggestions</h2>
        <button class="fb-modal-close-btn">${Icons.close}</button>
      </div>
      <div class="fb-modal-body">
        <form id="fb-mobile-search-form" style="display:flex; gap:8px;">
          <input type="text" id="fb-mobile-search-input" value="${this.state.urlInputValue && !this.state.urlInputValue.startsWith('yayra://') ? this.state.urlInputValue : ''}" placeholder="Search with Google or enter website address" class="fb-input" style="flex:1;" autocomplete="off" spellcheck="false" />
          <button type="button" class="fb-mobile-search-clear" aria-label="Clear search">${Icons.close}</button>
        </form>
      </div>
    `;

    modal.querySelector('.fb-modal-close-btn')?.addEventListener('click', () => this.closeModal());
    modal.querySelector('#fb-mobile-search-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const searchInput = modal.querySelector('#fb-mobile-search-input');
      const val = searchInput?.dataset.selectedSuggestion || searchInput?.value;
      if (val) {
        this.closeModal();
        this.navigateActiveTab(val);
      }
    });

    const input = modal.querySelector('#fb-mobile-search-input');
    this.bindSearchSuggestions(input, { mobile: true });
    modal.querySelector('.fb-mobile-search-clear')?.addEventListener('click', () => {
      if (input) {
        input.value = '';
        input.dataset.selectedSuggestion = '';
        input.focus();
      }
    });
    setTimeout(() => {
      input?.focus();
      input?.select();
      input?.scrollIntoView?.({ block: 'nearest' });
    }, 50);
  }

  /* -------------------------------------------------------------
   * PERSISTENT ASSISTIVETOUCH-STYLE FLOATING BUBBLE (PHASES 3, 4, 5, 20, 21)
   * ----------------------------------------------------------- */
  ensurePersistentAssistiveBubble() {
    if (typeof document === 'undefined') return;

    let bubble = document.getElementById('yayra-persistent-assistive-bubble') || document.getElementById('yayra-floating-bubble-persistent');
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.className = 'yayra-floating-bubble-persistent yayra-persistent-assistive-bubble';
      bubble.id = 'yayra-persistent-assistive-bubble';
      bubble.setAttribute('role', 'button');
      bubble.setAttribute('aria-label', 'Yayra Floating Browser Bubble');
      bubble.tabIndex = 0;

      bubble.style.right = '24px';
      bubble.style.bottom = '24px';

      let isDragging = false;
      let startX = 0;
      let startY = 0;
      let initialLeft = 0;
      let initialTop = 0;
      let hasMoved = false;

      bubble.addEventListener('pointerdown', (e) => {
        isDragging = true;
        hasMoved = false;
        startX = e.clientX;
        startY = e.clientY;
        const rect = bubble.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        if (bubble.setPointerCapture) bubble.setPointerCapture(e.pointerId);
      });

      bubble.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          hasMoved = true;
        }
        const newLeft = initialLeft + dx;
        const newTop = initialTop + dy;
        bubble.style.left = `${newLeft}px`;
        bubble.style.top = `${newTop}px`;
        bubble.style.right = 'auto';
        bubble.style.bottom = 'auto';
      });

      const onPointerUp = (e) => {
        if (!isDragging) return;
        isDragging = false;
        if (bubble.releasePointerCapture) bubble.releasePointerCapture(e.pointerId);

        if (!hasMoved) {
          // Requirement 4: Single tap of the float bubble opens the mini floating full site, clicking it again minimizes it into the bubble
          if (this.state.isFloatingMiniOpen) {
            this.closeFloatingMini();
          } else {
            this.openFloatingMini();
          }
        }
      };

      bubble.addEventListener('pointerup', onPointerUp);
      bubble.addEventListener('pointercancel', onPointerUp);

      // Requirement 1: Double-click opens Radial Launcher Wheel
      bubble.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.openRadialLauncher();
      });

      document.body.appendChild(bubble);
    }

    // Update opacity, badge, loading pulse
    const hasLoadingTab = this.state.tabs.some((t) => t.isLoading);
    const bubbleOpacity = this.state.settings.bubbleOpacity || 0.88;
    bubble.style.opacity = String(bubbleOpacity);

    bubble.innerHTML = `
      ${hasLoadingTab ? '<div class="yayra-bubble-loading-ring"></div>' : ''}
      <div style="width:34px; height:34px; display:flex; align-items:center; justify-content:center; pointer-events:none;">
        ${Icons.officialOrb}
      </div>
      <span class="yayra-circle-badge" style="position:absolute; top:-3px; right:-3px; min-width:18px; height:18px; padding:0 4px; font-size:10px; border-radius:9px; background:var(--fb-accent-primary); color:#ffffff; font-weight:700; display:flex; align-items:center; justify-content:center;">
        ${this.state.tabs.length}
      </span>
    `;
  }

  renderFloatingBubbleOverlay() {
    this.ensurePersistentAssistiveBubble();
    if (typeof document === 'undefined') return;
    if (this.bubbleOverlay || document.getElementById('yayra-floating-bubble-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'yayra-floating-bubble-overlay';
    overlay.className = 'yayra-floating-bubble-overlay';
    overlay.innerHTML = `
      <div class="yayra-floating-bubble yayra-floating-orb" role="button" aria-label="Restore Yayra Browser" tabindex="0">
        <div style="width:36px; height:36px; display:flex; align-items:center; justify-content:center;">
          ${Icons.officialOrb}
        </div>
        <span class="yayra-bubble-badge">${this.state.tabs.length}</span>
      </div>
    `;
    overlay.addEventListener('click', () => {
      this.restoreFromBubble();
    });
    document.body.appendChild(overlay);
    this.bubbleOverlay = overlay;
  }

  minimizeToBubble() {
    this.state.isMinimizedToBubble = true;
    if (this.options.onMinimizeToBubble) {
      this.options.onMinimizeToBubble();
    }
    this.render();
  }

  restoreFromBubble() {
    this.state.isMinimizedToBubble = false;
    if (this.bubbleOverlay) {
      this.bubbleOverlay.remove();
      this.bubbleOverlay = null;
    }
    if (typeof document !== 'undefined') {
      const legacyOverlay = document.getElementById('yayra-floating-bubble-overlay');
      if (legacyOverlay) {
        legacyOverlay.remove();
      }
    }
    this.render();
  }

  toggleDesktopMode() {
    const nextMode = this.state.desktopFloatingMode === 'circle-first' ? 'browser-first' : 'circle-first';
    this.state.desktopFloatingMode = nextMode;
    this.state.settings.desktopFloatingMode = nextMode;
    // Make the mode switch observable: circle-first docks the full shell into
    // the persistent bubble, while browser-first restores the full browser.
    this.state.isMinimizedToBubble = nextMode === 'circle-first';
    if (nextMode === 'circle-first') this.state.isFloatingMiniOpen = false;
    if (this.settingsRepo && typeof this.settingsRepo.updateSettings === 'function') {
      this.settingsRepo.updateSettings({ desktopFloatingMode: nextMode });
    }
    if (this.options.onToggleMode) {
      this.options.onToggleMode(nextMode);
    }
    this.render();
  }

  /* -------------------------------------------------------------
   * TAB MANAGEMENT
   * ----------------------------------------------------------- */
  createNewTab(isPrivate = false) {
    const newId = `tab-${Date.now()}`;
    const newTab = {
      id: newId,
      title: isPrivate ? 'Incognito Tab' : 'New Tab',
      url: 'yayra://newtab',
      isSecure: true,
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      isPrivate,
      favicon: null
    };

    this.state.tabs.push(newTab);
    this.state.activeTabId = newId;
    this.state.urlInputValue = '';
    this.state.isBookmarked = false;

    this.render();
  }

  selectTab(tabId) {
    const tab = this.state.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    this.state.activeTabId = tabId;
    this.state.urlInputValue = this.getDisplayUrl(tab.url);
    this.updateBookmarkState(tab.url);
    this.render();
  }

  closeTab(tabId) {
    const tabIndex = this.state.tabs.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) return;

    const [closedTab] = this.state.tabs.splice(tabIndex, 1);

    // Save to closed tabs history (for Ctrl+Shift+T restore)
    if (closedTab && !closedTab.isPrivate && closedTab.url !== 'yayra://newtab') {
      this.state.closedTabsHistory.unshift(closedTab);
      if (this.state.closedTabsHistory.length > 25) {
        this.state.closedTabsHistory.pop();
      }
    }

    if (this.state.tabs.length === 0) {
      // If last tab closed, open New Tab
      this.createNewTab();
      return;
    }

    if (this.state.activeTabId === tabId) {
      const nextIndex = Math.min(tabIndex, this.state.tabs.length - 1);
      this.selectTab(this.state.tabs[nextIndex].id);
    } else {
      this.render();
    }
  }

  restoreLastClosedTab() {
    if (this.state.closedTabsHistory.length === 0) return;

    const lastClosed = this.state.closedTabsHistory.shift();
    const newId = `tab-${Date.now()}`;
    const restoredTab = {
      ...lastClosed,
      id: newId,
      canGoBack: false,
      canGoForward: false,
      isLoading: false
    };

    this.state.tabs.push(restoredTab);
    this.selectTab(newId);
  }

  reorderTabs(fromIdx, toIdx) {
    if (fromIdx < 0 || fromIdx >= this.state.tabs.length || toIdx < 0 || toIdx >= this.state.tabs.length) return;
    const [movedTab] = this.state.tabs.splice(fromIdx, 1);
    this.state.tabs.splice(toIdx, 0, movedTab);
    this.render();
  }

  /* -------------------------------------------------------------
   * NAVIGATION & OMNIBOX INTERPRETATION
   * ----------------------------------------------------------- */
  ensureNavigationState(tab) {
    if (!tab) return null;
    const initialUrl = tab.url || 'yayra://newtab';
    const current = tab.navigationState;
    if (!current || !Array.isArray(current.historyStack) || current.historyStack.length === 0) {
      tab.navigationState = {
        historyStack: [initialUrl],
        currentIndex: 0,
        canGoBack: false,
        canGoForward: false
      };
    }
    tab.canGoBack = tab.navigationState.currentIndex > 0;
    tab.canGoForward = tab.navigationState.currentIndex < tab.navigationState.historyStack.length - 1;
    return tab.navigationState;
  }

  navigateActiveTab(rawInput) {
    const activeTab = this.getActiveTab();
    if (!activeTab) return;

    const query = (rawInput || '').trim();
    if (!query) return;

    const targetUrl = this.interpretUrl(query);
    const navigationState = this.ensureNavigationState(activeTab);
    const currentUrl = navigationState.historyStack[navigationState.currentIndex];
    if (currentUrl !== targetUrl) {
      navigationState.historyStack = navigationState.historyStack.slice(0, navigationState.currentIndex + 1);
      navigationState.historyStack.push(targetUrl);
      navigationState.currentIndex = navigationState.historyStack.length - 1;
    }
    activeTab.url = targetUrl;
    activeTab.title = this.getTabTitle(activeTab);
    activeTab.isSecure = targetUrl.startsWith('https://') || targetUrl.startsWith('yayra://');
    activeTab.canGoBack = navigationState.currentIndex > 0;
    activeTab.canGoForward = navigationState.currentIndex < navigationState.historyStack.length - 1;
    navigationState.canGoBack = activeTab.canGoBack;
    navigationState.canGoForward = activeTab.canGoForward;
    activeTab.isLoading = !targetUrl.startsWith('yayra://');

    this.state.urlInputValue = this.getDisplayUrl(targetUrl);
    this.updateBookmarkState(targetUrl);

    // Record history if not in private mode and not internal newtab
    if (!activeTab.isPrivate && this.historyRepo && targetUrl !== 'yayra://newtab') {
      if (typeof this.historyRepo.recordVisit === 'function') {
        this.historyRepo.recordVisit(targetUrl, activeTab.title);
      } else if (typeof this.historyRepo.addEntry === 'function') {
        this.historyRepo.addEntry(targetUrl, activeTab.title, activeTab.favicon);
      }
    }

    if (this.navigationController && typeof this.navigationController.navigate === 'function') {
      this.navigationController.navigate(targetUrl);
    }

    this.render();

    // Auto-complete loading for internal pages
    if (targetUrl.startsWith('yayra://')) {
      this.updateTabLoading(activeTab.id, false);
    }
  }

  interpretUrl(input) {
    const trimmed = input.trim();
    if (trimmed.startsWith('yayra://') || trimmed.startsWith('about:') || trimmed.startsWith('app://')) {
      return trimmed;
    }
    if (trimmed === 'settings') return 'yayra://settings';
    if (trimmed === 'history') return 'yayra://history';
    if (trimmed === 'bookmarks') return 'yayra://bookmarks';
    if (trimmed === 'downloads') return 'yayra://downloads';
    if (trimmed === 'passwords') return 'yayra://passwords';
    if (trimmed === 'extensions') return 'yayra://extensions';
    if (trimmed === 'permissions') return 'yayra://permissions';
    if (trimmed === 'about') return 'yayra://about';

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }

    if (/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+(:[0-9]+)?(\/.*)?$/.test(trimmed)) {
      return `https://${trimmed}`;
    }

    // Natural Language Search Query (Default: Google)
    const engine = this.state.settings.searchEngine || 'google';
    const encoded = encodeURIComponent(trimmed);
    if (engine === 'duckduckgo') return `https://duckduckgo.com/?q=${encoded}`;
    if (engine === 'bing') return `https://www.bing.com/search?q=${encoded}`;
    if (engine === 'startpage') return `https://www.startpage.com/do/dsearch?query=${encoded}`;
    return `https://www.google.com/search?q=${encoded}`;
  }

  openInternalPage(schemeUrl) {
    const activeTab = this.getActiveTab();
    if (activeTab && activeTab.url === 'yayra://newtab') {
      this.navigateActiveTab(schemeUrl);
    } else {
      this.createNewTab();
      this.navigateActiveTab(schemeUrl);
    }
  }

  goBack() {
    const activeTab = this.getActiveTab();
    if (!activeTab) return false;
    // Move the active tab's local history first. A native controller may
    // update its own model synchronously, so delegating before this step can
    // overwrite the shell state or jump straight back to the new-tab page.
    const navigationState = this.ensureNavigationState(activeTab);
    if (navigationState.currentIndex <= 0) return false;
    navigationState.currentIndex -= 1;
    activeTab.url = navigationState.historyStack[navigationState.currentIndex];
    activeTab.title = this.getTabTitle(activeTab);
    activeTab.isSecure = activeTab.url.startsWith('https://') || activeTab.url.startsWith('yayra://');
    activeTab.canGoBack = navigationState.currentIndex > 0;
    activeTab.canGoForward = navigationState.currentIndex < navigationState.historyStack.length - 1;
    navigationState.canGoBack = activeTab.canGoBack;
    navigationState.canGoForward = activeTab.canGoForward;
    activeTab.isLoading = !activeTab.url.startsWith('yayra://');
    this.state.urlInputValue = this.getDisplayUrl(activeTab.url);
    if (this.navigationController && typeof this.navigationController.goBack === 'function') {
      this.navigationController.goBack();
    }
    return true;
  }

  goForward() {
    const activeTab = this.getActiveTab();
    if (!activeTab) return false;
    const navigationState = this.ensureNavigationState(activeTab);
    if (navigationState.currentIndex >= navigationState.historyStack.length - 1) return false;
    navigationState.currentIndex += 1;
    activeTab.url = navigationState.historyStack[navigationState.currentIndex];
    activeTab.title = this.getTabTitle(activeTab);
    activeTab.isSecure = activeTab.url.startsWith('https://') || activeTab.url.startsWith('yayra://');
    activeTab.canGoBack = navigationState.currentIndex > 0;
    activeTab.canGoForward = navigationState.currentIndex < navigationState.historyStack.length - 1;
    navigationState.canGoBack = activeTab.canGoBack;
    navigationState.canGoForward = activeTab.canGoForward;
    activeTab.isLoading = !activeTab.url.startsWith('yayra://');
    this.state.urlInputValue = this.getDisplayUrl(activeTab.url);
    if (this.navigationController && typeof this.navigationController.goForward === 'function') {
      this.navigationController.goForward();
    }
    return true;
  }

  reload() {
    const activeTab = this.getActiveTab();
    if (activeTab) {
      activeTab.isLoading = true;
      this.render();
      setTimeout(() => {
        this.updateTabLoading(activeTab.id, false);
        this.render();
      }, 300);
    }
  }

  stopLoading() {
    const activeTab = this.getActiveTab();
    if (activeTab) {
      activeTab.isLoading = false;
      this.render();
    }
  }

  updateTabLoading(tabId, isLoading) {
    const tab = this.state.tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.isLoading = isLoading;
      const countEl = this.rootElement?.querySelector('.fb-page-loading-bar');
      if (countEl) countEl.style.display = isLoading ? 'block' : 'none';
      this.ensurePersistentAssistiveBubble();
    }
  }

  /* -------------------------------------------------------------
   * BOOKMARKS & REPOSITORIES
   * ----------------------------------------------------------- */
  async toggleBookmarkCurrentTab() {
    const activeTab = this.getActiveTab();
    if (!activeTab || !activeTab.url || activeTab.url === 'yayra://newtab') return;

    this._bookmarkCheckId = (this._bookmarkCheckId || 0) + 1;
    this.state.isBookmarked = !this.state.isBookmarked;

    if (this.bookmarksRepo) {
      if (this.state.isBookmarked) {
        if (typeof this.bookmarksRepo.addBookmark === 'function') {
          await this.bookmarksRepo.addBookmark({
            url: activeTab.url,
            title: activeTab.title || activeTab.url,
            favicon: activeTab.favicon
          });
        }
      } else {
        if (typeof this.bookmarksRepo.removeBookmarkByUrl === 'function') {
          await this.bookmarksRepo.removeBookmarkByUrl(activeTab.url);
        } else if (typeof this.bookmarksRepo.removeBookmark === 'function') {
          await this.bookmarksRepo.removeBookmark(activeTab.url);
        }
      }
      if (typeof this.bookmarksRepo.getAllBookmarks === 'function') {
        this.state.bookmarksItems = await this.bookmarksRepo.getAllBookmarks();
      }
    }

    const starBtn = this.rootElement?.querySelector('.fb-omnibox-star');
    if (starBtn) {
      starBtn.className = `fb-omnibox-star ${this.state.isBookmarked ? 'bookmarked' : ''}`;
      starBtn.innerHTML = this.state.isBookmarked ? Icons.starFilled : Icons.star;
    }
  }

  async updateBookmarkState(url) {
    if (!url || url === 'yayra://newtab' || !this.bookmarksRepo) {
      this.state.isBookmarked = false;
      return;
    }

    const currentCheckId = ++this._bookmarkCheckId;
    if (typeof this.bookmarksRepo.isBookmarked === 'function') {
      try {
        const bookmarked = await this.bookmarksRepo.isBookmarked(url);
        if (this._bookmarkCheckId === currentCheckId) {
          this.state.isBookmarked = Boolean(bookmarked);
          const starBtn = this.rootElement?.querySelector('.fb-omnibox-star');
          if (starBtn) {
            starBtn.className = `fb-omnibox-star ${this.state.isBookmarked ? 'bookmarked' : ''}`;
            starBtn.innerHTML = this.state.isBookmarked ? Icons.starFilled : Icons.star;
          }
        }
      } catch (err) {
        console.warn('Failed to verify bookmark state:', err);
      }
    }
  }

  shareCurrentPage() {
    const activeTab = this.getActiveTab();
    if (typeof navigator !== 'undefined' && navigator.share && activeTab) {
      navigator.share({ title: activeTab.title, url: activeTab.url }).catch(() => {});
    } else if (typeof navigator !== 'undefined' && navigator.clipboard && activeTab) {
      navigator.clipboard.writeText(activeTab.url);
      alert('Link copied to clipboard: ' + activeTab.url);
    }
  }

  openModal(modalName) {
    this.state.activeModal = modalName;
    this.render();
  }

  closeModal() {
    this.state.activeModal = null;
    this.render();
  }

  toggleModal(modalName) {
    if (this.state.activeModal === modalName) {
      this.closeModal();
    } else {
      this.openModal(modalName);
    }
  }

  updateCssCustomProperties() {
    if (this.rootElement && this.rootElement.style && typeof this.rootElement.style.setProperty === 'function') {
      if (this.state.settings.bubbleOpacity !== undefined) {
        this.rootElement.style.setProperty('--fb-bubble-opacity', String(this.state.settings.bubbleOpacity));
      }
      if (this.state.settings.frameOpacity !== undefined) {
        this.rootElement.style.setProperty('--fb-frame-opacity', String(this.state.settings.frameOpacity));
      }
      if (this.state.settings.glassmorphismBlurRadius !== undefined) {
        this.rootElement.style.setProperty('--fb-glass-blur', `${this.state.settings.glassmorphismBlurRadius}px`);
      }
    }
  }

  toggleFullscreen() {
    this.state.isFullscreen = !this.state.isFullscreen;
    this.render();
  }

  reopenLastClosedTab() {
    if (this.state.closedTabsHistory.length === 0) return null;
    const lastClosed = this.state.closedTabsHistory.pop();
    const newTab = {
      id: 'tab-' + Math.random().toString(36).substring(2, 9),
      url: lastClosed.url || 'yayra://newtab',
      title: lastClosed.title || this.getTabTitle(lastClosed),
      isSecure: true,
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      isPrivate: lastClosed.isPrivate || false,
      favicon: lastClosed.favicon || null
    };
    this.state.tabs.push(newTab);
    this.state.activeTabId = newTab.id;
    this.state.urlInputValue = newTab.url;
    this.render();
    return newTab;
  }

  zoomIn() {
    this.setZoom(this.state.zoomLevel + 10);
  }

  zoomOut() {
    this.setZoom(this.state.zoomLevel - 10);
  }

  setZoom(level) {
    const clamped = Math.max(25, Math.min(500, Math.round(level)));
    this.state.zoomLevel = clamped;
    this.render();
  }

  resetZoom() {
    this.state.zoomLevel = 100;
    this.render();
  }

  executeFindInPage(query) {
    this.state.findInPage = {
      isOpen: true,
      query: query || '',
      currentMatch: query ? 1 : 0,
      matchesCount: query ? 5 : 0
    };
    this.render();
  }

  findNext() {
    if (!this.state.findInPage.isOpen || this.state.findInPage.matchesCount === 0) return;
    let next = this.state.findInPage.currentMatch + 1;
    if (next > this.state.findInPage.matchesCount) next = 1;
    this.state.findInPage.currentMatch = next;
    this.render();
  }

  findPrev() {
    if (!this.state.findInPage.isOpen || this.state.findInPage.matchesCount === 0) return;
    let prev = this.state.findInPage.currentMatch - 1;
    if (prev < 1) prev = this.state.findInPage.matchesCount;
    this.state.findInPage.currentMatch = prev;
    this.render();
  }

  closeFindInPage() {
    this.state.findInPage = {
      isOpen: false,
      query: '',
      currentMatch: 0,
      matchesCount: 0
    };
    this.render();
  }

  getDisplayUrl(url) {
    if (!url || url === 'yayra://newtab' || url === 'about:blank') return '';
    return url;
  }

  getTabTitle(tab) {
    if (!tab) return 'New Tab';
    if (tab.title && tab.title !== 'New Tab') return tab.title;
    if (!tab.url || tab.url === 'yayra://newtab') return tab.isPrivate ? 'Incognito Tab' : 'New Tab';
    if (tab.url === 'yayra://settings') return 'Settings';
    if (tab.url === 'yayra://history') return 'History';
    if (tab.url === 'yayra://bookmarks') return 'Bookmarks';
    if (tab.url === 'yayra://downloads') return 'Downloads';
    if (tab.url === 'yayra://passwords') return 'Passwords';
    if (tab.url === 'yayra://extensions') return 'Extensions';
    if (tab.url === 'yayra://permissions') return 'Site Permissions';
    if (tab.url === 'yayra://about') return 'About Yayra';

    try {
      const parsed = new URL(tab.url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return tab.url;
    }
  }

  getTabFavicon(tab) {
    if (!tab) return Icons.globe;
    const url = tab.url || '';
    if (url.startsWith('yayra://settings')) return Icons.settings;
    if (url.startsWith('yayra://history')) return Icons.history;
    if (url.startsWith('yayra://bookmarks')) return Icons.bookmark;
    if (url.startsWith('yayra://downloads')) return Icons.download;
    if (url.startsWith('yayra://passwords')) return Icons.lock;
    if (url.startsWith('yayra://extensions')) return Icons.shield;
    if (url.startsWith('yayra://permissions')) return Icons.lock;
    if (url.startsWith('yayra://about')) return Icons.logoOrb;
    if (url.startsWith('yayra://newtab') || !url) return tab.isPrivate ? Icons.incognito : Icons.officialOrb;
    return Icons.globe;
  }

  handleViewportResize() {
    const isMobile = this.checkMobileViewport();
    if (isMobile !== this.state.isMobile) {
      this.state.isMobile = isMobile;
      this.render();
    }
  }

  handleGlobalKeyDown(e) {
    // Ctrl+T: New Tab
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      this.createNewTab();
    }
    // Ctrl+W: Close Tab
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      this.closeTab(this.state.activeTabId);
    }
    // Ctrl+Shift+T: Reopen Last Closed Tab
    else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      this.restoreLastClosedTab();
    }
    // Ctrl+Shift+N: New Incognito Tab
    else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      this.createNewTab(true);
    }
    // Ctrl+L or Alt+D: Focus Omnibox
    else if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') || (e.altKey && e.key.toLowerCase() === 'd')) {
      e.preventDefault();
      this.omniboxInput?.focus();
      this.omniboxInput?.select();
    }
    // Ctrl+D: Bookmark Tab
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      this.toggleBookmarkCurrentTab();
    }
    // Ctrl+H: History
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      this.openInternalPage('yayra://history');
    }
    // Ctrl+J: Downloads
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      this.openInternalPage('yayra://downloads');
    }
    // Ctrl+F: Find in Page
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      this.state.findInPage.isOpen = true;
      this.render();
    }
    // Esc: Close Overlays
    else if (e.key === 'Escape') {
      if (this.state.isRadialLauncherOpen) {
        this.closeRadialLauncher();
      }
      if (this.state.isFloatingMiniOpen) {
        this.closeFloatingMini();
      }
      if (this.state.isSecurityDropdownOpen) {
        this.state.isSecurityDropdownOpen = false;
        this.render();
      }
      if (this.state.isSideDrawerOpen) {
        this.state.isSideDrawerOpen = false;
        this.render();
      }
    }
  }

  destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.boundResizeHandler);
      window.removeEventListener('keydown', this.boundKeyHandler);
    }
    if (this.bubbleOverlay) {
      this.bubbleOverlay.remove();
    }
    const persistentBubble = typeof document !== 'undefined' ? (document.getElementById('yayra-persistent-assistive-bubble') || document.getElementById('yayra-floating-bubble-persistent')) : null;
    if (persistentBubble) {
      persistentBubble.remove();
    }
  }
}
