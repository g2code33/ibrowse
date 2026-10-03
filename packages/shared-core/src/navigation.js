/**
 * Yayra Floating Browser - Navigation Controller
 */

export class NavigationController {
  constructor(eventBus) {
    this.tabs = new Map();
    this.activeTabId = null;
    this.eventBus = eventBus;
  }

  createTab(url = 'about:blank', isIncognito = false) {
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const tab = {
      id,
      url: this.sanitizeUrl(url),
      title: 'New Tab',
      favicon: null,
      isLoading: false,
      loadingProgress: 0,
      canGoBack: false,
      canGoForward: false,
      zoomLevel: 1.0,
      isIncognito,
      isSecure: url.startsWith('https://'),
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.tabs.set(id, tab);
    if (!this.activeTabId) {
      this.activeTabId = id;
    }

    this.eventBus.emit('tab:created', { tab });
    return tab;
  }

  closeTab(tabId) {
    if (!this.tabs.has(tabId)) return;

    this.tabs.delete(tabId);
    this.eventBus.emit('tab:closed', { tabId });

    if (this.activeTabId === tabId) {
      const remaining = Array.from(this.tabs.keys());
      const nextActiveId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      if (nextActiveId) {
        this.switchTab(nextActiveId);
      } else {
        this.activeTabId = null;
      }
    }
  }

  switchTab(tabId) {
    if (!this.tabs.has(tabId)) return null;

    const previousTabId = this.activeTabId;
    this.activeTabId = tabId;

    this.eventBus.emit('tab:switched', {
      previousTabId,
      currentTabId: tabId
    });

    return this.tabs.get(tabId) || null;
  }

  getActiveTab() {
    if (!this.activeTabId) return null;
    return this.tabs.get(this.activeTabId) || null;
  }

  getTab(tabId) {
    return this.tabs.get(tabId) || null;
  }

  getAllTabs() {
    return Array.from(this.tabs.values());
  }

  updateTabState(tabId, updates) {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;

    Object.assign(tab, updates, { updatedAt: Date.now() });

    if (updates.title !== undefined) {
      this.eventBus.emit('navigation:title-changed', { tabId, title: updates.title });
    }
    if (updates.favicon !== undefined && updates.favicon !== null) {
      this.eventBus.emit('navigation:favicon-changed', { tabId, favicon: updates.favicon });
    }
    if (updates.loadingProgress !== undefined) {
      this.eventBus.emit('navigation:progress-changed', { tabId, progress: updates.loadingProgress });
    }

    return tab;
  }

  sanitizeUrl(input) {
    const trimmed = String(input || '').trim();
    if (!trimmed) return 'about:blank';
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
      return trimmed;
    }
    if (/^[^\s.]+\.[^\s]{2,}/.test(trimmed)) {
      return `https://${trimmed}`;
    }
    return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
  }
}
