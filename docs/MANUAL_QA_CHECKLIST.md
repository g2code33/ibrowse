# Manual QA checklist — what this sandbox could NOT verify

Everything in this list requires a real machine/device/account. Items are
ordered so earlier failures invalidate later sections. The automated suite
(`npm test`, 330+ tests) covers the logic behind all of this with mocks;
this list is the reality check.

## 0. Build sanity (any dev machine)

- [ ] `npm ci && npm test` — expect exactly one failure ONLY if the
  machine lacks `dpkg-deb` (the Linux packaging test); zero otherwise.
- [ ] `npm run ci:gates` passes end-to-end.
- [ ] **Electron 44 runtime smoke** (the 31→44 major upgrade was
  test-verified but never launched in the sandbox):
  `npm run build:web && npm run smoke:desktop` on Linux AND Windows.
  Then by hand: window chrome/controls, tab create/close, downloads
  panel, floating overlay bubble, settings persistence across relaunch,
  right-click context menu (incl. Back/Forward which now use
  `navigationHistory`).
- [ ] **Capacitor 8 native builds** (6→8 major upgrade): `npm run
  build:android` with Android Studio/SDK 35+ installed; `npm run
  build:ios` on macOS/Xcode 16+. Both were only `cap add`/`cap sync`
  verified in-sandbox.

## 1. Google sign-in — live round trips (per docs/GOOGLE_SIGNIN.md)

- [ ] **Desktop (Linux + Windows):** sign in via system browser, profile
  appears, survives relaunch, sign-out clears, "switch account" shows
  the Google account chooser.
- [ ] **Web (`yayra.pages.dev`):** worker secrets deployed; sign-in in a
  normal tab AND as installed PWA; cancel-on-consent shows a clear
  message; Back after sign-in does not re-run the callback; private
  window behaves (session gone on close).
- [ ] **Android (real device):** Custom Tab (not webview!) opens; app
  returns to foreground signed in; dismissal → clean "cancelled";
  works with the debug-keystore SHA-1 client AND the Play-signing
  SHA-1 client on a Play-internal-testing build.
- [ ] **iOS (real device):** SFSafariViewController flow, same checks.
- [ ] Negative: wrong/unregistered redirect URI shows Google's error (not
  a hang); airplane-mode sign-in fails with a readable error.

## 2. Update pipeline — live (per docs/RELEASE-PIPELINE.md)

- [ ] Publish a real tagged release end-to-end (`release.yml`):
  artifacts + SHA256SUMS + `.sig` files + manifest reach GitHub/worker.
- [ ] Install version N on a machine, publish N+1, confirm: in-app
  update notice → download → sha256 verified → (with pinned key
  configured) signature verified → install path works.
- [ ] Tamper test: corrupt one byte of a staged artifact copy and
  confirm the client refuses it (`checksum:` / `signature:` error, old
  version keeps running).
- [ ] Staged rollout: set `rollout.percent: 1` in the worker manifest
  binding; confirm most devices report up-to-date and an allowlisted
  deviceId still updates.
- [ ] Rollback drill: publish a bad N+1, then N+2 with `minSupported`
  bumped; confirm N+1 devices get a forced update. (Remember: clients
  never downgrade — "rollback" always means shipping a higher version.)
- [ ] PWA: service-worker update prompt appears on next open after a
  Pages deploy; "reload" applies it.

## 3. Signed-artifact UX (per docs/SIGNING_REQUIREMENTS.md)

- [ ] Windows: signed installer on a clean VM — SmartScreen behavior
  acceptable; `signtool verify /pa` passes.
- [ ] Linux: `.deb` installs on clean Ubuntu/Debian; `.sig` verifies with
  the published public key; AppImage runs on a non-dev distro.
- [ ] Android: Play-internal-testing install (signed by Play) runs; APK
  sideload warns only about "unknown sources", nothing else.
- [ ] macOS/iOS: once those release jobs exist — Gatekeeper/TestFlight
  acceptance.

## 4. Store submissions (per docs/STORE_READINESS.md)

- [ ] Privacy policy URL live; consent screen brand verification done.
- [ ] Play data-safety + IARC forms submitted truthfully; AAB uploaded.
- [ ] App Store privacy labels; review notes explaining the browser UX.

## 5. Cross-cutting

- [ ] Fresh-profile first-run on every platform (no stale state from dev
  profiles).
- [ ] Non-English OS locale spot check (UI is EN, but OS dialogs/paths
  with spaces+unicode must not break downloads/updates).
- [ ] Corporate-proxy machine: desktop sign-in + update check still work
  (Electron `net.fetch` path — see GOOGLE_SIGNIN troubleshooting).
- [ ] Low-disk device: update download fails gracefully, old install
  intact.
