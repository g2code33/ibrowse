import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthStore } from '../electron/authStore.cjs';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yayra-auth-store-'));
}

function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    // Trivial reversible "encryption" stand-in for an OS keychain - good
    // enough to prove the store round-trips through it correctly.
    encryptString: (str) => Buffer.from(`enc:${str}`, 'utf8'),
    decryptString: (buf) => buf.toString('utf8').replace(/^enc:/, '')
  };
}

test('authStore: save() then load() round-trips profile and tokens when encryption is available', () => {
  const dir = makeTempDir();
  const store = createAuthStore({ fs, safeStorageImpl: fakeSafeStorage(true), userDataDir: dir });

  store.save({ profile: { sub: '1', email: 'a@b.com' }, tokens: { access_token: 'at', refresh_token: 'rt' } });
  const loaded = store.load();

  assert.deepEqual(loaded.profile, { sub: '1', email: 'a@b.com' });
  assert.deepEqual(loaded.tokens, { access_token: 'at', refresh_token: 'rt' });
  assert.ok(loaded.savedAt);
});

test('authStore: tokens are never written to disk in plaintext', () => {
  const dir = makeTempDir();
  const store = createAuthStore({ fs, safeStorageImpl: fakeSafeStorage(true), userDataDir: dir });
  store.save({ profile: { sub: '1' }, tokens: { access_token: 'super-secret-access-token', refresh_token: 'super-secret-refresh-token' } });

  const raw = fs.readFileSync(path.join(dir, 'google-session.json'), 'utf8');
  assert.ok(!raw.includes('super-secret-access-token'));
  assert.ok(!raw.includes('super-secret-refresh-token'));
});

test('authStore: load() returns null when nothing has been saved', () => {
  const dir = makeTempDir();
  const store = createAuthStore({ fs, safeStorageImpl: fakeSafeStorage(true), userDataDir: dir });
  assert.equal(store.load(), null);
});

test('authStore: clear() removes the session so a subsequent load() returns null', () => {
  const dir = makeTempDir();
  const store = createAuthStore({ fs, safeStorageImpl: fakeSafeStorage(true), userDataDir: dir });
  store.save({ profile: { sub: '1' }, tokens: { access_token: 'at' } });
  assert.ok(store.load());
  store.clear();
  assert.equal(store.load(), null);
});

test('authStore: clear() on an already-empty store does not throw', () => {
  const dir = makeTempDir();
  const store = createAuthStore({ fs, safeStorageImpl: fakeSafeStorage(true), userDataDir: dir });
  assert.doesNotThrow(() => store.clear());
});

test('authStore: when OS keychain encryption is unavailable, profile is still kept but tokens are not persisted unencrypted', () => {
  const dir = makeTempDir();
  const store = createAuthStore({ fs, safeStorageImpl: fakeSafeStorage(false), userDataDir: dir });
  store.save({ profile: { sub: '1', email: 'a@b.com' }, tokens: { access_token: 'secret' } });

  const raw = fs.readFileSync(path.join(dir, 'google-session.json'), 'utf8');
  assert.ok(!raw.includes('secret'));

  const loaded = store.load();
  assert.deepEqual(loaded.profile, { sub: '1', email: 'a@b.com' });
  assert.equal(loaded.tokens, null);
});

test('authStore: load() tolerates a corrupted session file instead of throwing', () => {
  const dir = makeTempDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'google-session.json'), 'not valid json {{{');
  const store = createAuthStore({ fs, safeStorageImpl: fakeSafeStorage(true), userDataDir: dir });
  assert.equal(store.load(), null);
});
