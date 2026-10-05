'use strict';

/**
 * Resolves the Google OAuth "Desktop app" Client ID/Secret for Sign in with
 * Google.
 *
 * Google's own docs describe Desktop-app OAuth clients as "non-confidential"
 * (see https://developers.google.com/identity/protocols/oauth2/native-app),
 * implying PKCE alone should be enough at the token endpoint. In practice
 * Google's token endpoint still rejects the authorization_code exchange for
 * Desktop-app clients with `invalid_request: client_secret is missing`
 * unless client_secret is included in the request body, even though PKCE is
 * used correctly. This is a Google-specific implementation quirk (confirmed
 * by multiple independent reports), not a security requirement - the secret
 * is still fine to ship inside the built app, same as the Client ID. Both
 * values are resolved the same way, out of this repository's tracked source
 * because they are specific to whoever deploys their own instance of Yayra -
 * see docs/GOOGLE_SIGNIN.md for how to create them and where to put them.
 * Resolution order (for each of Client ID / Client Secret independently):
 *   1. YAYRA_GOOGLE_CLIENT_ID / YAYRA_GOOGLE_CLIENT_SECRET environment
 *      variables (handy for local dev).
 *   2. electron/google-auth.config.json next to this file, shape
 *      { "clientId": "....apps.googleusercontent.com", "clientSecret": "..." }
 *      - gitignored, and packaged into the app by electron-builder's
 *      "electron/**" files glob so it travels with a built installer if
 *      present at build time.
 *   3. google-auth.config.json in the app's per-user config directory
 *      (~/.config/yayra on Linux, %APPDATA%\yayra on Windows,
 *      ~/Library/Application Support/yayra on macOS). This is what lets an
 *      ALREADY-INSTALLED build be configured without rebuilding: drop the
 *      file there and restart Yayra. A machine-local file deliberately wins
 *      over the file baked into the installer (source 2 below it), so users
 *      can point an official build at their own OAuth client.
 * Returns null (not a throw) when no source is configured, so callers
 * can surface a clear "not configured" state instead of crashing.
 */

const path = require('node:path');

function readConfigField(fs, configPath, field) {
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return typeof raw[field] === 'string' && raw[field].trim() ? raw[field].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Per-user config directory for the installed app, matching where Electron
 * puts userData for an app named "yayra" (overlay-settings.json etc. live in
 * the same place). Pure computation - no electron dependency - so it stays
 * unit-testable in plain Node.
 */
function defaultUserConfigDir({ env = process.env, platform = process.platform, homedir } = {}) {
  const home = homedir || require('node:os').homedir();
  if (platform === 'win32') {
    return path.join(env.APPDATA && env.APPDATA.trim() ? env.APPDATA : path.join(home, 'AppData', 'Roaming'), 'yayra');
  }
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'yayra');
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() ? env.XDG_CONFIG_HOME : path.join(home, '.config');
  return path.join(xdg, 'yayra');
}

function resolveField(field, envName, { env, fs, configDir, userConfigDir }) {
  const fromEnv = env[envName] && env[envName].trim();
  if (fromEnv) return fromEnv;
  // Machine-local file first: it lets an installed build be (re)configured
  // without rebuilding, and overrides whatever shipped inside the installer.
  const fromUserDir = readConfigField(fs, path.join(userConfigDir, 'google-auth.config.json'), field);
  if (fromUserDir) return fromUserDir;
  return readConfigField(fs, path.join(configDir, 'google-auth.config.json'), field);
}

function resolveGoogleClientId({ env = process.env, fs = require('node:fs'), configDir = __dirname, userConfigDir = defaultUserConfigDir({ env }) } = {}) {
  return resolveField('clientId', 'YAYRA_GOOGLE_CLIENT_ID', { env, fs, configDir, userConfigDir });
}

function resolveGoogleClientSecret({ env = process.env, fs = require('node:fs'), configDir = __dirname, userConfigDir = defaultUserConfigDir({ env }) } = {}) {
  return resolveField('clientSecret', 'YAYRA_GOOGLE_CLIENT_SECRET', { env, fs, configDir, userConfigDir });
}

module.exports = { resolveGoogleClientId, resolveGoogleClientSecret, defaultUserConfigDir };
