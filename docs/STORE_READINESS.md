# App-store / release readiness — non-code requirements

Everything below needs a human (accounts, money, legal text, screenshots).
Nothing here blocks self-distribution (GitHub Releases / Pages PWA), which
is already functional.

## Both stores

- [ ] **Privacy policy URL** — hard requirement for Play AND App Store AND
  the Google OAuth consent screen. Must cover: what Google sign-in data is
  used (name/email/picture, display only), the opt-in crash reporting
  policy (see `docs/MONITORING_AND_CRASH_REPORTING.md`), and the
  local-first storage story. Host it on a domain you control (e.g.
  `https://yayra.pages.dev/privacy`) — currently **does not exist**.
- [ ] Support email + marketing site URL.
- [ ] Screenshots per form factor (Play: phone + 7"/10" tablet; App
  Store: 6.9" and 6.5" iPhone, 13" iPad) and store listing copy
  (short/full description, keywords).
- [ ] App icon already exists (`assets/brand/`, generated per-platform by
  `scripts/branding.mjs`) — verify store-size exports render well.

## Google Play specifics

- [ ] Play Console account ($25 one-time), **Play App Signing enrollment**
  (see `docs/SIGNING_REQUIREMENTS.md`).
- [ ] **Data safety form**: declare Google sign-in (email/name/photo,
  "App functionality", not shared, user-deletable via sign-out); declare
  crash reporting only if/when the opt-in reporter ships.
- [ ] **Content rating questionnaire (IARC)**: as an app with an
  unrestricted web browser, answer the "accesses the open internet"
  questions truthfully — expect a Teen/"Parental guidance" style rating,
  and note some regions treat browsers specially.
- [ ] Target-API compliance: Play requires recent `targetSdkVersion`;
  Capacitor 8 templates currently satisfy this — re-check at submission
  time against Play's current deadline.
- [ ] An AAB (not APK) for Play: `cd android && ./gradlew bundleRelease`
  (the repo's `build:android` currently produces an APK for
  self-distribution; both are fine to keep).

## Apple App Store specifics

- [ ] Apple Developer Program ($99/yr); iOS distribution signing (see
  `docs/SIGNING_REQUIREMENTS.md` — `exportOptions.plist` must move off
  `method: development`).
- [ ] **App Review note:** apps whose main purpose is web browsing must use
  WebKit (guideline 2.5.6) — Yayra's iOS build renders pages in WKWebView
  via Capacitor, which complies; be ready to explain the floating-bubble
  UX in review notes.
- [ ] **Privacy "nutrition label"** in App Store Connect: mirrors the Play
  data-safety answers (contact info: email/name, linked to user, app
  functionality only).
- [ ] Sign in with Google alone is acceptable (guideline 4.8 "Sign in with
  Apple" requirement applies only when third-party login is *required* to
  use the app — Yayra's sign-in is optional; keep it optional or plan SIWA).

## Google OAuth consent-screen verification (post-Part-1 check)

Confirmed still true after the sign-in work: Yayra requests **only
`openid`, `email`, `profile`** on every platform (asserted by unit tests
on the authorization URLs — desktop `tests/google-oauth.test.mjs`, web
`tests/google-auth-web.test.mjs`, mobile `tests/google-auth-capacitor.test.mjs`;
the worker never widens scopes). These are **non-sensitive scopes**, so:

- No security assessment / CASA audit is required.
- "Publishing" the consent screen (so any Google account can sign in, no
  test-user list) requires only **basic brand verification**: app name,
  logo, support email, authorized domain, homepage + privacy-policy URLs
  on that domain. Budget days, not months.
- Keep it this way: adding any Gmail/Drive/Calendar scope later would
  trigger the heavyweight verification tier.
