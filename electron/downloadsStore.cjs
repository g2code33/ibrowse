'use strict';

/**
 * Persists Yayra's real download history + the user's chosen download
 * folder ("storage root") across restarts.
 *
 * This deliberately only ever stores *real* downloads that actually
 * happened (written by electron/downloadsBridge.cjs from live
 * `session.on('will-download')` events) - there is no seeded/sample data
 * here. A fresh install starts with an empty list and a default folder
 * (the OS "Downloads" directory), exactly like a real browser.
 *
 * Fully dependency-injected (fs, userDataDir, defaultDownloadsDir) so this
 * is unit-testable with a real temp directory and no live Electron runtime.
 * Mirrors the design of electron/authStore.cjs.
 */

const path = require('node:path');

const FILE_NAME = 'downloads.json';

function createDownloadsStore({ fs, userDataDir, defaultDownloadsDir }) {
  const filePath = path.join(userDataDir, FILE_NAME);

  // In-memory read cache: this process is the file's only writer, so once
  // read (or written) the parsed state is authoritative. Without it, every
  // renderer poll and every download progress event did a SYNCHRONOUS
  // exists+read+parse on the MAIN thread - with AV software scanning the
  // file on Windows, those stacked up into visible app freezes.
  let cache; // undefined = not read yet; null/object = cached disk state

  function readRaw() {
    if (cache !== undefined) return cache;
    if (!fs.existsSync(filePath)) {
      cache = null;
      return cache;
    }
    try {
      cache = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      cache = null;
    }
    return cache;
  }

  function writeRaw(data) {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data), { mode: 0o600 });
    cache = data;
  }

  function load() {
    const raw = readRaw();
    return {
      items: Array.isArray(raw?.items) ? raw.items : [],
      downloadRoot: typeof raw?.downloadRoot === 'string' && raw.downloadRoot ? raw.downloadRoot : defaultDownloadsDir
    };
  }

  function saveItems(items) {
    const current = load();
    const next = { ...current, items };
    writeRaw(next);
    return next;
  }

  function addOrUpdateItem(item) {
    const current = load();
    const idx = current.items.findIndex((it) => it.id === item.id);
    const items = idx === -1 ? [item, ...current.items] : current.items.map((it, i) => (i === idx ? { ...it, ...item } : it));
    // Keep a bounded history so this file never grows unbounded.
    const trimmed = items.slice(0, 500);
    return saveItems(trimmed);
  }

  function removeItem(id) {
    const current = load();
    return saveItems(current.items.filter((it) => it.id !== id));
  }

  function clearItems() {
    return saveItems([]);
  }

  function getDownloadRoot() {
    return load().downloadRoot;
  }

  function setDownloadRoot(dir) {
    const current = load();
    const next = { ...current, downloadRoot: dir };
    writeRaw(next);
    return next;
  }

  return { load, addOrUpdateItem, removeItem, clearItems, getDownloadRoot, setDownloadRoot };
}

module.exports = { createDownloadsStore, FILE_NAME };
