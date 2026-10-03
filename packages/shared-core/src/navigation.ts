/**
 * Yayra Floating Browser - Navigation Controller
 * Platform-independent browser tab and navigation state management.
 */

import { BrowserTab, NavigationEventPayloads } from './types.js';
import { EventBus } from './events.js';

export class NavigationController {
  private tabs: Map<string, BrowserTab> = new Map();
  private activeTabId: string | null = null;
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  public createTab(url: string = 'about:blank', isIncognito: boolean = false): BrowserTab {
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const tab: BrowserTab = {
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

  public closeTab(tabId: string): void {
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

  public switchTab(tabId: string): BrowserTab | null {
    if (!this.tabs.has(tabId)) return null;

    const previousTabId = this.activeTabId;
    this.activeTabId = tabId;

    this.eventBus.emit('tab:switched', {
      previousTabId,
      currentTabId: tabId
    });

    return this.tabs.get(tabId) || null;
  }

  public getActiveTab(): BrowserTab | null {
    if (!this.activeTabId) return null;
    return this.tabs.get(this.activeTabId) || null;
  }

  public getTab(tabId: string): BrowserTab | null {
    return this.tabs.get(tabId) || null;
  }

  public getAllTabs(): BrowserTab[] {
    return Array.from(this.tabs.values());
  }

  public updateTabState(tabId: string, updates: Partial<BrowserTab>): BrowserTab | null {
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

  public sanitizeUrl(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return 'about:blank';
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
      return trimmed;
    }
    if (/^[^\s.]+\.[^\s]{2,}/.test(trimmed)) {
      return `https://${trimmed}`;
    }
    // Search query fallback
    return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
  }
}
