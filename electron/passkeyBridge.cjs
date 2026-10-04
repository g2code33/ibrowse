'use strict';

/**
 * Device passkey for the Electron desktop shell.
 *
 * WHY THIS EXISTS: Yayra's desktop UI is served from the custom
 * `yayra://app` scheme. Chromium's WebAuthn implementation only mints
 * credentials for real http(s) origins with a valid domain, so
 * navigator.credentials.create() inside the shell throws SecurityError -
 * which users saw as "passkeys require a secure (HTTPS) context" even
 * though the app itself is perfectly trusted. Web/PWA builds (real
 * https origin) keep genuine WebAuthn passkeys.
 *
 * WHAT THIS IS (honest scope): an OS-keychain-bound device credential.
 * A random secret is generated at registration and encrypted with
 * Electron's safeStorage (DPAPI on Windows, Keychain on macOS,
 * libsecret/kwallet on Linux). Verifying = decrypting that secret, which
 * only the logged-in OS user's session can do; on macOS a REAL Touch ID
 * prompt guards the ceremony when the hardware supports it. It proves
 * "the OS user who registered this is present on this device" - the
 * right bar for unlocking a local vault.
 *
 * WHAT IT IS NOT: a cross-device synced passkey or (outside macOS) a
 * biometric prompt. The UI copy reflects that honestly.
 */

const crypto = require('node:crypto');

const FILE_NAME = 'yayra-device-passkey.json';

function createPasskeyBridge({
  ipcMain,
  fs,
  path,
  userDataDir,
  safeStorageImpl,
  systemPreferencesImpl = null,
  platform = process.platform,
  randomBytesImpl = (n) => crypto.randomBytes(n),
  logger = console
}) {
  const filePath = path.join(userDataDir, FILE_NAME);

  function encryptionAvailable() {
    try {
      return Boolean(safeStorageImpl && safeStorageImpl.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  function touchIdAvailable() {
    try {
      return platform === 'darwin'
        && Boolean(systemPreferencesImpl && typeof systemPreferencesImpl.canPromptTouchID === 'function'
          && systemPreferencesImpl.canPromptTouchID());
    } catch {
      return false;
    }
  }

  async function promptTouchIdIfAvailable(reason) {
    if (!touchIdAvailable()) return { ok: true, prompted: false };
    try {
      await systemPreferencesImpl.promptTouchID(reason);
      return { ok: true, prompted: true };
    } catch (err) {
      return { ok: false, reason: 'user-declined-or-timeout', detail: String(err?.message || err) };
    }
  }

  function readRecord() {
    try {
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  function method() {
    return touchIdAvailable() ? 'touch-id' : 'os-keychain';
  }

  async function handleStatus() {
    const record = readRecord();
    return {
      available: encryptionAvailable(),
      method: method(),
      registered: Boolean(record),
      passkey: record ? { credentialId: record.credentialId, label: record.label, createdAt: record.createdAt, method: record.method } : null
    };
  }

  async function handleRegister(_event, { label = 'Yayra user' } = {}) {
    if (!encryptionAvailable()) return { ok: false, reason: 'keychain-unavailable' };
    const gate = await promptTouchIdIfAvailable('register a Yayra device passkey');
    if (!gate.ok) return { ok: false, reason: gate.reason };
    try {
      const secret = randomBytesImpl(32).toString('base64');
      const encrypted = safeStorageImpl.encryptString(secret);
      const record = {
        credentialId: `device-${Date.now()}-${randomBytesImpl(6).toString('hex')}`,
        label: String(label),
        createdAt: Date.now(),
        method: method(),
        secretHash: crypto.createHash('sha256').update(secret).digest('hex'),
        encryptedSecret: Buffer.from(encrypted).toString('base64')
      };
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(record));
      return { ok: true, passkey: { credentialId: record.credentialId, label: record.label, createdAt: record.createdAt, method: record.method } };
    } catch (err) {
      logger?.error?.(`[yayra:passkey] register failed: ${err?.message || err}`);
      return { ok: false, reason: 'keychain-unavailable' };
    }
  }

  async function handleVerify() {
    const record = readRecord();
    if (!record) return { ok: false, reason: 'no-passkey-registered' };
    if (!encryptionAvailable()) return { ok: false, reason: 'keychain-unavailable' };
    const gate = await promptTouchIdIfAvailable('unlock your Yayra vault');
    if (!gate.ok) return { ok: false, reason: gate.reason };
    try {
      const secret = safeStorageImpl.decryptString(Buffer.from(record.encryptedSecret, 'base64'));
      const matches = crypto.createHash('sha256').update(secret).digest('hex') === record.secretHash;
      return matches ? { ok: true } : { ok: false, reason: 'verification-failed' };
    } catch (err) {
      logger?.error?.(`[yayra:passkey] verify failed: ${err?.message || err}`);
      return { ok: false, reason: 'verification-failed' };
    }
  }

  async function handleRemove() {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: String(err?.message || err) };
    }
  }

  if (ipcMain) {
    ipcMain.handle('yayra:passkey-status', handleStatus);
    ipcMain.handle('yayra:passkey-register', handleRegister);
    ipcMain.handle('yayra:passkey-verify', handleVerify);
    ipcMain.handle('yayra:passkey-remove', handleRemove);
  }

  return { handleStatus, handleRegister, handleVerify, handleRemove, _filePath: filePath };
}

module.exports = { createPasskeyBridge };
