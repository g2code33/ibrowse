#!/usr/bin/env python3
"""
Follow-up fix for Yayra's "Sign in with Google" feature (apply_google_signin.py).

Root cause of the errors you hit:
  1. "client_secret is missing" - Google's token endpoint REQUIRES a
     client_secret for "Desktop app" OAuth clients even when using PKCE
     correctly. This contradicts Google's own "non-confidential client" docs
     but is a confirmed, real Google-side quirk. Fix: also configure
     YAYRA_GOOGLE_CLIENT_SECRET and send it in the token exchange.
  2. "fetch failed" - Node's built-in fetch() does not share a network stack
     with your system browser. On machines with a corporate proxy, VPN, or a
     TLS-inspecting antivirus, Node's fetch can fail outright even though the
     browser-driven consent step worked. Fix: use Electron's own net.fetch
     (same Chromium network stack the browser uses) for the token/userinfo
     requests instead of Node's fetch.

This script is idempotent: run it as many times as you like. It only edits
the Google Sign-In files already created by apply_google_signin.py, and
reports clearly what it did (or skipped because it was already applied).

Usage:
    cd "/path/to/your/yayra/checkout"
    python3 apply_google_signin_client_secret_fix.py
"""

import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


def read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def write(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def replace_once(path, old, new, label):
    """Apply one anchored replacement. Idempotent: if `new` is already
    present, skip. If `old` can't be found and `new` isn't present either,
    report a clear failure instead of silently doing nothing."""
    content = read(path)
    if new in content:
        print(f"  [skip] {label} (already applied)")
        return content, False
    if old not in content:
        print(f"  [FAIL] {label} - anchor text not found; file may have changed. Leaving untouched.")
        return content, False
    content = content.replace(old, new, 1)
    write(path, content)
    print(f"  [ok]   {label}")
    return content, True


NEW_CONFIG_FILE = '''\'use strict\';

/**
 * Resolves the Google OAuth "Desktop app" Client ID/Secret for Sign in with
 * Google.
 *
 * Google\'s own docs describe Desktop-app OAuth clients as "non-confidential"
 * (see https://developers.google.com/identity/protocols/oauth2/native-app),
 * implying PKCE alone should be enough at the token endpoint. In practice
 * Google\'s token endpoint still rejects the authorization_code exchange for
 * Desktop-app clients with `invalid_request: client_secret is missing`
 * unless client_secret is included in the request body, even though PKCE is
 * used correctly. This is a Google-specific implementation quirk (confirmed
 * by multiple independent reports), not a security requirement - the secret
 * is still fine to ship inside the built app, same as the Client ID. Both
 * values are resolved the same way, out of this repository\'s tracked source
 * because they are specific to whoever deploys their own instance of Yayra -
 * see docs/GOOGLE_SIGNIN.md for how to create them and where to put them.
 * Resolution order (for each of Client ID / Client Secret independently):
 *   1. YAYRA_GOOGLE_CLIENT_ID / YAYRA_GOOGLE_CLIENT_SECRET environment
 *      variables (handy for local dev).
 *   2. electron/google-auth.config.json next to this file, shape
 *      { "clientId": "....apps.googleusercontent.com", "clientSecret": "..." }
 *      - gitignored, and packaged into the app by electron-builder\'s
 *      "electron/**" files glob so it travels with a built installer if
 *      present at build time.
 * Returns null (not a throw) when neither source is configured, so callers
 * can surface a clear "not configured" state instead of crashing.
 */

const path = require(\'node:path\');

function readConfigField(fs, configPath, field) {
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = JSON.parse(fs.readFileSync(configPath, \'utf8\'));
    return typeof raw[field] === \'string\' && raw[field].trim() ? raw[field].trim() : null;
  } catch {
    return null;
  }
}

function resolveGoogleClientId({ env = process.env, fs = require(\'node:fs\'), configDir = __dirname } = {}) {
  const fromEnv = env.YAYRA_GOOGLE_CLIENT_ID && env.YAYRA_GOOGLE_CLIENT_ID.trim();
  if (fromEnv) return fromEnv;
  return readConfigField(fs, path.join(configDir, \'google-auth.config.json\'), \'clientId\');
}

function resolveGoogleClientSecret({ env = process.env, fs = require(\'node:fs\'), configDir = __dirname } = {}) {
  const fromEnv = env.YAYRA_GOOGLE_CLIENT_SECRET && env.YAYRA_GOOGLE_CLIENT_SECRET.trim();
  if (fromEnv) return fromEnv;
  return readConfigField(fs, path.join(configDir, \'google-auth.config.json\'), \'clientSecret\');
}

module.exports = { resolveGoogleClientId, resolveGoogleClientSecret };
'''


def patch_google_auth_config():
    path = os.path.join(ROOT, "electron", "googleAuthConfig.cjs")
    print(f"electron/googleAuthConfig.cjs:")
    if not os.path.exists(path):
        print("  [FAIL] file not found - did apply_google_signin.py run first?")
        return
    content = read(path)
    if "resolveGoogleClientSecret" in content:
        print("  [skip] already has resolveGoogleClientSecret (already applied)")
        return
    write(path, NEW_CONFIG_FILE)
    print("  [ok]   rewritten to also resolve a Client Secret")


def patch_google_auth():
    path = os.path.join(ROOT, "electron", "googleAuth.cjs")
    print("electron/googleAuth.cjs:")
    if not os.path.exists(path):
        print("  [FAIL] file not found - did apply_google_signin.py run first?")
        return

    replace_once(
        path,
        old=''' *   2. Use the Authorization Code + PKCE flow (no client secret - "Desktop
 *      app" OAuth clients in Google Cloud Console are public/non-confidential
 *      clients; Google explicitly does not require or expect a secret here,
 *      so it is safe for the Client ID to live in this source file).''',
        new=''' *   2. Use the Authorization Code + PKCE flow. Google's docs call "Desktop
 *      app" OAuth clients public/non-confidential, but Google's token
 *      endpoint still rejects the code exchange without a client_secret in
 *      the request body (a known Google-specific quirk - PKCE is additive
 *      here, not a replacement). The secret is still non-confidential in the
 *      sense Google means: it's fine for it to ship inside the built app,
 *      same as the Client ID - see electron/googleAuthConfig.cjs.''',
        label="update file header comment",
    )

    replace_once(
        path,
        old="async function exchangeCodeForTokens({ clientId, code, codeVerifier, redirectUri, fetchImpl = globalThis.fetch }) {\n  const body = new URLSearchParams({\n    client_id: clientId,\n    code,\n    code_verifier: codeVerifier,\n    grant_type: 'authorization_code',\n    redirect_uri: redirectUri\n  });\n  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {",
        new="async function exchangeCodeForTokens({ clientId, clientSecret, code, codeVerifier, redirectUri, fetchImpl = globalThis.fetch }) {\n  const body = new URLSearchParams({\n    client_id: clientId,\n    code,\n    code_verifier: codeVerifier,\n    grant_type: 'authorization_code',\n    redirect_uri: redirectUri\n  });\n  // Google requires this for Desktop-app clients despite PKCE - see the\n  // file header comment above for why this is still safe to send.\n  if (clientSecret) body.set('client_secret', clientSecret);\n  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {",
        label="send client_secret in exchangeCodeForTokens",
    )

    replace_once(
        path,
        old="async function signInWithGoogle({\n  clientId,\n  scopes = DEFAULT_SCOPES,",
        new="async function signInWithGoogle({\n  clientId,\n  clientSecret,\n  scopes = DEFAULT_SCOPES,",
        label="accept clientSecret param in signInWithGoogle",
    )

    replace_once(
        path,
        old="const tokens = await exchangeCodeForTokens({ clientId, code, codeVerifier, redirectUri: capturedRedirectUri, fetchImpl });",
        new="const tokens = await exchangeCodeForTokens({ clientId, clientSecret, code, codeVerifier, redirectUri: capturedRedirectUri, fetchImpl });",
        label="pass clientSecret through to exchangeCodeForTokens",
    )


def patch_auth_bridge():
    path = os.path.join(ROOT, "electron", "authBridge.cjs")
    print("electron/authBridge.cjs:")
    if not os.path.exists(path):
        print("  [FAIL] file not found - did apply_google_signin.py run first?")
        return

    replace_once(
        path,
        old=''' * IMPORTANT: this requires a real Google Cloud "Desktop app" OAuth Client ID
 * that only the person deploying Yayra can create (see docs/GOOGLE_SIGNIN.md
 * for the exact console steps). Without YAYRA_GOOGLE_CLIENT_ID configured,
 * sign-in fails fast with a clear 'not_configured' error rather than silently
 * doing nothing.
 */''',
        new=''' * IMPORTANT: this requires a real Google Cloud "Desktop app" OAuth Client ID
 * AND Client Secret that only the person deploying Yayra can create (see
 * docs/GOOGLE_SIGNIN.md for the exact console steps - Google's token
 * endpoint requires the secret for Desktop-app clients even with PKCE).
 * Without both YAYRA_GOOGLE_CLIENT_ID and YAYRA_GOOGLE_CLIENT_SECRET
 * configured, sign-in fails fast with a clear 'not_configured' error rather
 * than silently doing nothing or failing deep inside the token exchange.
 */''',
        label="update file header comment",
    )

    replace_once(
        path,
        old="""function createAuthBridge({
  ipcMain,
  shell,
  getMainWindow,
  authStore,
  clientId,
  signInImpl,
  logger = console
}) {""",
        new="""function createAuthBridge({
  ipcMain,
  shell,
  getMainWindow,
  authStore,
  clientId,
  clientSecret,
  fetchImpl,
  signInImpl,
  logger = console
}) {""",
        label="accept clientSecret and fetchImpl params",
    )

    replace_once(
        path,
        old="""    if (signingIn) return { ok: false, error: 'sign_in_already_in_progress' };
    if (!clientId) return { ok: false, error: 'not_configured' };""",
        new="""    if (signingIn) return { ok: false, error: 'sign_in_already_in_progress' };
    if (!clientId || !clientSecret) return { ok: false, error: 'not_configured' };""",
        label="require clientSecret too before attempting sign-in",
    )

    replace_once(
        path,
        old="""      const { profile, tokens } = await signInImpl({
        clientId,
        openExternal: (url) => shell.openExternal(url),
        logger
      });""",
        new="""      const { profile, tokens } = await signInImpl({
        clientId,
        clientSecret,
        openExternal: (url) => shell.openExternal(url),
        ...(fetchImpl ? { fetchImpl } : {}),
        logger
      });""",
        label="pass clientSecret and fetchImpl to signInImpl",
    )


def patch_main():
    path = os.path.join(ROOT, "electron", "main.cjs")
    print("electron/main.cjs:")
    if not os.path.exists(path):
        print("  [FAIL] file not found - did apply_google_signin.py run first?")
        return

    replace_once(
        path,
        old="const { resolveGoogleClientId } = require('./googleAuthConfig.cjs');",
        new="const { resolveGoogleClientId, resolveGoogleClientSecret } = require('./googleAuthConfig.cjs');",
        label="import resolveGoogleClientSecret",
    )

    replace_once(
        path,
        old="""  createAuthBridge({
    ipcMain,
    shell,
    getMainWindow: () => mainWindow,
    authStore,
    clientId: resolveGoogleClientId(),
    signInImpl: signInWithGoogle
  });""",
        new="""  createAuthBridge({
    ipcMain,
    shell,
    getMainWindow: () => mainWindow,
    authStore,
    clientId: resolveGoogleClientId(),
    clientSecret: resolveGoogleClientSecret(),
    // Use Electron's own net.fetch (Chromium's network stack) instead of
    // Node's global fetch for the Google token/userinfo requests. The
    // system browser (Chromium) and Node's undici-based fetch do NOT share
    // a network stack - on machines with a corporate proxy, VPN, or a
    // TLS-inspecting antivirus whose root cert is trusted by the OS/Chromium
    // but not by Node's own CA store, Node's fetch fails outright with a
    // generic "fetch failed" even though the browser-driven consent step
    // worked fine. net.fetch is proxy- and OS-cert-aware the same way the
    // browser is, so it succeeds in those environments too.
    fetchImpl: typeof net.fetch === 'function' ? net.fetch : undefined,
    signInImpl: signInWithGoogle
  });""",
        label="resolve + wire clientSecret and net.fetch into the auth bridge",
    )


def main():
    print("Applying Google Sign-In client_secret + fetch robustness fix...\n")
    patch_google_auth_config()
    patch_google_auth()
    patch_auth_bridge()
    patch_main()
    print(
        "\nDone. Next steps:\n"
        "  1. In Google Cloud Console, open your existing Desktop OAuth client\n"
        "     and copy its Client Secret (next to the Client ID).\n"
        "  2. export YAYRA_GOOGLE_CLIENT_SECRET=\"<that secret>\"\n"
        "     (keep your existing YAYRA_GOOGLE_CLIENT_ID export too)\n"
        "  3. npm test   (should still be all-green)\n"
        "  4. npx electron .   then Settings -> Account -> Sign in with Google\n"
    )


if __name__ == "__main__":
    sys.exit(main())
