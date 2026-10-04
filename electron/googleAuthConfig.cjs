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
 * Returns null (not a throw) when neither source is configured, so callers
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

function resolveGoogleClientId({ env = process.env, fs = require('node:fs'), configDir = __dirname } = {}) {
  const fromEnv = env.YAYRA_GOOGLE_CLIENT_ID && env.YAYRA_GOOGLE_CLIENT_ID.trim();
  if (fromEnv) return fromEnv;
  return readConfigField(fs, path.join(configDir, 'google-auth.config.json'), 'clientId');
}

function resolveGoogleClientSecret({ env = process.env, fs = require('node:fs'), configDir = __dirname } = {}) {
  const fromEnv = env.YAYRA_GOOGLE_CLIENT_SECRET && env.YAYRA_GOOGLE_CLIENT_SECRET.trim();
  if (fromEnv) return fromEnv;
  return readConfigField(fs, path.join(configDir, 'google-auth.config.json'), 'clientSecret');
}

module.exports = { resolveGoogleClientId, resolveGoogleClientSecret };
