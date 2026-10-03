/**
 * Yayra Floating Browser - Android Native Browser Engine (JS runtime)
 */

import {
  createBrowserTab,
  createBrowserSession,
  defaultUrlInterpreter
} from '../../browser-contract/src/index.js';

export class AndroidWebViewEngine {
  static DESKTOP_USER_AGENT =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
  static MOBILE_USER_AGENT =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

  constructor(options = {}) {
    this.capabilities = {
      supportsIncognito: true,
      supportsCustomUserAgent: true,
      supportsHardwareAcceleration: true,
      supportsExtensions: false,
      supportsDirectComposition: false,
      engineName: 'AndroidWebView',
      engineVersion: 'Chromium-Blink-Android-14'
    };

    this.urlInterpreter = options.urlInterpreter || defaultUrlInterpreter;
    this.nativeBridge = options.nativeBridge;
    this.tabs = new Map();
    this.activeTabId = null;
    this.isDestroyed = false;
    this.zoomLevel = 1.0;
    this.listeners = new Map();
    this.containerElement = null;

    const initialTab = createBrowserTab({ url: 'about:blank' });
    this.tabs.set(initialTab.id, {
      tab: initialTab,
      isDesktopMode: false,
      historyStack: ['about:blank'],
      historyIndex: 0
    });
    this.activeTabId = initialTab.id;
  }

  async initialize(container) {
    if (this.isDestroyed) throw new Error('Cannot initialize destroyed AndroidWebViewEngine');
    this.containerElement = container || null;
  }

  async loadUrl(input, options) {
    this.checkNotDestroyed();
    const active = this.getActiveInstance();
    if (!active) return;

    const interpreted = this.urlInterpreter.interpret(input, options?.searchEngine);
    const targetUrl = interpreted.normalizedUrl;

    if (interpreted.isBlockedScheme) {
      this.handleNavigationError(active.tab.id, targetUrl, -10, 'Blocked unsafe URI scheme');
      return;
    }

    active.tab.url = targetUrl;
    active.tab.isSecure = targetUrl.startsWith('https://');
    active.tab.loadingState = {
      status: 'loading',
      progress: 15,
      error: null
    };
    active.tab.isLoading = true;
    active.tab.progress = 15;

    this.emit('load:start', targetUrl);
    this.emit('loading:state-changed', active.tab.loadingState);

    if (active.historyStack.length === 1 && active.historyStack[0] === 'about:blank') {
      active.historyStack = [targetUrl];
      active.historyIndex = 0;
    } else if (active.historyStack[active.historyIndex] !== targetUrl) {
      active.historyStack = active.historyStack.slice(0, active.historyIndex + 1);
      active.historyStack.push(targetUrl);
      active.historyIndex = active.historyStack.length - 1;
    }

    this.updateNavigationState(active);
    this.sendNativeCommand('loadUrl', { tabId: active.tab.id, url: targetUrl });
  }

  async navigate(url, options) {
    return this.loadUrl(url, options);
  }

  async search(query, engine) {
    const searchUrl = this.urlInterpreter.buildSearchUrl(query, engine);
    return this.loadUrl(searchUrl);
  }

  async goBack() {
    this.checkNotDestroyed();
    const active = this.getActiveInstance();
    if (!active || !this.canGoBack()) return false;

    active.historyIndex -= 1;
    const targetUrl = active.historyStack[active.historyIndex];
    active.tab.url = targetUrl;
    active.tab.isSecure = targetUrl.startsWith('https://');

    this.updateNavigationState(active);
    this.emit('load:start', targetUrl);
    this.sendNativeCommand('goBack', { tabId: active.tab.id, url: targetUrl });
    return true;
  }

  async goForward() {
    this.checkNotDestroyed();
    const active = this.getActiveInstance();
    if (!active || !this.canGoForward()) return false;

    active.historyIndex += 1;
    const targetUrl = active.historyStack[active.historyIndex];
    active.tab.url = targetUrl;
    active.tab.isSecure = targetUrl.startsWith('https://');

    this.updateNavigationState(active);
    this.emit('load:start', targetUrl);
    this.sendNativeCommand('goForward', { tabId: active.tab.id, url: targetUrl });
    return true;
  }

  canGoBack() {
    const active = this.getActiveInstance();
    return Boolean(active && active.historyIndex > 0);
  }

  canGoForward() {
    const active = this.getActiveInstance();
    return Boolean(active && active.historyIndex < active.historyStack.length - 1);
  }

  async reload(bypassCache = false) {
    this.checkNotDestroyed();
    const active = this.getActiveInstance();
    if (!active) return;

    active.tab.loadingState = { status: 'loading', progress: 10, error: null };
    active.tab.isLoading = true;
    this.emit('load:start', active.tab.url);
    this.sendNativeCommand('reload', { tabId: active.tab.id, bypassCache });
  }

  async stop() {
    this.checkNotDestroyed();
    const active = this.getActiveInstance();
    if (!active) return;

    active.tab.loadingState.status = 'cancelled';
    active.tab.isLoading = false;
    this.emit('loading:state-changed', active.tab.loadingState);
    this.sendNativeCommand('stop', { tabId: active.tab.id });
  }

  async navigateHome() {
    return this.loadUrl('https://duckduckgo.com');
  }

  createTab(options = {}) {
    this.checkNotDestroyed();
    const initialUrl = options.url || 'about:blank';
    const tab = createBrowserTab({
      url: initialUrl,
      isIncognito: options.isIncognito
    });

    const instance = {
      tab,
      isDesktopMode: Boolean(options.isDesktop),
      historyStack: [initialUrl],
      historyIndex: 0
    };

    this.tabs.set(tab.id, instance);
    this.activeTabId = tab.id;
    this.sendNativeCommand('createTab', { tabId: tab.id, url: initialUrl, isIncognito: options.isIncognito });
    return tab;
  }

  selectTab(tabId) {
    this.checkNotDestroyed();
    if (!this.tabs.has(tabId)) return false;

    this.activeTabId = tabId;
    const active = this.tabs.get(tabId);
    active.tab.lastAccessedAt = Date.now();

    this.updateNavigationState(active);
    this.sendNativeCommand('selectTab', { tabId });
    return true;
  }

  closeTab(tabId) {
    this.checkNotDestroyed();
    if (!this.tabs.has(tabId)) return false;

    this.tabs.delete(tabId);
    this.sendNativeCommand('closeTab', { tabId });

    if (this.activeTabId === tabId) {
      const remainingIds = Array.from(this.tabs.keys());
      if (remainingIds.length > 0) {
        this.selectTab(remainingIds[0]);
      } else {
        const fallback = this.createTab({ url: 'https://duckduckgo.com' });
        this.activeTabId = fallback.id;
      }
    }
    return true;
  }

  getTabs() {
    return Array.from(this.tabs.values()).map((inst) => inst.tab);
  }

  getActiveTab() {
    const active = this.getActiveInstance();
    return active ? active.tab : null;
  }

  setDesktopMode(enabled, tabId) {
    const target = tabId ? this.tabs.get(tabId) : this.getActiveInstance();
    if (!target) return;

    target.isDesktopMode = enabled;
    const ua = enabled ? AndroidWebViewEngine.DESKTOP_USER_AGENT : AndroidWebViewEngine.MOBILE_USER_AGENT;
    this.sendNativeCommand('setUserAgent', { tabId: target.tab.id, userAgent: ua, isDesktop: enabled });
  }

  isDesktopMode(tabId) {
    const target = tabId ? this.tabs.get(tabId) : this.getActiveInstance();
    return target ? target.isDesktopMode : false;
  }

  getCurrentUrl() {
    const active = this.getActiveInstance();
    return active ? active.tab.url : 'about:blank';
  }

  isLoading() {
    const active = this.getActiveInstance();
    return active ? active.tab.isLoading : false;
  }

  getPageTitle() {
    const active = this.getActiveInstance();
    return active ? active.tab.title : 'New Tab';
  }

  getLoadingProgress() {
    const active = this.getActiveInstance();
    return active ? active.tab.progress : 0;
  }

  getLoadingState() {
    const active = this.getActiveInstance();
    return active ? active.tab.loadingState : { status: 'idle', progress: 0 };
  }

  getNavigationState() {
    const active = this.getActiveInstance();
    if (!active) {
      return {
        currentUrl: 'about:blank',
        title: 'New Tab',
        historyStack: ['about:blank'],
        currentIndex: 0,
        canGoBack: false,
        canGoForward: false
      };
    }
    return active.tab.navigationState;
  }

  async evaluateJavaScript(script) {
    this.checkNotDestroyed();
    const active = this.getActiveInstance();
    if (!active) throw new Error('No active Android WebView tab');

    this.sendNativeCommand('evaluateJs', { tabId: active.tab.id, script });
    return {};
  }

  async setZoomLevel(zoom) {
    this.zoomLevel = Math.max(0.5, Math.min(3.0, zoom));
    this.sendNativeCommand('setZoom', { zoom: this.zoomLevel });
  }

  getZoomLevel() {
    return this.zoomLevel;
  }

  handleSslError(tabId, failingUrl, errorCode, certIssuer) {
    const instance = this.tabs.get(tabId);
    if (!instance) return;

    const errorHtml = this.generateSslErrorHtml(failingUrl, certIssuer);
    instance.tab.error = {
      code: errorCode,
      description: `SSL Certificate Authority Verification Failed (${certIssuer})`,
      failingUrl,
      isCertError: true,
      timestamp: Date.now()
    };
    instance.tab.loadingState = {
      status: 'failed',
      progress: 0,
      error: instance.tab.error
    };
    instance.tab.isLoading = false;

    this.emit('load:error', failingUrl, errorCode, instance.tab.error.description);
    this.emit('loading:state-changed', instance.tab.loadingState);
    this.sendNativeCommand('loadData', { tabId, data: errorHtml, mimeType: 'text/html' });
  }

  handleNavigationError(tabId, failingUrl, errorCode, description) {
    const instance = this.tabs.get(tabId);
    if (!instance) return;

    instance.tab.error = {
      code: errorCode,
      description,
      failingUrl,
      isCertError: false,
      timestamp: Date.now()
    };
    instance.tab.loadingState = {
      status: 'failed',
      progress: 0,
      error: instance.tab.error
    };
    instance.tab.isLoading = false;

    this.emit('load:error', failingUrl, errorCode, description);
    this.emit('loading:state-changed', instance.tab.loadingState);
  }

  handleRendererCrashed(tabId, killed) {
    const instance = this.tabs.get(tabId);
    if (!instance) return;

    this.handleNavigationError(tabId, instance.tab.url, -99, `Renderer process terminated (killed=${killed})`);
    this.sendNativeCommand('recreateWebView', { tabId });
  }

  handleProgressUpdate(tabId, progress) {
    const instance = this.tabs.get(tabId);
    if (!instance) return;

    instance.tab.progress = Math.max(0, Math.min(100, progress));
    instance.tab.loadingState.progress = instance.tab.progress;
    if (progress >= 100) {
      instance.tab.loadingState.status = 'loaded';
      instance.tab.isLoading = false;
    }
    this.emit('load:progress', instance.tab.progress);
  }

  handleTitleReceived(tabId, title) {
    const instance = this.tabs.get(tabId);
    if (!instance) return;

    instance.tab.title = title || instance.tab.url;
    instance.tab.navigationState.title = instance.tab.title;
    this.emit('title:received', instance.tab.title);
  }

  saveSession() {
    const session = createBrowserSession();
    session.tabs = this.getTabs();
    session.activeTabId = this.activeTabId;
    return session;
  }

  restoreSession(session) {
    if (!session || !session.tabs || session.tabs.length === 0) return;

    this.tabs.clear();
    session.tabs.forEach((t) => {
      this.tabs.set(t.id, {
        tab: { ...t },
        isDesktopMode: false,
        historyStack: t.navigationState?.historyStack || [t.url],
        historyIndex: t.navigationState?.currentIndex || 0
      });
    });

    this.activeTabId = session.activeTabId && this.tabs.has(session.activeTabId)
      ? session.activeTabId
      : Array.from(this.tabs.keys())[0];

    const active = this.getActiveInstance();
    if (active) {
      this.updateNavigationState(active);
    }
  }

  async destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    for (const [tabId] of this.tabs) {
      this.sendNativeCommand('destroyWebView', { tabId });
    }

    this.tabs.clear();
    this.listeners.clear();
    this.containerElement = null;
    this.activeTabId = null;
  }

  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  emit(event, ...args) {
    const set = this.listeners.get(event);
    if (set) {
      set.forEach((cb) => {
        try {
          cb(...args);
        } catch {}
      });
    }
  }

  getActiveInstance() {
    if (!this.activeTabId) return null;
    return this.tabs.get(this.activeTabId) || null;
  }

  updateNavigationState(instance) {
    const navState = {
      currentUrl: instance.tab.url,
      title: instance.tab.title,
      historyStack: [...instance.historyStack],
      currentIndex: instance.historyIndex,
      canGoBack: instance.historyIndex > 0,
      canGoForward: instance.historyIndex < instance.historyStack.length - 1
    };
    instance.tab.navigationState = navState;
    instance.tab.canGoBack = navState.canGoBack;
    instance.tab.canGoForward = navState.canGoForward;
    this.emit('navigation:state-changed', navState);
  }

  sendNativeCommand(action, payload) {
    if (this.nativeBridge && typeof this.nativeBridge.postMessage === 'function') {
      try {
        this.nativeBridge.postMessage(JSON.stringify({ action, payload }));
      } catch {}
    }
  }

  checkNotDestroyed() {
    if (this.isDestroyed) {
      throw new Error('AndroidWebViewEngine has been destroyed');
    }
  }

  generateSslErrorHtml(url, issuer) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { background: #060b19; color: #f8fafc; font-family: system-ui, sans-serif; padding: 24px; text-align: center; }
          .card { background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 16px; padding: 24px; margin-top: 40px; }
          h2 { color: #ef4444; }
          p { color: #94a3b8; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Security Warning: Untrusted Certificate</h2>
          <p>Yayra refused to load <strong>${url}</strong> because its SSL certificate is invalid or untrusted by authority: ${issuer}.</p>
          <p>Connection aborted to protect your credentials and data privacy.</p>
        </div>
      </body>
      </html>
    `;
  }
}
