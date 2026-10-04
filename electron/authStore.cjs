'use strict';

/**
 * Persists the signed-in Google session for Yayra's Electron desktop build.
 *
 * Security design:
 *   - Only the non-sensitive profile (sub/email/name/picture) is ever sent
 *     to the renderer over IPC (see electron/main.cjs + preload.cjs). The
 *     renderer never sees access/refresh tokens.
 *   - The raw token response (which may include a long-lived refresh_token)
 *     is encrypted at rest with Electron's `safeStorage`, which is backed by
 *     the OS keychain (Keychain on macOS, libsecret on Linux, DPAPI on
 *     Windows) - never written to disk in plaintext.
 *   - Everything lives under Electron's per-user `userData` directory, so a
 *     signed-in session is local to one machine/profile, matching how the
 *     rest of Yayra's local-first storage works.
 *
 * Fully dependency-injected (fsImpl, safeStorageImpl, userDataDir) so this
 * is unit-testable with a real temp directory and a fake safeStorage, with
 * no real Electron runtime required.
 */

const path = require('node:path');

const FILE_NAME = 'google-session.json';

function createAuthStore({ fs, safeStorageImpl, userDataDir }) {
  const filePath = path.join(userDataDir, FILE_NAME);

  function isEncryptionAvailable() {
    try {
      return Boolean(safeStorageImpl && safeStorageImpl.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  function save({ profile, tokens }) {
    const payload = { profile, savedAt: new Date().toISOString() };
    if (isEncryptionAvailable() && tokens) {
      const encrypted = safeStorageImpl.encryptString(JSON.stringify(tokens));
      payload.tokensEncrypted = encrypted.toString('base64');
    } else if (tokens) {
      // No OS keychain available (e.g. some headless Linux CI environments).
      // Do not persist raw tokens unencrypted; the user will simply need to
      // sign in again next launch. The profile alone is harmless to keep.
      payload.tokensEncrypted = null;
      payload.encryptionUnavailable = true;
    }
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload), { mode: 0o600 });
    return payload;
  }

  function load() {
    if (!fs.existsSync(filePath)) return null;
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
    let tokens = null;
    if (payload.tokensEncrypted && isEncryptionAvailable()) {
      try {
        const decrypted = safeStorageImpl.decryptString(Buffer.from(payload.tokensEncrypted, 'base64'));
        tokens = JSON.parse(decrypted);
      } catch {
        tokens = null;
      }
    }
    return { profile: payload.profile || null, tokens, savedAt: payload.savedAt || null };
  }

  function clear() {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore - nothing to clear
    }
  }

  return { save, load, clear };
}

module.exports = { createAuthStore, FILE_NAME };
