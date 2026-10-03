import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MemoryPersistenceAdapter,
  CorruptedDataRecoveryAdapter,
  HistoryRepository,
  BookmarkRepository,
  SessionRepository,
  DownloadRepository,
  SettingsRepository,
  PrivacyManager,
  PrivateBrowsingStorageContext,
  DatabaseMigrationRunner,
  SQL_SCHEMA_V1
} from '../packages/persistence/src/index.js';

test('Database Schema & Migration: runs v1 and v2 migrations sequentially', async () => {
  const adapter = new MemoryPersistenceAdapter();
  const runner = new DatabaseMigrationRunner();

  assert.ok(SQL_SCHEMA_V1.includes('CREATE TABLE IF NOT EXISTS browser_tab'));
  assert.ok(SQL_SCHEMA_V1.includes('CREATE TABLE IF NOT EXISTS browser_history'));
  assert.ok(SQL_SCHEMA_V1.includes('CREATE TABLE IF NOT EXISTS browser_bookmark'));
  assert.ok(SQL_SCHEMA_V1.includes('CREATE TABLE IF NOT EXISTS browser_session'));
  assert.ok(SQL_SCHEMA_V1.includes('CREATE TABLE IF NOT EXISTS download_record'));
  assert.ok(SQL_SCHEMA_V1.includes('CREATE TABLE IF NOT EXISTS browser_settings'));
  assert.ok(SQL_SCHEMA_V1.includes('CREATE TABLE IF NOT EXISTS floating_settings'));

  const finalVersion = await runner.runMigrations(adapter);
  assert.equal(finalVersion, 2);
  const versionInDb = await adapter.get('db_schema_version');
  assert.equal(versionInDb, 2);
});

test('HistoryRepository: saves visits, searches entries, and prevents credential leakage', async () => {
  const adapter = new MemoryPersistenceAdapter();
  const repo = new HistoryRepository(adapter);

  // Normal entry
  await repo.addEntry('https://duckduckgo.com/?q=open+source', 'DuckDuckGo Search');
  // URL containing cleartext credentials should be sanitized
  await repo.addEntry('https://example.com/login?user=admin&password=SuperSecretPassword123', 'Example Login');

  const entries = await repo.getEntries();
  assert.equal(entries.length, 2);
  assert.ok(!entries[0].url.includes('SuperSecretPassword123'));
  assert.ok(entries[0].url.includes('REDACTED'));

  // Search
  const results = await repo.search('source');
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'DuckDuckGo Search');

  // Last Visited
  const lastVisited = await repo.getLastVisited();
  assert.ok(lastVisited);
  assert.equal(lastVisited.title, 'Example Login');
});

test('BookmarkRepository: manages tree hierarchy, folders, and position ordering', async () => {
  const adapter = new MemoryPersistenceAdapter();
  const repo = new BookmarkRepository(adapter);

  const rootFolder = await repo.createFolder('Development');
  assert.equal(rootFolder.isFolder, true);

  const bm1 = await repo.addBookmark('GitHub', 'https://github.com', rootFolder.id);
  const bm2 = await repo.addBookmark('MDN Web Docs', 'https://developer.mozilla.org', rootFolder.id);

  const rootChildren = await repo.getBookmarks(rootFolder.id);
  assert.equal(rootChildren.length, 2);
  assert.equal(rootChildren[0].title, 'GitHub');
  assert.equal(rootChildren[1].title, 'MDN Web Docs');

  // Search bookmarks
  const found = await repo.searchBookmarks('mozilla');
  assert.equal(found.length, 1);
  assert.equal(found[0].url, 'https://developer.mozilla.org');

  // Delete folder
  await repo.deleteBookmark(rootFolder.id);
  const afterDelete = await repo.getBookmarks(rootFolder.id);
  assert.equal(afterDelete.length, 0);
});

test('SessionRepository: restores tabs, validates URLs, and ignores incognito sessions', async () => {
  const adapter = new MemoryPersistenceAdapter();
  const repo = new SessionRepository(adapter);

  const tabs = [
    {
      id: 'tab-1',
      url: 'https://news.ycombinator.com',
      title: 'Hacker News',
      favicon: null,
      isLoading: false,
      loadingProgress: 100,
      canGoBack: false,
      canGoForward: false,
      zoomLevel: 1.0,
      isIncognito: false,
      isSecure: true,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    },
    {
      id: 'tab-2',
      url: 'javascript:alert("exploit")', // Malicious executable URL
      title: 'Malicious Tab',
      favicon: null,
      isLoading: false,
      loadingProgress: 100,
      canGoBack: false,
      canGoForward: false,
      zoomLevel: 1.0,
      isIncognito: false,
      isSecure: false,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    },
    {
      id: 'tab-incognito',
      url: 'https://secret.com',
      title: 'Secret Incognito',
      favicon: null,
      isLoading: false,
      loadingProgress: 100,
      canGoBack: false,
      canGoForward: false,
      zoomLevel: 1.0,
      isIncognito: true,
      isSecure: true,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  ];

  await repo.saveTabs(tabs, 'tab-1');

  const restored = await repo.restoreTabs();
  assert.ok(restored);
  // Incognito tab must be excluded
  assert.equal(restored.tabs.length, 2);
  assert.equal(restored.activeTabId, 'tab-1');

  // Dangerous javascript: URL must be safely neutralized to default search
  const neutralized = restored.tabs.find((t) => t.id === 'tab-2');
  assert.equal(neutralized.url, 'https://duckduckgo.com');
});

test('DownloadRepository: tracks download progress and state transitions', async () => {
  const adapter = new MemoryPersistenceAdapter();
  const repo = new DownloadRepository(adapter);

  const dl = await repo.addRecord({
    id: 'dl-1',
    url: 'https://example.com/archive.zip',
    fileName: 'archive.zip',
    filePath: '/downloads/archive.zip',
    totalBytes: 1048576,
    receivedBytes: 0,
    state: 'in-progress',
    mimeType: 'application/zip'
  });

  assert.equal(dl.state, 'in-progress');

  await repo.updateRecord('dl-1', {
    receivedBytes: 1048576,
    state: 'completed',
    completedAt: Date.now()
  });

  const all = await repo.getRecords();
  assert.equal(all.length, 1);
  assert.equal(all[0].state, 'completed');
  assert.equal(all[0].receivedBytes, 1048576);

  await repo.clearDownloads();
  const empty = await repo.getRecords();
  assert.equal(empty.length, 0);
});

test('SettingsRepository: manages BrowserSettings, FloatingSettings, geometry, and bubble position', async () => {
  const adapter = new MemoryPersistenceAdapter();
  const repo = new SettingsRepository(adapter);

  const initial = await repo.getSettings();
  assert.equal(initial.desktopFloatingMode, 'circle-first');
  assert.equal(initial.searchEngine, 'google');

  await repo.updateSettings({
    desktopFloatingMode: 'browser-first',
    searchEngine: 'searx',
    adBlockEnabled: true,
    glassmorphismBlurRadius: 24
  });

  const updated = await repo.getSettings();
  assert.equal(updated.desktopFloatingMode, 'browser-first');
  assert.equal(updated.searchEngine, 'searx');
  assert.equal(updated.glassmorphismBlurRadius, 24);

  // Save & load window geometry
  await repo.saveWindowGeometry({ x: 250, y: 150, width: 900, height: 650, monitorIndex: 1 });
  const geom = await repo.loadWindowGeometry();
  assert.equal(geom.x, 250);
  assert.equal(geom.width, 900);

  // Save & load bubble position
  await repo.saveBubblePosition({ x: 1840, y: 320, snapSide: 'right' });
  const bubblePos = await repo.loadBubblePosition();
  assert.equal(bubblePos.x, 1840);
  assert.equal(bubblePos.snapSide, 'right');
});

test('PrivacyManager: provides comprehensive history, cookies, cache, storage, and bookmark clearing', async () => {
  const adapter = new MemoryPersistenceAdapter();
  const privacy = new PrivacyManager(adapter);

  const historyRepo = new HistoryRepository(adapter);
  const bookmarkRepo = new BookmarkRepository(adapter);

  await historyRepo.addEntry('https://site-a.com', 'Site A');
  await bookmarkRepo.addBookmark('Site B', 'https://site-b.com');
  await adapter.set('cookie:site-a.com:sess', 'abc123token');
  await adapter.set('cache:site-a.com:main.js', 'console.log()');
  await adapter.set('webstorage:site-a.com:state', { count: 42 });

  // Clear cookies & cache
  await privacy.clearCookies();
  assert.equal(await adapter.get('cookie:site-a.com:sess'), null);

  await privacy.clearCache();
  assert.equal(await adapter.get('cache:site-a.com:main.js'), null);

  await privacy.clearWebsiteStorage();
  assert.equal(await adapter.get('webstorage:site-a.com:state'), null);

  // Clear all remaining user data
  await privacy.clearAllUserData();
  assert.equal((await historyRepo.getEntries()).length, 0);
});

test('PrivateBrowsingStorageContext: strictly isolates incognito browsing from persistent disk', async () => {
  const diskAdapter = new MemoryPersistenceAdapter();
  const diskHistory = new HistoryRepository(diskAdapter);

  // Normal browsing writes to disk
  await diskHistory.addEntry('https://public-site.com', 'Public Site');
  assert.equal((await diskHistory.getEntries()).length, 1);

  // Private session uses ephemeral context
  const privateContext = new PrivateBrowsingStorageContext();
  const privateAdapter = privateContext.getAdapter();
  const privateHistory = new HistoryRepository(privateAdapter);

  await privateHistory.addEntry('https://private-banking.com', 'Private Banking');
  assert.equal((await privateHistory.getEntries()).length, 1);

  // Verify disk storage remains completely untouched
  const diskAfterPrivate = await diskHistory.getEntries();
  assert.equal(diskAfterPrivate.length, 1);
  assert.equal(diskAfterPrivate[0].url, 'https://public-site.com');

  // Destroy private session wipes ephemeral partition
  await privateContext.destroy();
  assert.equal(privateContext.isContextActive(), false);
  assert.throws(() => privateContext.getAdapter(), /destroyed/);
});

test('CorruptedDataRecoveryAdapter: handles malformed data gracefully without crashing', async () => {
  const memory = new MemoryPersistenceAdapter();
  const recovery = new CorruptedDataRecoveryAdapter(memory);

  // Save valid settings
  await recovery.set('user-settings', { desktopFloatingMode: 'circle-first', searchEngine: 'duckduckgo' });
  const valid = await recovery.get('user-settings');
  assert.equal(valid.desktopFloatingMode, 'circle-first');

  // Intentionally corrupt storage by injecting invalid JSON directly into memory store
  memory.store.set('user-settings', '{malformed_json:--broken--');

  // Reading corrupted data must NOT throw an uncaught error; it falls back to last known good
  const recovered = await recovery.get('user-settings');
  assert.ok(recovered);
  assert.equal(recovered.desktopFloatingMode, 'circle-first');
  assert.equal(recovery.getCorruptionLog().length, 1);
});
