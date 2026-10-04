# Production configuration reference (single source of truth)

Every environment variable, config file, and CI secret a production
deployment of Yayra needs, in one place. If you add a new one, add it here.

Nothing in this file is a secret itself; actual values live in your shell
environment, gitignored local config files, or GitHub Actions secrets.

## 1. Google Sign-In (app-level account feature)

| Name | Where set | Used by | Notes |
| --- | --- | --- | --- |
| `YAYRA_GOOGLE_CLIENT_ID` | env var (dev) | `electron/googleAuthConfig.cjs` | "Desktop app" OAuth client ID. See `docs/GOOGLE_SIGNIN.md`. |
| `YAYRA_GOOGLE_CLIENT_SECRET` | env var (dev) | `electron/googleAuthConfig.cjs` | Google requires it for Desktop clients even with PKCE; treated as non-confidential per Google's own definition. |
| `electron/google-auth.config.json` | local file (packaged builds) | `electron/googleAuthConfig.cjs` | `{ "clientId": ..., "clientSecret": ... }`. **Gitignored.** |
| Web client ID config | local file (Web/PWA builds) | Web sign-in (Phase A1) | "Web application" OAuth client, **no secret** (public PKCE client). Gitignored via `**/google-auth*.config.json`. |
| Android / iOS client IDs | local file (mobile builds) | Capacitor sign-in (Phase A2) | "Android" / "iOS" OAuth clients, no secret; verified by package name + SHA-1 / bundle ID. Gitignored via the same pattern. |

## 2. Update worker (Cloudflare Worker: `yayra-updates-api`)

| Name | Where set | Used by | Notes |
| --- | --- | --- | --- |
| `UPDATES_MANIFEST_JSON` | Worker binding (wrangler secret/var) | `worker/update-worker.mjs` | Full JSON update manifest; falls back to a built-in default when unset. |
| `GITHUB_TOKEN` | Worker secret | `worker/update-worker.mjs` (`/api/latest-release`) | Raises GitHub API rate limits; read-only PAT with no scopes is sufficient. |
| `UPDATE_MANIFEST_URL` | build-time env | `scripts/build-web.mjs` / `src/config/updates.js` | Points clients at your worker's `/updates/manifest.json`. |

## 3. Cloudflare deployment

| Name | Where set | Used by |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | env / GH Actions secret | `scripts/deploy-cloudflare.mjs`, `scripts/deploy-cloudflare-worker.mjs`, `release.yml` |
| `CLOUDFLARE_ACCOUNT_ID` | env / GH Actions secret | same |
| `CLOUDFLARE_PROJECT_NAME` | env (optional) | `scripts/deploy-cloudflare.mjs` (Pages project) |
| `CLOUDFLARE_WORKER_NAME` | env (optional) | `scripts/deploy-cloudflare-worker.mjs` (defaults to `wrangler.worker.toml` name) |

## 4. Release signing (GitHub Actions secrets consumed by `release.yml`)

See `docs/SIGNING_REQUIREMENTS.md` (Phase B5) for how a human obtains each
credential. None of these may ever be committed.

| Platform | Secrets |
| --- | --- |
| Linux | `LINUX_SIGNING_KEY` (ASCII-armored GPG private key), `LINUX_SIGNING_KEY_PASSWORD` |
| Windows | `WINDOWS_CERTIFICATE_PATH`/`WINDOWS_CERTIFICATE_PASSWORD` (Authenticode PFX) |
| Android | `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEYSTORE_TYPE`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (via `scripts/configure-android-signing.mjs`) |
| macOS / iOS | `APPLE_TEAM_ID`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_AUTH_KEY_PATH`, `APPLE_KEYCHAIN_PATH`/`KEYCHAIN_PASSWORD`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_PRIVATE_KEY` |
| GitHub | `GH_TOKEN` / `GITHUB_TOKEN` (provided by Actions; used for release feed checks and publishing) |

## 5. Build/dev toggles (not secrets)

| Name | Purpose |
| --- | --- |
| `PORT` | `scripts/dev-server.mjs` listen port (default 4173). |
| `BUILT_AT`, `GITHUB_SHA`, `GITHUB_REPOSITORY`, `RUNNER_OS`, `RELEASE_TARGETS`, `VERSION_OVERRIDE` | CI metadata consumed by build/release scripts. |
| `YAYRA_SMOKE` / `YAYRA_FORCE_BAD_LOAD` (legacy `IBROWSE_*` aliases) | Desktop smoke-test harness toggles (`scripts/smoke-desktop.mjs`). |
| `ELECTRON_SKIP_BINARY_DOWNLOAD=1` | Install deps without downloading the Electron binary (CI lint/test-only jobs, restricted sandboxes). |

## 6. Dependency security posture (kept current with `npm audit`)

Targeted `overrides` in `package.json` (do not remove without re-auditing):

- `tar: ^7.5.21` — patches a critical advisory chain; applied everywhere
  **except** `@capacitor/cli`, which is pinned back to `tar ~6.2.1` because
  Capacitor CLI 6 depends on tar v6's removed default-export API.
  **Accepted residual risk:** `@capacitor/cli`'s only tar use is extracting
  the platform template tarball that ships *inside* the npm-integrity-
  verified `@capacitor/android`/`@capacitor/ios` packages — never
  attacker-controlled input. Fully resolved by the Capacitor 7 upgrade
  (tracked in `docs/PRODUCTION_READINESS_PLAN.md`).
- `http-cache-semantics: ^4.3.0` — patches GHSA-ch52-4w7c-c8xp in the
  `electron → @electron/get → got` install chain.

Known-open advisories requiring a major upgrade (deliberate decision, see
plan): `electron@31.7.7` (EOL line with published CVEs — upgrade to a
supported major; this also removes the unpatchable `extract-zip`
advisories, which only affect Electron's own install-time zip extraction of
its HTTPS-downloaded, checksum-verified binary).
