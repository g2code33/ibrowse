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
 *
 * FALLBACK LADDER for devices with no biometrics / no usable keychain /
 * no security key:
 *  1. 'device' method - safeStorage bound to the OS login ("system lock":
 *     unlocking the PC session IS the authentication), + Touch ID where
 *     the hardware has it.
 *  2. 'pin' method - a user-created 6-digit PIN, stored only as a
 *     scrypt verifier (salted, memory-hard) with attempt lockout:
 *     5 wrong tries locks PIN entry for 60 seconds.
 *  3. Phone QR approval (electron/phoneApproval.cjs) - scan a one-time
 *     QR with any phone on the same network and approve there.
 */

const crypto = require('node:crypto');

const FILE_NAME = 'yayra-device-passkey.json';
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MS = 60 * 1000;

function createPasskeyBridge({
  ipcMain,
  fs,
  path,
  userDataDir,
  safeStorageImpl,
  systemPreferencesImpl = null,
  platform = process.platform,
  randomBytesImpl = (n) => crypto.randomBytes(n),
  // Phone QR approval session manager (electron/phoneApproval.cjs).
  // Optional: without it the phone option reports itself unavailable.
  phoneApproval = null,
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

  function writeRecord(record) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(record));
  }

  /* ---------------------- 6-digit PIN fallback ---------------------- */

  function validPin(pin) {
    return typeof pin === 'string' && /^\d{6}$/.test(pin);
  }

  // scrypt: memory-hard, so a stolen record file cannot be brute-forced
  // cheaply even though a 6-digit space is small - combined with the
  // random 16-byte salt and the live attempt lockout below.
  function derivePinVerifier(pin, saltHex) {
    return crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  }

  function pinLockState(record) {
    const lockUntil = Number(record?.pinLockUntil) || 0;
    if (lockUntil > Date.now()) return { locked: true, retryAt: lockUntil };
    return { locked: false, retryAt: null };
  }

  function verifyPin(record, pin) {
    const lock = pinLockState(record);
    if (lock.locked) return { ok: false, reason: 'pin-locked', retryAt: lock.retryAt };
    if (!validPin(pin)) return { ok: false, reason: 'pin-required' };
    const expected = Buffer.from(record.pinVerifier, 'hex');
    const got = Buffer.from(derivePinVerifier(pin, record.pinSalt), 'hex');
    const matches = expected.length === got.length && crypto.timingSafeEqual(expected, got);
    if (matches) {
      if (record.pinAttempts || record.pinLockUntil) {
        writeRecord({ ...record, pinAttempts: 0, pinLockUntil: 0 });
      }
      return { ok: true };
    }
    const attempts = (Number(record.pinAttempts) || 0) + 1;
    const lockedNow = attempts >= PIN_MAX_ATTEMPTS;
    writeRecord({
      ...record,
      pinAttempts: lockedNow ? 0 : attempts,
      pinLockUntil: lockedNow ? Date.now() + PIN_LOCK_MS : 0
    });
    if (lockedNow) {
      logger?.warn?.('[yayra:passkey] 5 wrong PIN attempts - PIN entry locked for 60s');
      return { ok: false, reason: 'pin-locked', retryAt: Date.now() + PIN_LOCK_MS };
    }
    return { ok: false, reason: 'wrong-pin', attemptsRemaining: PIN_MAX_ATTEMPTS - attempts };
  }

  function method() {
    return touchIdAvailable() ? 'touch-id' : 'os-keychain';
  }

  /**
   * Linux honesty: safeStorage only gives REAL keychain-bound encryption
   * when a secret service (gnome-keyring/kwallet) is running. Electron
   * falls back to a hardcoded-key 'basic_text' backend otherwise - that
   * still works, but it is NOT bound to the OS login, so the UI must say
   * so instead of overclaiming.
   */
  function weakEncryption() {
    try {
      return platform === 'linux'
        && typeof safeStorageImpl?.getSelectedStorageBackend === 'function'
        && safeStorageImpl.getSelectedStorageBackend() === 'basic_text';
    } catch {
      return false;
    }
  }

  async function handleStatus() {
    const record = readRecord();
    const pinLock = record?.method === 'pin' ? pinLockState(record) : { locked: false, retryAt: null };
    return {
      // 'available' keeps its historical meaning (OS keychain usable);
      // the PIN fallback works regardless - see 'methods' below.
      available: encryptionAvailable(),
      method: record?.method || method(),
      weakEncryption: weakEncryption(),
      registered: Boolean(record),
      // The fallback ladder, so the UI can offer exactly what this
      // device really supports instead of a dead button.
      methods: {
        deviceLock: encryptionAvailable(),
        touchId: touchIdAvailable(),
        pin: true,
        phone: Boolean(phoneApproval)
      },
      pinLocked: pinLock.locked,
      pinRetryAt: pinLock.retryAt,
      passkey: record ? { credentialId: record.credentialId, label: record.label, createdAt: record.createdAt, method: record.method } : null
    };
  }

  function persistWithReadBack(record) {
    writeRecord(record);
    // Read-back verification: registration only reports success when
    // the device record is genuinely on disk and parseable - otherwise
    // the UI would claim "passkey active" while verify (which re-reads
    // this file) would say nothing is registered.
    const persisted = readRecord();
    if (!persisted || persisted.credentialId !== record.credentialId) {
      return { ok: false, reason: 'device-storage-failed' };
    }
    return { ok: true, passkey: { credentialId: record.credentialId, label: record.label, createdAt: record.createdAt, method: record.method } };
  }

  async function handleRegister(_event, { label = 'Yayra user', method: wantMethod = 'device', pin = null } = {}) {
    if (wantMethod === 'pin') {
      // 6-digit PIN fallback: for devices with no fingerprint/Face ID,
      // no security key and no usable OS keychain. Stored only as a
      // salted scrypt verifier - never the PIN itself.
      if (!validPin(pin)) return { ok: false, reason: 'pin-invalid' };
      try {
        const pinSalt = randomBytesImpl(16).toString('hex');
        return persistWithReadBack({
          credentialId: `device-${Date.now()}-${randomBytesImpl(6).toString('hex')}`,
          label: String(label),
          createdAt: Date.now(),
          method: 'pin',
          pinSalt,
          pinVerifier: derivePinVerifier(pin, pinSalt),
          pinAttempts: 0,
          pinLockUntil: 0
        });
      } catch (err) {
        logger?.error?.(`[yayra:passkey] PIN register failed: ${err?.message || err}`);
        return { ok: false, reason: 'device-storage-failed' };
      }
    }
    if (!encryptionAvailable()) return { ok: false, reason: 'keychain-unavailable' };
    const gate = await promptTouchIdIfAvailable('register a Yayra device passkey');
    if (!gate.ok) return { ok: false, reason: gate.reason };
    try {
      const secret = randomBytesImpl(32).toString('base64');
      const encrypted = safeStorageImpl.encryptString(secret);
      return persistWithReadBack({
        credentialId: `device-${Date.now()}-${randomBytesImpl(6).toString('hex')}`,
        label: String(label),
        createdAt: Date.now(),
        method: method(),
        secretHash: crypto.createHash('sha256').update(secret).digest('hex'),
        encryptedSecret: Buffer.from(encrypted).toString('base64')
      });
    } catch (err) {
      logger?.error?.(`[yayra:passkey] register failed: ${err?.message || err}`);
      return { ok: false, reason: 'keychain-unavailable' };
    }
  }

  async function handleVerify(_event, { pin = null } = {}) {
    const record = readRecord();
    if (!record) return { ok: false, reason: 'no-passkey-registered' };
    if (record.method === 'pin') return verifyPin(record, pin);
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

  /* ---------------- phone QR approval (verification alt) ---------------- */

  async function handlePhoneStart() {
    if (!phoneApproval) return { ok: false, reason: 'unavailable' };
    const record = readRecord();
    if (!record) return { ok: false, reason: 'no-passkey-registered' };
    return phoneApproval.start({ reason: `unlock the Yayra vault for "${record.label}"` });
  }

  async function handlePhoneStatus() {
    if (!phoneApproval) return { state: 'unavailable' };
    return phoneApproval.status();
  }

  async function handlePhoneCancel() {
    if (!phoneApproval) return { ok: false, reason: 'unavailable' };
    return phoneApproval.cancel();
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
    ipcMain.handle('yayra:passkey-phone-start', handlePhoneStart);
    ipcMain.handle('yayra:passkey-phone-status', handlePhoneStatus);
    ipcMain.handle('yayra:passkey-phone-cancel', handlePhoneCancel);
  }

  return {
    handleStatus, handleRegister, handleVerify, handleRemove,
    handlePhoneStart, handlePhoneStatus, handlePhoneCancel,
    _filePath: filePath
  };
}

module.exports = { createPasskeyBridge };
