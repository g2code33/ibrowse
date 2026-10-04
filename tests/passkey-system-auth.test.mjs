/**
 * P29 passkey fixes:
 *
 * 1. REAL system-password confirmation on Linux: the 'device' (system
 *    lock) method now runs a live PolicyKit prompt (pkexec) at both
 *    registration and verification - "using system password" actually
 *    asks for and checks the system password instead of silently
 *    decrypting (or silently failing).
 * 2. Durable record storage: the device record is written with a .bak
 *    twin and reads fall back to it, so a corrupted main file no longer
 *    makes verify report "no passkey registered".
 * 3. Renderer self-REPAIR: when the device-side record is genuinely
 *    gone, verifying no longer silently REMOVES the passkey - device
 *    records are re-created through the OS ceremony; only PIN records
 *    (whose verifier cannot be rebuilt) still fall back to removal.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { setupDomShim } from './dom-shim.mjs';

setupDomShim();

import { createRequire } from 'node:module';
import { PasskeyService } from '../packages/shared-ui/src/services/passkeyService.js';

const require = createRequire(import.meta.url);
const { createPasskeyBridge } = require('../electron/passkeyBridge.cjs');

function makeFakeFs({ withPkexec = false } = {}) {
  const files = new Map();
  if (withPkexec) files.set('/usr/bin/pkexec', '#!');
  return {
    files,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      if (!files.has(p)) throw new Error('ENOENT');
      return files.get(p);
    },
    writeFileSync: (p, data) => { files.set(p, String(data)); },
    mkdirSync: () => {},
    unlinkSync: (p) => { files.delete(p); }
  };
}

const noKeychain = {
  isEncryptionAvailable: () => false,
  encryptString: () => { throw new Error('no backend'); },
  decryptString: () => { throw new Error('no backend'); }
};

function makeWorkingKeychain() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`),
    decryptString: (buf) => String(buf).replace(/^enc:/, '')
  };
}

/** spawn fake: pops exit codes off a script, records every invocation. */
function makeSpawnScript(exitCodes) {
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
    const code = exitCodes.length ? exitCodes.shift() : 0;
    calls.push({ cmd, args, opts });
    return {
      once(event, fn) { if (event === 'exit') setImmediate(() => fn(code)); },
      kill() {}
    };
  };
  return { calls, spawnImpl };
}

function makeLinuxBridge({ fs = null, safeStorageImpl = noKeychain, exitCodes = [] } = {}) {
  const fakeFs = fs || makeFakeFs({ withPkexec: true });
  const { calls, spawnImpl } = makeSpawnScript(exitCodes);
  const bridge = createPasskeyBridge({
    ipcMain: null,
    fs: fakeFs,
    path,
    userDataDir: '/fake/userData',
    safeStorageImpl,
    systemPreferencesImpl: null,
    platform: 'linux',
    spawnImpl,
    phoneApproval: null,
    logger: { error: () => {}, warn: () => {} }
  });
  return { bridge, fs: fakeFs, spawnCalls: calls };
}

const RECORD_PATH = '/fake/userData/yayra-device-passkey.json';

/* ----------------- Linux system lock = REAL pkexec prompt ----------------- */

test('Linux + pkexec: system lock registers and verifies with ZERO keychain - the live password prompt is the proof', async () => {
  const { bridge, fs, spawnCalls } = makeLinuxBridge({ exitCodes: [0, 0] });

  const status = await bridge.handleStatus();
  assert.equal(status.available, false, 'keychain really is unavailable');
  assert.equal(status.methods.deviceLock, true, 'system lock is OFFERED anyway - pkexec makes it real');

  const reg = await bridge.handleRegister(null, { label: 'linux user', method: 'device' });
  assert.equal(reg.ok, true, 'registration works without a keychain');
  assert.equal(reg.passkey.method, 'system-lock');
  assert.equal(spawnCalls.length, 1, 'creating the passkey CONFIRMED the system password');
  assert.match(spawnCalls[0].cmd, /pkexec$/);

  const record = JSON.parse(fs.files.get(RECORD_PATH));
  assert.equal(record.encryptedSecret, undefined, 'no fake secret is stored - the live prompt is the ceremony');

  const ok = await bridge.handleVerify(null, {});
  assert.deepEqual(ok, { ok: true });
  assert.equal(spawnCalls.length, 2, 'verify ran the system password prompt again');
});

test('Linux + pkexec: dismissing the system password prompt FAILS the ceremony (register and verify)', async () => {
  const { bridge, fs } = makeLinuxBridge({ exitCodes: [126, 0, 126] });

  const declined = await bridge.handleRegister(null, { label: 'u', method: 'device' });
  assert.equal(declined.ok, false);
  assert.equal(declined.reason, 'user-declined-or-timeout');
  assert.equal(fs.files.has(RECORD_PATH), false, 'nothing persisted after a declined prompt');

  assert.equal((await bridge.handleRegister(null, { label: 'u', method: 'device' })).ok, true);
  const verify = await bridge.handleVerify(null, {});
  assert.equal(verify.ok, false);
  assert.equal(verify.reason, 'user-declined-or-timeout', 'wrong/cancelled system password NEVER unlocks the vault');
});

test('Linux + pkexec + keychain: verify demands the live system prompt even when decryption would succeed', async () => {
  const { bridge } = makeLinuxBridge({ safeStorageImpl: makeWorkingKeychain(), exitCodes: [0, 126, 0] });

  const reg = await bridge.handleRegister(null, { label: 'u', method: 'device' });
  assert.equal(reg.ok, true);

  const declined = await bridge.handleVerify(null, {});
  assert.equal(declined.ok, false, 'silent decrypt alone no longer passes when a real prompt exists');
  assert.equal(declined.reason, 'user-declined-or-timeout');

  assert.deepEqual(await bridge.handleVerify(null, {}), { ok: true });
});

test('Linux + pkexec: a reset OS keyring (decrypt throws) is survivable - the live prompt still proves the user', async () => {
  const keychain = makeWorkingKeychain();
  const { bridge } = makeLinuxBridge({ safeStorageImpl: keychain, exitCodes: [0, 0] });
  assert.equal((await bridge.handleRegister(null, { label: 'u', method: 'device' })).ok, true);

  keychain.decryptString = () => { throw new Error('keyring was reset'); };
  assert.deepEqual(await bridge.handleVerify(null, {}), { ok: true },
    'passing the system password prompt outranks stale ciphertext');
});

/* --------------------- record durability (.bak twin) --------------------- */

test('durability: a corrupted main record file self-heals from the backup - verify never claims "no passkey"', async () => {
  const { bridge, fs } = makeLinuxBridge({ exitCodes: [0, 0] });
  assert.equal((await bridge.handleRegister(null, { label: 'u', method: 'device' })).ok, true);
  assert.ok(fs.files.has(`${RECORD_PATH}.bak`), 'backup twin exists');

  fs.files.set(RECORD_PATH, '{half-written-garbag'); // crash mid-write
  const status = await bridge.handleStatus();
  assert.equal(status.registered, true, 'backup keeps the registration alive');
  assert.deepEqual(await bridge.handleVerify(null, {}), { ok: true });
  assert.ok(JSON.parse(fs.files.get(RECORD_PATH)).credentialId, 'main file restored from backup');
});

test('durability: remove deletes BOTH the record and its backup', async () => {
  const { bridge, fs } = makeLinuxBridge({ exitCodes: [0] });
  await bridge.handleRegister(null, { label: 'u', method: 'device' });
  await bridge.handleRemove();
  assert.equal(fs.files.has(RECORD_PATH), false);
  assert.equal(fs.files.has(`${RECORD_PATH}.bak`), false);
  assert.equal((await bridge.handleStatus()).registered, false);
});

/* ------------- renderer self-repair instead of silent removal ------------- */

function makeMemoryStorage() {
  const map = new Map();
  return {
    map,
    get: async (k) => (map.has(k) ? map.get(k) : null),
    set: async (k, v) => { map.set(k, v); },
    delete: async (k) => { map.delete(k); }
  };
}

test('verify with a lost DEVICE record REPAIRS it through the OS ceremony - the passkey is not removed', async () => {
  const storage = makeMemoryStorage();
  const registerCalls = [];
  const nativeBridge = {
    register: async (label, options) => {
      registerCalls.push({ label, options });
      return { ok: true, passkey: { credentialId: 'repaired-1', method: 'system-lock', createdAt: Date.now() } };
    },
    verify: async () => ({ ok: false, reason: 'no-passkey-registered' }),
    status: async () => ({ registered: false })
  };
  const service = new PasskeyService({ storage, nativeBridge });
  await storage.set('yayra-account-passkey-v1', {
    credentialId: 'lost-record', accountLabel: 'me@yayra', method: 'os-keychain', createdAt: 111
  });

  const result = await service.verifyPasskey();
  assert.equal(result.success, true, 'verification succeeds through the repair ceremony');
  assert.equal(result.repaired, true);
  assert.deepEqual(registerCalls, [{ label: 'me@yayra', options: { method: 'device' } }],
    'repair re-registers the device method (which itself runs the OS confirmation)');
  const stored = await service.getRegisteredPasskey();
  assert.equal(stored.credentialId, 'repaired-1', 'the passkey record lives on');
  assert.equal(stored.method, 'system-lock');
});

test('verify with a lost PIN record still removes it honestly (a typed guess must never mint a new verifier)', async () => {
  const storage = makeMemoryStorage();
  const registerCalls = [];
  const nativeBridge = {
    register: async (...args) => { registerCalls.push(args); return { ok: true, passkey: { credentialId: 'x' } }; },
    verify: async () => ({ ok: false, reason: 'no-passkey-registered' })
  };
  const service = new PasskeyService({ storage, nativeBridge });
  await storage.set('yayra-account-passkey-v1', {
    credentialId: 'lost-pin', accountLabel: 'me', method: 'pin', createdAt: 111
  });

  const result = await service.verifyPasskey({ pin: '123456' });
  assert.equal(result.success, false);
  assert.equal(result.reason, 'no-passkey-registered');
  assert.equal(registerCalls.length, 0, 'NO silent re-registration for PIN records');
  assert.equal(await service.getRegisteredPasskey(), null, 'stale record cleared so the UI offers Create passkey');
});

test('repair that itself fails falls back to the honest removal path', async () => {
  const storage = makeMemoryStorage();
  const nativeBridge = {
    register: async () => ({ ok: false, reason: 'keychain-unavailable' }),
    verify: async () => ({ ok: false, reason: 'no-passkey-registered' })
  };
  const service = new PasskeyService({ storage, nativeBridge });
  await storage.set('yayra-account-passkey-v1', {
    credentialId: 'lost', accountLabel: 'me', method: 'os-keychain', createdAt: 1
  });

  const result = await service.verifyPasskey();
  assert.equal(result.success, false);
  assert.equal(result.reason, 'no-passkey-registered');
  assert.equal(await service.getRegisteredPasskey(), null);
});
