/**
 * Profile-scoped persistence for the browser shell.
 *
 * WHY: the shipped app constructed BrowserShell with NO history/bookmarks/
 * settings repositories at all - the menu items "worked" visually but
 * nothing was ever stored (star a page: gone on restart; yayra://history:
 * always empty). This module provides real repositories backed by
 * localStorage, namespaced PER PROFILE (`yayra:p:<profileId>:<key>`), so
 * every profile keeps its own history, bookmarks, settings and wheel.
 *
 * The profile id is resolved through a callback ON EVERY call, so
 * switching profiles in-window automatically re-scopes all storage with
 * zero re-wiring.
 *
 * Migration: the DEFAULT profile adopts pre-existing un-scoped keys
 * (e.g. the old global `yayra:settings` / `yayra_radial_actions`) the
 * first time the scoped key is missing - nobody loses data.
 */

function safeParse(raw, fallback = null) {
  if (raw === null || raw === undefined) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function createProfileScopedStorage({ backing, getProfileId, legacyKeys = {} } = {}) {
  const store = backing || (typeof localStorage !== 'undefined' ? localStorage : null);
  const pid = () => {
    try { return String((typeof getProfileId === 'function' && getProfileId()) || 'default'); } catch { return 'default'; }
  };
  const scoped = (key) => `yayra:p:${pid()}:${key}`;

  return {
    get profileId() { return pid(); },
    async get(key) {
      if (!store) return null;
      const raw = store.getItem(scoped(key));
      if (raw !== null && raw !== undefined) return safeParse(raw, null);
      // Default profile: adopt the legacy un-scoped key once.
      if (pid() === 'default' && legacyKeys[key]) {
        const legacy = store.getItem(legacyKeys[key]);
        if (legacy !== null && legacy !== undefined) {
          const value = safeParse(legacy, null);
          if (value !== null) {
            try { store.setItem(scoped(key), JSON.stringify(value)); } catch { /* quota */ }
            return value;
          }
        }
      }
      return null;
    },
    async set(key, value) {
      if (!store) return;
      try { store.setItem(scoped(key), JSON.stringify(value)); } catch { /* quota - keep running */ }
    },
    async delete(key) {
      if (!store) return;
      try { store.removeItem(scoped(key)); } catch { /* ignore */ }
      // The legacy un-scoped key is just the pre-profile alias of the
      // default profile's data - deleting must cover it too, or the old
      // value would silently re-migrate on the next read.
      if (pid() === 'default' && legacyKeys[key]) {
        try { store.removeItem(legacyKeys[key]); } catch { /* ignore */ }
      }
    }
  };
}

const HISTORY_KEY = 'history';
const HISTORY_CAP = 1000;

export function createHistoryRepo(storage) {
  const repo = {
    async addEntry(url, title = '', favicon = null) {
      if (!url || String(url).startsWith('yayra://newtab')) return;
      const items = (await storage.get(HISTORY_KEY)) || [];
      // Collapse an immediate repeat (reload) instead of stacking dupes.
      if (items[0]?.url === url) {
        items[0] = { ...items[0], title: title || items[0].title, lastVisitedAt: Date.now() };
      } else {
        items.unshift({
          id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          url, title: title || url, favicon: favicon || null, lastVisitedAt: Date.now()
        });
      }
      await storage.set(HISTORY_KEY, items.slice(0, HISTORY_CAP));
    },
    async getEntries(limit = 100) {
      const items = (await storage.get(HISTORY_KEY)) || [];
      return items.slice(0, limit);
    },
    async removeEntry(id) {
      const items = (await storage.get(HISTORY_KEY)) || [];
      await storage.set(HISTORY_KEY, items.filter((i) => i.id !== id));
    },
    async clear() {
      await storage.delete(HISTORY_KEY);
    }
  };
  // Duck-typed aliases BrowserShell probes for (older repo contracts).
  repo.recordVisit = (url, title) => repo.addEntry(url, title);
  repo.deleteEntry = (id) => repo.removeEntry(id);
  repo.clearHistory = () => repo.clear();
  return repo;
}

const BOOKMARKS_KEY = 'bookmarks';

export function createBookmarksRepo(storage) {
  const repo = {
    async getAllBookmarks() {
      return (await storage.get(BOOKMARKS_KEY)) || [];
    },
    async addBookmark({ url, title = '', favicon = null } = {}) {
      if (!url) return null;
      const items = (await storage.get(BOOKMARKS_KEY)) || [];
      if (items.some((b) => b.url === url)) return items.find((b) => b.url === url);
      const bookmark = {
        id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url, title: title || url, favicon: favicon || null, addedAt: Date.now()
      };
      items.unshift(bookmark);
      await storage.set(BOOKMARKS_KEY, items);
      return bookmark;
    },
    async removeBookmark(urlOrId) {
      const items = (await storage.get(BOOKMARKS_KEY)) || [];
      await storage.set(BOOKMARKS_KEY, items.filter((b) => b.url !== urlOrId && b.id !== urlOrId));
    },
    async isBookmarked(url) {
      const items = (await storage.get(BOOKMARKS_KEY)) || [];
      return items.some((b) => b.url === url);
    }
  };
  // Duck-typed alias BrowserShell probes for first.
  repo.removeBookmarkByUrl = (url) => repo.removeBookmark(url);
  return repo;
}

const SETTINGS_KEY = 'settings';

export function createSettingsRepo(storage) {
  return {
    async getSettings() {
      return (await storage.get(SETTINGS_KEY)) || null;
    },
    async updateSettings(partial) {
      const current = (await storage.get(SETTINGS_KEY)) || {};
      const next = { ...current, ...(partial || {}) };
      await storage.set(SETTINGS_KEY, next);
      return next;
    }
  };
}

const WHEEL_KEY = 'radial-wheel';

/**
 * Radial action wheel persistence. Only plain serializable fields are
 * stored ({id,title,url,type}) - builtin actions are rebuilt by id at
 * load time and icons are resolved at render time (favicon for links),
 * so stale icon-HTML blobs from old versions are stripped on read.
 */
export function createWheelRepo(storage) {
  const sanitize = (items) => (Array.isArray(items) ? items : [])
    .filter((i) => i && i.id && i.title)
    .map(({ id, title, url = null, type = null }) => ({ id, title, url, type }));
  return {
    async getItems() {
      const items = await storage.get(WHEEL_KEY);
      return items === null ? null : sanitize(items);
    },
    async setItems(items) {
      await storage.set(WHEEL_KEY, sanitize(items));
    },
    async reset() {
      await storage.delete(WHEEL_KEY);
    }
  };
}
