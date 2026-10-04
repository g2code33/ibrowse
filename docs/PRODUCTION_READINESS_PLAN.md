# Yayra — Production Readiness Plan

Status: **PROPOSED — awaiting approval before implementation begins.**
Branch: `arena/01a105e3-yayra`. Baseline verified in sandbox on 2026-10-04:
`npm test` = 298/299 pass (single failure is the known Linux `.deb` packaging
test that needs native packaging tools absent from this sandbox);
`npm audit` = 5 vulnerabilities (4 high, 1 critical), all in build-time
devDependency chains (details in P2.1 below).

---

## Phase A — Sign in with Google on all platforms (Part 1)

### A1. Web/PWA: Authorization Code + PKCE with HTTPS callback  (effort: L, risk: M)

**Chosen approach: full-page redirect with state restored from
`sessionStorage`** (not popup+postMessage). Justification:

- Popup flows are increasingly broken by popup blockers, Brave/Safari
  tracking protections, and PWA display-mode `standalone` windows where
  `window.opener` relationships are unreliable; a redirect works identically
  in a browser tab and an installed PWA.
- postMessage adds an origin-validation attack surface we don't need; the
  redirect flow keeps everything same-origin.
- Yayra's shell state (open tab, settings panel) is small and already
  serializable — restoring it from `sessionStorage` after the round trip is
  cheap.

Work items:
1. New `src/services/googleAuthWeb.js` (ESM, mirrors `electron/googleAuth.cjs`
   factory + dependency-injection style): PKCE pair + `state` generation
   (reuse the same base64url/SHA-256 logic), authorization URL builder with
   `redirect_uri = https://<origin>/auth/callback`, callback-params parser
   with strict `state` check, token exchange + userinfo fetch via injected
   `fetchImpl`. **No client secret** — "Web application" clients doing PKCE
   from the browser must be treated as public; the secret cannot be kept
   confidential in JS.
2. `auth/callback` route handling in the web shell + SW/`_redirects` so the
   path serves the app shell on Cloudflare Pages.
3. Session persistence: profile + tokens in a dedicated storage module with
   **explicit code comments** on the trade-off — browsers have no OS-keychain
   equivalent (`safeStorage` doesn't exist); tokens live in storage readable
   by same-origin JS, mitigated by: shortest-lived tokens only, no
   refresh-token request by default (`access_type=online`), immediate
   discard of the access token after the userinfo fetch, and only the
   profile retained for display.
4. UI wiring: provide a web `authBridge`-shaped adapter so
   `BrowserShell.js`'s existing Account section works unmodified (it already
   feature-detects `window.yayra.auth`); profile only crosses that seam,
   never raw tokens — same contract as Electron.
5. Tests: `tests/google-auth-web.test.mjs` — DI'd fake `sessionStorage`,
   fake `location`/redirect recorder, fake fetch for token+userinfo, state
   mismatch rejection, error-param handling, state restoration round trip.
6. Docs: "Web application" Client ID console steps (authorized JS origins +
   redirect URIs for `https://yayra.pages.dev/auth/callback` and the local
   dev origin) added to `docs/GOOGLE_SIGNIN.md`, status table updated.

### A2. Android/iOS (Capacitor): native-browser OAuth callback  (effort: L, risk: M)

**Plugin choice (to confirm with a fresh maintenance check at implementation
time):** `@capacitor/browser` (already a dependency) for launching the system
Custom Tab / `SFSafariViewController`, combined with `@capacitor/app` for the
`appUrlOpen` deep-link callback — i.e. first-party Capacitor plugins rather
than a third-party OAuth plugin. Rationale: third-party options
(`@byteowls/capacitor-oauth2`, `@capacitor-community/generic-oauth2`) have
had maintenance gaps, and Google requires the consent screen in a *system*
browser surface anyway; the PKCE logic itself is pure JS we already own and
test. If research at implementation time shows a clearly better-maintained
dedicated plugin, I'll present the comparison before committing.

Work items:
1. Add `@capacitor/app` dependency; `src/services/googleAuthCapacitor.js`
   factory (DI: browser-opener, url-open subscription, fetch) implementing
   Authorization Code + PKCE with a custom-scheme redirect
   (`com.yayra.app:/oauth2redirect`) per RFC 8252 §7.1 — Android/iOS Google
   client types, **no secret**.
2. Document (and script where possible via Capacitor config) the native
   project changes: Android `intent-filter` for the scheme (and the
   App-Links alternative), iOS `CFBundleURLTypes`; note that `android/` and
   `ios/` are gitignored/generated, so changes go through
   `capacitor.config.json` + documented manual steps in GOOGLE_SIGNIN.md.
3. Console steps for "Android" (package name + SHA-1, both debug and Play
   App Signing fingerprints) and "iOS" (bundle ID) client IDs in
   GOOGLE_SIGNIN.md.
4. Tests: `tests/google-auth-capacitor.test.mjs` — fully mocked plugin
   surfaces; verify auth URL shape, state verification, token exchange body,
   profile-only output, cancellation/timeout paths.
5. Status table + "what a human must verify on a real device" section.

**Honest verification boundary (both A1/A2):** everything above is verified
with mocks/fakes only. A human with a real Google Cloud project, real
Client IDs, a real browser, and a real device/emulator must run the live
consent round trip. The docs will carry explicit checklists for that.

---

## Phase B — Production readiness audit & hardening (Part 2)

Ordered by risk:

### B1. Dependency security (P0 — do first)  (effort: S)
`npm audit` findings mapped to actual dependency paths:

| Advisory | Package | Path | Shipped to users? | Plan |
| --- | --- | --- | --- | --- |
| GHSA-34x7-… + 11 more (critical) | `tar@6.2.1` | `@capacitor/cli` (dev) | No — CLI build tool | Add `overrides` to force patched `tar` (verify `cap sync` still works), or upgrade Capacitor majors if compatible; justify if deferred |
| high | `tar@7.5.22` | `electron-builder → app-builder-lib / node-gyp` (dev) | No — build tool | Same `overrides` evaluation |
| GHSA-jmr9-…, GHSA-7pqw-… (high) | `extract-zip@2.0.1` | `electron` postinstall (dev) | No — downloads Electron binary at install time from trusted URL | Evaluate override; otherwise document residual risk (attacker needs to MITM the Electron download, which is HTTPS + checksummed) |
| GHSA-ch52-… (high) | `http-cache-semantics@4.2.0` | `electron → @electron/get → got` (dev) | No | Same |

Key point: **none of these are in the runtime bundle** (`dependencies` is
only `@capacitor/core` + `@capacitor/browser`). They are real supply-chain /
build-machine risks, not end-user risks. I will fix what's fixable via
targeted `overrides` with the full test suite green, and write up any
accepted residuals. No `npm audit fix --force`.

### B2. Secrets & config hygiene (P0)  (effort: S)
- Verified: no real secrets tracked (only a `GOCSPX-...` placeholder in
  docs). Extend `.gitignore` for any new Phase-A config files
  (web/mobile client-ID config) following the
  `electron/google-auth.config.json` pattern.
- New `docs/PRODUCTION_CONFIG.md`: single canonical list of every env var /
  config file / CI secret a production deployment needs (OAuth client IDs
  per platform, Cloudflare tokens, signing secrets, worker bindings).

### B3. Auto-update pipeline verification (P1)  (effort: M)
Review `worker/update-worker.mjs` + `src/services/updateService.js` +
`electron/desktopUpdater.cjs` end-to-end against: staged rollout percent
determinism, rollback via `minSupported`/last-good-manifest, sha256 +
signature verification **before** install, manifest TTL/ETag behavior,
downgrade protection. `tests/worker.test.mjs` / `update-service.test.mjs`
cover much of this — I'll verify the chain holds end-to-end and add tests
for any gap found rather than assuming.

### B4. CI/CD (P1)  (effort: S)
CI exists (`.github/workflows/ci.yml` on PRs, `release.yml` on tags/main).
Gaps to fix: add `npm audit --omit=dev` (runtime deps) as a hard gate and
full `npm audit` as a report step; ensure the release workflow's signing
steps fail loudly (not warn-and-continue) when a tag build lacks signing
secrets; document required repo secrets.

### B5. Code signing & release artifacts (P1 — mostly human-action doc)  (effort: S)
Review `scripts/package-*.mjs`, `sign-linux-artifacts.mjs`,
`assert-release-signed.mjs`, `configure-android-signing.mjs` and produce
`docs/SIGNING_REQUIREMENTS.md`: exactly which credentials a human must
obtain — Windows Authenticode (EV/OV cert), macOS Developer ID +
notarization (Apple Developer account), Android upload keystore + Play App
Signing, iOS distribution cert + provisioning profile — plus where each
plugs into the existing scripts/workflows. **No placeholder certs will be
fabricated.**

### B6. Monitoring & crash reporting (P2)  (effort: M)
Audit what exists (likely nothing beyond local logs). Proposal consistent
with Yayra's local-first/privacy posture: **opt-in only**, default off,
disclosed in settings — recommend self-hosted Sentry (or GlitchTip) with
Electron `crashReporter` + Capacitor community Sentry plugin; scrub URLs/
PII at source. I'll scaffold the opt-in setting + no-op reporter seam with
tests; actual DSN/hosting is a human decision.

### B7. App-store / release readiness (P2 — human checklist)  (effort: S)
`docs/STORE_READINESS.md`: Play Store + App Store non-code requirements
(privacy policy URL, data-safety & content-rating questionnaires,
screenshots, listing copy), and Google OAuth consent-screen verification —
confirming post-Phase-A scopes remain only `openid email profile`
(non-sensitive ⇒ no full security assessment, but publishing the consent
screen with branding still requires basic verification: homepage +
privacy-policy URLs on a verified domain).

### B8. Final QA pass (P2)  (effort: S)
`docs/MANUAL_QA_CHECKLIST.md`: everything this sandbox cannot verify — live
Google sign-in on each platform, real update rollout/rollback on installed
builds, signed-artifact install UX (SmartScreen/Gatekeeper), real-device
floating-bubble behavior, store-build smoke tests.

### B9. Documentation sweep (P3)  (effort: S)
README + docs updated so a third party can deploy their own instance:
own Cloudflare worker, own OAuth client IDs, own signing certs; cross-link
the new docs from B2/B5/B7/B8.

---

## Execution order & check-in points

1. **B1 + B2** (small, de-risk everything else) → check-in #1 with findings.
2. **A1 Web/PWA sign-in** (largest user-facing item) → check-in #2.
3. **A2 Capacitor sign-in** → check-in #3.
4. **B3 + B4** (update pipeline + CI hardening) → check-in #4.
5. **B5–B9** (docs/proposals/checklists) → final check-in & summary.

`npm test` runs green after every step (modulo the known sandbox-only `.deb`
failure). All work stays on `arena/01a105e3-yayra`; merging to `main`
happens via a PR you approve.
