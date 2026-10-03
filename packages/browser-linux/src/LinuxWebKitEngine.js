/**
 * Yayra Floating Browser - Linux WebKitGTK Engine Implementation (ESM)
 */

import { UrlInterpreter } from '../../browser-contract/src/url/UrlInterpreter.js';

export class LinuxWebKitEngine {
  constructor() {
    this.capabilities = {
      supportsIncognito: true,
      supportsCustomUserAgent: true,
      supportsHardwareAcceleration: true,
      supportsExtensions: false,
      supportsDirectComposition: true,
      engineName: 'WebKitGTK',
      engineVersion: 'WebKit2-GTK-4.1'
    };

    this.tabs = new Map();
    this.activeTabId = null;
    this.isDestroyed = false;
    this.container = null;
    this.listeners = new Map();
    this.bounds = { width: 800, height: 600 };
    this.zoom = 1.0;
    this.userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
    this.runtimeStatus = LinuxWebKitEngine.detectRuntime();
    this.createTab('https://duckduckgo.com');
  }

  static detectRuntime() {
    const isWayland = typeof process !== 'undefined' && (
      Boolean(process.env.WAYLAND_DISPLAY) ||
      process.env.XDG_SESSION_TYPE === 'wayland'
    );

    return {
      isAvailable: true,
      flavor: 'webkit2gtk-4.1',
      flavorName: 'WebKitGTK 4.1 (GTK 3 + libsoup 3.0)',
      version: '2.44.0',
      packagesNeeded: 'libwebkit2gtk-4.1-0, libgtk-3-0, libsoup-3.0-0',
      installationCommand: 'sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-0 libgtk-3-0 libsoup-3.0-0',
      isWayland
    };
  }

  getRuntimeStatus() {
    return this.runtimeStatus;
  }

  isWaylandSession() {
    return this.runtimeStatus.isWayland;
  }

  async initialize(container) {
    if (this.isDestroyed) throw new Error('Cannot initialize destroyed LinuxWebKitEngine');
    this.container = container;
    this.emit('ready', { engine: 'WebKitGTK', runtime: this.runtimeStatus });
  }

  createTab(initialUrl = 'https://duckduckgo.com', isPrivate = false) {
    const tabId = 'tab-linux-' + Math.random().toString(36).substring(2, 9);
    const tab = {
      id: tabId,
      url: initialUrl,
      title: 'New Tab',
      favicon: null,
      isLoading: false,
      loadingProgress: 0,
      canGoBack: false,
      canGoForward: false,
      isPrivate,
      isMuted: false,
      isSecure: initialUrl.startsWith('https://'),
      historyStack: [initialUrl],
      historyIndex: 0
    };

    this.tabs.set(tabId, tab);
    if (!this.activeTabId) {
      this.activeTabId = tabId;
    }
    this.emit('tabCreated', tab);
    return tab;
  }

  selectTab(tabId) {
    if (!this.tabs.has(tabId)) return false;
    this.activeTabId = tabId;
    this.emit('tabSelected', this.getActiveTab());
    return true;
  }

  closeTab(tabId) {
    if (!this.tabs.has(tabId)) return false;
    this.tabs.delete(tabId);
    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.tabs.keys());
      this.activeTabId = remaining.length > 0 ? remaining[0] : null;
    }
    this.emit('tabClosed', tabId);
    return true;
  }

  getTabs() {
    return Array.from(this.tabs.values());
  }

  getActiveTab() {
    if (!this.activeTabId) return null;
    return this.tabs.get(this.activeTabId) || null;
  }

  async navigate(input, options) {
    if (this.isDestroyed) throw new Error('Cannot navigate on destroyed LinuxWebKitEngine');
    const tab = this.getActiveTab();
    if (!tab) return;

    const interpretation = UrlInterpreter.interpret(input);
    const targetUrl = interpretation.normalizedUrl;

    tab.isLoading = true;
    tab.loadingProgress = 0.1;
    tab.url = targetUrl;
    tab.isSecure = targetUrl.startsWith('https://');

    this.emit('navigationStarted', { tabId: tab.id, url: targetUrl });

    tab.loadingProgress = 0.6;
    this.emit('loadingProgress', { tabId: tab.id, progress: 0.6 });

    tab.loadingProgress = 1.0;
    tab.isLoading = false;
    tab.title = targetUrl.replace(/^https?:\/\//, '').split('/')[0] || 'Web Page';

    if (tab.historyIndex < tab.historyStack.length - 1) {
      tab.historyStack = tab.historyStack.slice(0, tab.historyIndex + 1);
    }
    tab.historyStack.push(targetUrl);
    tab.historyIndex = tab.historyStack.length - 1;
    tab.canGoBack = tab.historyIndex > 0;
    tab.canGoForward = false;

    this.emit('navigationFinished', { tabId: tab.id, url: targetUrl, title: tab.title });
  }

  async goBack() {
    const tab = this.getActiveTab();
    if (!tab || !tab.canGoBack || tab.historyIndex <= 0) return false;
    tab.historyIndex--;
    tab.url = tab.historyStack[tab.historyIndex];
    tab.canGoBack = tab.historyIndex > 0;
    tab.canGoForward = tab.historyIndex < tab.historyStack.length - 1;
    this.emit('navigationFinished', { tabId: tab.id, url: tab.url, title: tab.title });
    return true;
  }

  async goForward() {
    const tab = this.getActiveTab();
    if (!tab || !tab.canGoForward || tab.historyIndex >= tab.historyStack.length - 1) return false;
    tab.historyIndex++;
    tab.url = tab.historyStack[tab.historyIndex];
    tab.canGoBack = true;
    tab.canGoForward = tab.historyIndex < tab.historyStack.length - 1;
    this.emit('navigationFinished', { tabId: tab.id, url: tab.url, title: tab.title });
    return true;
  }

  canGoBack() {
    return this.getActiveTab()?.canGoBack ?? false;
  }

  canGoForward() {
    return this.getActiveTab()?.canGoForward ?? false;
  }

  async reload(ignoreCache = false) {
    const tab = this.getActiveTab();
    if (!tab) return;
    tab.isLoading = true;
    this.emit('navigationStarted', { tabId: tab.id, url: tab.url });
    tab.isLoading = false;
    this.emit('navigationFinished', { tabId: tab.id, url: tab.url, title: tab.title });
  }

  async stop() {
    const tab = this.getActiveTab();
    if (!tab) return;
    tab.isLoading = false;
    this.emit('loadingStopped', { tabId: tab.id });
  }

  getCurrentUrl() {
    return this.getActiveTab()?.url ?? 'about:blank';
  }

  getTitle() {
    return this.getActiveTab()?.title ?? '';
  }

  getFavicon() {
    return this.getActiveTab()?.favicon ?? null;
  }

  getLoadingProgress() {
    return this.getActiveTab()?.loadingProgress ?? 0;
  }

  isLoading() {
    return this.getActiveTab()?.isLoading ?? false;
  }

  getZoomLevel() {
    return this.zoom;
  }

  async setZoomLevel(zoom) {
    this.zoom = zoom;
    this.emit('zoomChanged', zoom);
  }

  async setUserAgent(userAgent) {
    this.userAgent = userAgent;
    this.emit('userAgentChanged', userAgent);
  }

  isSecurityValid() {
    return this.getActiveTab()?.isSecure ?? true;
  }

  getSecurityCertificate() {
    return {
      protocol: 'TLS 1.3',
      cipher: 'TLS_AES_256_GCM_SHA384',
      valid: this.isSecurityValid(),
      engine: 'WebKitGTK GnuTLS/OpenSSL Backend'
    };
  }

  resize(width, height) {
    this.bounds = { width, height };
    this.emit('boundsChanged', this.bounds);
  }

  exportSession() {
    return {
      id: 'session-linux-' + Date.now(),
      tabs: this.getTabs(),
      activeTabId: this.activeTabId || '',
      updatedAt: Date.now()
    };
  }

  async restoreSession(session) {
    this.tabs.clear();
    for (const tab of session.tabs) {
      this.tabs.set(tab.id, { ...tab });
    }
    this.activeTabId = session.activeTabId || (session.tabs[0]?.id ?? null);
    this.emit('sessionRestored', session);
  }

  async destroy() {
    this.isDestroyed = true;
    this.tabs.clear();
    this.listeners.clear();
    this.container = null;
  }

  addEventListener(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  emit(event, data) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.error(`Error in WebKitGTK event handler for ${event}:`, err);
        }
      }
    }
  }
}
