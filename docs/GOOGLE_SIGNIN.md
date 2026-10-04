# Sign in with Google (Electron desktop) — setup & architecture

## What this is, and what it is not

This feature gives **Yayra itself** a real, app-level Google identity (name,
email, profile picture), so Yayra's own UI can show "Signed in as ..." /
"Sign out". It is **not** a way to use Gmail, Drive, or any other Google
service logged-in *inside* Yayra's embedded browsing view — Google actively
detects and blocks sign-in inside any embedded browser surface (WebView,
WebContentsView, iframe, etc.) as an anti-phishing measure. See
[Google's own policy](https://developers.google.com/identity/protocols/oauth2/policies#embedded-webviews).
Yayra does not attempt to bypass that; `electron/webviewBridge.cjs` already
hands those navigations off to the user's real system browser.

This document covers **Phase 1: Electron desktop only**. Web/PWA and
Android/iOS are separate follow-up work (see "Status by platform" below).

## How it works

Yayra uses the OAuth 2.0 flow Google explicitly recommends for native/desktop
apps (RFC 8252, "OAuth 2.0 for Native Apps"):

1. Yayra opens your **real system browser** (never an embedded view) to
   Google's consent screen.
2. It uses **Authorization Code + PKCE**. Google calls "Desktop app" OAuth
   clients public/non-confidential, but Google's token endpoint still
   requires the **Client Secret** in the code-exchange request even with
   PKCE — a known Google-specific quirk, not a security requirement (the
   secret is still fine to ship inside the built app, same as the Client ID;
   see step 5 below).
3. A short-lived local HTTP server on `127.0.0.1` (an OS-assigned free port,
   picked fresh every sign-in) catches Google's redirect. This is Google's
   own documented ["loopback interface redirect"](https://developers.google.com/identity/protocols/oauth2/native-app#loopback-ip-address)
   pattern — **no domain, no custom URL scheme, and no fixed port need to be
   registered.**
4. Yayra exchanges the authorization code for tokens directly with Google,
   then fetches your basic profile (name/email/picture).
5. The profile (not the tokens) is shown in Yayra's UI. The raw tokens are
   encrypted at rest using Electron's `safeStorage` (backed by your OS
   keychain — Keychain on macOS, libsecret on Linux, DPAPI on Windows) and
   are never sent to the renderer/web UI process.

Relevant source files:
- `electron/googleAuth.cjs` — the OAuth flow itself (PKCE, loopback server,
  token exchange, userinfo fetch). Fully unit-tested in
  `tests/google-oauth.test.mjs` with a real local socket and a fake Google
  (no live network access).
- `electron/authStore.cjs` — encrypted-at-rest session persistence. Tested in
  `tests/google-auth-store.test.mjs`.
- `electron/authBridge.cjs` — wires the above to IPC channels
  (`yayra:auth-sign-in`, `yayra:auth-sign-out`, `yayra:auth-get-session`).
  Tested in `tests/google-auth-bridge.test.mjs`.
- `electron/googleAuthConfig.cjs` — resolves your Client ID and Client
  Secret. Tested in `tests/google-auth-config.test.mjs`.
- `electron/preload.cjs` — exposes `window.yayra.auth.{signIn, signOut,
  getSession, onEvent}` to the renderer.
- `packages/shared-ui/src/components/BrowserShell.js` — the "Account"
  section inside Settings (`yayra://settings`) that calls the above.

## Creating your own Google Cloud OAuth Client ID

You (not this agent) need to create this, because it ties to a Google Cloud
project you own. **No domain purchase is required.**

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create (or select) a project.
2. Go to **APIs & Services → OAuth consent screen**. Choose "External" (or
   "Internal" if you have a Google Workspace), fill in the app name/logo/
   support email, and add the `openid`, `email`, and `profile` scopes (these
   are the only ones Yayra requests). While the app is in "Testing" mode you
   can add your own Google account as a test user; "Publish" it later if you
   want any Google account to be able to sign in.
3. Go to **APIs & Services → Credentials → Create Credentials → OAuth client
   ID**.
4. For **Application type, choose "Desktop app"**. Give it any name (e.g.
   "Yayra Desktop"). Click Create.
5. Copy the generated **Client ID** (it looks like
   `123456789-abc...apps.googleusercontent.com`) **and the Client Secret**
   shown right next to it. Despite the "Desktop app" type and PKCE, Google's
   token endpoint rejects sign-in with `client_secret is missing` if you
   don't configure the secret too — you need both values.
6. No redirect URI needs to be registered for "Desktop app" clients using the
   loopback pattern — Google allows any `http://127.0.0.1:<port>/...` or
   `http://localhost:<port>/...` redirect automatically for this client type.

## Configuring Yayra with your Client ID

Pick one:

- **Local development:** export both environment variables before launching
  Electron:
  ```bash
  export YAYRA_GOOGLE_CLIENT_ID="123456789-abc...apps.googleusercontent.com"
  export YAYRA_GOOGLE_CLIENT_SECRET="GOCSPX-..."
  ```
- **Packaged builds:** create `electron/google-auth.config.json` (already
  gitignored — it will never be committed) before running
  `npm run package:linux` / `package:win` / etc.:
  ```json
  { "clientId": "123456789-abc...apps.googleusercontent.com", "clientSecret": "GOCSPX-..." }
  ```
  This file is included by electron-builder's existing `electron/**/*` files
  glob, so it travels with the built installer.

If either value is missing, the "Sign in with Google" button in Settings →
Account will show a clear "not configured" error instead of failing deep
inside the token exchange.

### Troubleshooting

- **`Couldn't sign in: token_exchange_failed:400:{"error":"invalid_request","error_description":"client_secret is missing."}`**
  — you only set the Client ID. Set `YAYRA_GOOGLE_CLIENT_SECRET` too (see
  above) and restart the app.
- **`Couldn't sign in: fetch failed`** — the token/userinfo request itself
  couldn't reach Google (not an auth error). Most common on Windows machines
  behind a corporate proxy, VPN, or TLS-inspecting antivirus: Node's own
  `fetch` doesn't automatically use the OS proxy/certificate store the way
  your system browser does. Yayra's main process now uses Electron's
  `net.fetch` (Chromium's own network stack) for these requests instead of
  Node's `fetch`, which should resolve this on most machines; if it still
  happens, it usually means outbound HTTPS to `oauth2.googleapis.com` /
  `www.googleapis.com` is blocked entirely by that machine's firewall/proxy.

## Status by platform

| Platform | Status |
| --- | --- |
| Electron desktop (Linux/Windows) | **Implemented** in this change; the live round trip against real Google servers has **not** been run by this agent (no GUI browser or registered Client ID in this sandbox) and must be verified by you on your own machine with your own Client ID. |
| Web / PWA (`yayra.pages.dev`) | **Not yet implemented.** Would use the same Authorization Code + PKCE flow with a popup/redirect to `https://yayra.pages.dev/auth/callback` instead of a loopback server — separate follow-up work. |
| Android / iOS (Capacitor) | **Not yet implemented, deferred.** Needs a dedicated Capacitor OAuth plugin (not currently a project dependency) and real-device/emulator testing this sandbox cannot perform. |

## How to verify it actually works (you must do this)

1. Create your Client ID per the steps above and set it via the environment
   variable (fastest for a first test).
2. Run the desktop app (`npm run build:web && npx electron .` or your usual
   dev launch command) on a machine with a real display.
3. Open Settings → Account → "Sign in with Google".
4. Your default system browser should open to Google's consent screen. Sign
   in and approve.
5. Your browser tab should show "Signed in to Yayra — you can close this tab"
   and Yayra's Settings → Account should now show your name/email.
6. Confirm "Sign out" clears it, and relaunching Yayra without signing in
   again still remembers you were signed in (session persistence) until you
   explicitly sign out.
