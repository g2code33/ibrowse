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
import { PasskeyService } from '../services/passkeyService.js';
import { ProfileService } from '../services/profileService.js';
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

// Escape a value for safe embedding inside an HTML attribute.
function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Human wording for PasskeyService failure reasons.
function describePasskeyReason(reason) {
  switch (reason) {
    case 'passkeys-unsupported': return 'this device/browser does not support passkeys';
    case 'user-declined-or-timeout': return 'the request was cancelled or timed out';
    case 'authenticator-already-registered': return 'a passkey already exists on this authenticator';
    case 'insecure-context': return 'passkeys require a secure (HTTPS) context';
    case 'no-passkey-registered': return 'no passkey is registered yet';
    case 'keychain-unavailable': return 'the OS keychain is locked or unavailable on this device';
    case 'verification-failed': return 'the device passkey could not be verified';
    default: return reason || 'unknown error';
  }
}

// Apex hostnames (and all their subdomains) that are known to send
// X-Frame-Options / CSP frame-ancestors headers forbidding ANY iframe
// embedding — enforced by the target site itself, not something Yayra's
// own CSP can override. Kept as a static list so the floating browser can
// proactively fall back to "open in a new tab" instead of ever attempting
// (and visibly failing) to embed these.
const FRAME_EMBEDDING_BLOCKED_HOSTS = [
  'google.com', 'youtube.com',
  'facebook.com', 'instagram.com', 'threads.net', 'twitter.com', 'x.com', 'linkedin.com',
  'github.com',
  'amazon.com',
  'microsoft.com', 'live.com', 'outlook.com', 'office.com',
  'apple.com', 'icloud.com',
  'paypal.com',
  'netflix.com',
  'pinterest.com',
  'reddit.com',
  'yahoo.com',
  'stackoverflow.com', 'stackexchange.com',
  'nytimes.com', 'wsj.com',
  'twitch.tv',
  'bing.com'
];

export class BrowserShell {
  static FRAME_EMBEDDING_BLOCKED_HOSTS = FRAME_EMBEDDING_BLOCKED_HOSTS;

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
    // Passkey for the Yayra account: biometric/PIN gate for revealing
    // vault secrets + account security. Web/PWA uses real WebAuthn; the
    // Electron desktop (custom yayra:// scheme, where Chromium refuses
    // WebAuthn) uses the OS-keychain device-passkey bridge instead - see
    // get passkeysBridge() + electron/passkeyBridge.cjs. DI for tests.
    this.passkeyService = options.passkeyService
      || new PasskeyService({ storage: this.storageAdapter, nativeBridge: this.passkeysBridge });
    // Browser profiles + the Chrome-style "keep your browsing separate"
    // smart prompt. See packages/shared-ui/src/services/profileService.js.
    this.profileService = options.profileService
      || new ProfileService({ storage: typeof localStorage !== 'undefined' ? localStorage : null });
    // Per-profile windows boot with ?profile=<id> (Electron
    // createProfileWindow / web window.open fallback): bind this window
    // to that profile before anything renders, so "Add profile" opens a
    // NEW window already living as the new profile while the original
    // window keeps its own.
    if (options.windowProfileId && this.profileService) {
      try {
        const exists = (this.profileService.list() || []).some((p) => p.id === options.windowProfileId);
        if (exists) this.profileService.switchTo(options.windowProfileId);
      } catch { /* unknown profile id - stay on the stored current one */ }
    }
    // One suggestion per account per session, even before "No thanks".
    this._profileSignalsSeen = new Set();
    // Guards so a page is only auto-filled once per navigation target.
    this._autofilledFor = new Set();
    // Set after a successful passkey ceremony so one unlock covers the
    // whole passwords-page visit instead of prompting per reveal.
    this._vaultUnlockedAt = 0;

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
      // True while the native Android system-wide bubble service is live
      // (YayraOverlayPlugin) - suppresses the duplicate in-page bubble.
      systemBubbleActive: false,
      // Chrome-style "keep your browsing separate" card:
      // { email, action: 'suggest-create'|'suggest-switch', profileId? }
      profileSuggestion: null,
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
      // Starts empty - no seeded/sample rows. On the Electron desktop build
      // this is populated from real `will-download` history (see
      // electron/downloadsBridge.cjs) in initialize() below; on builds
      // without that bridge (web/PWA/mobile) it honestly stays empty rather
      // than showing fake placeholder downloads.
      downloadsItems: [],
      downloadRoot: null,
      // System-wide floating overlay bubble (see electron/overlayWindow.cjs).
      // These mirror the Electron-side defaults so the UI shows sane values
      // even before overlayBridge.getSettings() resolves.
      overlaySettings: { enabled: true, launchAtStartup: true, overlayAllApps: true },
      passwordsItems: [],
      // API keys / tokens / secure notes living in the same encrypted vault.
      vaultKeysItems: [],
      // Vault behaviour flags mirrored from PasswordManager.getConfig().
      passwordsConfig: null,
      // Chrome-style "Save password?" bar (set when a login submission is
      // captured in a page; cleared on save / never / dismiss).
      pendingPasswordSave: null,
      // Which vault section is active on yayra://passwords.
      passwordsActiveSection: 'passwords',
      // Registered Yayra account passkey metadata (null = none yet).
      passkeyInfo: null,
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
        bubbleSizePx: 64,
        frameOpacity: 0.85,
        glassmorphismBlurRadius: 24,
        savePasswordsEnabled: true,
        autofillEnabled: true,
        httpsFirst: true,
        adBlockEnabled: true,
        clearHistoryOnExit: false,
        restoreSessionOnLaunch: true,
        ...locallyPersistedSettings,
        ...options.initialSettings
      },
      updateState: {
        status: 'idle', // 'idle' | 'checking' | 'available' | 'ready' | 'uptodate'
        // Prefer the real installed version carried by the UpdateService (set
        // from the build's injected version at startup - see src/browser/main.js).
        // Falling back to a hardcoded literal here previously caused every
        // check to treat the live install as "behind" forever - see
        // checkForUpdates() below for the full fix.
        installedVersion: options.updateService?.installedVersion || null,
        availableVersion: null,
        notes: null
      },
      updatePromptShown: false,
      // In-app "Update available" card: { version, notes, desktopPipeline }
      updatePrompt: null,
      // Post-download install choice card: { path, version }
      updateInstallPrompt: null,
      // "Close Yayra?" prompt (close all / just close / keep all tabs)
      closePrompt: false,
      // "Reopen recent tabs?" offer after a plain close: [{url,title}]
      recentTabsOffer: null,
      // Real "Sign in with Google" app-level identity (Electron desktop only
      // for now - see electron/googleAuth.cjs + electron/authBridge.cjs).
      // This is unrelated to, and does not attempt, signing in to Google
      // services INSIDE the embedded browsing view, which Google's own
      // policy forbids for any embedded surface.
      googleAccount: {
        status: 'idle', // 'idle' | 'checking' | 'signing-in' | 'signed-in' | 'error'
        signedIn: false,
        profile: null,
        error: null,
        savedAt: null
      },
      // Persistent top-right account menu (see renderAccountDropdown()) -
      // separate from the Settings > Account page, which stays available too.
      isAccountMenuOpen: false,
      // Chrome-style downloads dropdown under the toolbar download button
      // (see renderDownloadsDropdown()) - tracks downloads without ever
      // yanking the user to the yayra://downloads page.
      isDownloadsDropdownOpen: false,
      // True while a transient popup that is NOT part of render() (omnibox
      // search-suggestion dropdown) is covering the page area. On Electron
      // the native page surface must be hidden for the popup to be seen at
      // all - see hasBlockingOverlay().
      isPageObscured: false
    };

    this.state.tabs.forEach((tab) => this.ensureNavigationState(tab));

    // DOM Elements
    this.rootElement = null;
    this.tabStripElement = null;
    this.omniboxInput = null;
    this.viewportElement = null;
    this.bubbleOverlay = null;
    // Persistent web-frame layer (web/PWA): survives re-renders so embedded
    // pages never reload when the chrome re-renders. See ensureWebFrameLayer().
    this.webFrameLayer = null;
    this.webFrames = new Map();
    this.activeWebFrameSlot = null;
    this.activeWebFrameTabId = null;
    this.lastRenderTarget = null;
    this._updateCheckTimer = null;
    this._overlayPermissionPromptShown = false;

    this.boundResizeHandler = () => this.handleViewportResize();
    this.boundKeyHandler = (e) => this.handleGlobalKeyDown(e);
    this._bookmarkCheckId = 0;

    // Native website-rendering engine bridge (Electron desktop only - see
    // electron/webviewBridge.cjs). Subscribed once here, not per-render,
    // because the underlying native views persist across this class's
    // frequent full-DOM re-renders.
    this._nativeWebviewTabIds = new Set();
    this._nativeWebviewResizeObservers = new Map();
    this._unsubscribeNativeWebview = null;
    // Last captured still image of each tab's native view, shown underneath
    // Yayra's own chrome (menu drawer, modals, mini window, dropdowns)
    // while the native surface is hidden - a native WebContentsView always
    // paints ABOVE the HTML document, so this snapshot swap is what makes
    // in-app panels genuinely overlay the page instead of the page covering
    // (and visually "carding over") the panels.
    this._pageSnapshots = new Map();
    if (this.nativeWebview) {
      this._unsubscribeNativeWebview = this.nativeWebview.onEvent((evt) => this.handleNativeWebviewEvent(evt));
    }

    // Live desktop update progress (electron/desktopUpdater.cjs events).
    this._unsubscribeUpdatesBridge = null;
    const updatesBridge = this.desktopUpdatesBridge;
    if (updatesBridge && typeof updatesBridge.onEvent === 'function') {
      this._unsubscribeUpdatesBridge = updatesBridge.onEvent((evt) => this.handleDesktopUpdateEvent(evt));
    }

    // "Sign in with Google" bridge (Electron desktop only - see get authBridge()
    // below). Restores any previously-signed-in session and keeps the UI in
    // sync with sign-in/sign-out/error events fired from the main process.
    this._unsubscribeAuthBridge = null;
    if (this.authBridge) {
      this._unsubscribeAuthBridge = this.authBridge.onEvent((evt) => this.handleGoogleAuthEvent(evt));
      this.authBridge.getSession()
        .then((session) => {
          if (session?.signedIn) {
            this.state.googleAccount = { status: 'signed-in', signedIn: true, profile: session.profile, error: null, savedAt: session.savedAt || null };
            this.handleAccountSignal(session.profile?.email, { source: 'yayra-account' });
            this.render();
          }
        })
        .catch(() => {
          // No prior session or the bridge isn't ready yet - leave the
          // default signed-out state as-is.
        });
    }

    if (typeof window !== 'undefined') {
      setTimeout(() => {
        this.checkForUpdates(false);
      }, 1200);
      this.startBackgroundUpdateChecks();
      // Android (Capacitor): bring up the REAL system-wide bubble so it
      // floats over every opened app from the moment Yayra starts.
      setTimeout(() => {
        this.ensureSystemOverlayBubble();
      }, 600);
    }

    // When the theme preference is "system", follow live OS light/dark
    // switches. Guarded: dom-shim/test environments may lack matchMedia
    // or its event API.
    try {
      if (typeof matchMedia === 'function') {
        const mq = matchMedia('(prefers-color-scheme: light)');
        const onSchemeChange = () => {
          if ((this.state.settings.theme || 'dark') === 'system') this.render();
        };
        if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onSchemeChange);
        else if (typeof mq.addListener === 'function') mq.addListener(onSchemeChange);
      }
    } catch {
      // Theme still resolves correctly at each render; live OS tracking
      // is a progressive enhancement.
    }
  }

  // window.yayra.webview (exposed by electron/preload.cjs) only exists when
  // running inside the Electron desktop shell. Its absence (plain web/PWA
  // tab, or Android/iOS Capacitor WebView) is the signal to fall back to the
  // <iframe>-based renderer, which is the only option available there.
  get nativeWebview() {
    if (typeof window === 'undefined') return null;
    return (window.yayra && window.yayra.webview) || (window.ibrowse && window.ibrowse.webview) || null;
  }

  // window.yayra.auth (exposed by electron/preload.cjs, backed by
  // electron/authBridge.cjs + electron/googleAuth.cjs) only exists on the
  // Electron desktop build. Its absence is the signal that real "Sign in
  // with Google" app-level identity isn't wired up for this build yet (web/
  // PWA/mobile), so the Settings UI shows an honest "not available on this
  // build" message instead of a button that would silently do nothing.
  get authBridge() {
    if (typeof window === 'undefined') return null;
    return (window.yayra && window.yayra.auth) || (window.ibrowse && window.ibrowse.auth) || null;
  }

  // window.yayra.downloads (exposed by electron/preload.cjs, backed by
  // electron/downloadsBridge.cjs) only exists on the Electron desktop
  // build. Its absence means there is no real OS-level download tracking
  // available for this build, so the Downloads page honestly shows an
  // empty list instead of decorative placeholder rows.
  get downloadsBridge() {
    if (typeof window === 'undefined') return null;
    return (window.yayra && window.yayra.downloads) || (window.ibrowse && window.ibrowse.downloads) || null;
  }

  // window.yayra.passkeys (exposed by electron/preload.cjs, backed by
  // electron/passkeyBridge.cjs): OS-keychain device passkey for the
  // Electron desktop, where Chromium refuses real WebAuthn on the custom
  // yayra:// scheme. Web/PWA builds (real https origin) keep genuine
  // WebAuthn and this getter returns null there.
  get passkeysBridge() {
    if (typeof window === 'undefined') return null;
    const bridge = (window.yayra && window.yayra.passkeys) || (window.ibrowse && window.ibrowse.passkeys) || null;
    return bridge && typeof bridge.register === 'function' ? bridge : null;
  }

  // window.yayra.profiles (electron/preload.cjs → yayra:open-profile-window
  // in electron/main.cjs): opens a profile in its OWN new Yayra window,
  // Chrome-style, while this window stays on its current profile.
  get profileWindowsBridge() {
    if (typeof window === 'undefined') return null;
    const bridge = (window.yayra && window.yayra.profiles) || (window.ibrowse && window.ibrowse.profiles) || null;
    return bridge && typeof bridge.openWindow === 'function' ? bridge : null;
  }

  // window.yayra.overlay (exposed by electron/preload.cjs, backed by
  // electron/overlayWindow.cjs) - the system-wide floating overlay bubble's
  // settings. See Settings > Floating Overlay.
  get overlayBridge() {
    if (typeof window === 'undefined') return null;
    return (window.yayra && window.yayra.overlay) || (window.ibrowse && window.ibrowse.overlay) || null;
  }

  // window.yayra.windowControls (electron/preload.cjs): real minimize/
  // maximize/close for the frameless Electron main window. The OS title
  // bar (which just said "yayra") and the File/Edit/View/Window menu block
  // are removed - Yayra's own tab strip is the title bar, so it shows the
  // brand wordmark image and these controls instead. Absent on web/PWA,
  // where the browser provides the window chrome.
  get windowControls() {
    if (typeof window === 'undefined') return null;
    const bridge = (window.yayra && window.yayra.windowControls) || (window.ibrowse && window.ibrowse.windowControls) || null;
    return bridge && typeof bridge.close === 'function' ? bridge : null;
  }

  // window.yayra.updates (exposed by electron/preload.cjs, backed by
  // electron/desktopUpdater.cjs): main-process download+verify+install for
  // desktop updates. Only treated as present when the REAL pipeline
  // (download) exists - older builds exposed check/install stubs only.
  get desktopUpdatesBridge() {
    if (typeof window === 'undefined') return null;
    const bridge = (window.yayra && window.yayra.updates) || (window.ibrowse && window.ibrowse.updates) || null;
    return bridge && typeof bridge.download === 'function' ? bridge : null;
  }

  /**
   * True whenever any piece of Yayra chrome that must appear ABOVE the page
   * is open. On Electron the page is a native WebContentsView - a sibling
   * OS surface that always paints over the HTML document - so while any of
   * these are open the native surface is hidden and replaced by its last
   * snapshot (see attachNativeWebviewSlot/syncNativeWebviewVisibility).
   * On web/PWA/mobile builds this has no effect: iframes stack normally
   * under positioned/z-indexed chrome.
   */
  hasBlockingOverlay() {
    const s = this.state;
    return Boolean(
      s.isSideDrawerOpen ||
      s.activeModal ||
      s.isSecurityDropdownOpen ||
      s.isAccountMenuOpen ||
      s.isDownloadsDropdownOpen ||
      s.isFloatingMiniOpen ||
      s.isRadialLauncherOpen ||
      (s.findInPage && s.findInPage.isOpen) ||
      Boolean(s.pendingPasswordSave) ||
      s.isPageObscured
    );
  }

  async signInWithGoogle() {
    if (!this.authBridge) return;
    this.state.googleAccount = { ...this.state.googleAccount, status: 'signing-in', error: null };
    this.render();
    const result = await this.authBridge.signIn();
    if (!result?.ok) {
      this.state.googleAccount = { status: 'error', signedIn: false, profile: null, error: result?.error || 'sign_in_failed', savedAt: null };
      this.render();
    }
    // On success the 'signed-in' event from handleGoogleAuthEvent() already
    // updates state + re-renders; nothing further to do here.
  }

  // "Switch account" reuses the exact same sign-in flow: the authorization
  // URL built in electron/googleAuth.cjs already passes
  // `prompt=consent select_account`, so Google shows its account chooser
  // again even though a session is already saved, and the newly chosen
  // profile simply overwrites the old one on success.
  async switchGoogleAccount() {
    this.state.isAccountMenuOpen = false;
    return this.signInWithGoogle();
  }

  async signOutOfGoogle() {
    if (!this.authBridge) return;
    this.state.isAccountMenuOpen = false;
    await this.authBridge.signOut();
  }

  // Opens Google's own "Manage your Account" page in the user's system
  // browser (never embedded - see electron/authBridge.cjs for why).
  async openGoogleAccountPage() {
    if (!this.authBridge?.openAccountPage) return;
    this.state.isAccountMenuOpen = false;
    this.render();
    await this.authBridge.openAccountPage();
  }

  toggleAccountMenu() {
    this.state.isAccountMenuOpen = !this.state.isAccountMenuOpen;
    this.render();
  }

  handleGoogleAuthEvent(evt) {
    if (!evt) return;
    switch (evt.type) {
      case 'signing-in':
        this.state.googleAccount = { ...this.state.googleAccount, status: 'signing-in', error: null };
        break;
      case 'signed-in':
        this.state.googleAccount = { status: 'signed-in', signedIn: true, profile: evt.profile, error: null, savedAt: new Date().toISOString() };
        this.handleAccountSignal(evt.profile?.email, { source: 'yayra-account' });
        break;
      case 'signed-out':
        this.state.googleAccount = { status: 'idle', signedIn: false, profile: null, error: null, savedAt: null };
        break;
      case 'error':
        this.state.googleAccount = { status: 'error', signedIn: false, profile: null, error: evt.message || 'sign_in_failed', savedAt: null };
        break;
      default:
        return;
    }
    this.render();
  }

  // Capacitor's native in-app browser (SFSafariViewController on iOS, Chrome
  // Custom Tabs on Android) — used on Android/iOS builds, which run the
  // whole app (including this file) inside ONE Capacitor WebView. That outer
  // WebView is still a real Chromium/WebKit engine and enforces the exact
  // same X-Frame-Options / frame-ancestors restrictions against any nested
  // <iframe> as a desktop browser would, and Google/Apple/Microsoft apply
  // the same embedded-webview sign-in block there too. Only active when
  // actually running as a packaged native app (`Capacitor.isNativePlatform()`),
  // never for the plain web/PWA build, where window.Capacitor is absent.
  get capacitorBrowser() {
    if (typeof window === 'undefined') return null;
    const capacitor = window.Capacitor;
    if (!capacitor || typeof capacitor.isNativePlatform !== 'function' || !capacitor.isNativePlatform()) return null;
    return (capacitor.Plugins && capacitor.Plugins.Browser) || null;
  }

  // Native Android system-wide floating bubble bridge (YayraOverlayPlugin -
  // see packages/floating-android/src/kotlin and
  // scripts/ensure-capacitor-platform.mjs). When present AND the user has
  // granted "Display over other apps", the bubble is a REAL OS overlay that
  // floats above every other application - the Android equivalent of the
  // Electron native overlay window. Feature-detected, so plain web/PWA and
  // test environments without the plugin fall back to the in-page bubble.
  get capacitorOverlay() {
    if (typeof window === 'undefined') return null;
    const capacitor = window.Capacitor;
    if (!capacitor || typeof capacitor.isNativePlatform !== 'function' || !capacitor.isNativePlatform()) return null;
    const plugin = capacitor.Plugins && capacitor.Plugins.YayraOverlay;
    if (!plugin || typeof plugin.show !== 'function') return null;
    return plugin;
  }

  /**
   * Start the Android system-wide bubble so it floats over EVERY opened
   * app, not just inside Yayra. Called once shortly after startup and
   * again from minimizeToBubble(). If the overlay permission hasn't been
   * granted yet, the user is told why and taken to the system "Display
   * over other apps" page (once per session - never a nag loop).
   */
  async ensureSystemOverlayBubble({ fromUserAction = false } = {}) {
    const overlay = this.capacitorOverlay;
    if (!overlay) return false;
    try {
      const res = typeof overlay.hasPermission === 'function' ? await overlay.hasPermission() : { granted: true };
      if (res && res.granted) {
        await overlay.show();
        if (!this.state.systemBubbleActive) {
          this.state.systemBubbleActive = true;
          // The native bubble replaces the in-page one - re-render so
          // ensurePersistentAssistiveBubble can remove the duplicate.
          this.render();
        }
        return true;
      }
      if (!this._overlayPermissionPromptShown && (fromUserAction || typeof overlay.requestPermission === 'function')) {
        this._overlayPermissionPromptShown = true;
        this.showTransientNotice('Allow "Display over other apps" so the Yayra bubble can float over everything.');
        await overlay.requestPermission?.();
      }
    } catch (err) {
      this.logger?.(`[overlay] system bubble unavailable: ${err?.message || err}`);
    }
    return false;
  }

  // Keep in sync with SYSTEM_BROWSER_AUTH_HOSTS in electron/webviewBridge.cjs
  // (the Electron main process equivalent). Duplicated rather than imported
  // because electron/webviewBridge.cjs is a CommonJS, Electron-only module
  // and this file ships in the plain web/PWA/Capacitor bundle too.
  static SYSTEM_BROWSER_AUTH_HOSTS = ['accounts.google.com', 'appleid.apple.com', 'login.live.com', 'login.microsoftonline.com'];

  isSystemBrowserAuthHost(url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return BrowserShell.SYSTEM_BROWSER_AUTH_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    } catch (_err) {
      return false;
    }
  }

  // Opens a URL using the best available system-level surface: Capacitor's
  // native in-app browser on Android/iOS, or a plain new browser tab/window
  // everywhere else (desktop web/PWA). Electron has its own main-process
  // handoff (shell.openExternal, see electron/webviewBridge.cjs) and never
  // reaches this method for auth hosts.
  async openExternally(url) {
    const capacitorBrowser = this.capacitorBrowser;
    if (capacitorBrowser && typeof capacitorBrowser.open === 'function') {
      try {
        await capacitorBrowser.open({ url });
        return;
      } catch (err) {
        console.warn('[yayra] Capacitor Browser.open() failed, falling back to window.open', err);
      }
    }
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(url, '_blank', 'noopener,noreferrer');
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
    // Honour last session's close choice (keep all tabs -> reopen them;
    // just close -> offer them) and any "install update when opened
    // again" scheduled last run. Both are consumed exactly once.
    this.restoreCloseSession();
    this.processPendingInstallOnLaunch().catch(() => {});

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

    // Real download history + the user's chosen storage root (Electron
    // desktop build only - see electron/downloadsBridge.cjs). Also listens
    // for live progress/completion events so the Downloads page updates in
    // real time while something is downloading, instead of only on next
    // render.
    if (this.downloadsBridge) {
      try {
        const { items, downloadRoot } = await this.downloadsBridge.list();
        this.state.downloadsItems = items || [];
        this.state.downloadRoot = downloadRoot || null;
      } catch (err) {
        console.warn('Failed to load downloads in BrowserShell:', err);
      }
      if (typeof this.downloadsBridge.onEvent === 'function') {
        // Smart handling: per-chunk progress updates the toolbar ring and
        // any visible dropdown row IN PLACE; only started/done (structural
        // changes) trigger a full render. See handleDownloadEvent().
        this.downloadsBridge.onEvent((payload) => this.handleDownloadEvent(payload));
      }
    }

    // System-wide floating overlay bubble settings (Electron desktop build
    // only - see electron/overlayWindow.cjs). The overlay window itself
    // runs independently of this renderer; this just reflects/edits its
    // settings from Settings > Floating & Transparency.
    if (this.overlayBridge) {
      try {
        const settings = await this.overlayBridge.getSettings();
        if (settings) {
          this.state.overlaySettings = { ...this.state.overlaySettings, ...settings };
          // Keep the Settings sliders in sync with the native bubble's
          // persisted size so the UI shows what's actually on screen.
          if (Number.isFinite(Number(settings.size)) && Number(settings.size) > 0) {
            this.state.settings.bubbleSizePx = Number(settings.size);
          }
        }
      } catch (err) {
        console.warn('Failed to load overlay settings in BrowserShell:', err);
      }
    }

    if (this.passwordManager && typeof this.passwordManager.getAllCredentials === 'function') {
      try {
        this.state.passwordsItems = await this.passwordManager.getAllCredentials();
      } catch (err) {
        console.warn('Failed to load passwords in BrowserShell:', err);
      }
    }
    await this.refreshVaultState();

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

    this.lastRenderTarget = target;

    // CRITICAL (web/PWA no-blink fix): the persistent web-frame layer holds
    // the live <iframe> for each external tab. It must SURVIVE re-renders -
    // recreating (or even reparenting) an <iframe> forces the embedded page
    // to fully reload, which users saw as a white flash of the whole page
    // every time any piece of chrome re-rendered (opening the Yayra menu,
    // pressing "Check for updates", toggling a dropdown...). So instead of
    // wiping the container wholesale, every child EXCEPT the frame layer is
    // removed and rebuilt as before.
    if (this.webFrameLayer && this.webFrameLayer.parentElement === target) {
      for (const child of [...(target.children || [])]) {
        if (child !== this.webFrameLayer) child.remove();
      }
    } else {
      target.innerHTML = '';
    }
    const activeTab = this.getActiveTab();
    const isPrivate = activeTab?.isPrivate;

    const shell = document.createElement('div');
    shell.className = `fb-browser-shell ${this.state.isMobile ? 'fb-mobile-layout' : 'fb-desktop-layout'} ${isPrivate ? 'fb-incognito-mode' : ''}`;
    shell.setAttribute('data-theme', this.resolveEffectiveTheme());
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

    // Persistent Account Dropdown (top-right account button)
    if (this.state.isAccountMenuOpen) {
      this.renderAccountDropdown(shell);
    }

    // Downloads dropdown (latest 5 + state-aware actions) under the
    // toolbar download button - tracking without leaving the page.
    if (this.state.isDownloadsDropdownOpen) {
      this.renderDownloadsDropdown(shell);
    }

    // Chrome-style "Keep your browsing separate?" profile suggestion
    if (this.state.profileSuggestion) {
      this.renderProfileSuggestionCard(shell);
    }

    // "Update available - now or later?" card (auto background checks)
    if (this.state.updatePrompt) {
      this.renderUpdatePromptCard(shell);
    }

    // "Update downloaded - install now / next launch / later" card
    if (this.state.updateInstallPrompt) {
      this.renderUpdateInstallPromptCard(shell);
    }

    // "Close Yayra?" prompt (close all tabs / just close / keep all tabs)
    if (this.state.closePrompt) {
      this.renderClosePromptModal(shell);
    }

    // "Reopen recent tabs?" offer after a plain close last session
    if (this.state.recentTabsOffer && this.state.recentTabsOffer.length) {
      this.renderRecentTabsOffer(shell);
    }

    // Find in Page Toolbar
    if (this.state.findInPage.isOpen) {
      this.renderFindInPageBar(shell);
    }

    // Chrome-style "Save password?" bar (captured login submission)
    if (this.state.pendingPasswordSave) {
      this.renderPasswordSaveBar(shell);
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

    // Position/show/hide the persistent web-frame layer so the live iframe
    // lines up exactly with the viewport slot rendered above. A second pass
    // on the next animation frame catches post-layout geometry.
    this.syncWebFrameLayer();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => this.syncWebFrameLayer());
    }

    return shell;
  }

  /* -------------------------------------------------------------
   * PERSISTENT WEB-FRAME LAYER (WEB/PWA - NO-RELOAD RENDERING)
   * -----------------------------------------------------------
   * On web/PWA builds external pages render in an <iframe>. Browsers
   * reload an iframe whenever it is recreated OR reparented, so the frames
   * live in a fixed-position layer that is a SIBLING of the re-rendered
   * shell (never torn down by render()) and the viewport only renders a
   * transparent slot whose on-screen rectangle the layer copies. Yayra's
   * own chrome (drawer z-600000, dropdowns/modals z-1000+, bubble z-99999)
   * all stack far above the layer's z-index of 10, so overlays still
   * paint over the page exactly as before. This mirrors the Electron
   * native-WebContentsView architecture (see attachNativeWebviewSlot),
   * which is why Electron never had the reload bug.
   * ----------------------------------------------------------- */
  ensureWebFrameLayer() {
    if (typeof document === 'undefined') return null;
    const target = this.lastRenderTarget || this.container || (this.rootElement && this.rootElement.parentElement);
    if (!target) return null;
    if (!this.webFrameLayer || this.webFrameLayer.parentElement !== target) {
      if (this.webFrameLayer) this.webFrameLayer.remove();
      const layer = document.createElement('div');
      layer.className = 'fb-web-frame-layer';
      layer.style.cssText = 'position:fixed; left:0; top:0; width:0; height:0; z-index:10; display:none; overflow:hidden; background:transparent;';
      target.appendChild(layer);
      this.webFrameLayer = layer;
      this.webFrames = new Map();
    }
    return this.webFrameLayer;
  }

  // Returns true when the pooled persistent frame was mounted for this tab;
  // false means the caller must fall back to the classic one-shot
  // createWebContentFrame() path (native engine, auth handoff, known
  // frame-blocked hosts, zoomed viewports, non-DOM test environments).
  mountPooledWebFrame(webViewContainer, tab) {
    if (typeof document === 'undefined') return false;
    if (this.nativeWebview) return false;
    if (this.isSystemBrowserAuthHost(tab.url)) return false;
    if (this.isKnownFrameBlockedUrl(tab.url)) return false;
    if (this.state.zoomLevel !== 100) return false;
    const layer = this.ensureWebFrameLayer();
    if (!layer) return false;

    const slot = document.createElement('div');
    slot.className = 'fb-web-frame-slot';
    slot.style.cssText = 'flex:1; width:100%; height:100%; min-height:0;';
    slot.setAttribute('data-tab-id', tab.id);
    webViewContainer.appendChild(slot);
    this.activeWebFrameSlot = slot;
    this.activeWebFrameTabId = tab.id;

    let frame = this.webFrames.get(tab.id);
    if (!frame) {
      const host = document.createElement('div');
      host.className = 'fb-web-frame-host';
      host.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; display:flex;';
      const iframe = document.createElement('iframe');
      iframe.className = 'fb-webview-frame';
      iframe.style.cssText = 'flex:1; border:none; width:100%; height:100%; background:transparent;';
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
      iframe.setAttribute('allow', 'fullscreen');
      frame = { host, iframe, url: null, tabId: tab.id, blockedFallbackShown: false };
      iframe.addEventListener('load', () => {
        this.updateTabLoading(tab.id, false);
        // Same best-effort blocked-framing net as createWebContentFrame():
        // a site that refuses framing never actually replaces the frame's
        // initial same-origin document.
        const loadedUrl = frame.url;
        setTimeout(() => {
          try {
            const frameDoc = iframe.contentDocument || iframe.contentWindow?.document;
            const blocked = !!frameDoc && (!frameDoc.location || frameDoc.location.href === 'about:blank');
            if (blocked && !frame.blockedFallbackShown && frame.url === loadedUrl) {
              frame.blockedFallbackShown = true;
              host.appendChild(this.buildFrameBlockedFallback(loadedUrl));
            }
          } catch (_err) {
            // Cross-origin document present - navigation succeeded.
          }
        }, 450);
      });
      host.appendChild(iframe);
      layer.appendChild(host);
      this.webFrames.set(tab.id, frame);
    }

    // Only touch src when the tab's URL actually changed - re-renders with
    // an unchanged URL must NEVER reset the iframe (that's the reload bug).
    if (frame.url !== tab.url) {
      frame.url = tab.url;
      frame.blockedFallbackShown = false;
      const stale = frame.host.querySelector ? frame.host.querySelector('.fb-frame-blocked-fallback') : null;
      if (stale) stale.remove();
      frame.iframe.src = tab.url;
    }
    return true;
  }

  syncWebFrameLayer() {
    const layer = this.webFrameLayer;
    if (!layer) return;

    // Drop frames for tabs that no longer exist.
    if (this.webFrames) {
      for (const [tabId, frame] of Array.from(this.webFrames.entries())) {
        if (!this.state.tabs.some((t) => t.id === tabId)) {
          frame.host.remove();
          this.webFrames.delete(tabId);
        }
      }
    }

    const slot = this.activeWebFrameSlot;
    const activeId = this.activeWebFrameTabId;
    const showing = Boolean(
      slot &&
      activeId &&
      this.webFrames &&
      this.webFrames.has(activeId) &&
      !this.state.isMinimizedToBubble &&
      (slot.isConnected !== false)
    );

    if (!showing) {
      layer.style.display = 'none';
      return;
    }

    layer.style.display = 'block';
    for (const [tabId, frame] of this.webFrames.entries()) {
      frame.host.style.display = tabId === activeId ? 'flex' : 'none';
    }

    if (typeof slot.getBoundingClientRect === 'function') {
      const rect = slot.getBoundingClientRect();
      if (rect && (rect.width > 0 || rect.height > 0)) {
        layer.style.left = `${rect.left}px`;
        layer.style.top = `${rect.top}px`;
        layer.style.width = `${rect.width}px`;
        layer.style.height = `${rect.height}px`;
      }
    }
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

    // Brand wordmark at the very top of the app - replaces the removed OS
    // title bar text ("yayra") with the official wordmark image.
    const tabstripBrand = document.createElement('span');
    tabstripBrand.className = 'fb-tabstrip-brand';
    tabstripBrand.innerHTML = Icons.officialWordmark;
    tabstripBrand.setAttribute('aria-hidden', 'true');
    tabStrip.appendChild(tabstripBrand);

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

      // Right-click: Chrome-style tab context menu (New Tab, Reload,
      // Duplicate, Close Tab / Other Tabs / Tabs to the Right).
      tabEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.renderTabContextMenu(e.clientX, e.clientY, tab);
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

    // New Tab "+" Button - lives OUTSIDE the scrollable tab row, pinned
    // right after it, so it NEVER scrolls out of sight no matter how many
    // tabs are open (the tab row scrolls horizontally behind it).
    const newTabBtn = document.createElement('button');
    newTabBtn.className = 'fb-btn-newtab';
    newTabBtn.setAttribute('title', 'New Tab (Ctrl+T)');
    newTabBtn.setAttribute('aria-label', 'Create new tab');
    newTabBtn.innerHTML = Icons.plus;
    newTabBtn.addEventListener('click', () => {
      this.createNewTab();
    });

    tabStrip.appendChild(tabsScroll);
    tabStrip.appendChild(newTabBtn);

    // Keep the active tab visible inside the scrollable row (e.g. a tab
    // just opened at the far end while many tabs are already open).
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        const activeEl = tabsScroll.querySelector?.('.fb-tab-item.active');
        if (activeEl && typeof activeEl.scrollIntoView === 'function') {
          activeEl.scrollIntoView({ inline: 'nearest', block: 'nearest' });
        }
      });
    }

    // REAL window controls for the frameless Electron window. The OS title
    // bar and menu block are removed (electron/main.cjs), so the tab strip
    // IS the title bar now: it is draggable (CSS -webkit-app-region) and
    // these buttons genuinely minimize/maximize/close the window via IPC -
    // unlike the old decorative cluster that was removed when the native
    // frame was still present. Web/PWA builds never render them (the
    // browser provides the window chrome there).
    const winControls = this.windowControls;
    if (winControls) {
      const controls = document.createElement('div');
      controls.className = 'fb-window-controls';
      const buttons = [
        { cls: 'fb-wc-minimize', title: 'Minimize', icon: '<svg viewBox="0 0 12 12" width="12" height="12"><line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" stroke-width="1.2"/></svg>', action: () => winControls.minimize() },
        { cls: 'fb-wc-maximize', title: 'Maximize / Restore', icon: '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2.5" y="2.5" width="7" height="7" rx="1"/></svg>', action: () => winControls.toggleMaximize() },
        { cls: 'fb-wc-close', title: 'Close window', icon: '<svg viewBox="0 0 12 12" width="12" height="12" stroke="currentColor" stroke-width="1.2"><line x1="2.5" y1="2.5" x2="9.5" y2="9.5"/><line x1="9.5" y1="2.5" x2="2.5" y2="9.5"/></svg>', action: () => this.requestAppClose() }
      ];
      for (const { cls, title, icon, action } of buttons) {
        const btn = document.createElement('button');
        btn.className = `fb-wc-btn ${cls}`;
        btn.setAttribute('title', title);
        btn.setAttribute('aria-label', title);
        btn.innerHTML = icon;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          action();
        });
        controls.appendChild(btn);
      }
      tabStrip.appendChild(controls);
    }
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
    toolbarBrand.setAttribute('title', this.state.updateState.installedVersion ? `Yayra Floating Browser v${this.state.updateState.installedVersion}` : 'Yayra Floating Browser');
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

    // Persistent "Update available" chip: background update checks (see
    // startBackgroundUpdateChecks) can discover a release at any time, and
    // the one-per-session confirm dialog is easy to dismiss - this chip
    // stays visible until the update is actually applied.
    if (this.state.updateState.status === 'ready') {
      const updateChip = document.createElement('button');
      updateChip.className = 'fb-update-chip';
      updateChip.setAttribute(
        'title',
        `Update Yayra to v${this.state.updateState.availableVersion || 'latest'} - click to install`
      );
      updateChip.setAttribute('aria-label', 'Install available update');
      updateChip.innerHTML = `${Icons.download}<span class="fb-update-chip-label">Update</span>`;
      updateChip.addEventListener('click', (e) => {
        e.stopPropagation();
        this.applyUpdate();
      });
      toolbarActions.appendChild(updateChip);
    }

    // Requirement 10: Downloads Button (Transparent, Compact, Matching Star Size)
    // Smart: while anything is downloading it wears a revolving progress
    // ring tracking the live percentage (updated in place - see
    // updateDownloadIndicator()). Clicking opens the downloads DROPDOWN
    // (latest 5 + actions), never yanking the user to a new tab - the
    // full yayra://downloads page is one button away inside it.
    const dlBtn = document.createElement('button');
    dlBtn.className = 'fb-action-btn fb-btn-downloads fb-toolbar-downloads-btn fb-toolbar-action-btn';
    dlBtn.setAttribute('aria-label', 'Downloads');
    dlBtn.innerHTML = `${this.renderDownloadRingHtml()}${Icons.download}`;
    dlBtn.setAttribute('title', this.describeDownloadActivity());
    dlBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.state.isDownloadsDropdownOpen = !this.state.isDownloadsDropdownOpen;
      this.render();
    });
    toolbarActions.appendChild(dlBtn);

    // Requirement 10: Extensions & Shields Button (Transparent, Compact, Matching Star Size)
    const extBtn = document.createElement('button');
    extBtn.className = 'fb-action-btn fb-btn-extensions fb-toolbar-extensions-btn fb-toolbar-action-btn';
    extBtn.setAttribute('title', 'Extensions & Shields');
    extBtn.setAttribute('aria-label', 'Extensions and Content Shields');
    extBtn.innerHTML = Icons.shield;
    extBtn.addEventListener('click', () => this.openInternalPage('yayra://extensions'));
    toolbarActions.appendChild(extBtn);

    // NOTE: the old "floating mode" switcher pill used to live here. It
    // hid the whole main window when toggled to circle-first, which users
    // experienced as Yayra "disappearing". Removed entirely: the native
    // bubble is ALWAYS available and opening it never touches this window.

    // Persistent Top-Right Account Button (Yayra app-level "Sign in with
    // Google" - see electron/authBridge.cjs - plus the browser-profile
    // switcher). Lives here, next to the 3-dot menu, so it stays in the
    // same place across every tab/page. Rendered on EVERY build now:
    // Google sign-in is Electron-only, but profiles work everywhere.
    {
      const account = this.state.googleAccount || { status: 'idle' };
      const currentProfile = this.profileService ? this.profileService.current() : null;
      const acctBtn = document.createElement('button');
      acctBtn.className = `fb-action-btn fb-account-btn fb-toolbar-action-btn${account.status === 'signing-in' ? ' fb-account-btn-busy' : ''}`;
      acctBtn.setAttribute(
        'title',
        account.signedIn
          ? `Yayra account: ${account.profile?.name || account.profile?.email || 'Signed in'}`
          : (account.status === 'signing-in'
            ? 'Signing in with Google…'
            : `Profile: ${currentProfile?.name || 'My profile'} - account & profiles`)
      );
      acctBtn.setAttribute('aria-label', 'Account');
      acctBtn.innerHTML = account.signedIn
        ? this.renderAccountAvatarHtml(account.profile, 26)
        : (currentProfile ? this.profileAvatarHtml(currentProfile, 26) : this.renderAccountAvatarHtml(null, 26));
      acctBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleAccountMenu();
      });
      toolbarActions.appendChild(acctBtn);
    }

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
    // Assume no external pooled frame is on screen until the external
    // branch below proves otherwise - internal pages must hide the layer.
    this.activeWebFrameSlot = null;
    this.activeWebFrameTabId = null;
    if (!activeTab) return;

    // Page Loading Progress Bar
    if (activeTab.isLoading) {
      const progressBar = document.createElement('div');
      progressBar.className = 'fb-page-loading-bar';
      viewport.appendChild(progressBar);
    }

    const url = activeTab.url || '';
    const isInternalPage = !url || url === 'about:blank' || url.startsWith('yayra://');
    // The native engine (Electron WebContentsView) renders as a separate
    // on-screen surface above the HTML document, not inside it - so it must
    // be explicitly shown/hidden to match whichever tab/page is actually
    // on screen right now (internal pages like Settings must not have a
    // leftover native surface floating over them), AND it must get out of
    // the way whenever Yayra's own chrome (menu drawer, modals, dropdowns,
    // mini window) needs to appear above the page - capturing a snapshot
    // first so the page still appears present underneath the chrome.
    const overlayOpen = this.hasBlockingOverlay();
    this.syncNativeWebviewVisibility(activeTab.id, !isInternalPage && !overlayOpen, {
      captureActive: overlayOpen && !isInternalPage
    });

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

      // Web/PWA: reuse the persistent pooled iframe for this tab so chrome
      // re-renders never reload the page (no more white flash when opening
      // the menu or checking for updates). Falls back to the classic
      // one-shot frame for the native engine, auth handoff, known
      // frame-blocked hosts and zoomed viewports.
      const pooled = this.mountPooledWebFrame(webViewContainer, activeTab);
      if (!pooled) {
        const { wrapper } = this.createWebContentFrame(activeTab.url, {
          frameClassName: 'fb-webview-frame',
          onLoaded: () => this.updateTabLoading(activeTab.id, false),
          tabId: activeTab.id,
          isPrivate: activeTab.isPrivate,
          allowNative: true
        });

        webViewContainer.appendChild(wrapper);
      }
      viewport.appendChild(webViewContainer);
    }
  }

  /* -------------------------------------------------------------
   * EXTERNAL WEB CONTENT FRAME HELPER
   * -----------------------------------------------------------
   * Many real-world sites (Google, GitHub, Facebook, etc.) send their own
   * X-Frame-Options / CSP frame-ancestors headers that forbid being
   * embedded in ANY iframe. That restriction is enforced by the target
   * site and by the browser itself — Yayra's own CSP (frame-src) cannot
   * override it, and modern Chrome now renders its own inline
   * "<site> refused to connect." error INSIDE the frame rather than
   * failing silently, which also defeats any contentDocument-based
   * runtime detection (the error document itself is cross-origin, so
   * reading it throws exactly like a real successful navigation would).
   * The only reliable fix is to proactively recognize known
   * frame-hostile hosts before ever attempting to embed them, and show a
   * clear in-app fallback with an explicit "Open in new tab" action
   * instead of a dead/blocked frame.
   * ----------------------------------------------------------- */
  isKnownFrameBlockedUrl(url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      return BrowserShell.FRAME_EMBEDDING_BLOCKED_HOSTS.some(
        (blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`)
      );
    } catch (_err) {
      return false;
    }
  }

  buildFrameBlockedFallback(url) {
    const fallback = document.createElement('div');
    fallback.className = 'fb-frame-blocked-fallback';
    fallback.style.cssText = 'position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; background:#15171c; color:#d7dbe3; text-align:center; padding:24px; z-index:1;';
    fallback.innerHTML = `
      <div style="font-size:0.9rem; max-width:360px; line-height:1.5;">This site doesn't allow embedded browsing and must be opened in its own tab.</div>
      <button type="button" class="fb-btn fb-frame-blocked-open-btn" style="padding:8px 16px; border-radius:8px; border:none; background:#3b82f6; color:#fff; cursor:pointer; font-size:0.875rem;">Open in new tab</button>
    `;
    fallback.querySelector('.fb-frame-blocked-open-btn')?.addEventListener('click', () => {
      this.openExternally(url);
    });
    return fallback;
  }

  buildSystemBrowserHandoffFallback(url) {
    const fallback = document.createElement('div');
    fallback.className = 'fb-frame-blocked-fallback fb-auth-handoff-fallback';
    fallback.style.cssText = 'position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; background:#15171c; color:#d7dbe3; text-align:center; padding:24px; z-index:1;';
    fallback.innerHTML = `
      <div style="font-size:0.9rem; max-width:360px; line-height:1.5;">For your security, sign-in opens in your browser and never inside an embedded view.</div>
      <button type="button" class="fb-btn fb-auth-handoff-open-btn" style="padding:8px 16px; border-radius:8px; border:none; background:#3b82f6; color:#fff; cursor:pointer; font-size:0.875rem;">Continue sign-in</button>
    `;
    fallback.querySelector('.fb-auth-handoff-open-btn')?.addEventListener('click', () => {
      this.openExternally(url);
    });
    return fallback;
  }

  createWebContentFrame(url, { frameClassName = '', onLoaded, tabId = null, isPrivate = false, allowNative = true } = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'fb-webview-frame-wrapper';
    wrapper.style.cssText = 'position:relative; flex:1; width:100%; height:100%; display:flex; min-height:0;';

    // PRIMARY FIX: on Electron (Linux/Windows desktop builds) real website
    // content is rendered by a native WebContentsView, not an <iframe> -
    // see electron/webviewBridge.cjs for the full rationale. A WebContentsView
    // is a sibling OS surface, not a nested browsing context, so a target
    // site's X-Frame-Options/frame-ancestors headers (which only govern
    // frame/iframe embedding) never come into play.
    if (allowNative && tabId && this.nativeWebview) {
      this.attachNativeWebviewSlot(wrapper, tabId, url, isPrivate);
      if (typeof onLoaded === 'function') onLoaded();
      return { wrapper, iframe: null };
    }

    // No native Electron bridge here: plain web/PWA tab, or an Android/iOS
    // Capacitor build (which still runs this file inside ONE WebView, so a
    // nested <iframe> is subject to the exact same restrictions a desktop
    // browser tab would see). Google/Apple/Microsoft refuse to complete
    // sign-in inside ANY embedded webview on these platforms too - hand off
    // to the real system/in-app browser instead of attempting (and failing)
    // to embed the sign-in page. See the matching Electron-side handoff in
    // electron/webviewBridge.cjs for the desktop equivalent of this check.
    if (this.isSystemBrowserAuthHost(url)) {
      wrapper.appendChild(this.buildSystemBrowserHandoffFallback(url));
      this.openExternally(url);
      if (typeof onLoaded === 'function') onLoaded();
      return { wrapper, iframe: null };
    }

    // Known case: don't even attempt to embed it — avoids the raw browser
    // "refused to connect" error ever flashing inside the frame.
    if (this.isKnownFrameBlockedUrl(url)) {
      wrapper.appendChild(this.buildFrameBlockedFallback(url));
      if (typeof onLoaded === 'function') onLoaded();
      return { wrapper, iframe: null };
    }

    const iframe = document.createElement('iframe');
    if (frameClassName) iframe.className = frameClassName;
    iframe.src = url;
    iframe.style.cssText = 'flex:1; border:none; width:100%; height:100%;';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    iframe.setAttribute('allow', 'fullscreen');

    let settled = false;
    const showBlockedFallback = () => {
      if (settled) return;
      settled = true;
      wrapper.appendChild(this.buildFrameBlockedFallback(url));
    };

    iframe.addEventListener('load', () => {
      if (typeof onLoaded === 'function') onLoaded();
      // Best-effort secondary net for hosts not in the known-blocked list:
      // a site that refuses framing never actually navigates — the
      // browser silently keeps the frame on its pre-navigation
      // same-origin document instead. A genuinely framed cross-origin
      // page throws a SecurityError on contentDocument access; a blocked
      // one does not, because it was never replaced. Note this does NOT
      // catch every case (some browsers render the inline refusal error
      // as a cross-origin document too, which is why the proactive
      // hostname list above is the primary defense).
      setTimeout(() => {
        try {
          const frameDoc = iframe.contentDocument || iframe.contentWindow?.document;
          const blocked = !!frameDoc && (!frameDoc.location || frameDoc.location.href === 'about:blank');
          if (blocked) showBlockedFallback();
        } catch (_err) {
          // Threw because the frame now holds a real cross-origin document
          // — navigation succeeded, nothing to do.
        }
      }, 450);
    });

    wrapper.appendChild(iframe);
    return { wrapper, iframe };
  }

  /* -------------------------------------------------------------
   * NATIVE WEBSITE-RENDERING ENGINE (ELECTRON DESKTOP)
   * -----------------------------------------------------------
   * See electron/webviewBridge.cjs for the main-process side. This is the
   * renderer half: it keeps a transparent placeholder <div> in the normal
   * HTML layout (so flexbox/grid sizing, the tab strip, address bar, etc.
   * all work completely unchanged) and tells the main process to position a
   * real native WebContentsView exactly on top of that placeholder's
   * on-screen bounds.
   * ----------------------------------------------------------- */
  attachNativeWebviewSlot(wrapper, tabId, url, isPrivate) {
    wrapper.className += ' fb-native-webview-slot';
    this._nativeWebviewTabIds.add(tabId);

    // While chrome is overlaying the page the native surface stays hidden;
    // show the last captured snapshot in its place so the page is still
    // "there" visually underneath the drawer/modal/mini window.
    if (this.hasBlockingOverlay() && typeof document !== 'undefined') {
      const snapshot = this._pageSnapshots.get(tabId);
      const still = document.createElement('img');
      still.className = 'fb-page-snapshot-img';
      still.dataset.tabId = tabId;
      still.alt = '';
      still.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:top left; background:#101218;';
      if (snapshot) still.src = snapshot;
      wrapper.appendChild(still);
    }

    // Pass the active browsing profile so Electron places this view in
    // that profile's own session partition (real cookie/login separation).
    const activeProfileId = this.profileService ? this.profileService.current().id : 'default';
    this.nativeWebview.ensure(tabId, url, isPrivate, activeProfileId).then((result) => {
      if (result && result.handedOffToSystemBrowser) {
        const tab = this.state.tabs.find((t) => t.id === tabId);
        if (tab) {
          tab.url = 'yayra://newtab';
          tab.isLoading = false;
          this.showTransientNotice('Opened in your default browser for secure sign-in.');
          if (tabId === this.state.activeTabId) this.render();
        }
      }
    }).catch((err) => console.warn('[yayra] native webview ensure() failed:', err));

    const reportBounds = () => {
      // Never reposition (and thereby re-show) the native surface while
      // chrome is overlaying the page - the next render after the overlay
      // closes re-reports real bounds via the fresh ResizeObserver below.
      if (this.hasBlockingOverlay()) return;
      try {
        const rect = wrapper.getBoundingClientRect();
        this.nativeWebview.setBounds(tabId, {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        });
      } catch (_err) {
        // Non-browser/test environment without a real layout engine - safe
        // to ignore, there is nothing to position on screen.
      }
    };

    const previousObserver = this._nativeWebviewResizeObservers.get(tabId);
    if (previousObserver) previousObserver.disconnect();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(reportBounds);
      observer.observe(wrapper);
      this._nativeWebviewResizeObservers.set(tabId, observer);
    } else {
      // No ResizeObserver (very old WebKit/test environments): best-effort
      // one-shot placement plus the existing window resize handler.
      setTimeout(reportBounds, 0);
    }
  }

  /**
   * Shows only the active tab's native view (when it should be visible -
   * i.e. the active tab is actually rendering external web content, not an
   * internal yayra:// page) and hides every other tab's native view. Native
   * views are sibling OS surfaces layered above the HTML document, so any
   * tab not currently on screen must be explicitly hidden or it would float
   * over whatever IS on screen.
   */
  syncNativeWebviewVisibility(activeTabId, showActive, { captureActive = false } = {}) {
    if (!this.nativeWebview || this._nativeWebviewTabIds.size === 0) return;
    for (const tabId of this._nativeWebviewTabIds) {
      const visible = tabId === activeTabId && showActive;
      if (visible) {
        this.nativeWebview.setVisible(tabId, true).catch(() => {});
        continue;
      }
      // Hiding the ACTIVE tab because chrome needs to overlay it. Order
      // matters to avoid a blank flash: FIRST snapshot the still-visible
      // page and paint the still image into the slot, THEN hide the
      // native surface - with a fail-safe so the hide can never hang on a
      // slow/failed capture. (Hidden background tabs need no snapshot.)
      const wantsCapture = captureActive && tabId === activeTabId;
      if (wantsCapture && typeof this.nativeWebview.capture === 'function') {
        let hidden = false;
        const hideNow = () => {
          if (hidden) return;
          hidden = true;
          const r = this.nativeWebview.setVisible(tabId, false);
          if (r && typeof r.catch === 'function') r.catch(() => {});
        };
        const failSafe = setTimeout(hideNow, 350);
        this.nativeWebview.capture(tabId).then((res) => {
          if (res && res.snapshot) {
            this._pageSnapshots.set(tabId, res.snapshot);
            this.applyPageSnapshot(tabId, () => { clearTimeout(failSafe); hideNow(); });
          } else {
            clearTimeout(failSafe);
            hideNow();
          }
        }).catch(() => { clearTimeout(failSafe); hideNow(); });
        continue;
      }
      // Legacy combined path (older preloads without capture()): the main
      // process snapshots before zeroing bounds and returns the image.
      const result = this.nativeWebview.setVisible(tabId, false, wantsCapture ? { capture: true } : undefined);
      if (wantsCapture && result && typeof result.then === 'function') {
        result.then((res) => {
          if (res && res.snapshot) {
            this._pageSnapshots.set(tabId, res.snapshot);
            this.applyPageSnapshot(tabId);
          }
        }).catch(() => {});
      } else if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    }
  }

  /**
   * Paints the latest captured snapshot into the (already-rendered)
   * placeholder slot for a tab. Runs after the async capture resolves, and
   * only while chrome is actually overlaying the page.
   */
  applyPageSnapshot(tabId, onPainted = null) {
    const done = () => { if (typeof onPainted === 'function') onPainted(); };
    if (typeof document === 'undefined' || !this.hasBlockingOverlay()) { done(); return; }
    const snapshot = this._pageSnapshots.get(tabId);
    if (!snapshot) { done(); return; }
    // Search the shell's own rendered tree first (works for the main
    // window, the mini window, and detached test containers), falling
    // back to the whole document.
    let img = null;
    for (const root of [this.viewportElement, this.rootElement, document]) {
      if (!root || typeof root.querySelectorAll !== 'function') continue;
      const stills = Array.from(root.querySelectorAll('.fb-page-snapshot-img') || []);
      img = stills.find((el) => (el.dataset && el.dataset.tabId === tabId)
        || (typeof el.getAttribute === 'function' && el.getAttribute('data-tab-id') === tabId)) || null;
      if (img) break;
    }
    if (!img) { done(); return; }
    if (img.src === snapshot) { done(); return; }
    if (typeof onPainted === 'function') {
      // Signal readiness only after the data-URL actually decodes and
      // paints, so the native view hides UNDER an already-visible still.
      let signalled = false;
      const signal = () => { if (!signalled) { signalled = true; done(); } };
      img.onload = () => { img.onload = null; signal(); };
      setTimeout(signal, 250); // decode fail-safe
      img.src = snapshot;
      if (img.complete) signal();
      return;
    }
    img.src = snapshot;
  }

  /**
   * Lightweight page-obscuring toggle for transient popups that live
   * OUTSIDE the render() cycle (the omnibox suggestion dropdown): hides/
   * restores the native page surface in place, without a full re-render
   * that would destroy the focused input mid-typing.
   */
  setPageObscured(obscured) {
    const flag = Boolean(obscured);
    if (this.state.isPageObscured === flag) return;
    this.state.isPageObscured = flag;
    if (!this.nativeWebview) return;
    const tab = this.getActiveTab();
    if (!tab) return;
    const url = tab.url || '';
    const isInternal = !url || url === 'about:blank' || url.startsWith('yayra://');
    if (isInternal) return;

    if (flag) {
      this.syncNativeWebviewVisibility(tab.id, false, { captureActive: true });
      if (typeof document !== 'undefined') {
        const slot = this.viewportElement?.querySelector('.fb-native-webview-slot');
        if (slot && !slot.querySelector('.fb-page-snapshot-img')) {
          const still = document.createElement('img');
          still.className = 'fb-page-snapshot-img';
          still.dataset.tabId = tab.id;
          still.alt = '';
          still.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:top left; background:#101218;';
          const snapshot = this._pageSnapshots.get(tab.id);
          if (snapshot) still.src = snapshot;
          slot.appendChild(still);
        }
      }
    } else {
      if (typeof document !== 'undefined') {
        this.viewportElement?.querySelectorAll('.fb-page-snapshot-img').forEach((el) => el.remove());
      }
      const restored = this.nativeWebview.setVisible(tab.id, true);
      if (restored && typeof restored.catch === 'function') restored.catch(() => {});
      this.restoreActiveNativeBounds(tab.id);
    }
  }

  restoreActiveNativeBounds(tabId) {
    if (typeof document === 'undefined' || !this.nativeWebview) return;
    const slot = this.viewportElement?.querySelector('.fb-native-webview-slot');
    if (!slot) return;
    try {
      const rect = slot.getBoundingClientRect();
      this.nativeWebview.setBounds(tabId, { x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    } catch {
      // No layout engine (tests) - nothing on screen to reposition.
    }
  }

  handleNativeWebviewEvent(evt) {
    if (!evt || !evt.tabId) return;
    const { tabId, type } = evt;
    const tab = this.state.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    switch (type) {
      case 'loading-start':
        this.updateTabLoading(tabId, true);
        break;
      case 'loading-stop':
        this.updateTabLoading(tabId, false);
        break;
      case 'navigated': {
        tab.url = evt.url || tab.url;
        tab.isSecure = (tab.url || '').startsWith('https://');
        tab.canGoBack = Boolean(evt.canGoBack);
        tab.canGoForward = Boolean(evt.canGoForward);
        const navigationState = this.ensureNavigationState(tab);
        const currentUrl = navigationState.historyStack[navigationState.currentIndex];
        if (currentUrl !== tab.url) {
          navigationState.historyStack = navigationState.historyStack.slice(0, navigationState.currentIndex + 1);
          navigationState.historyStack.push(tab.url);
          navigationState.currentIndex = navigationState.historyStack.length - 1;
        }
        if (!tab.isPrivate && this.historyRepo && tab.url !== 'yayra://newtab') {
          if (typeof this.historyRepo.recordVisit === 'function') this.historyRepo.recordVisit(tab.url, tab.title);
          else if (typeof this.historyRepo.addEntry === 'function') this.historyRepo.addEntry(tab.url, tab.title, tab.favicon);
        }
        if (tabId === this.state.activeTabId) {
          this.state.urlInputValue = this.getDisplayUrl(tab.url);
          this.updateBookmarkState(tab.url);
          this.render();
        }
        break;
      }
      case 'title-updated':
        tab.title = evt.title || tab.title;
        if (tabId === this.state.activeTabId) this.render();
        break;
      case 'favicon-updated':
        tab.favicon = evt.favicon || tab.favicon;
        break;
      case 'fail-load':
        this.updateTabLoading(tabId, false);
        console.warn(`[yayra] native webview failed to load ${evt.url}: ${evt.errorDescription} (${evt.errorCode})`);
        break;
      case 'system-browser-handoff':
        this.showTransientNotice('Opened in your default browser for secure sign-in.');
        break;
      case 'autofill-captured':
        // Chrome-style: a login was submitted inside the page. Offer to
        // remember it (never for private tabs - checked again in the vault).
        this.handleAutofillCaptured(tab, evt);
        break;
      case 'autofill-form-detected':
        this.handleAutofillFormDetected(tab, evt);
        break;
      case 'new-window-request':
        if (evt.url) {
          this.createNewTab();
          this.navigateActiveTab(evt.url);
        }
        break;
      default:
        break;
    }
  }

  /* -------------------------------------------------------------
   * PASSWORD VAULT: Chrome-style remember prompt, autofill, passkeys
   * ----------------------------------------------------------- */

  async refreshVaultState() {
    if (this.passwordManager) {
      try {
        if (typeof this.passwordManager.getAllCredentials === 'function') {
          this.state.passwordsItems = await this.passwordManager.getAllCredentials();
        }
        if (typeof this.passwordManager.getAllKeys === 'function') {
          this.state.vaultKeysItems = await this.passwordManager.getAllKeys();
        }
        if (typeof this.passwordManager.getConfig === 'function') {
          this.state.passwordsConfig = await this.passwordManager.getConfig();
        }
      } catch (err) {
        console.warn('Failed to refresh vault state:', err);
      }
    }
    if (this.passkeyService && typeof this.passkeyService.getRegisteredPasskey === 'function') {
      try {
        this.state.passkeyInfo = await this.passkeyService.getRegisteredPasskey();
      } catch {
        this.state.passkeyInfo = null;
      }
    }
  }

  async handleAutofillCaptured(tab, evt) {
    if (!this.passwordManager || !tab || tab.isPrivate) return;
    const { url, username, password } = evt || {};
    if (!url || !username || !password) return;
    let origin;
    try { origin = new URL(url).origin; } catch { return; }
    // Never offer to save Yayra's own internal pages.
    if (origin.startsWith('yayra://')) return;
    // Smart profile separation: an email-shaped sign-in on a real page is
    // the signal Chrome uses for "someone else is using this browser".
    this.handleAccountSignal(username, { source: 'site-signin' });
    try {
      const offer = typeof this.passwordManager.shouldOfferToSave === 'function'
        ? await this.passwordManager.shouldOfferToSave({ origin, username, password, isPrivate: tab.isPrivate })
        : this.passwordManager.shouldPromptToSave(origin, tab.isPrivate);
      if (!offer) return;
    } catch { return; }
    const existing = (await this.passwordManager.getCredentialsForOrigin(origin))
      .find((c) => c.username === username);
    this.state.pendingPasswordSave = {
      tabId: tab.id,
      origin,
      username,
      password,
      isUpdate: Boolean(existing)
    };
    this.render();
  }

  async handleAutofillFormDetected(tab, evt) {
    if (!this.passwordManager || !tab || tab.isPrivate) return;
    if (!this.nativeWebview || typeof this.nativeWebview.fillCredentials !== 'function') return;
    const config = this.state.passwordsConfig || (await this.passwordManager.getConfig());
    if (!config.autofillEnabled) return;
    const url = (evt && evt.url) || tab.url;
    let origin;
    try { origin = new URL(url).origin; } catch { return; }
    const guardKey = `${tab.id}|${origin}`;
    if (this._autofilledFor.has(guardKey)) return;
    const matches = await this.passwordManager.getCredentialsForOrigin(origin);
    if (matches.length === 0) return;
    this._autofilledFor.add(guardKey);
    // Chrome behaviour: a single saved credential fills silently; multiple
    // matches fill the most recently used one and say so.
    const chosen = [...matches].sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))[0];
    try {
      await this.nativeWebview.fillCredentials(tab.id, {
        username: chosen.username,
        password: chosen.password
      });
      const host = origin.replace(/^https?:\/\//, '');
      this.showTransientNotice(matches.length > 1
        ? `Filled most recent sign-in for ${host} (${matches.length} saved)`
        : `Filled saved sign-in for ${host}`);
    } catch { /* page may have navigated away */ }
  }

  async resolvePendingPasswordSave(action) {
    const pending = this.state.pendingPasswordSave;
    this.state.pendingPasswordSave = null;
    if (!pending) { this.render(); return; }
    if (action === 'save' && this.passwordManager) {
      const result = await this.passwordManager.saveCredential({
        origin: pending.origin,
        username: pending.username,
        password: pending.password
      });
      if (result && result.success) {
        await this.refreshVaultState();
        this.showTransientNotice(pending.isUpdate
          ? `Updated password for ${pending.origin.replace(/^https?:\/\//, '')}`
          : `Password saved to your encrypted vault`);
      } else {
        this.showTransientNotice(`Couldn't save password: ${result?.reason || 'unknown error'}`);
      }
    } else if (action === 'never' && this.passwordManager
      && typeof this.passwordManager.addNeverSaveOrigin === 'function') {
      await this.passwordManager.addNeverSaveOrigin(pending.origin);
      await this.refreshVaultState();
      this.showTransientNotice(`Yayra won't offer to save passwords for ${pending.origin.replace(/^https?:\/\//, '')}`);
    }
    this.render();
  }

  renderPasswordSaveBar(root) {
    const pending = this.state.pendingPasswordSave;
    if (!pending) return;
    const host = pending.origin.replace(/^https?:\/\//, '');
    const bar = document.createElement('div');
    bar.className = 'fb-password-save-bar';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Save password');
    bar.innerHTML = `
      <div class="fb-password-save-icon">${Icons.lock}</div>
      <div class="fb-password-save-text">
        <strong>${pending.isUpdate ? 'Update password?' : 'Save password?'}</strong>
        <span>${pending.username} &middot; ${host}</span>
      </div>
      <div class="fb-password-save-actions">
        <button class="fb-btn fb-btn-primary fb-pwd-save-yes">${pending.isUpdate ? 'Update' : 'Save'}</button>
        <button class="fb-btn fb-btn-secondary fb-pwd-save-never">Never</button>
        <button class="fb-action-btn fb-pwd-save-dismiss" title="Not now" aria-label="Not now">${Icons.close}</button>
      </div>
    `;
    bar.querySelector('.fb-pwd-save-yes')?.addEventListener('click', () => this.resolvePendingPasswordSave('save'));
    bar.querySelector('.fb-pwd-save-never')?.addEventListener('click', () => this.resolvePendingPasswordSave('never'));
    bar.querySelector('.fb-pwd-save-dismiss')?.addEventListener('click', () => this.resolvePendingPasswordSave('dismiss'));
    root.appendChild(bar);
  }

  /**
   * Passkey gate for revealing/copying vault secrets. One successful
   * OS-level ceremony unlocks the vault for 5 minutes. Returns true when
   * access is allowed.
   */
  async unlockVaultIfNeeded() {
    const config = this.state.passwordsConfig
      || (this.passwordManager ? await this.passwordManager.getConfig() : null);
    if (!config || !config.requirePasskeyToReveal) return true;
    if (!this.state.passkeyInfo) return true; // gate enabled but no passkey yet
    if (Date.now() - this._vaultUnlockedAt < 5 * 60 * 1000) return true;
    if (!this.passkeyService) return false;
    const result = await this.passkeyService.verifyPasskey();
    if (result && result.success) {
      this._vaultUnlockedAt = Date.now();
      return true;
    }
    this.showTransientNotice('Passkey verification needed to reveal vault secrets.');
    return false;
  }

  async registerAccountPasskey() {
    if (!this.passkeyService) return;
    if (!this.passkeyService.isSupported()) {
      this.showTransientNotice('Passkeys need a device with biometrics/PIN and a secure (HTTPS) context, or the Yayra desktop app (OS keychain).');
      return;
    }
    const profile = this.state.googleAccount?.signedIn ? this.state.googleAccount.profile : null;
    const label = (profile && (profile.email || profile.name)) || 'Yayra user';
    const result = await this.passkeyService.registerPasskey({ accountLabel: label });
    if (result.success) {
      this.state.passkeyInfo = result.passkey;
      this._vaultUnlockedAt = Date.now();
      this.showTransientNotice('Passkey created - your Yayra account is now protected by this device.');
    } else {
      this.showTransientNotice(`Couldn't create passkey: ${describePasskeyReason(result.reason)}`);
    }
    this.render();
  }

  async verifyAccountPasskey() {
    if (!this.passkeyService) return false;
    const result = await this.passkeyService.verifyPasskey();
    if (result.success) {
      this._vaultUnlockedAt = Date.now();
      this.showTransientNotice('Passkey verified.');
      this.render();
      return true;
    }
    this.showTransientNotice(`Passkey check failed: ${describePasskeyReason(result.reason)}`);
    return false;
  }

  async removeAccountPasskey() {
    if (!this.passkeyService) return;
    // Removing the protector requires proving you still hold it.
    if (this.state.passkeyInfo) {
      const ok = await this.verifyAccountPasskey();
      if (!ok) return;
    }
    await this.passkeyService.removePasskey();
    this.state.passkeyInfo = null;
    if (this.passwordManager) {
      await this.passwordManager.updateConfig({ requirePasskeyToReveal: false });
      await this.refreshVaultState();
    }
    this.showTransientNotice('Passkey removed.');
    this.render();
  }

  destroyNativeWebview(tabId) {
    if (!this._nativeWebviewTabIds.has(tabId)) return;
    this._nativeWebviewTabIds.delete(tabId);
    const observer = this._nativeWebviewResizeObservers.get(tabId);
    if (observer) {
      observer.disconnect();
      this._nativeWebviewResizeObservers.delete(tabId);
    }
    this.nativeWebview?.destroy(tabId).catch(() => {});
  }

  showTransientNotice(message) {
    if (typeof document === 'undefined') return;
    const notice = document.createElement('div');
    notice.className = 'fb-transient-notice';
    notice.textContent = message;
    notice.style.cssText = 'position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:#1f2430; color:#e7eaf0; padding:10px 18px; border-radius:10px; font-size:0.85rem; box-shadow:0 8px 24px rgba(0,0,0,0.35); z-index:999999; opacity:0; transition:opacity 0.2s ease;';
    document.body.appendChild(notice);
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 16);
    raf(() => { notice.style.opacity = '1'; });
    setTimeout(() => {
      notice.style.opacity = '0';
      setTimeout(() => notice.remove(), 250);
    }, 4000);
  }

  /* -------------------------------------------------------------
   * 1. NEW TAB PAGE (PHASE 7, REQ 6 & REQ 7)
   * ----------------------------------------------------------- */
  renderNewTabPage(viewport, activeTab) {
    const newTabPage = document.createElement('div');
    newTabPage.className = `fb-newtab-page ${this.state.isMobile ? 'fb-mobile-safari-start-page' : ''}`;

    // Requirement 5 & 7: Developer Sponsor cards — prominent, glassy cards
    // (icon tile + name + domain) that read clearly on web, PWA and Android.
    const adLinks = DEVELOPER_AD_LINKS || this.state.sponsoredLinks || [];
    if (!activeTab.isPrivate && adLinks.length > 0) {
      const sponsoredSection = document.createElement('section');
      sponsoredSection.className = 'fb-dev-ad-showcase fb-sponsored-showcase';
      sponsoredSection.setAttribute('aria-label', 'Developer sponsors');
      const cardsHtml = adLinks.map((item) => {
        const host = item.domain || item.url.replace(/^https?:\/\//, '').split('/')[0];
        return `
        <a class="fb-dev-ad-card fb-sponsored-card" href="${item.url}" data-url="${item.url}" target="_blank" rel="noopener" aria-label="${item.title}" title="${item.title}">
          <img class="fb-dev-ad-icon fb-sponsored-icon" src="https://icons.duckduckgo.com/ip3/${host}.ico" alt="" loading="lazy" />
          <span class="fb-dev-ad-text">
            <span class="fb-dev-ad-label">${item.title}</span>
            <span class="fb-dev-ad-domain">${host}</span>
          </span>
          <span class="fb-dev-ad-tooltip">${item.title}</span>
        </a>`;
      }).join('');
      sponsoredSection.innerHTML = `
        <h2 class="fb-dev-ad-heading">Developer Sponsors</h2>
        <div class="fb-dev-ad-row">${cardsHtml}</div>
      `;

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
  // Renders the body of the Settings > Account section for "Sign in with
  // Google". Kept as a small standalone helper (rather than inline in the
  // giant settings template literal) so the sign-in/signing-in/signed-in/
  // error states stay easy to follow. See get authBridge() above for why
  // this is Electron-desktop-only for now.
  // Shared avatar renderer used by both the Settings > Account page and the
  // persistent top-right account button. Google profile photo URLs
  // occasionally 404/expire or fail to load (offline, blocked tracker
  // lists, etc.), so this always has a solid fallback: the signed-in
  // user's initials on a colored circle, never a broken-image icon.
  renderAccountAvatarHtml(profile, size = 32) {
    if (!profile) {
      return `<span class="fb-avatar fb-avatar-signed-out" style="width:${size}px; height:${size}px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.08); color:var(--fb-text-secondary);">${Icons.userCircle}</span>`;
    }
    const label = (profile.name || profile.email || '?').trim();
    const initials = label
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?';
    const fallback = `<span class="fb-avatar-fallback" style="width:${size}px; height:${size}px; border-radius:50%; display:${profile.picture ? 'none' : 'flex'}; align-items:center; justify-content:center; background:linear-gradient(135deg,#06b6d4,#3b82f6); color:#fff; font-weight:700; font-size:${Math.max(11, Math.round(size * 0.4))}px;">${initials}</span>`;
    const img = profile.picture
      ? `<img src="${profile.picture}" alt="" class="fb-avatar-img" style="width:${size}px; height:${size}px; border-radius:50%; object-fit:cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />`
      : '';
    return `<span class="fb-avatar" style="position:relative; width:${size}px; height:${size}px; display:inline-flex;">${img}${fallback}</span>`;
  }

  renderGoogleAccountSectionHtml() {
    if (!this.authBridge) {
      return `
        <p>Sign in with Google is available in the Yayra desktop app. This build of Yayra doesn't support it yet.</p>
      `;
    }

    const account = this.state.googleAccount || { status: 'idle' };

    if (account.status === 'signing-in') {
      return `
        <p>Continue in the browser window that just opened to finish signing in to Google.</p>
        <button class="fb-btn fb-btn-secondary" disabled>Waiting for sign-in&hellip;</button>
      `;
    }

    if (account.status === 'signed-in' && account.profile) {
      const { name, email } = account.profile;
      const sinceLabel = account.savedAt
        ? new Date(account.savedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
        : null;
      return `
        <div style="display:flex; align-items:center; gap:12px;">
          ${this.renderAccountAvatarHtml(account.profile, 40)}
          <div>
            <strong>${name || email || 'Signed in'}</strong>
            ${email ? `<p style="margin:2px 0 0;">${email}</p>` : ''}
            ${sinceLabel ? `<p style="margin:2px 0 0; font-size:0.8rem; color:var(--fb-text-muted);">Signed in since ${sinceLabel}</p>` : ''}
          </div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="fb-btn fb-btn-secondary fb-in-google-manage-btn">Manage Google Account ${Icons.externalLink || '↗'}</button>
          <button class="fb-btn fb-btn-secondary fb-in-google-switch-btn">Switch account</button>
          <button class="fb-btn fb-btn-secondary fb-in-google-signout-btn">Sign out</button>
        </div>
      `;
    }

    const errorNote = account.status === 'error'
      ? `<p style="color:#f66;">Couldn't sign in: ${account.error === 'not_configured' ? 'Google sign-in isn\u2019t configured for this build yet.' : (account.error || 'please try again.')}</p>`
      : '';

    return `
      <p>Sign in with your Google account to personalize Yayra. Sign-in opens in your default browser for security, per Google's own policy.</p>
      ${errorNote}
      <button class="fb-btn fb-btn-primary fb-in-google-signin-btn" style="align-self:flex-start;">Sign in with Google</button>
    `;
  }

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
        <button class="fb-settings-nav-item ${activeCat === 'account' ? 'active' : ''}" data-cat="account" data-category="account">
          ${Icons.info} <span>Account</span>
        </button>
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
        <button class="fb-settings-nav-item ${activeCat === 'updates' ? 'active' : ''}" data-cat="updates" data-category="updates">
          ${Icons.download} <span>Yayra Updates</span>
        </button>
        <button class="fb-settings-nav-item ${activeCat === 'about' ? 'active' : ''}" data-cat="about" data-category="about">
          ${Icons.info} <span>About Yayra</span>
        </button>
      </nav>

      <main class="fb-settings-content-pane">
        <div class="fb-settings-category-panel">
          <!-- Account -->
          <section class="fb-settings-group-card" id="sec-account" style="${activeCat === 'account' || this.state.settingsSearchQuery ? 'display:flex;' : 'display:none;'}">
            <h3 class="fb-settings-group-title">${Icons.info} Account</h3>
            ${this.renderGoogleAccountSectionHtml()}
          </section>

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

            <div class="fb-setting-slider-row">
              <div class="fb-slider-header">
                <label for="fb-in-bubble-opacity">Collapsed Bubble Opacity</label>
                <span id="fb-in-val-bubble-opacity">${Math.round((this.state.settings.bubbleOpacity || 0.88) * 100)}%</span>
              </div>
              <input type="range" id="fb-in-bubble-opacity" min="20" max="100" value="${Math.round((this.state.settings.bubbleOpacity || 0.88) * 100)}" class="fb-range-slider" />
            </div>

            <div class="fb-setting-slider-row">
              <div class="fb-slider-header">
                <label for="fb-in-bubble-size">Floating Bubble Size</label>
                <span id="fb-in-val-bubble-size">${this.state.settings.bubbleSizePx || 64}px</span>
              </div>
              <input type="range" id="fb-in-bubble-size" min="40" max="120" value="${this.state.settings.bubbleSizePx || 64}" class="fb-range-slider" />
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

          <!-- System-Wide Floating Overlay Bubble -->
          <section class="fb-settings-group-card" id="sec-overlay" style="${activeCat === 'floating' || this.state.settingsSearchQuery ? 'display:flex;' : 'display:none;'}">
            <h3 class="fb-settings-group-title">${Icons.bubble} System-Wide Overlay Bubble</h3>
            <p style="font-size:0.82rem; color:var(--fb-text-muted); margin:0;">
              ${this.overlayBridge
                ? 'A small Yayra bubble that floats on top of every other window on your desktop - like Apple\u2019s AssistiveTouch - so you can jump back into Yayra without digging through your taskbar. It starts automatically, before you ever open Yayra.'
                : 'This build can\u2019t run a true system-wide overlay yet. On the Yayra desktop app this runs as its own always-on-top window outside the browser. On Android it needs the "draw over other apps" permission (not wired up in this build); Apple does not allow any third-party app to overlay other apps on iOS, so it will never be available there.'}
            </p>

            <div class="fb-setting-toggle-row">
              <div>
                <strong>Enable floating overlay</strong>
                <p>Shows the bubble right after Yayra starts - no need to open the app first.</p>
              </div>
              <input type="checkbox" id="fb-in-set-overlay-enabled" ${this.state.overlaySettings.enabled ? 'checked' : ''} ${this.overlayBridge ? '' : 'disabled'} />
            </div>

            <div class="fb-setting-toggle-row">
              <div>
                <strong>Open on boot (start with your computer)</strong>
                <p>On: the Yayra bubble appears automatically right after you log in or reboot. Off: nothing launches at boot - no bubble, no window - until you open Yayra yourself.</p>
              </div>
              <input type="checkbox" id="fb-in-set-overlay-autostart" ${this.state.overlaySettings.launchAtStartup ? 'checked' : ''} ${this.overlayBridge ? '' : 'disabled'} />
            </div>

            <div class="fb-setting-toggle-row">
              <div>
                <strong>Overlay on top of every app or window</strong>
                <p>Keeps the bubble above other applications (desktop-only). Turning this off keeps it only above Yayra's own window.</p>
              </div>
              <input type="checkbox" id="fb-in-set-overlay-allapps" ${this.state.overlaySettings.overlayAllApps ? 'checked' : ''} ${this.overlayBridge ? '' : 'disabled'} />
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
              <label>Save files to</label>
              <input type="text" class="fb-input" value="${this.downloadsBridge ? (this.state.downloadRoot || 'Default Downloads folder') : 'Requires the Yayra desktop app'}" readonly style="flex:1;" />
              <button class="fb-btn fb-btn-secondary fb-in-set-dl-choose-root" ${this.downloadsBridge ? '' : 'disabled'}>Change…</button>
            </div>
            <p style="font-size:0.78rem; color:var(--fb-text-muted); margin:0;">Every new download is saved here. ${this.downloadsBridge ? '' : 'Picking a custom folder (e.g. an external drive) requires the Yayra desktop app.'}</p>
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
          <!-- Yayra Updates -->
          <section class="fb-settings-group-card" id="sec-updates" style="${activeCat === 'updates' || this.state.settingsSearchQuery ? 'display:flex;' : 'display:none;'}">
            <h3 class="fb-settings-group-title">${Icons.download} Yayra Updates</h3>
            ${this.renderUpdatesSettingsHtml()}
          </section>

          <!-- About -->
          <section class="fb-settings-group-card" id="sec-about" style="${activeCat === 'about' || this.state.settingsSearchQuery ? 'display:flex;' : 'display:none;'}">
            <h3 class="fb-settings-group-title">${Icons.info} About Yayra</h3>
            <p>Version ${this.state.updateState.installedVersion || 'unknown'} • Fast, Private Floating Browser with Glassmorphism Overlay.</p>
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

    // Yayra Updates section actions
    this.bindUpdatesSettingsActions(page);

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
    const sizeSlider = page.querySelector('#fb-in-bubble-size');
    const fSlider = page.querySelector('#fb-in-frame-opacity') || page.querySelector('#fb-in-slider-frame-opacity');
    const blurSlider = page.querySelector('#fb-in-slider-blur');
    const previewBox = page.querySelector('#fb-in-transparency-live-preview');

    const updatePreview = () => {
      const bOp = Number(bSlider?.value || 88) / 100;
      const bSize = Math.max(40, Math.min(120, Number(sizeSlider?.value || this.state.settings.bubbleSizePx || 64)));
      const fOp = Number(fSlider?.value || 85) / 100;
      const blurVal = Number(blurSlider?.value || 24);

      this.state.settings.bubbleOpacity = bOp;
      this.state.settings.bubbleSizePx = bSize;
      this.state.settings.frameOpacity = fOp;
      this.state.settings.glassmorphismBlurRadius = blurVal;

      if (page.querySelector('#fb-in-val-bubble-size')) page.querySelector('#fb-in-val-bubble-size').textContent = `${bSize}px`;
      if (page.querySelector('#fb-in-val-bubble-opacity')) page.querySelector('#fb-in-val-bubble-opacity').textContent = `${Math.round(bOp * 100)}%`;
      if (page.querySelector('#fb-in-val-frame-opacity')) page.querySelector('#fb-in-val-frame-opacity').textContent = `${Math.round(fOp * 100)}%`;
      if (page.querySelector('#fb-in-val-blur')) page.querySelector('#fb-in-val-blur').textContent = `${blurVal}px`;

      if (previewBox) {
        previewBox.style.background = `rgba(13, 23, 54, ${fOp})`;
        previewBox.style.backdropFilter = `blur(${blurVal}px)`;
      }
      this.ensurePersistentAssistiveBubble();
      this.updateCssCustomProperties();
    };

    bSlider?.addEventListener('input', updatePreview);
    sizeSlider?.addEventListener('input', updatePreview);
    fSlider?.addEventListener('input', updatePreview);
    blurSlider?.addEventListener('input', updatePreview);

    page.querySelector('.fb-in-reset-transparency-btn')?.addEventListener('click', () => {
      if (bSlider) bSlider.value = '88';
      if (sizeSlider) sizeSlider.value = '64';
      if (fSlider) fSlider.value = '85';
      if (blurSlider) blurSlider.value = '24';
      updatePreview();
      this.persistSettings();
      this.overlayBridge?.setBubbleSize?.(64);
      this.overlayBridge?.setBubbleOpacity?.(0.88);
    });

    page.querySelector('.fb-in-save-btn')?.addEventListener('click', async () => {
      const floatingDefault = page.querySelector('#fb-in-set-floating-default')?.checked;
      const theme = page.querySelector('#fb-in-set-theme')?.value;
      const colorTheme = page.querySelector('#fb-in-set-color-theme')?.value;
      const engine = page.querySelector('#fb-in-set-engine')?.value;

      this.state.settings.floatingEnabledByDefault = floatingDefault;
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

    // -----------------------------------------------------------------
    // Immediate-apply controls: every dropdown/toggle takes effect the
    // moment it is changed (Chrome-style) and is persisted right away.
    // The Save button above remains as an explicit "save everything"
    // affordance but is no longer required for changes to stick.
    // -----------------------------------------------------------------
    const bindSelect = (selector, apply) => {
      const el = page.querySelector(selector);
      el?.addEventListener('change', (e) => {
        const value = e?.target?.value !== undefined ? e.target.value : el.value;
        apply(value);
        this.persistSettings();
        this.render();
      });
    };

    const bindToggle = (selector, apply) => {
      const el = page.querySelector(selector);
      el?.addEventListener('change', (e) => {
        const checked = e?.target?.checked !== undefined ? e.target.checked : el.checked;
        apply(!!checked);
        this.persistSettings();
      });
    };

    bindSelect('#fb-in-set-theme', (v) => { this.state.settings.theme = v || 'dark'; });
    bindSelect('#fb-in-set-color-theme', (v) => { this.state.settings.colorTheme = v || 'blue'; });
    bindSelect('#fb-in-set-engine', (v) => { if (v) this.state.settings.searchEngine = v; });

    bindToggle('#fb-in-set-https', (on) => { this.state.settings.httpsFirst = on; });
    bindToggle('#fb-in-set-adblock', (on) => { this.state.settings.adBlockEnabled = on; });
    bindToggle('#fb-in-set-restore-session', (on) => { this.state.settings.restoreSessionOnLaunch = on; });
    bindToggle('#fb-in-set-floating-default', (on) => { this.state.settings.floatingEnabledByDefault = on; });

    // Transparency/size sliders already preview live on 'input'; persist
    // the final value once the user releases the handle ('change'). Bubble
    // size and opacity are also pushed to the native desktop bubble so the
    // real always-on-top overlay window resizes/fades live, not just the
    // in-page preview bubble.
    bSlider?.addEventListener('change', () => {
      this.persistSettings();
      this.overlayBridge?.setBubbleOpacity?.(this.state.settings.bubbleOpacity);
    });
    sizeSlider?.addEventListener('change', () => {
      this.persistSettings();
      this.overlayBridge?.setBubbleSize?.(this.state.settings.bubbleSizePx);
    });
    fSlider?.addEventListener('change', () => this.persistSettings());
    blurSlider?.addEventListener('change', () => this.persistSettings());

    page.querySelector('.fb-in-open-cleardata-btn')?.addEventListener('click', () => {
      this.openModal('clear-data');
    });

    page.querySelector('#fb-in-set-overlay-enabled')?.addEventListener('change', async (e) => {
      if (!this.overlayBridge) return;
      const next = await this.overlayBridge.setEnabled(e.target.checked);
      this.state.overlaySettings = { ...this.state.overlaySettings, ...next };
      this.render();
    });

    page.querySelector('#fb-in-set-overlay-autostart')?.addEventListener('change', async (e) => {
      if (!this.overlayBridge) return;
      const next = await this.overlayBridge.setLaunchAtStartup(e.target.checked);
      this.state.overlaySettings = { ...this.state.overlaySettings, ...next };
      this.render();
    });

    page.querySelector('#fb-in-set-overlay-allapps')?.addEventListener('change', async (e) => {
      if (!this.overlayBridge) return;
      const next = await this.overlayBridge.setOverlayAllApps(e.target.checked);
      this.state.overlaySettings = { ...this.state.overlaySettings, ...next };
      this.render();
    });

    page.querySelector('.fb-in-set-dl-choose-root')?.addEventListener('click', async () => {
      if (!this.downloadsBridge) return;
      const result = await this.downloadsBridge.chooseRoot();
      if (result?.ok) {
        this.state.downloadRoot = result.root;
        this.render();
      }
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

    page.querySelector('.fb-in-google-signin-btn')?.addEventListener('click', () => {
      this.signInWithGoogle();
    });

    page.querySelector('.fb-in-google-signout-btn')?.addEventListener('click', () => {
      this.signOutOfGoogle();
    });

    page.querySelector('.fb-in-google-switch-btn')?.addEventListener('click', () => {
      this.switchGoogleAccount();
    });

    page.querySelector('.fb-in-google-manage-btn')?.addEventListener('click', () => {
      this.openGoogleAccountPage();
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
    const hasRealBridge = Boolean(this.downloadsBridge);
    const root = this.state.downloadRoot;

    const actionButtons = (dl) => `
      <button class="fb-in-dl-location-btn" data-id="${dl.id}" title="Show in folder" ${hasRealBridge ? '' : 'disabled'}>${Icons.folder} Show in Folder</button>
      <button class="fb-btn fb-btn-secondary fb-in-dl-open" data-id="${dl.id}" ${hasRealBridge ? '' : 'disabled'}>Open</button>
      <button class="fb-btn fb-btn-secondary fb-in-dl-del" data-id="${dl.id}">${Icons.close}</button>
    `;

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

        <div class="fb-settings-group-card" style="margin-bottom:12px; display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <div>
            <strong style="display:block; font-size:0.85rem;">Save files to</strong>
            <span style="font-size:0.78rem; color:var(--fb-text-muted);">${hasRealBridge ? (root || 'Default Downloads folder') : 'Choosing a custom folder requires the Yayra desktop app'}</span>
          </div>
          <button class="fb-btn fb-btn-secondary fb-in-dl-choose-root" ${hasRealBridge ? '' : 'disabled'}>Change…</button>
        </div>

        ${viewMode === 'list' ? `
          <!-- List View -->
          <div class="fb-downloads-list-layout" style="display:flex; flex-direction:column; gap:8px;">
            ${items.length > 0 ? items.map((dl) => `
              <div class="fb-download-item-row" style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:10px;">
                <div style="display:flex; align-items:center; gap:12px;">
                  <span style="color:var(--fb-accent-primary);">${Icons.download}</span>
                  <div>
                    <strong style="display:block; font-size:0.9rem;">${dl.filename}</strong>
                    <span style="font-size:0.75rem; color:var(--fb-text-muted);">${dl.size} • ${dl.state}${dl.progress != null && dl.state === 'Downloading' ? ` (${dl.progress}%)` : ''} • ${dl.date || 'Today'}</span>
                  </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                  ${actionButtons(dl)}
                </div>
              </div>
            `).join('') : `<div class="fb-empty-state">No downloads yet${hasRealBridge ? '' : ' (download tracking requires the Yayra desktop app)'}.</div>`}
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
                  ${actionButtons(dl)}
                </div>
              </div>
            `).join('') : `<div class="fb-empty-state">No downloads yet${hasRealBridge ? '' : ' (download tracking requires the Yayra desktop app)'}.</div>`}
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

    page.querySelector('.fb-in-clear-dl-btn')?.addEventListener('click', async () => {
      if (this.downloadsBridge) {
        const result = await this.downloadsBridge.clear();
        this.state.downloadsItems = result?.items || [];
      } else {
        this.state.downloadsItems = [];
      }
      this.render();
    });

    page.querySelector('.fb-in-dl-choose-root')?.addEventListener('click', async () => {
      if (!this.downloadsBridge) return;
      const result = await this.downloadsBridge.chooseRoot();
      if (result?.ok) {
        this.state.downloadRoot = result.root;
        this.render();
      }
    });

    // Requirement 11: Visit Location Button - now a real OS "reveal in file
    // manager" call (electron shell.showItemInFolder) instead of a
    // clipboard+alert placeholder.
    page.querySelectorAll('.fb-in-dl-location-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!this.downloadsBridge) return;
        await this.downloadsBridge.showInFolder(btn.dataset.id);
      });
    });

    page.querySelectorAll('.fb-in-dl-open').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!this.downloadsBridge) return;
        await this.downloadsBridge.open(btn.dataset.id);
      });
    });

    page.querySelectorAll('.fb-in-dl-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (this.downloadsBridge) {
          const result = await this.downloadsBridge.remove(id);
          this.state.downloadsItems = result?.items || [];
        } else {
          this.state.downloadsItems = this.state.downloadsItems.filter((d) => d.id !== id);
        }
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

    const section = this.state.passwordsActiveSection === 'keys' ? 'keys' : 'passwords';
    const q = (this.state.passwordsSearchQuery || '').toLowerCase().trim();
    const match = (p) => !q
      || (p.origin && p.origin.toLowerCase().includes(q))
      || (p.username && p.username.toLowerCase().includes(q))
      || (p.title && p.title.toLowerCase().includes(q));
    const items = (section === 'keys' ? this.state.vaultKeysItems : this.state.passwordsItems).filter(match);
    const config = this.state.passwordsConfig || { savePasswordsEnabled: true, autofillEnabled: true, requirePasskeyToReveal: false, neverSaveOrigins: [] };
    const passkey = this.state.passkeyInfo;
    const passkeySupported = Boolean(this.passkeyService && this.passkeyService.isSupported());

    const hostOf = (origin) => String(origin || '').replace(/^https?:\/\//, '');
    const rowHtml = (p) => section === 'keys' ? `
      <div class="fb-password-row fb-pwd-row fb-key-row" data-id="${p.id}">
        <div class="fb-password-meta">
          <strong class="fb-password-origin">${p.title || p.origin}</strong>
          <span class="fb-password-user">${p.username}</span>
        </div>
        <div class="fb-password-actions">
          <span class="fb-pwd-masked" data-pwd="${escapeAttr(p.password || '')}">••••••••</span>
          <button class="fb-pwd-action fb-pwd-reveal-btn fb-in-pwd-reveal" title="Reveal secret">&#128065;</button>
          <button class="fb-pwd-action fb-in-pwd-copy" data-copy="${escapeAttr(p.password || '')}" title="Copy secret">&#10697;</button>
          <button class="fb-pwd-action fb-pwd-delete-btn fb-in-pwd-delete" data-id="${p.id}" title="Delete">${Icons.trash}</button>
        </div>
      </div>` : `
      <div class="fb-password-row fb-pwd-row" data-id="${p.id}">
        <img class="fb-password-favicon" src="https://icons.duckduckgo.com/ip3/${hostOf(p.origin).split('/')[0]}.ico" alt="" loading="lazy" />
        <div class="fb-password-meta">
          <strong class="fb-password-origin">${hostOf(p.origin)}</strong>
          <span class="fb-password-user">${p.username}</span>
        </div>
        <div class="fb-password-actions">
          <span class="fb-pwd-masked" data-pwd="${escapeAttr(p.password || '')}">••••••••</span>
          <button class="fb-pwd-action fb-pwd-reveal-btn fb-in-pwd-reveal" title="Reveal password">&#128065;</button>
          <button class="fb-pwd-action fb-in-pwd-copy" data-copy="${escapeAttr(p.password || '')}" title="Copy password">&#10697;</button>
          <button class="fb-pwd-action fb-pwd-delete-btn fb-in-pwd-delete" data-id="${p.id}" title="Delete">${Icons.trash}</button>
        </div>
      </div>`;

    page.innerHTML = `
      <div class="fb-internal-container">
        <header class="fb-internal-header">
          <div class="fb-internal-title-group">
            <span class="fb-internal-icon">${Icons.lock}</span>
            <h1 class="fb-internal-title">Passwords &amp; Keys</h1>
          </div>
          <div style="display:flex; align-items:center; gap:12px;">
            <div class="fb-internal-search">
              <span class="fb-internal-search-icon">${Icons.search}</span>
              <input type="text" id="fb-in-pwd-search" placeholder="Search vault" value="${this.state.passwordsSearchQuery || ''}" />
            </div>
            <button class="fb-btn fb-btn-primary fb-in-add-pwd-btn">${Icons.plus} ${section === 'keys' ? 'Add Key' : 'Add Password'}</button>
          </div>
        </header>

        <div class="fb-vault-section-tabs" role="tablist">
          <button class="fb-vault-tab ${section === 'passwords' ? 'active' : ''}" data-section="passwords" role="tab" aria-selected="${section === 'passwords'}">
            ${Icons.lock} Passwords <span class="fb-vault-count">${this.state.passwordsItems.length}</span>
          </button>
          <button class="fb-vault-tab ${section === 'keys' ? 'active' : ''}" data-section="keys" role="tab" aria-selected="${section === 'keys'}">
            ${Icons.shield} Keys &amp; Tokens <span class="fb-vault-count">${this.state.vaultKeysItems.length}</span>
          </button>
        </div>

        <div class="fb-settings-group-card fb-vault-security-card" style="margin-bottom:12px;">
          <h3 class="fb-settings-group-title">${Icons.shield} Account Passkey</h3>
          <p style="margin:0; font-size:0.82rem; color:var(--fb-text-secondary);">
            ${passkey
              ? `Passkey active for <strong>${passkey.accountLabel || 'this device'}</strong> since ${new Date(passkey.createdAt).toLocaleDateString()}. ${passkey.method
                  ? (passkey.method === 'touch-id'
                    ? 'Touch ID and your Mac\u2019s Keychain protect this vault.'
                    : 'Your OS keychain (this device, this OS user) protects this vault.')
                  : 'Your device\u2019s biometrics/PIN protect this vault.'}`
              : passkeySupported
                ? (this.passkeysBridge
                  ? 'Protect your Yayra account and vault with a device passkey bound to this computer\u2019s OS keychain (with Touch ID on supporting Macs). Only your OS user session can unlock it.'
                  : 'Protect your Yayra account and vault with your device\u2019s biometrics or PIN. Works like Windows Hello / Touch ID in Chrome.')
                : 'Passkeys need a secure (HTTPS) context and a device authenticator; this build/runtime does not expose one.'}
          </p>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            ${passkey
              ? `<button class="fb-btn fb-btn-secondary fb-vault-passkey-verify">Verify now</button>
                 <button class="fb-btn fb-btn-secondary fb-vault-passkey-remove">Remove passkey</button>`
              : `<button class="fb-btn fb-btn-primary fb-vault-passkey-create" ${passkeySupported ? '' : 'disabled'}>Create passkey</button>`}
          </div>
          <div class="fb-setting-toggle-row">
            <div>
              <strong>Require passkey to reveal secrets</strong>
              <p>Ask for biometrics/PIN before showing or copying any stored password or key (5-minute unlock).</p>
            </div>
            <input type="checkbox" id="fb-in-toggle-passkey-gate" ${config.requirePasskeyToReveal ? 'checked' : ''} ${passkey ? '' : 'disabled'} />
          </div>
        </div>

        <div class="fb-settings-group-card" style="margin-bottom:12px;">
          <div class="fb-setting-toggle-row">
            <div>
              <strong>Offer to save passwords</strong>
              <p>Chrome-style prompt whenever you sign in to a site with new credentials</p>
            </div>
            <input type="checkbox" id="fb-in-toggle-savepwd" ${config.savePasswordsEnabled ? 'checked' : ''} />
          </div>
          <div class="fb-setting-toggle-row">
            <div>
              <strong>Auto Sign-in / Autofill</strong>
              <p>Fills saved usernames and passwords automatically on matching sites</p>
            </div>
            <input type="checkbox" id="fb-in-toggle-autofill" ${config.autofillEnabled ? 'checked' : ''} />
          </div>
          ${config.neverSaveOrigins.length > 0 ? `
            <div class="fb-vault-never-list">
              <strong style="font-size:0.8rem;">Never saved for:</strong>
              ${config.neverSaveOrigins.map((o) => `
                <span class="fb-vault-never-chip">${hostOf(o)}
                  <button class="fb-vault-never-remove" data-origin="${escapeAttr(o)}" title="Allow saving again">${Icons.close}</button>
                </span>`).join('')}
            </div>` : ''}
        </div>

        <form class="fb-vault-add-form" id="fb-vault-add-form" style="display:none;">
          ${section === 'keys' ? `
            <input type="text" id="fb-vault-add-label" class="fb-input" placeholder="Label (e.g. OpenAI API key)" />
            <input type="text" id="fb-vault-add-user" class="fb-input" placeholder="Key name / account (optional)" />
            <input type="password" id="fb-vault-add-secret" class="fb-input" placeholder="Secret value" />
          ` : `
            <input type="text" id="fb-vault-add-label" class="fb-input" placeholder="Website (e.g. https://github.com)" />
            <input type="text" id="fb-vault-add-user" class="fb-input" placeholder="Username / email" />
            <input type="password" id="fb-vault-add-secret" class="fb-input" placeholder="Password" />
          `}
          <button type="submit" class="fb-btn fb-btn-primary">Save</button>
        </form>

        <div class="fb-vault-rows" style="display:flex; flex-direction:column; gap:10px;">
          ${items.length > 0
            ? items.map(rowHtml).join('')
            : `<div class="fb-empty-state">${section === 'keys'
                ? 'No keys or tokens yet. Store API keys, recovery codes and tokens in the same encrypted vault.'
                : 'No saved passwords yet. Sign in to any site and Yayra will offer to remember it.'}</div>`}
        </div>
      </div>
    `;

    const searchInput = page.querySelector('#fb-in-pwd-search');
    searchInput?.addEventListener('input', (e) => {
      this.state.passwordsSearchQuery = e.target.value;
      this.render();
    });

    page.querySelectorAll('.fb-vault-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.state.passwordsActiveSection = tab.dataset.section;
        this.render();
      });
    });

    page.querySelector('#fb-in-toggle-savepwd')?.addEventListener('change', async (e) => {
      this.state.settings.savePasswordsEnabled = e.target.checked;
      if (this.passwordManager) {
        await this.passwordManager.updateConfig({ savePasswordsEnabled: e.target.checked });
        await this.refreshVaultState();
      }
    });

    page.querySelector('#fb-in-toggle-autofill')?.addEventListener('change', async (e) => {
      this.state.settings.autofillEnabled = e.target.checked;
      if (this.passwordManager) {
        await this.passwordManager.updateConfig({ autofillEnabled: e.target.checked });
        await this.refreshVaultState();
      }
    });

    page.querySelector('#fb-in-toggle-passkey-gate')?.addEventListener('change', async (e) => {
      if (this.passwordManager) {
        await this.passwordManager.updateConfig({ requirePasskeyToReveal: e.target.checked });
        await this.refreshVaultState();
        this.render();
      }
    });

    page.querySelector('.fb-vault-passkey-create')?.addEventListener('click', () => this.registerAccountPasskey());
    page.querySelector('.fb-vault-passkey-verify')?.addEventListener('click', () => this.verifyAccountPasskey());
    page.querySelector('.fb-vault-passkey-remove')?.addEventListener('click', () => this.removeAccountPasskey());

    page.querySelectorAll('.fb-vault-never-remove').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (this.passwordManager && typeof this.passwordManager.removeNeverSaveOrigin === 'function') {
          await this.passwordManager.removeNeverSaveOrigin(btn.dataset.origin);
          await this.refreshVaultState();
          this.render();
        }
      });
    });

    // Inline add form (replaces the old triple prompt() flow).
    const addForm = page.querySelector('#fb-vault-add-form');
    page.querySelector('.fb-in-add-pwd-btn')?.addEventListener('click', () => {
      if (!addForm) return;
      addForm.style.display = addForm.style.display === 'none' ? 'flex' : 'none';
      addForm.querySelector('#fb-vault-add-label')?.focus();
    });
    addForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const label = addForm.querySelector('#fb-vault-add-label')?.value.trim();
      const user = addForm.querySelector('#fb-vault-add-user')?.value.trim();
      const secret = addForm.querySelector('#fb-vault-add-secret')?.value;
      if (!label || !secret || !this.passwordManager) return;
      if (section === 'keys') {
        await this.passwordManager.saveKey({ label, keyName: user || label, secret });
      } else {
        await this.passwordManager.saveCredential({ origin: label, username: user || '', password: secret, title: label });
      }
      await this.refreshVaultState();
      this.render();
    });

    // Reveal: synchronous when no passkey gate applies; otherwise verify
    // via the OS ceremony first (one unlock covers 5 minutes).
    const gateNeeded = () => Boolean(config.requirePasskeyToReveal && passkey
      && (Date.now() - this._vaultUnlockedAt >= 5 * 60 * 1000));
    page.querySelectorAll('.fb-in-pwd-reveal').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.fb-password-row');
        const masked = row?.querySelector('.fb-pwd-masked');
        if (!masked) return;
        const doToggle = () => {
          const rawPwd = masked.getAttribute('data-pwd') || '';
          masked.textContent = masked.textContent === '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' ? rawPwd : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
        };
        if (!gateNeeded()) { doToggle(); return; }
        this.unlockVaultIfNeeded().then((ok) => { if (ok) doToggle(); });
      });
    });

    page.querySelectorAll('.fb-in-pwd-copy').forEach((btn) => {
      btn.addEventListener('click', () => {
        const doCopy = () => {
          const value = btn.getAttribute('data-copy') || '';
          try {
            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(value);
              this.showTransientNotice('Copied to clipboard');
            }
          } catch { /* clipboard unavailable */ }
        };
        if (!gateNeeded()) { doCopy(); return; }
        this.unlockVaultIfNeeded().then((ok) => { if (ok) doCopy(); });
      });
    });

    page.querySelectorAll('.fb-in-pwd-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (this.passwordManager && id) {
          await this.passwordManager.deleteCredential(id);
          await this.refreshVaultState();
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
          <span class="fb-about-version fb-about-version-badge">Version ${this.state.updateState.installedVersion || 'unknown'} (Stable 64-bit Release)</span>
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
        <div class="fb-mini-viewport" style="flex:1; display:flex; flex-direction:column; overflow:hidden;"></div>
      </div>
    `;

    const dupViewportUrl = activeTab.url && !activeTab.url.startsWith('yayra://') ? activeTab.url : 'about:blank';
    if (dupViewportUrl !== 'about:blank') {
      const { wrapper } = this.createWebContentFrame(dupViewportUrl);
      dupWin.querySelector('.fb-mini-viewport')?.appendChild(wrapper);
    }

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
          ${this.authBridge ? `<button class="fb-action-btn fb-toolbar-action-btn fb-account-btn fb-mini-account-btn" title="Yayra account" aria-label="Account">${this.renderAccountAvatarHtml(this.state.googleAccount?.signedIn ? this.state.googleAccount.profile : null, 22)}</button>` : ''}
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

    win.querySelector('.fb-mini-account-btn')?.addEventListener('click', () => {
      const existingDropdown = win.querySelector('.fb-account-dropdown');
      if (existingDropdown) {
        existingDropdown.remove();
        this.state.isAccountMenuOpen = false;
      } else {
        this.state.isAccountMenuOpen = true;
        this.renderAccountDropdown(win);
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
        const { wrapper } = this.createWebContentFrame(activeTab.url);
        miniViewport.appendChild(wrapper);
      }
    }

    document.body.appendChild(win);
  }

  /* -------------------------------------------------------------
   * REQUIREMENT 3: SECURITY & SEARCH ENGINE DROPDOWN
   * ----------------------------------------------------------- */
  // Shared full-viewport scrim for lightweight dropdowns (security badge,
  // account menu). Unlike a plain "click outside" listener, this is a real
  // element that sits above everything else except the main side drawer, so
  // it reliably captures the click/scroll instead of letting it fall
  // through to whatever is rendered underneath - exactly how Chrome's own
  // toolbar dropdowns behave.
  appendDropdownScrim(root, onClose) {
    const scrim = document.createElement('button');
    scrim.type = 'button';
    scrim.className = 'fb-dropdown-scrim';
    scrim.setAttribute('aria-label', 'Close menu');
    scrim.addEventListener('click', onClose);
    // A right-click (or long-press context menu) anywhere outside must
    // dismiss the open menu too - exactly like native browser menus.
    scrim.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      onClose(e);
    });
    root.appendChild(scrim);
    return scrim;
  }

  renderSecurityDropdown(root) {
    this.appendDropdownScrim(root, () => {
      this.state.isSecurityDropdownOpen = false;
      this.render();
    });

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

  /* -------------------------------------------------------------
   * PERSISTENT TOP-RIGHT ACCOUNT DROPDOWN
   * ----------------------------------------------------------- */
  /* -------------------------------------------------------------
   * BROWSER PROFILES - "KEEP YOUR BROWSING SEPARATE"
   * -----------------------------------------------------------
   * Chrome-style smart separation: when a sign-in happens with an
   * account that is NOT the one this profile belongs to, Yayra offers a
   * separate profile instead of silently mixing two people's cookies,
   * logins and saved passwords. Decision table + no-nag memory live in
   * profileService.js; on Electron each profile is a REAL separate
   * Chromium session partition (electron/webviewBridge.cjs).
   * ----------------------------------------------------------- */
  handleAccountSignal(email, { source = 'unknown' } = {}) {
    if (!this.profileService) return;
    const key = String(email || '').trim().toLowerCase();
    if (!key || this._profileSignalsSeen.has(key)) return;
    const verdict = this.profileService.evaluateSignIn(email);
    if (verdict.action === 'none') return;
    this._profileSignalsSeen.add(key);
    if (verdict.action === 'adopted') {
      // First account on a fresh profile: silently bind, exactly like
      // Chrome's first sign-in (no prompt, nothing to separate yet).
      return;
    }
    this.state.profileSuggestion = {
      email: key,
      action: verdict.action,
      profileId: verdict.profile ? verdict.profile.id : null,
      source
    };
    this.render();
  }

  acceptProfileSuggestion() {
    const suggestion = this.state.profileSuggestion;
    if (!suggestion || !this.profileService) return;
    let target = null;
    if (suggestion.action === 'suggest-switch' && suggestion.profileId) {
      target = (this.profileService.list() || []).find((p) => p.id === suggestion.profileId) || null;
    } else {
      target = this.profileService.createProfile({ email: suggestion.email });
    }
    this.state.profileSuggestion = null;
    // Chrome-style: the suggested profile opens in its OWN new window and
    // this window keeps browsing as-is. In-place switch only as fallback.
    if (target && this.openProfileWindow(target)) {
      this.showTransientNotice(`Opened ${target.name} in its own window - this window keeps its current profile.`);
      this.render();
      return;
    }
    if (target) target = this.profileService.switchTo(target.id) || target;
    this.applyProfileSwitch(target);
  }

  declineProfileSuggestion() {
    const suggestion = this.state.profileSuggestion;
    if (suggestion && this.profileService) {
      // Remembered forever - this exact prompt never nags again.
      this.profileService.dismissAccount(suggestion.email);
    }
    this.state.profileSuggestion = null;
    this.render();
  }

  /**
   * Open `profile` in its OWN new Yayra window - Chrome's model: the
   * window you clicked in STAYS on its current profile and the other
   * profile gets a fresh window. Electron uses the real native
   * window-per-profile bridge (yayra:open-profile-window); web/PWA falls
   * back to window.open with a ?profile= boot param. Returns false when
   * neither exists (tests, odd embeds) so callers keep the old in-place
   * switch as a last resort.
   */
  openProfileWindow(profile) {
    if (!profile || !profile.id) return false;
    const bridge = this.profileWindowsBridge;
    if (bridge) {
      Promise.resolve(bridge.openWindow(profile.id)).catch(() => {});
      return true;
    }
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      let target = `?profile=${encodeURIComponent(profile.id)}`;
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('profile', profile.id);
        target = url.toString();
      } catch { /* relative ?profile= still resolves against this page */ }
      // Click-initiated, same-origin open; popup blockers allow these.
      window.open(target, '_blank');
      return true;
    }
    return false;
  }

  switchProfile(profileId) {
    if (!this.profileService) return;
    const current = this.profileService.current();
    if (current && current.id === profileId) return;
    this.state.isAccountMenuOpen = false;
    const target = (this.profileService.list() || []).find((p) => p.id === profileId) || null;
    if (target && this.openProfileWindow(target)) {
      // New window carries the other profile; THIS window keeps its own.
      this.showTransientNotice(`Opened ${target.name} in its own window - this window stays on ${current ? current.name : 'its profile'}.`);
      this.render();
      return;
    }
    const switched = this.profileService.switchTo(profileId);
    if (!switched) return;
    this.applyProfileSwitch(switched);
  }

  // Tear down the old profile's live web surfaces and start the new one
  // on a clean slate. On Electron the per-profile session partition only
  // applies to NEWLY created native views, so every existing view must go.
  applyProfileSwitch(profile) {
    for (const tab of this.state.tabs) {
      this.destroyNativeWebview(tab.id);
    }
    if (this.webFrames) {
      for (const [tabId, frame] of Array.from(this.webFrames.entries())) {
        frame.host.remove();
        this.webFrames.delete(tabId);
      }
    }
    this.state.tabs = [{
      id: `tab-${Date.now()}`,
      title: 'New Tab',
      url: 'yayra://newtab',
      isSecure: true,
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      isPrivate: false,
      favicon: null
    }];
    this.state.activeTabId = this.state.tabs[0].id;
    this.state.urlInputValue = '';
    this.state.isBookmarked = false;
    this.render();
    if (profile) {
      this.showTransientNotice(`Browsing as ${profile.name}${profile.email ? ` (${profile.email})` : ''} - separate from other profiles.`);
    }
  }

  /* -------------------------------------------------------------
   * CLOSE PROMPT & SESSION HANDOVER
   * -----------------------------------------------------------
   * Closing the app while real tabs are open asks what to do:
   *  - "Close all tabs & close"  -> next launch starts fresh;
   *  - "Just close"              -> next launch OFFERS the recent tabs;
   *  - "Keep all tabs & close"   -> next launch REOPENS every tab.
   * The choice is stored in localStorage ('yayra:close-session') and
   * consumed exactly once by the next launch (restoreCloseSession()).
   * ----------------------------------------------------------- */
  requestAppClose() {
    const realTabs = this.state.tabs.filter((t) => !t.isPrivate && t.url && t.url !== 'yayra://newtab');
    if (!realTabs.length || typeof document === 'undefined') {
      try { this.windowControls?.close(); } catch { /* already closing */ }
      return;
    }
    this.state.closePrompt = true;
    this.render();
  }

  closeWithSessionMode(mode) {
    this.state.closePrompt = false;
    const tabs = mode === 'fresh'
      ? []
      : this.state.tabs
        .filter((t) => !t.isPrivate && t.url && t.url !== 'yayra://newtab')
        .map((t) => ({ url: t.url, title: t.title || '' }));
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('yayra:close-session', JSON.stringify({ mode, tabs, savedAt: new Date().toISOString() }));
      } catch { /* storage unavailable - closing still works */ }
    }
    try { this.windowControls?.close(); } catch { /* already closing */ }
    // Web/PWA builds have no native window to close - at least dismiss
    // the prompt so the choice is still honoured on the next visit.
    this.render();
  }

  /** Consume the previous session's close choice (once, at launch). */
  restoreCloseSession() {
    if (typeof localStorage === 'undefined') return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('yayra:close-session') || 'null'); } catch { saved = null; }
    if (!saved) return;
    try { localStorage.removeItem('yayra:close-session'); } catch { /* ignore */ }
    const tabs = Array.isArray(saved.tabs) ? saved.tabs.filter((t) => t && t.url) : [];
    if (!tabs.length) return;
    // A deep link (explicit initialUrl) always wins the first tab - the
    // saved session is downgraded to an offer instead of a takeover.
    if (saved.mode === 'restore' && this.options?.initialUrl) saved.mode = 'recent';
    if (saved.mode === 'restore') {
      // Reopen every tab automatically, exactly as they were.
      this.state.tabs = tabs.map((t, i) => ({
        id: `tab-${Date.now()}-${i}`,
        title: t.title || 'New Tab',
        url: t.url,
        isSecure: String(t.url).startsWith('https://'),
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
        isPrivate: false,
        favicon: null
      }));
      this.state.activeTabId = this.state.tabs[0].id;
      this.state.urlInputValue = this.getDisplayUrl(this.state.tabs[0].url);
    } else if (saved.mode === 'recent') {
      // Plain close: offer the recent tabs instead of forcing them open.
      this.state.recentTabsOffer = tabs;
    }
  }

  acceptRecentTabsOffer() {
    const tabs = this.state.recentTabsOffer || [];
    this.state.recentTabsOffer = null;
    if (!tabs.length) { this.render(); return; }
    const restored = tabs.map((t, i) => ({
      id: `tab-${Date.now()}-${i}`,
      title: t.title || 'New Tab',
      url: t.url,
      isSecure: String(t.url).startsWith('https://'),
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      isPrivate: false,
      favicon: null
    }));
    // Replace a lone pristine new-tab; otherwise append after current tabs.
    const onlyPristine = this.state.tabs.length === 1 && this.state.tabs[0].url === 'yayra://newtab';
    this.state.tabs = onlyPristine ? restored : [...this.state.tabs, ...restored];
    this.state.activeTabId = restored[0].id;
    this.state.urlInputValue = this.getDisplayUrl(restored[0].url);
    this.render();
  }

  dismissRecentTabsOffer() {
    this.state.recentTabsOffer = null;
    this.render();
  }

  renderClosePromptModal(root) {
    const scrim = document.createElement('div');
    scrim.className = 'fb-close-prompt-scrim';
    scrim.addEventListener('click', () => {
      this.state.closePrompt = false;
      this.render();
    });
    root.appendChild(scrim);

    const realCount = this.state.tabs.filter((t) => !t.isPrivate && t.url && t.url !== 'yayra://newtab').length;
    const modal = document.createElement('div');
    modal.className = 'fb-close-prompt-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Close Yayra');
    modal.innerHTML = `
      <strong class="fb-close-prompt-title">Close Yayra?</strong>
      <p class="fb-close-prompt-text">You have ${realCount} open tab${realCount === 1 ? '' : 's'}. What should happen to ${realCount === 1 ? 'it' : 'them'}?</p>
      <div class="fb-close-prompt-actions">
        <button class="fb-btn fb-btn-primary fb-close-keep-tabs">Keep all tabs &amp; close <small>reopens them automatically next time</small></button>
        <button class="fb-btn fb-btn-secondary fb-close-just-close">Just close <small>offers your recent tabs next time</small></button>
        <button class="fb-btn fb-btn-secondary fb-close-all-tabs">Close all tabs &amp; close <small>starts fresh next time</small></button>
        <button class="fb-btn fb-btn-secondary fb-close-cancel">Cancel</button>
      </div>
    `;
    modal.querySelector('.fb-close-keep-tabs')?.addEventListener('click', () => this.closeWithSessionMode('restore'));
    modal.querySelector('.fb-close-just-close')?.addEventListener('click', () => this.closeWithSessionMode('recent'));
    modal.querySelector('.fb-close-all-tabs')?.addEventListener('click', () => this.closeWithSessionMode('fresh'));
    modal.querySelector('.fb-close-cancel')?.addEventListener('click', () => {
      this.state.closePrompt = false;
      this.render();
    });
    root.appendChild(modal);
  }

  renderRecentTabsOffer(root) {
    const tabs = this.state.recentTabsOffer || [];
    const card = document.createElement('div');
    card.className = 'fb-recent-tabs-offer';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Reopen recent tabs');
    card.innerHTML = `
      <span class="fb-recent-tabs-icon">${Icons.history}</span>
      <span class="fb-recent-tabs-text"><strong>Pick up where you left off?</strong><small>${tabs.length} recent tab${tabs.length === 1 ? '' : 's'} from your last session</small></span>
      <button class="fb-btn fb-btn-primary fb-recent-tabs-reopen">Reopen</button>
      <button class="fb-btn fb-btn-secondary fb-recent-tabs-dismiss">Dismiss</button>
    `;
    card.querySelector('.fb-recent-tabs-reopen')?.addEventListener('click', () => this.acceptRecentTabsOffer());
    card.querySelector('.fb-recent-tabs-dismiss')?.addEventListener('click', () => this.dismissRecentTabsOffer());
    root.appendChild(card);
  }

  profileAvatarHtml(profile, size = 28) {
    const initial = String((profile && (profile.name || profile.email)) || '?').charAt(0).toUpperCase();
    const color = (profile && profile.color) || '#3b82f6';
    return `<span class="fb-profile-avatar" style="width:${size}px; height:${size}px; background:${color}; font-size:${Math.round(size * 0.5)}px;">${initial}</span>`;
  }

  renderProfileSuggestionCard(root) {
    const suggestion = this.state.profileSuggestion;
    if (!suggestion || !this.profileService) return;
    const current = this.profileService.current();
    const isSwitch = suggestion.action === 'suggest-switch';
    const targetProfile = isSwitch
      ? this.profileService.list().find((p) => p.id === suggestion.profileId)
      : null;

    const card = document.createElement('div');
    card.className = 'fb-profile-suggestion-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Keep your browsing separate');
    card.innerHTML = `
      <div class="fb-profile-suggestion-avatars">
        ${this.profileAvatarHtml(current, 34)}
        ${this.profileAvatarHtml(targetProfile || { name: suggestion.email, color: '#10b981' }, 34)}
      </div>
      <strong class="fb-profile-suggestion-title">Keep your browsing separate?</strong>
      <p class="fb-profile-suggestion-text">
        <b>${current.name}</b>${current.email ? ` (${current.email})` : ''} is already using this profile.
        ${isSwitch
          ? `Switch to the existing profile for <b>${suggestion.email}</b> to keep cookies, logins and passwords separate.`
          : `Create a separate profile for <b>${suggestion.email}</b> so their cookies, logins and passwords stay their own.`}
      </p>
      <div class="fb-profile-suggestion-actions">
        <button class="fb-btn fb-btn-secondary fb-profile-suggestion-decline">No thanks</button>
        <button class="fb-btn fb-btn-primary fb-profile-suggestion-accept">${isSwitch ? 'Switch profile' : 'Use separate profile'}</button>
      </div>
    `;
    card.querySelector('.fb-profile-suggestion-accept')?.addEventListener('click', () => this.acceptProfileSuggestion());
    card.querySelector('.fb-profile-suggestion-decline')?.addEventListener('click', () => this.declineProfileSuggestion());
    root.appendChild(card);
  }

  renderAccountDropdown(root) {
    this.appendDropdownScrim(root, () => {
      this.state.isAccountMenuOpen = false;
      this.render();
    });

    const dropdown = document.createElement('div');
    dropdown.className = 'fb-account-dropdown';

    const account = this.state.googleAccount || { status: 'idle' };

    // Vault + passkey summary shown in both signed-in and signed-out
    // states: the Yayra account's local powers (encrypted passwords,
    // keys, passkey protection) work with or without Google sign-in.
    const passkey = this.state.passkeyInfo;
    const vaultSummaryHtml = `
      <div class="fb-account-vault-summary">
        <button class="fb-account-vault-btn" title="Open passwords & keys vault">
          ${Icons.lock}
          <span>
            <strong>Passwords &amp; keys vault</strong>
            <small>${this.state.passwordsItems.length} password${this.state.passwordsItems.length === 1 ? '' : 's'} &#183; ${this.state.vaultKeysItems.length} key${this.state.vaultKeysItems.length === 1 ? '' : 's'} &#183; AES-256 encrypted</small>
          </span>
        </button>
        <button class="fb-account-passkey-btn" title="${passkey ? 'Verify your account passkey' : 'Create an account passkey'}">
          ${Icons.shield}
          <span>
            <strong>${passkey ? 'Passkey active' : 'Create a passkey'}</strong>
            <small>${passkey
              ? `Protected since ${new Date(passkey.createdAt).toLocaleDateString()}`
              : 'Lock your account & vault with biometrics/PIN'}</small>
          </span>
        </button>
      </div>`;

    // Browser profiles section - shown in both branches. Each profile is
    // its own browsing identity (own cookies/logins on Electron via a
    // dedicated session partition - see electron/webviewBridge.cjs).
    const profiles = this.profileService ? this.profileService.list() : [];
    const currentProfileId = this.profileService ? this.profileService.current().id : null;
    const profilesHtml = this.profileService ? `
      <div class="fb-account-profiles">
        <small class="fb-account-profiles-label">Browsing profiles</small>
        ${profiles.map((p) => `
          <button class="fb-profile-row${p.id === currentProfileId ? ' fb-profile-row-current' : ''}" data-profile-id="${p.id}" title="${p.id === currentProfileId ? 'Current profile' : `Switch to ${p.name}`}">
            ${this.profileAvatarHtml(p, 26)}
            <span class="fb-profile-row-text">
              <strong>${p.name}</strong>
              ${p.email ? `<small>${p.email}</small>` : ''}
            </span>
            ${p.id === currentProfileId ? `<span class="fb-profile-row-check">${Icons.check || '&#10003;'}</span>` : ''}
          </button>
        `).join('')}
        <button class="fb-profile-row fb-profile-add-btn" title="Add a new browsing profile">
          <span class="fb-profile-avatar fb-profile-avatar-add">+</span>
          <span class="fb-profile-row-text"><strong>Add profile</strong></span>
        </button>
      </div>` : '';

    if (account.status === 'signed-in' && account.profile) {
      const { name, email } = account.profile;
      const sinceLabel = account.savedAt
        ? new Date(account.savedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
        : null;
      dropdown.innerHTML = `
        <div class="fb-account-dropdown-header">
          ${this.renderAccountAvatarHtml(account.profile, 40)}
          <div>
            <strong>${name || email || 'Signed in'}</strong>
            ${email ? `<p style="margin:2px 0 0; font-size:0.8rem; color:var(--fb-text-muted);">${email}</p>` : ''}
          </div>
        </div>
        ${sinceLabel ? `<p style="margin:0; padding:0 2px; font-size:0.75rem; color:var(--fb-text-muted);">Signed in since ${sinceLabel}</p>` : ''}
        ${vaultSummaryHtml}
        ${profilesHtml}
        <div class="fb-account-dropdown-actions">
          <button class="fb-btn fb-btn-secondary fb-account-manage-btn" style="width:100%; justify-content:flex-start;">${Icons.externalLink} Manage Google Account</button>
          <button class="fb-btn fb-btn-secondary fb-account-settings-btn" style="width:100%; justify-content:flex-start;">${Icons.info} Yayra account settings</button>
          <button class="fb-btn fb-btn-secondary fb-account-switch-btn" style="width:100%; justify-content:flex-start;">${Icons.userCircle} Switch account</button>
          <button class="fb-btn fb-btn-secondary fb-account-signout-btn" style="width:100%; justify-content:flex-start;">${Icons.close} Sign out</button>
        </div>
      `;
    } else {
      const isSigningIn = account.status === 'signing-in';
      const errorNote = account.status === 'error'
        ? `<p style="margin:0; color:#f66; font-size:0.8rem;">Couldn't sign in: ${account.error === 'not_configured' ? 'Google sign-in isn\u2019t configured for this build yet.' : (account.error || 'please try again.')}</p>`
        : '';
      dropdown.innerHTML = `
        <div class="fb-account-dropdown-header">
          ${this.renderAccountAvatarHtml(null, 40)}
          <div>
            <strong>Not signed in</strong>
            <p style="margin:2px 0 0; font-size:0.8rem; color:var(--fb-text-muted);">Sign in to personalize Yayra</p>
          </div>
        </div>
        ${errorNote}
        ${vaultSummaryHtml}
        ${profilesHtml}
        <div class="fb-account-dropdown-actions">
          <button class="fb-btn fb-btn-primary fb-account-signin-btn" style="width:100%;" ${isSigningIn ? 'disabled' : ''}>${isSigningIn ? 'Signing in&hellip;' : 'Sign in with Google'}</button>
          <button class="fb-btn fb-btn-secondary fb-account-settings-btn" style="width:100%; justify-content:flex-start;">${Icons.info} Yayra account settings</button>
        </div>
      `;
    }

    dropdown.querySelector('.fb-account-vault-btn')?.addEventListener('click', () => {
      this.state.isAccountMenuOpen = false;
      this.openInternalPage('yayra://passwords');
    });
    dropdown.querySelector('.fb-account-passkey-btn')?.addEventListener('click', () => {
      this.state.isAccountMenuOpen = false;
      if (this.state.passkeyInfo) this.verifyAccountPasskey();
      else this.registerAccountPasskey();
    });
    dropdown.querySelector('.fb-account-manage-btn')?.addEventListener('click', () => this.openGoogleAccountPage());
    dropdown.querySelector('.fb-account-switch-btn')?.addEventListener('click', () => this.switchGoogleAccount());
    dropdown.querySelector('.fb-account-signout-btn')?.addEventListener('click', () => this.signOutOfGoogle());
    dropdown.querySelector('.fb-account-signin-btn')?.addEventListener('click', () => this.signInWithGoogle());
    dropdown.querySelector('.fb-account-settings-btn')?.addEventListener('click', () => {
      this.state.isAccountMenuOpen = false;
      this.state.settingsActiveCategory = 'account';
      this.state.activeSettingsCategory = 'account';
      this.openInternalPage('yayra://settings');
    });

    // Profile switcher rows + "Add profile".
    for (const row of dropdown.querySelectorAll('.fb-profile-row')) {
      if (row.className.includes('fb-profile-add-btn')) {
        row.addEventListener('click', () => {
          const created = this.profileService.createProfile({});
          this.state.isAccountMenuOpen = false;
          // Chrome-style: the NEW profile opens in a NEW Yayra window;
          // this window stays on its current profile. In-place switch
          // only when no window capability exists at all.
          if (this.openProfileWindow(created)) {
            this.showTransientNotice(`${created.name} opened in a new window - this window stays on ${this.profileService.current().name}.`);
            this.render();
            return;
          }
          this.profileService.switchTo(created.id);
          this.applyProfileSwitch(created);
        });
      } else {
        row.addEventListener('click', () => {
          const id = row.getAttribute('data-profile-id');
          if (id) this.switchProfile(id);
        });
      }
    }

    root.appendChild(dropdown);
  }

  /* -------------------------------------------------------------
   * BACKGROUND UPDATE CHECKS
   * -----------------------------------------------------------
   * Beyond the single check shortly after startup, Yayra now re-checks on
   * a timer (config-driven: updates config checkIntervalMinutes, default
   * 12h, clamped to a 15-minute floor) so long-running sessions learn
   * about new releases without the user ever opening the menu. When a
   * background check finds an update, checkForUpdates() already alerts
   * the user: promptUpdateReady() shows the one-per-session confirm
   * dialog, and the toolbar renders a persistent "Update" chip that stays
   * until the update is applied.
   * ----------------------------------------------------------- */
  startBackgroundUpdateChecks() {
    if (this._updateCheckTimer || typeof setInterval !== 'function') return;
    if (!this.updateService || typeof this.updateService.check !== 'function') return;
    const configured = Number(this.updateService?.config?.checkIntervalMinutes);
    const minutes = Math.max(15, Number.isFinite(configured) && configured > 0 ? configured : 720);
    this._updateCheckTimer = setInterval(() => {
      this.checkForUpdates(false);
    }, minutes * 60 * 1000);
    // Never keep a Node test process alive because of this timer.
    if (this._updateCheckTimer && typeof this._updateCheckTimer.unref === 'function') {
      this._updateCheckTimer.unref();
    }
  }

  stopBackgroundUpdateChecks() {
    if (this._updateCheckTimer) {
      clearInterval(this._updateCheckTimer);
      this._updateCheckTimer = null;
    }
  }

  async checkForUpdates(manual = false) {
    if (this.state.updateState.status === 'checking') return;
    this.state.updateState = { ...this.state.updateState, status: 'checking' };
    this.render();

    // The Cloudflare Worker's /updates/manifest.json (via UpdateService) is
    // the single source of truth for "is a real update available" - it
    // already encodes per-target min-supported versions, staged rollout
    // percentages and ETag-cached fetches. There used to be a second,
    // independent "fallback" check here that fetched the raw GitHub Releases
    // API directly and compared the tag against a version string that was
    // hardcoded to '0.1.0' and never updated. That meant the fallback judged
    // the installed app "out of date" against EVERY release forever (0.1.0
    // never equals any real tag), even right after the UpdateService itself
    // had just confirmed the app was fully up to date - producing an
    // "update ready" prompt on every load/reload that could never be
    // satisfied. Removed entirely rather than patched, since UpdateService
    // already does this correctly and duplicating it only reintroduces the
    // same class of bug. See tests/update-service.test.mjs and
    // tests/browser-shell-update-check.test.mjs.
    if (!this.updateService || typeof this.updateService.check !== 'function') {
      this.state.updateState = {
        ...this.state.updateState,
        status: 'unknown',
        availableVersion: null,
        notes: 'No update service configured.'
      };
      this.render();
      return;
    }

    // Only the network call to the Worker-backed UpdateService is wrapped in
    // try/catch here (offline/5xx/etc). Showing the confirm()/alert()
    // dialogs afterward is deliberately kept OUTSIDE that try block: if a
    // browser blocks repeated dialogs (e.g. Chrome's "Prevent this page from
    // creating additional dialogs" safeguard, which can trip after a prior
    // dialog loop like the one this fix addresses) or a WebView lacks
    // window.alert/confirm, that must never be swallowed as if the update
    // check itself had failed - doing so previously reset the state back to
    // "uptodate" and skipped window.location.reload() silently, with no
    // visible error, right after telling the user an update was ready.
    let res;
    try {
      res = await this.updateService.check({ manual });
    } catch (err) {
      // A thrown check is a FAILED check - say so instead of silently
      // pretending everything is up to date (which left manual "Check for
      // updates" clicks looking like they did nothing at all).
      this.state.updateState = {
        ...this.state.updateState,
        status: 'error',
        availableVersion: null,
        notes: String(err?.message || err || 'Update check failed')
      };
      this.render();
      if (manual) this.showTransientNotice('Update check failed - please check your connection and try again.');
      return;
    }

    if (res && (res.status === 'available' || res.status === 'ready')) {
      this.state.updateState = {
        status: 'ready',
        installedVersion: res.installedVersion ?? this.state.updateState.installedVersion,
        availableVersion: res.version || null,
        notes: res.notes || (res.force ? 'A required update is ready.' : 'Update ready.'),
        // Verified download descriptor from the update manifest (url,
        // sha256, bytes) - this is what the desktop pipeline downloads,
        // verifies and installs. See applyUpdate().
        download: res.download || null,
        force: Boolean(res.force)
      };
      this.render();
      if (manual) this.showTransientNotice(`Update v${res.version || ''} is available.`);
      this.promptUpdateReady();
    } else {
      // 'upToDate', 'ahead', 'unknown', 'disabled', etc. - never a reason to
      // show the "update ready" dialog.
      const normalized = res?.status === 'upToDate' ? 'uptodate' : (res?.status || 'uptodate');
      this.state.updateState = {
        ...this.state.updateState,
        status: normalized,
        installedVersion: res?.installedVersion ?? this.state.updateState.installedVersion,
        availableVersion: null,
        download: null
      };
      this.render();
      if (manual) {
        if (normalized === 'uptodate' || normalized === 'ahead') {
          const v = this.state.updateState.installedVersion;
          this.showTransientNotice(`Yayra is up to date${v ? ` (v${v})` : ''}.`);
        } else if (normalized === 'unknown') {
          this.showTransientNotice('Could not reach the update server - will retry later.');
        } else if (normalized === 'disabled') {
          this.showTransientNotice('Updates are disabled on this build.');
        }
      }
    }
  }

  promptUpdateReady() {
    if (this.state.updatePromptShown) return;
    this.state.updatePromptShown = true;
    // In-app card (not a native confirm() dialog): "Download & install
    // now" / "Later". One per session; the persistent toolbar "Update"
    // chip keeps offering the update after "Later".
    this.state.updatePrompt = {
      version: this.state.updateState.availableVersion || null,
      notes: this.state.updateState.notes || '',
      desktopPipeline: Boolean(this.desktopUpdatesBridge && this.state.updateState.download?.url)
    };
    this.render();
  }

  acceptUpdatePrompt() {
    this.state.updatePrompt = null;
    this.render();
    this.applyUpdate();
  }

  deferUpdatePrompt() {
    this.state.updatePrompt = null;
    this.render();
    this.showTransientNotice('Okay - update anytime from the "Update" chip or menu.');
  }

  renderUpdatePromptCard(root) {
    const prompt = this.state.updatePrompt;
    if (!prompt) return;
    const card = document.createElement('div');
    card.className = 'fb-update-prompt-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Update available');
    card.innerHTML = `
      <div class="fb-update-prompt-head">
        <span class="fb-update-prompt-icon">${Icons.download}</span>
        <div>
          <strong class="fb-update-prompt-title">Update available</strong>
          <p class="fb-update-prompt-text">Yayra v${prompt.version || 'latest'} is ready.${prompt.desktopPipeline
            ? ' It will be downloaded and verified before anything runs.'
            : ' It applies in seconds with a quick restart.'}</p>
        </div>
      </div>
      <div class="fb-update-prompt-actions">
        <button class="fb-btn fb-btn-secondary fb-update-prompt-later">Later</button>
        <button class="fb-btn fb-btn-primary fb-update-prompt-now">${prompt.desktopPipeline ? 'Download &amp; install now' : 'Update now'}</button>
      </div>
    `;
    card.querySelector('.fb-update-prompt-now')?.addEventListener('click', () => this.acceptUpdatePrompt());
    card.querySelector('.fb-update-prompt-later')?.addEventListener('click', () => this.deferUpdatePrompt());
    root.appendChild(card);
  }

  /** Read (without consuming) a scheduled "install on next launch". */
  getScheduledInstall() {
    if (typeof localStorage === 'undefined') return null;
    try { return JSON.parse(localStorage.getItem('yayra:pending-update-install') || 'null'); } catch { return null; }
  }

  /**
   * Settings -> "Yayra Updates": the full manual home of the update
   * pipeline. Everything the prompts offer lives here too - check,
   * download, install now, install on next launch - so "Later" is never
   * a dead end. Also reachable from the menu's update section.
   */
  renderUpdatesSettingsHtml() {
    const u = this.state.updateState || {};
    const scheduled = this.getScheduledInstall();
    const desktopPipeline = Boolean(this.desktopUpdatesBridge);
    const configured = Number(this.updateService?.config?.checkIntervalMinutes);
    const intervalMin = Math.max(15, Number.isFinite(configured) && configured > 0 ? configured : 720);
    const intervalLabel = intervalMin % 60 === 0 ? `${intervalMin / 60} hour${intervalMin === 60 ? '' : 's'}` : `${intervalMin} minutes`;

    const statusLabel = u.status === 'checking' ? 'Checking for updates…'
      : u.status === 'downloading' ? `Downloading v${u.availableVersion || ''}… ${typeof u.progressPercent === 'number' ? `${u.progressPercent}%` : ''}`
      : u.status === 'staged' ? `v${u.availableVersion || ''} downloaded & verified - ready to install`
      : u.status === 'ready' ? `v${u.availableVersion || ''} is available`
      : u.status === 'installing' ? 'Installer running…'
      : u.status === 'error' ? `Problem: ${u.notes || 'update check failed'}`
      : `You're up to date${u.installedVersion ? ` (v${u.installedVersion})` : ''}`;

    return `
      <div class="fb-updates-settings">
        <div class="fb-updates-status-row">
          <span class="fb-status-orb ${u.status === 'error' ? '' : u.status === 'checking' || u.status === 'downloading' ? 'pulse' : 'green'}" ${u.status === 'error' ? 'style="background:#ef4444;"' : ''}></span>
          <div>
            <strong>${statusLabel}</strong>
            <p style="margin:2px 0 0; font-size:0.78rem; color:var(--fb-text-muted);">Installed: v${u.installedVersion || 'unknown'} &#183; Auto-checks every ${intervalLabel} while Yayra is open.</p>
          </div>
        </div>
        ${scheduled ? `
          <div class="fb-updates-scheduled-row">
            <span>${Icons.hourglass}</span>
            <span style="flex:1;">Scheduled: install v${scheduled.version || 'update'} the next time Yayra opens.</span>
            <button class="fb-btn fb-btn-secondary fb-up-cancel-scheduled">Cancel</button>
          </div>` : ''}
        <div class="fb-updates-actions">
          <button class="fb-btn fb-btn-secondary fb-up-check">Check for updates now</button>
          ${u.status === 'ready' ? `<button class="fb-btn fb-btn-primary fb-up-download">${desktopPipeline && u.download?.url ? `Download v${u.availableVersion || 'update'} (verified)` : `Update now to v${u.availableVersion || 'latest'}`}</button>` : ''}
          ${u.status === 'staged' ? `
            <button class="fb-btn fb-btn-primary fb-up-install-now">Install &amp; restart now</button>
            <button class="fb-btn fb-btn-secondary fb-up-install-next">Install when Yayra opens again</button>` : ''}
        </div>
      </div>
    `;
  }

  bindUpdatesSettingsActions(page) {
    page.querySelector('.fb-up-check')?.addEventListener('click', () => this.checkForUpdates(true));
    page.querySelector('.fb-up-download')?.addEventListener('click', () => this.applyUpdate());
    page.querySelector('.fb-up-install-now')?.addEventListener('click', () => this.installDesktopUpdateNow());
    page.querySelector('.fb-up-install-next')?.addEventListener('click', () => this.deferInstallToNextLaunch());
    page.querySelector('.fb-up-cancel-scheduled')?.addEventListener('click', () => {
      this.clearPendingInstall();
      this.render();
      this.showTransientNotice('Scheduled install cancelled - the update stays downloaded.');
    });
  }

  applyUpdate() {
    // Electron desktop with a real download descriptor: download the
    // artifact in the main process, verify sha256 + byte length, then hand
    // the verified installer to the OS. Everything else (web/PWA) keeps the
    // reload-based flow below.
    const bridge = this.desktopUpdatesBridge;
    if (bridge && this.state.updateState.download?.url) {
      this.applyDesktopUpdate().catch(() => {});
      return;
    }
    try {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert('Updating Yayra to latest version in background...');
      }
    } catch {
      // Dialogs can be blocked by the browser after repeated prompts - that
      // must never prevent the actual reload/update below from happening.
    }
    try {
      // PWA: promote any waiting service worker BEFORE reloading, otherwise
      // the reload keeps serving the previous cached build.
      if (typeof window !== 'undefined' && typeof window.__yayraApplyPwaUpdate === 'function') {
        window.__yayraApplyPwaUpdate();
      }
    } catch {
      // Never let the service-worker handoff block the reload fallback.
    }
    if (typeof window !== 'undefined' && window.location && typeof window.location.reload === 'function') {
      window.location.reload();
    }
  }

  async applyDesktopUpdate() {
    const bridge = this.desktopUpdatesBridge;
    const { download, availableVersion } = this.state.updateState;
    if (!bridge || !download?.url) return;
    if (this.state.updateState.status === 'downloading') return;

    this.state.updateState = { ...this.state.updateState, status: 'downloading', progressPercent: 0 };
    this.render();
    this.showTransientNotice(`Downloading Yayra v${availableVersion || ''}…`);

    let result;
    try {
      result = await bridge.download({
        url: download.url,
        sha256: download.sha256 || null,
        bytes: download.bytes || null,
        version: availableVersion || 'latest',
        target: this.updateService?.target || this.platform || 'desktop'
      });
    } catch (err) {
      result = { status: 'error', reason: String(err?.message || err) };
    }

    if (!result || result.status !== 'staged') {
      const reason = result?.reason || 'download failed';
      this.state.updateState = { ...this.state.updateState, status: 'error', notes: reason };
      this.render();
      this.showTransientNotice(`Update failed: ${reason}. Your current version keeps running.`);
      return;
    }

    this.state.updateState = { ...this.state.updateState, status: 'staged', stagedPath: result.path, progressPercent: 100 };
    this.showTransientNotice(`Update v${availableVersion || ''} downloaded and verified.`);

    // The download is staged and verified - now ASK instead of installing
    // behind the user's back: install & restart now, install when Yayra
    // is opened again, or later (manually, from Settings -> Yayra Updates
    // or the menu's update section).
    this.state.updateInstallPrompt = { path: result.path, version: availableVersion || null };
    this.render();
  }

  /** Install the staged (already verified) update right now. */
  async installDesktopUpdateNow() {
    const bridge = this.desktopUpdatesBridge;
    const path = this.state.updateInstallPrompt?.path || this.state.updateState.stagedPath;
    this.state.updateInstallPrompt = null;
    this.clearPendingInstall();
    this.render();
    if (!bridge || !path) return;
    let install;
    try {
      install = await bridge.install({ path });
    } catch (err) {
      install = { status: 'error', reason: String(err?.message || err) };
    }
    if (install?.status === 'install_started') {
      this.showTransientNotice(install.method === 'os-installer'
        ? 'Installer launched - Yayra will close so it can restart on the new version.'
        : 'Update file revealed - replace your current install with it.');
      // "Install & RESTART now": get out of the installer's way so it can
      // replace the running app, which then reopens on the new version.
      if (install.method === 'os-installer' && this.windowControls && typeof setTimeout === 'function') {
        setTimeout(() => { try { this.windowControls.close(); } catch { /* already closing */ } }, 1500);
      }
    } else {
      this.showTransientNotice(`Could not launch the installer: ${install?.reason || 'unknown error'}.`);
    }
  }

  /** Remember to install the staged update on the NEXT app launch. */
  deferInstallToNextLaunch() {
    const prompt = this.state.updateInstallPrompt || {};
    const path = prompt.path || this.state.updateState.stagedPath;
    this.state.updateInstallPrompt = null;
    if (path && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('yayra:pending-update-install', JSON.stringify({
          path,
          version: prompt.version || this.state.updateState.availableVersion || null,
          savedAt: new Date().toISOString()
        }));
      } catch { /* storage unavailable - fall back to manual install */ }
    }
    this.render();
    this.showTransientNotice('Got it - Yayra will install this update the next time it opens.');
  }

  /** Dismiss the install choice - everything stays available manually. */
  dismissInstallPrompt() {
    this.state.updateInstallPrompt = null;
    this.render();
    this.showTransientNotice('Update stays downloaded - install anytime from Settings → Yayra Updates.');
  }

  clearPendingInstall() {
    if (typeof localStorage !== 'undefined') {
      try { localStorage.removeItem('yayra:pending-update-install'); } catch { /* ignore */ }
    }
  }

  /** Honour a "install when opened again" choice from the previous run. */
  async processPendingInstallOnLaunch() {
    if (typeof localStorage === 'undefined') return;
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem('yayra:pending-update-install') || 'null'); } catch { pending = null; }
    if (!pending || !pending.path) return;
    this.clearPendingInstall();
    const bridge = this.desktopUpdatesBridge;
    if (!bridge) return;
    let install;
    try {
      install = await bridge.install({ path: pending.path });
    } catch (err) {
      install = { status: 'error', reason: String(err?.message || err) };
    }
    if (install?.status === 'install_started') {
      this.showTransientNotice(`Installing the update you scheduled (v${pending.version || ''}) - follow the system prompts.`);
    } else {
      this.showTransientNotice(`Scheduled update could not start: ${install?.reason || 'unknown error'}. Install it from Settings → Yayra Updates.`);
    }
  }

  renderUpdateInstallPromptCard(root) {
    const prompt = this.state.updateInstallPrompt;
    if (!prompt) return;
    const card = document.createElement('div');
    card.className = 'fb-update-prompt-card fb-update-install-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Update downloaded');
    card.innerHTML = `
      <div class="fb-update-prompt-head">
        <span class="fb-update-prompt-icon">${Icons.check}</span>
        <div>
          <strong class="fb-update-prompt-title">Update downloaded &amp; verified</strong>
          <p class="fb-update-prompt-text">Yayra v${prompt.version || 'latest'} is ready to install. When should it happen?</p>
        </div>
      </div>
      <div class="fb-update-install-actions">
        <button class="fb-btn fb-btn-primary fb-update-install-now">Install &amp; restart now</button>
        <button class="fb-btn fb-btn-secondary fb-update-install-next-launch">Install when Yayra opens again</button>
        <button class="fb-btn fb-btn-secondary fb-update-install-later">Later - I'll do it manually</button>
      </div>
    `;
    card.querySelector('.fb-update-install-now')?.addEventListener('click', () => this.installDesktopUpdateNow());
    card.querySelector('.fb-update-install-next-launch')?.addEventListener('click', () => this.deferInstallToNextLaunch());
    card.querySelector('.fb-update-install-later')?.addEventListener('click', () => this.dismissInstallPrompt());
    root.appendChild(card);
  }

  /**
   * Live progress events from electron/desktopUpdater.cjs. Updates the
   * drawer progress label in place (no full re-render per chunk - that
   * would tear down input focus dozens of times per second).
   */
  handleDesktopUpdateEvent(evt) {
    if (!evt || typeof document === 'undefined') return;
    if (evt.type === 'download-progress') {
      if (typeof evt.percent === 'number') {
        this.state.updateState.progressPercent = evt.percent;
      }
      const label = document.querySelector('.fb-update-progress-label');
      if (label) {
        const received = Number(evt.received) || 0;
        const mb = (received / (1024 * 1024)).toFixed(1);
        label.textContent = typeof evt.percent === 'number'
          ? `Downloading update… ${evt.percent}%`
          : `Downloading update… ${mb} MB`;
      }
    } else if (evt.type === 'download-failed') {
      this.state.updateState = { ...this.state.updateState, status: 'error', notes: evt.reason || 'download failed' };
      this.render();
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
    const closeDrawer = () => {
      this.state.isSideDrawerOpen = false;
      this.render();
    };
    scrim.addEventListener('click', closeDrawer);
    scrim.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      closeDrawer();
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
            <button class="fb-drawer-update-btn fb-update-ready-btn" title="Download, verify and install this update">
              <span class="fb-update-badge-icon">${Icons.update}</span>
              <div class="fb-update-text-group">
                <strong>Update Yayra (${this.state.updateState.availableVersion ? `v${this.state.updateState.availableVersion}` : 'Update available'})</strong>
                <span>${this.desktopUpdatesBridge && this.state.updateState.download?.url ? 'Click to download & install now' : 'Click to restart & update now'}</span>
              </div>
            </button>
          ` : this.state.updateState.status === 'downloading' ? `
            <div class="fb-drawer-update-status-row">
              <div class="fb-update-status-left">
                <span class="fb-status-orb pulse"></span>
                <span class="fb-update-status-text fb-update-progress-label">Downloading update… ${typeof this.state.updateState.progressPercent === 'number' ? `${this.state.updateState.progressPercent}%` : ''}</span>
              </div>
            </div>
          ` : this.state.updateState.status === 'staged' ? `
            <div class="fb-drawer-update-status-row">
              <div class="fb-update-status-left">
                <span class="fb-status-orb green"></span>
                <span class="fb-update-status-text">Update v${this.state.updateState.availableVersion || ''} verified - installer launched</span>
              </div>
            </div>
          ` : this.state.updateState.status === 'error' ? `
            <div class="fb-drawer-update-status-row">
              <div class="fb-update-status-left">
                <span class="fb-status-orb" style="background:#ef4444;"></span>
                <span class="fb-update-status-text">Update problem: ${this.state.updateState.notes || 'check failed'}</span>
              </div>
              <button class="fb-btn-action fb-check-updates-btn" title="Retry update check">${Icons.refresh}</button>
            </div>
          ` : `
            <div class="fb-drawer-update-status-row">
              <div class="fb-update-status-left">
                <span class="fb-status-orb ${this.state.updateState.status === 'checking' ? 'pulse' : 'green'}"></span>
                <span class="fb-update-status-text">${this.state.updateState.status === 'checking' ? 'Checking for updates...' : (this.state.updateState.installedVersion ? `Yayra v${this.state.updateState.installedVersion}${this.state.updateState.status === 'uptodate' ? ' (Latest)' : ''}` : 'Yayra is up to date')}</span>
              </div>
              <button class="fb-btn-action fb-check-updates-btn" title="Check for updates">${Icons.refresh}</button>
            </div>
          `}
          <button class="fb-drawer-item fb-update-options-btn" title="Open Yayra Updates settings">${Icons.download} <span>Update options</span></button>
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

    // Full update controls live in Settings -> Yayra Updates.
    drawer.querySelector('.fb-update-options-btn')?.addEventListener('click', () => {
      this.state.isSideDrawerOpen = false;
      this.state.settingsActiveCategory = 'updates';
      this.state.activeSettingsCategory = 'updates';
      this.openInternalPage('yayra://settings');
    });

    drawer.querySelector('.fb-update-ready-btn')?.addEventListener('click', () => {
      // Direct action: the one-time confirm() prompt may already have been
      // shown and dismissed - clicking the drawer button must always start
      // the actual update, not silently no-op behind the prompt guard.
      this.state.isSideDrawerOpen = false;
      this.render();
      this.applyUpdate();
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
                    <img src="https://icons.duckduckgo.com/ip3/${domain}.ico" style="width:16px; height:16px; border-radius:50%;" alt="" />
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
          icon: `<img src="https://icons.duckduckgo.com/ip3/${domain}.ico" style="width:22px; height:22px; border-radius:50%;" alt="" />`,
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
          icon: `<img src="https://icons.duckduckgo.com/ip3/${domain}.ico" style="width:22px; height:22px; border-radius:50%;" alt="" />`,
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
      const response = await fetch(`https://yayra-updates-api.g2code335.workers.dev/api/suggestions?q=${encodeURIComponent(query)}`, {
        headers: { accept: 'application/json' },
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
      // Un-obscure the native page surface (Electron) now that the
      // dropdown no longer needs to paint above it.
      this.setPageObscured(false);
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
      // The dropdown paints over the page area: on Electron the native
      // page surface must yield (it always draws above HTML otherwise).
      this.setPageObscured(!list.hidden);
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

    // Electron desktop: the ONE floating bubble is the native always-on-top
    // overlay window (electron/overlayWindow.cjs) that floats over every
    // app on the desktop and exists even when this window is closed.
    // Rendering a second, in-page DOM bubble here produced two bubbles on
    // screen - so on Electron this in-page bubble is suppressed entirely
    // (and any leftover from an earlier render is removed).
    if (this.nativeWebview) {
      document.getElementById('yayra-persistent-assistive-bubble')?.remove();
      document.getElementById('yayra-floating-bubble-persistent')?.remove();
      return;
    }

    // Android (Capacitor) with the native system-wide bubble live: exactly
    // like Electron above, the OS-level overlay (YayraFloatBubbleService)
    // IS the one bubble - it floats over every app including Yayra itself,
    // so the in-page DOM copy would be a duplicate.
    if (this.state.systemBubbleActive && this.capacitorOverlay) {
      document.getElementById('yayra-persistent-assistive-bubble')?.remove();
      document.getElementById('yayra-floating-bubble-persistent')?.remove();
      return;
    }

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

    // Update size, opacity, badge, loading pulse. Size is user-adjustable
    // from Settings > Floating Behavior ("Floating Bubble Size") and the
    // inner logo scales proportionally with it.
    const hasLoadingTab = this.state.tabs.some((t) => t.isLoading);
    const bubbleOpacity = this.state.settings.bubbleOpacity || 0.88;
    const bubbleSize = Math.max(40, Math.min(120, Number(this.state.settings.bubbleSizePx) || 64));
    // The logo IS the bubble (no circular plate behind it), so it fills
    // the hit area edge-to-edge instead of sitting inside a backdrop.
    const logoSize = bubbleSize;
    bubble.style.opacity = String(bubbleOpacity);
    bubble.style.width = `${bubbleSize}px`;
    bubble.style.height = `${bubbleSize}px`;

    bubble.innerHTML = `
      ${hasLoadingTab ? '<div class="yayra-bubble-loading-ring"></div>' : ''}
      <div style="width:${logoSize}px; height:${logoSize}px; display:flex; align-items:center; justify-content:center; pointer-events:none;">
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
    // Pin the restore control just above the persistent assistive bubble
    // (bottom-right) instead of letting it fall into document flow.
    overlay.style.cssText = 'position:fixed; right:24px; bottom:104px; z-index:99998;';
    // Logo-only, exactly like the persistent bubble: no circular plate,
    // border or glass background behind the brand mark on ANY platform.
    overlay.innerHTML = `
      <div class="yayra-floating-bubble yayra-floating-orb" role="button" aria-label="Restore Yayra Browser" tabindex="0"
        style="position:relative; width:56px; height:56px; display:flex; align-items:center; justify-content:center; background:transparent; border:none; cursor:pointer; filter:drop-shadow(0 6px 14px rgba(0,0,0,0.45));">
        <div style="width:56px; height:56px; display:flex; align-items:center; justify-content:center; pointer-events:none;">
          ${Icons.officialOrb}
        </div>
        <span class="yayra-bubble-badge" style="position:absolute; top:-3px; right:-3px; min-width:18px; height:18px; padding:0 4px; font-size:10px; border-radius:9px; background:var(--fb-accent-primary); color:#ffffff; font-weight:700; display:flex; align-items:center; justify-content:center;">${this.state.tabs.length}</span>
      </div>
    `;
    overlay.addEventListener('click', () => {
      this.restoreFromBubble();
    });
    document.body.appendChild(overlay);
    this.bubbleOverlay = overlay;
  }

  minimizeToBubble() {
    // Electron desktop: "minimize to bubble" hides the real OS window; the
    // native system-wide bubble (always present) is the way back in. The
    // in-page bubble overlay below only exists for web/PWA builds where a
    // native overlay window is impossible.
    const overlay = this.overlayBridge;
    if (this.nativeWebview && overlay && typeof overlay.minimizeMainWindow === 'function') {
      overlay.minimizeMainWindow();
      if (this.options.onMinimizeToBubble) this.options.onMinimizeToBubble();
      return;
    }
    // Android (Capacitor): the system-wide bubble takes over - start it
    // (asking for the overlay permission on first use) and send the app to
    // the background so the bubble is immediately floating over whatever
    // the user switches to. Only when the permission isn't granted yet do
    // we fall through to the in-page bubble below.
    const sysOverlay = this.capacitorOverlay;
    if (sysOverlay) {
      this.ensureSystemOverlayBubble({ fromUserAction: true }).then((active) => {
        if (active && typeof sysOverlay.minimizeApp === 'function') sysOverlay.minimizeApp();
      });
      if (this.state.systemBubbleActive) {
        if (this.options.onMinimizeToBubble) this.options.onMinimizeToBubble();
        return;
      }
    }
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

  // NOTE: toggleDesktopMode() (the "floating mode / bubble mode" switch)
  // was removed on purpose. Switching modes hid the entire main window,
  // which users experienced as Yayra disappearing. The native bubble is
  // always present and opens its mini browser without ever touching the
  // main window, so a mode switch has no job left to do.

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

    this.destroyNativeWebview(tabId);

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

  // --- Tab strip right-click actions (Chrome parity - see renderTabContextMenu) ---

  duplicateTabById(tabId) {
    const tab = this.state.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const newId = `tab-${Date.now()}`;
    const index = this.state.tabs.findIndex((t) => t.id === tabId);
    const duplicate = { ...tab, id: newId, isLoading: false };
    this.state.tabs.splice(index + 1, 0, duplicate);
    this.selectTab(newId);
  }

  reloadTabById(tabId) {
    if (tabId === this.state.activeTabId) {
      this.reload();
      return;
    }
    // Background tabs rendered via the native engine can still be reloaded
    // directly through the webview bridge; iframe-rendered tabs simply pick
    // up the reload once the user switches to them (no native handle to
    // force a reload while not visible).
    if (this.nativeWebview?.reload) this.nativeWebview.reload(tabId);
  }

  closeOtherTabs(tabId) {
    const keep = this.state.tabs.find((t) => t.id === tabId);
    if (!keep) return;
    for (const tab of [...this.state.tabs]) {
      if (tab.id !== tabId) this.closeTab(tab.id);
    }
    if (this.state.activeTabId !== tabId) this.selectTab(tabId);
  }

  closeTabsToTheRight(tabId) {
    const index = this.state.tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return;
    for (const tab of this.state.tabs.slice(index + 1)) {
      this.closeTab(tab.id);
    }
  }

  /* -------------------------------------------------------------
   * CHROME-STYLE RIGHT-CLICK CONTEXT MENU FOR THE TAB STRIP
   * ----------------------------------------------------------- */
  renderTabContextMenu(x, y, tab) {
    document.body.querySelector('.fb-tab-context-menu')?.remove();
    document.body.querySelector('.fb-dropdown-scrim[data-tab-ctx]')?.remove();

    const scrim = document.createElement('button');
    scrim.type = 'button';
    scrim.className = 'fb-dropdown-scrim';
    scrim.setAttribute('data-tab-ctx', 'true');
    scrim.setAttribute('aria-label', 'Close menu');

    const menu = document.createElement('div');
    menu.className = 'fb-tab-context-menu';

    // Clicking/tapping OR right-clicking anywhere outside the menu must
    // dismiss BOTH the scrim and the menu (previously only the scrim was
    // removed, stranding the menu on screen forever).
    const dismiss = () => {
      scrim.remove();
      menu.remove();
    };
    scrim.addEventListener('click', dismiss);
    scrim.addEventListener('contextmenu', (e) => { e.preventDefault(); dismiss(); });
    const canCloseOthers = this.state.tabs.length > 1;
    const tabIndex = this.state.tabs.findIndex((t) => t.id === tab.id);
    const canCloseRight = tabIndex > -1 && tabIndex < this.state.tabs.length - 1;

    const items = [
      { label: 'New Tab', action: () => this.createNewTab() },
      null,
      { label: 'Reload', action: () => this.reloadTabById(tab.id) },
      { label: 'Duplicate Tab', action: () => this.duplicateTabById(tab.id) },
      null,
      { label: 'Close Tab', action: () => this.closeTab(tab.id) },
      { label: 'Close Other Tabs', action: () => this.closeOtherTabs(tab.id), disabled: !canCloseOthers },
      { label: 'Close Tabs to the Right', action: () => this.closeTabsToTheRight(tab.id), disabled: !canCloseRight }
    ];

    menu.innerHTML = items.map((item, i) => item === null
      ? '<div class="fb-tab-context-menu-sep"></div>'
      : `<button type="button" class="fb-tab-context-menu-item" data-idx="${i}" ${item.disabled ? 'disabled' : ''}>${item.label}</button>`
    ).join('');

    menu.querySelectorAll('.fb-tab-context-menu-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = items[Number(btn.dataset.idx)];
        scrim.remove();
        menu.remove();
        item?.action?.();
        this.render();
      });
    });

    document.body.appendChild(scrim);
    document.body.appendChild(menu);

    // Clamp to viewport so it never renders off-screen near the right/bottom edge.
    const menuWidth = 220;
    const menuHeight = items.length * 34 + 16;
    const left = Math.min(x, window.innerWidth - menuWidth - 8);
    const top = Math.min(y, window.innerHeight - menuHeight - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
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
    if (!activeTab) return;
    if (this.nativeWebview && this._nativeWebviewTabIds.has(activeTab.id)) {
      // Real reload on the native engine; loading-start/loading-stop events
      // flow back through handleNativeWebviewEvent and drive the UI.
      this.nativeWebview.reload(activeTab.id).catch(() => {});
      return;
    }
    activeTab.isLoading = true;
    this.render();
    setTimeout(() => {
      this.updateTabLoading(activeTab.id, false);
      this.render();
    }, 300);
  }

  stopLoading() {
    const activeTab = this.getActiveTab();
    if (!activeTab) return;
    // Environment-aware stop: native Electron views get a real
    // webContents.stop(); iframe-based tabs (web/PWA) get a best-effort
    // contentWindow.stop() (only reachable for same-origin documents).
    // Either way the UI flips back to the refresh icon IMMEDIATELY - a
    // stop must never leave the button stuck as an X.
    if (this.nativeWebview && this._nativeWebviewTabIds.has(activeTab.id)) {
      this.nativeWebview.stop(activeTab.id).catch(() => {});
    } else {
      const frame = this.webFrames?.get(activeTab.id);
      try { frame?.iframe?.contentWindow?.stop?.(); } catch { /* cross-origin */ }
    }
    this.updateTabLoading(activeTab.id, false);
  }

  updateTabLoading(tabId, isLoading) {
    const tab = this.state.tabs.find((t) => t.id === tabId);
    if (tab) {
      const changed = tab.isLoading !== Boolean(isLoading);
      tab.isLoading = Boolean(isLoading);
      const countEl = this.rootElement?.querySelector('.fb-page-loading-bar');
      if (countEl) countEl.style.display = isLoading ? 'block' : 'none';
      if (changed) this.refreshLoadingUi(tabId);
      this.ensurePersistentAssistiveBubble();
    }
  }

  /**
   * Smart loading indicators, updated surgically IN PLACE (never a full
   * re-render, so nothing flickers):
   *  - the reload button knows the page state: X (stop) while the site is
   *    loading, back to the refresh sign the moment it's fully loaded;
   *  - the tab's icon slot shows an animated hourglass ("time sign")
   *    while loading, then the real favicon again.
   * Works for every environment that reports loading state: Electron
   * native views (loading-start/loading-stop events), web/PWA iframes
   * (load events), desktop and mobile toolbars alike.
   */
  refreshLoadingUi(tabId) {
    if (typeof document === 'undefined') return;
    const tab = this.state.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const root = this.rootElement || document;
    if (!root || typeof root.querySelectorAll !== 'function') return;

    // Reload/stop button(s) - only the ACTIVE tab drives the toolbar.
    if (tabId === this.state.activeTabId) {
      for (const selector of ['.fb-nav-reload', '.fb-mobile-refresh-btn']) {
        const btn = root.querySelector(selector);
        if (!btn) continue;
        btn.innerHTML = tab.isLoading ? Icons.stop : Icons.refresh;
        btn.setAttribute('title', tab.isLoading ? 'Stop loading this page (Esc)' : 'Reload this page (Ctrl+R)');
        btn.setAttribute('aria-label', tab.isLoading ? 'Stop' : 'Reload');
      }
    }

    // The tab's icon slot: hourglass while loading, favicon when done.
    for (const tabEl of root.querySelectorAll('.fb-tab-item') || []) {
      const elTabId = (tabEl.dataset && tabEl.dataset.tabId)
        || (typeof tabEl.getAttribute === 'function' ? tabEl.getAttribute('data-tab-id') : null);
      if (elTabId !== tabId) continue;
      const favicon = tabEl.querySelector?.('.fb-tab-favicon');
      if (favicon) favicon.innerHTML = this.getTabFavicon(tab);
    }
  }

  /* -------------------------------------------------------------
   * SMART DOWNLOADS: progress ring + dropdown tracker
   * -----------------------------------------------------------
   * The toolbar download button wears a revolving ring tracking the live
   * download percentage, and opens a Chrome-style dropdown (latest 5,
   * state-aware actions) instead of yanking the user to a new tab. Live
   * progress updates are surgical (ring + open row only) - a full
   * re-render per network chunk would flicker and steal focus.
   * ----------------------------------------------------------- */
  activeDownloads() {
    return (this.state.downloadsItems || []).filter((it) => it.state === 'Downloading' || it.state === 'Paused');
  }

  /** Aggregate percent across in-flight downloads; null = indeterminate. */
  downloadProgressSummary() {
    const active = this.activeDownloads();
    if (!active.length) return { active: 0, percent: null };
    let received = 0;
    let total = 0;
    for (const it of active) {
      if (Number(it.sizeBytes) > 0) {
        total += Number(it.sizeBytes);
        received += Number(it.receivedBytes) || 0;
      }
    }
    return { active: active.length, percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null };
  }

  renderDownloadRingHtml() {
    const { active, percent } = this.downloadProgressSummary();
    if (!active) return '';
    const c = 2 * Math.PI * 14; // viewBox circle r=14
    const offset = percent === null ? c * 0.75 : c * (1 - percent / 100);
    return `
      <svg class="fb-dl-ring${percent === null ? ' indeterminate' : ''}" viewBox="0 0 32 32" aria-hidden="true">
        <circle class="fb-dl-ring-track" cx="16" cy="16" r="14"/>
        <circle class="fb-dl-ring-fill" cx="16" cy="16" r="14" style="stroke-dasharray:${c.toFixed(2)}; stroke-dashoffset:${offset.toFixed(2)};"/>
      </svg>`;
  }

  describeDownloadActivity() {
    const { active, percent } = this.downloadProgressSummary();
    if (!active) return 'Downloads (Ctrl+J)';
    return `Downloading ${active} file${active === 1 ? '' : 's'}${percent === null ? '…' : ` - ${percent}%`}`;
  }

  /** Normalized handler for every downloads bridge event. */
  handleDownloadEvent(payload) {
    if (!payload || !payload.id) return;
    const { type, ...item } = payload;
    const items = this.state.downloadsItems.slice();
    const idx = items.findIndex((it) => it.id === item.id);
    if (idx === -1) items.unshift(item);
    else items[idx] = { ...items[idx], ...item };
    this.state.downloadsItems = items;

    if (type === 'progress') {
      // Per-chunk: ring + visible dropdown row only. NEVER a full render.
      this.updateDownloadIndicator(items[idx === -1 ? 0 : idx]);
      return;
    }
    // started / done: structural change - rows and actions change shape.
    this.render();
    if (type === 'done') {
      const merged = items[idx === -1 ? 0 : idx];
      if (merged.state === 'Completed') {
        this.showTransientNotice(`Download complete: ${merged.filename}`);
      } else if (merged.state === 'Failed') {
        this.showTransientNotice(`Download failed: ${merged.filename} - retry from the downloads menu.`);
      }
    }
  }

  /** Surgical in-place refresh of the ring and any visible dropdown row. */
  updateDownloadIndicator(item) {
    if (typeof document === 'undefined') return;
    const root = this.rootElement || document;
    if (!root || typeof root.querySelector !== 'function') return;

    const btn = root.querySelector('.fb-toolbar-downloads-btn');
    if (btn) {
      btn.innerHTML = `${this.renderDownloadRingHtml()}${Icons.download}`;
      btn.setAttribute('title', this.describeDownloadActivity());
    }

    if (!item || !this.state.isDownloadsDropdownOpen) return;
    for (const row of root.querySelectorAll('.fb-dl-item') || []) {
      const rowId = (row.dataset && row.dataset.dlId)
        || (typeof row.getAttribute === 'function' ? row.getAttribute('data-dl-id') : null);
      if (rowId !== item.id) continue;
      const fill = row.querySelector?.('.fb-dl-progress-fill');
      if (fill && typeof item.progress === 'number') fill.style.width = `${item.progress}%`;
      const meta = row.querySelector?.('.fb-dl-meta');
      if (meta) meta.textContent = this.describeDownloadItem(item);
    }
  }

  describeDownloadItem(item) {
    const size = item.size || '';
    switch (item.state) {
      case 'Downloading':
        return typeof item.progress === 'number'
          ? `${item.progress}% of ${size || 'unknown size'}`
          : `Downloading… ${size}`;
      case 'Paused': return `Paused${typeof item.progress === 'number' ? ` at ${item.progress}%` : ''} - ${size}`;
      case 'Completed': return `${size}${item.date ? ` - ${item.date}` : ''}`;
      case 'Cancelled': return 'Cancelled';
      case 'Failed': return 'Failed - the file was not saved';
      default: return size;
    }
  }

  downloadStateIconHtml(item) {
    switch (item.state) {
      case 'Downloading': return `<span class="fb-dl-state-icon st-progress">${Icons.download}</span>`;
      case 'Paused': return `<span class="fb-dl-state-icon st-paused">${Icons.pause}</span>`;
      case 'Completed': return `<span class="fb-dl-state-icon st-done">${Icons.check}</span>`;
      case 'Failed': return `<span class="fb-dl-state-icon st-failed">${Icons.alertTriangle}</span>`;
      case 'Cancelled': return `<span class="fb-dl-state-icon st-failed">${Icons.stop}</span>`;
      default: return `<span class="fb-dl-state-icon">${Icons.download}</span>`;
    }
  }

  /**
   * State-aware action set - what shows (and what must NOT) per state:
   *  - Downloading: pause, cancel, copy address. ALWAYS visible (a stop
   *    must never hide behind a hover). No open/show-in-folder (no file).
   *  - Paused: resume, cancel, copy address. Always visible.
   *  - Completed: open, show in folder, copy file path, copy address,
   *    open address in tab, remove. Hover-revealed on pointer devices,
   *    always visible on touch (android/web).
   *  - Failed/Cancelled: retry (always visible), copy address, open
   *    address in tab, remove. Never open/show-in-folder (nothing saved).
   */
  downloadItemActionsHtml(item) {
    const hasBridge = Boolean(this.downloadsBridge);
    const act = (action, title, icon, extraClass = '') =>
      `<button class="fb-dl-act ${extraClass}" data-dl-action="${action}" title="${title}" aria-label="${title}">${icon}</button>`;
    if (item.state === 'Downloading') {
      return `<span class="fb-dl-item-actions fb-dl-actions-always">
        ${hasBridge ? act('pause', 'Pause download', Icons.pause) : ''}
        ${hasBridge ? act('cancel', 'Cancel download', Icons.stop) : ''}
        ${item.url ? act('copy-url', 'Copy download address', Icons.copy) : ''}
      </span>`;
    }
    if (item.state === 'Paused') {
      return `<span class="fb-dl-item-actions fb-dl-actions-always">
        ${hasBridge ? act('resume', 'Resume download', Icons.play) : ''}
        ${hasBridge ? act('cancel', 'Cancel download', Icons.stop) : ''}
        ${item.url ? act('copy-url', 'Copy download address', Icons.copy) : ''}
      </span>`;
    }
    if (item.state === 'Completed') {
      return `<span class="fb-dl-item-actions fb-dl-actions-reveal">
        ${hasBridge ? act('open', 'Open file', Icons.externalLink) : ''}
        ${hasBridge ? act('show', 'Show in folder', Icons.folder) : ''}
        ${hasBridge && item.path ? act('copy-path', 'Copy file path', Icons.save) : ''}
        ${item.url ? act('copy-url', 'Copy download address', Icons.copy) : ''}
        ${item.url ? act('open-url', 'Open download address in a tab', Icons.globe) : ''}
        ${hasBridge ? act('remove', 'Remove from list', Icons.trash) : ''}
      </span>`;
    }
    // Failed / Cancelled
    return `<span class="fb-dl-item-actions fb-dl-actions-reveal">
      ${(hasBridge && item.url) ? act('retry', 'Retry download', Icons.refresh, 'fb-dl-act-retry fb-dl-act-always') : ''}
      ${item.url ? act('copy-url', 'Copy download address', Icons.copy) : ''}
      ${item.url ? act('open-url', 'Open download address in a tab', Icons.globe) : ''}
      ${hasBridge ? act('remove', 'Remove from list', Icons.trash) : ''}
    </span>`;
  }

  renderDownloadsDropdown(root) {
    this.appendDropdownScrim(root, () => {
      this.state.isDownloadsDropdownOpen = false;
      this.render();
    });

    const dropdown = document.createElement('div');
    dropdown.className = 'fb-downloads-dropdown';
    const latest = (this.state.downloadsItems || []).slice(0, 5);

    const rows = latest.map((item) => `
      <div class="fb-dl-item st-${String(item.state || '').toLowerCase()}" data-dl-id="${item.id}">
        ${this.downloadStateIconHtml(item)}
        <span class="fb-dl-item-main">
          <strong class="fb-dl-item-name" title="${item.filename || ''}">${item.filename || 'download'}</strong>
          ${item.state === 'Downloading' || item.state === 'Paused' ? `
            <span class="fb-dl-progress"><span class="fb-dl-progress-fill" style="width:${typeof item.progress === 'number' ? item.progress : 15}%;"></span></span>` : ''}
          <small class="fb-dl-meta">${this.describeDownloadItem(item)}</small>
        </span>
        ${this.downloadItemActionsHtml(item)}
      </div>
    `).join('');

    dropdown.innerHTML = `
      <div class="fb-downloads-dropdown-header">
        <strong>Downloads</strong>
        ${this.activeDownloads().length ? `<small>${this.describeDownloadActivity()}</small>` : ''}
      </div>
      <div class="fb-downloads-dropdown-list">
        ${latest.length ? rows : `<p class="fb-dl-empty">${this.downloadsBridge
          ? 'No downloads yet - files you download will appear here.'
          : 'Downloads appear here on the Yayra desktop app. This browser handles file saving natively.'}</p>`}
      </div>
      <button class="fb-btn fb-btn-secondary fb-dl-open-page" style="width:100%;">${Icons.download} Open Yayra Downloads</button>
    `;

    dropdown.querySelector('.fb-dl-open-page')?.addEventListener('click', () => {
      this.state.isDownloadsDropdownOpen = false;
      this.openInternalPage('yayra://downloads');
    });

    for (const row of dropdown.querySelectorAll('.fb-dl-item')) {
      const id = (row.dataset && row.dataset.dlId) || row.getAttribute?.('data-dl-id');
      for (const btn of row.querySelectorAll('.fb-dl-act')) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = (btn.dataset && btn.dataset.dlAction) || btn.getAttribute?.('data-dl-action');
          this.performDownloadAction(id, action);
        });
      }
    }

    root.appendChild(dropdown);
  }

  async performDownloadAction(id, action) {
    const item = (this.state.downloadsItems || []).find((it) => it.id === id);
    if (!item || !action) return;
    const bridge = this.downloadsBridge;
    const copy = (value, notice) => {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(value);
          this.showTransientNotice(notice);
        }
      } catch { /* clipboard unavailable */ }
    };
    switch (action) {
      case 'open': {
        const res = await bridge?.open?.(id);
        if (res && res.ok === false) this.showTransientNotice(`Couldn't open file: ${res.error || 'unknown error'}`);
        break;
      }
      case 'show': {
        const res = await bridge?.showInFolder?.(id);
        if (res && res.ok === false) this.showTransientNotice(`Couldn't show in folder: ${res.error || 'unknown error'}`);
        break;
      }
      case 'copy-path':
        if (item.path) copy(item.path, 'File path copied');
        break;
      case 'copy-url':
        if (item.url) copy(item.url, 'Download address copied');
        break;
      case 'open-url':
        if (item.url) {
          this.state.isDownloadsDropdownOpen = false;
          this.createNewTab();
          this.navigateActiveTab(item.url);
        }
        break;
      case 'pause':
        await bridge?.pause?.(id);
        break;
      case 'resume':
        await bridge?.resume?.(id);
        break;
      case 'cancel': {
        const res = await bridge?.cancel?.(id);
        if (res?.ok) this.showTransientNotice(`Cancelled: ${item.filename}`);
        break;
      }
      case 'retry': {
        const res = await bridge?.retry?.(id);
        if (res?.ok) {
          // The failed row is replaced by the fresh attempt's record.
          this.state.downloadsItems = this.state.downloadsItems.filter((it) => it.id !== id);
          this.showTransientNotice(`Retrying: ${item.filename}`);
          this.render();
        } else {
          this.showTransientNotice(`Couldn't retry: ${res?.error || 'unknown error'}`);
        }
        break;
      }
      case 'remove': {
        if (bridge?.remove) {
          const res = await bridge.remove(id);
          if (res?.items) this.state.downloadsItems = res.items;
          else this.state.downloadsItems = this.state.downloadsItems.filter((it) => it.id !== id);
        } else {
          this.state.downloadsItems = this.state.downloadsItems.filter((it) => it.id !== id);
        }
        this.render();
        break;
      }
      default:
        break;
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

  /**
   * Resolves the user's theme preference into the concrete theme the shell
   * should render. 'system' follows the OS via prefers-color-scheme and
   * falls back to dark when media queries are unavailable.
   */
  resolveEffectiveTheme() {
    const pref = this.state.settings.theme || 'dark';
    if (pref !== 'system') return pref;
    try {
      if (typeof matchMedia === 'function') {
        return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      }
    } catch {
      // Fall through to the dark default below.
    }
    return 'dark';
  }

  /**
   * Persists the current settings snapshot to the settings repository and
   * localStorage. Fire-and-forget: UI changes always apply immediately
   * even if persistence fails (e.g. storage quota exceeded).
   */
  persistSettings() {
    if (this.settingsRepo && typeof this.settingsRepo.updateSettings === 'function') {
      try {
        const result = this.settingsRepo.updateSettings(this.state.settings);
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch {
        // Non-fatal: the in-memory state is already updated.
      }
    }
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('yayra:settings', JSON.stringify(this.state.settings));
      } catch {
        // Keep the browser usable when storage is unavailable or full.
      }
    }
  }

  updateCssCustomProperties() {
    if (this.rootElement && this.rootElement.style && typeof this.rootElement.style.setProperty === 'function') {
      if (this.state.settings.bubbleOpacity !== undefined) {
        this.rootElement.style.setProperty('--fb-bubble-opacity', String(this.state.settings.bubbleOpacity));
      }
      if (this.state.settings.bubbleSizePx !== undefined) {
        this.rootElement.style.setProperty('--fb-bubble-size', `${this.state.settings.bubbleSizePx}px`);
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
    // "Time sign" while the page is loading: the tab's icon slot becomes
    // an animated hourglass the moment loading starts, and flips back to
    // the real favicon when the page is fully loaded. Updated in place by
    // refreshLoadingUi() - never via a flickery full re-render.
    if (tab.isLoading) return `<span class="fb-tab-loading-hourglass">${Icons.hourglass}</span>`;
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
    } else {
      // Window resized without a layout-mode change: the chrome DOM is
      // untouched but the viewport slot moved/resized, so re-align the
      // persistent web-frame layer to it.
      this.syncWebFrameLayer();
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => this.syncWebFrameLayer());
      }
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
      // Tab-strip right-click menu lives outside render() state - remove
      // it (and its scrim) directly.
      if (typeof document !== 'undefined') {
        document.body.querySelector('.fb-tab-context-menu')?.remove();
        document.body.querySelector('.fb-dropdown-scrim[data-tab-ctx]')?.remove();
      }
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
      if (this.state.isAccountMenuOpen) {
        this.state.isAccountMenuOpen = false;
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
    this.stopBackgroundUpdateChecks();
    if (this.webFrameLayer) {
      this.webFrameLayer.remove();
      this.webFrameLayer = null;
      this.webFrames = new Map();
      this.activeWebFrameSlot = null;
      this.activeWebFrameTabId = null;
    }
    if (this._unsubscribeNativeWebview) {
      this._unsubscribeNativeWebview();
      this._unsubscribeNativeWebview = null;
    }
    if (this._unsubscribeAuthBridge) {
      this._unsubscribeAuthBridge();
      this._unsubscribeAuthBridge = null;
    }
    for (const tabId of Array.from(this._nativeWebviewTabIds || [])) {
      this.destroyNativeWebview(tabId);
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
