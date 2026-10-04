import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDownloadsStore } from '../electron/downloadsStore.cjs';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yayra-downloads-store-'));
}

test('downloadsStore: a fresh store starts with an empty item list and the default downloads dir (no seeded/fake data)', () => {
  const dir = makeTempDir();
  const store = createDownloadsStore({ fs, userDataDir: dir, defaultDownloadsDir: '/home/person/Downloads' });

  const loaded = store.load();
  assert.deepEqual(loaded.items, []);
  assert.equal(loaded.downloadRoot, '/home/person/Downloads');
});

test('downloadsStore: addOrUpdateItem() adds new records and updates existing ones by id in place', () => {
  const dir = makeTempDir();
  const store = createDownloadsStore({ fs, userDataDir: dir, defaultDownloadsDir: '/dl' });

  store.addOrUpdateItem({ id: 'a', filename: 'report.pdf', state: 'Downloading' });
  store.addOrUpdateItem({ id: 'b', filename: 'photo.png', state: 'Downloading' });
  let loaded = store.load();
  assert.equal(loaded.items.length, 2);
  // Newest-first ordering.
  assert.equal(loaded.items[0].id, 'b');

  store.addOrUpdateItem({ id: 'a', state: 'Completed' });
  loaded = store.load();
  assert.equal(loaded.items.length, 2);
  const a = loaded.items.find((it) => it.id === 'a');
  assert.equal(a.state, 'Completed');
  assert.equal(a.filename, 'report.pdf');
});

test('downloadsStore: removeItem() and clearItems() work and persist across a fresh store instance', () => {
  const dir = makeTempDir();
  const store = createDownloadsStore({ fs, userDataDir: dir, defaultDownloadsDir: '/dl' });
  store.addOrUpdateItem({ id: 'a', filename: 'x' });
  store.addOrUpdateItem({ id: 'b', filename: 'y' });

  store.removeItem('a');
  assert.deepEqual(store.load().items.map((it) => it.id), ['b']);

  const store2 = createDownloadsStore({ fs, userDataDir: dir, defaultDownloadsDir: '/dl' });
  assert.deepEqual(store2.load().items.map((it) => it.id), ['b']);

  store2.clearItems();
  assert.deepEqual(store2.load().items, []);
});

test('downloadsStore: setDownloadRoot()/getDownloadRoot() persist the user-chosen storage root across instances', () => {
  const dir = makeTempDir();
  const store = createDownloadsStore({ fs, userDataDir: dir, defaultDownloadsDir: '/default/Downloads' });
  assert.equal(store.getDownloadRoot(), '/default/Downloads');

  store.setDownloadRoot('/mnt/external-drive/MyDownloads');
  assert.equal(store.getDownloadRoot(), '/mnt/external-drive/MyDownloads');

  const store2 = createDownloadsStore({ fs, userDataDir: dir, defaultDownloadsDir: '/default/Downloads' });
  assert.equal(store2.getDownloadRoot(), '/mnt/external-drive/MyDownloads');
});

test('downloadsStore: history is bounded so the file never grows without limit', () => {
  const dir = makeTempDir();
  const store = createDownloadsStore({ fs, userDataDir: dir, defaultDownloadsDir: '/dl' });
  for (let i = 0; i < 600; i += 1) {
    store.addOrUpdateItem({ id: `dl-${i}`, filename: `f${i}` });
  }
  assert.ok(store.load().items.length <= 500);
});
