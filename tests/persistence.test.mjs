import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryPersistenceAdapter } from '../packages/persistence/src/LocalFirstStore.js';
import { SettingsRepository } from '../packages/persistence/src/SettingsRepository.js';
import { BookmarkRepository, HistoryRepository, SessionRepository } from '../packages/persistence/src/HistoryRepository.js';

test('SettingsRepository persists and updates local-first configuration', async () => {
  const adapter = new MemoryPersistenceAdapter();
  const repo = new SettingsRepository(adapter);

  const initial = await repo.getSettings();
  assert.equal(initial.desktopFloatingMode, 'circle-first');
  assert.equal(initial.searchEngine, 'google');

  const updated = await repo.updateSettings({
    desktopFloatingMode: 'browser-first',
    searchEngine: 'searx'
  });
  assert.equal(updated.desktopFloatingMode, 'browser-first');
  assert.equal(updated.searchEngine, 'searx');

  const reloaded = await repo.getSettings();
  assert.equal(reloaded.desktopFloatingMode, 'browser-first');
  assert.equal(reloaded.searchEngine, 'searx');
});

test('HistoryRepository logs visits, enables search and allows pruning', async () => {
  const adapter = new MemoryPersistenceAdapter();
  const repo = new HistoryRepository(adapter);

  await repo.addEntry('https://duckduckgo.com', 'DuckDuckGo');
  await repo.addEntry('https://github.com/trending', 'GitHub Trending');
  await repo.addEntry('https://news.ycombinator.com', 'Hacker News');

  const all = await repo.getEntries();
  assert.equal(all.length, 3);

  const searchResults = await repo.search('git');
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].title, 'GitHub Trending');

  await repo.clearHistory();
  assert.equal((await repo.getEntries()).length, 0);
});

test('BookmarkRepository creates folders and stores hierarchy', async () => {
  const adapter = new MemoryPersistenceAdapter();
  const repo = new BookmarkRepository(adapter);

  const folder = await repo.createFolder('Tech News');
  const bm1 = await repo.addBookmark('Hacker News', 'https://news.ycombinator.com', folder.id);

  const folderBookmarks = await repo.getBookmarks(folder.id);
  assert.equal(folderBookmarks.length, 1);
  assert.equal(folderBookmarks[0].title, 'Hacker News');
});

test('SessionRepository saves and restores active tabs', async () => {
  const adapter = new MemoryPersistenceAdapter();
  const repo = new SessionRepository(adapter);

  const tabs = [
    { id: 'tab-1', url: 'https://a.com', title: 'A', isIncognito: false },
    { id: 'tab-2', url: 'https://secret.com', title: 'Secret', isIncognito: true }
  ];

  await repo.saveTabs(tabs, 'tab-1');
  const restored = await repo.restoreTabs();
  assert.ok(restored);
  // Incognito tabs must NOT be persisted
  assert.equal(restored.tabs.length, 1);
  assert.equal(restored.tabs[0].url, 'https://a.com');
  assert.equal(restored.activeTabId, 'tab-1');
});
