# Code signing & trusted releases — what a human must obtain

The build/release scripts already have the right hook points (verified:
`release.yml` fails a *publishing* run loudly when a platform's signing
secret is missing, and only warns for build-only PR artifacts). What they
cannot do is conjure credentials. This file lists exactly what to obtain,
where it plugs in, and what it costs. **No placeholder/self-signed certs
are checked in anywhere, deliberately** — a fake cert is worse than none
(it trains users to click through warnings).

## Windows — Authenticode

| | |
|---|---|
| Obtain | An OV or EV **code signing certificate** from a CA (Sectigo, DigiCert, SSL.com, Certum…). Since 2023 CA rules, keys must live in an HSM/token — most CAs now offer cloud signing (e.g. DigiCert KeyLocker, SSL.com eSigner). Budget ≈ $80–$400/yr (OV) / $250–$700/yr (EV). |
| Why | Unsigned installers trigger SmartScreen "unknown publisher"; EV gets immediate SmartScreen reputation, OV builds it over weeks. |
| Plugs into | `release.yml` secrets `WINDOWS_CERTIFICATE_BASE64` + `WINDOWS_CERTIFICATE_PASSWORD` (PFX path) — note cloud-HSM signing would need the workflow's signing step swapped for the CA's CLI (e.g. `smctl`/eSigner); the current PFX flow assumes an exportable key. |
| Verify | `scripts/assert-release-signed.mjs`; manually: `signtool verify /pa yayra-setup-*.exe` on a clean Windows VM — no SmartScreen interstitial after reputation builds. |

## macOS — Developer ID + notarization

| | |
|---|---|
| Obtain | **Apple Developer Program** membership ($99/yr) → "Developer ID Application" certificate + an App Store Connect **API key** (for `notarytool`). |
| Why | Unsigned/un-notarized apps are blocked outright by Gatekeeper on modern macOS. |
| Plugs into | `release.yml` secrets `APPLE_TEAM_ID`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_AUTH_KEY_PATH`, `APP_STORE_CONNECT_{ISSUER_ID,KEY_ID,PRIVATE_KEY}`, keychain vars. **Note:** there is currently no macOS job in `release.yml` — adding one (runs-on: macos-latest, electron-builder `--mac dmg zip` + notarize) is a prerequisite for shipping macOS at all. |
| Verify | `spctl -a -vv yayra.app` says "accepted / Developer ID"; first launch on a clean Mac shows no Gatekeeper block. |

## Linux — GPG/RSA detached signatures (already wired)

| | |
|---|---|
| Obtain | Nothing to buy. Generate a dedicated RSA release key pair (`openssl genrsa 4096`), store the private key ONLY as the `LINUX_SIGNING_KEY` (+ passphrase) GitHub secret, publish the public half (the workflow already uploads `linux-signing-public-key.pem`). Keep an offline backup; rotation means shipping a release signed by both old and new keys. |
| Plugs into | `scripts/sign-linux-artifacts.mjs` (already implemented); update manifest embeds the `.sig` (see `scripts/generate-update-manifest.mjs`) and `UpdateService` verifies it against the **pinned** public key when configured with `updatePublicKey`. |
| Verify | `openssl dgst -sha256 -verify linux-signing-public-key.pem -signature yayra_*.deb.sig yayra_*.deb`. |

## Android — upload keystore + Play App Signing

| | |
|---|---|
| Obtain | Nothing to buy beyond the one-time **Google Play Console** registration ($25). Generate an **upload keystore** (`keytool -genkeypair -v -keystore upload.jks -keyalg RSA -keysize 4096 -validity 10000`), enroll in **Play App Signing** so Google holds the actual app signing key (loss-proof, required for new apps). |
| Plugs into | `release.yml` secrets `ANDROID_KEYSTORE_PATH/PASSWORD/TYPE`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` → `scripts/configure-android-signing.mjs` (verified to inject correctly into the Capacitor 8 Gradle template). |
| Gotcha | Google sign-in needs the **Play app-signing key's SHA-1** (Play Console → Setup → App signing) registered on the Android OAuth client — not just the upload key's. See `docs/GOOGLE_SIGNIN.md`. |
| Verify | `apksigner verify --print-certs app-release.apk`; install on a device without "unsafe app" warnings when distributed via Play. |

## iOS — distribution certificate + provisioning profile

| | |
|---|---|
| Obtain | Same **Apple Developer Program** membership ($99/yr) → iOS Distribution certificate + an App Store provisioning profile for `com.yayra.app` (or use Xcode automatic signing with an App Store Connect API key in CI). |
| Plugs into | `npm run build:ios` → `ios/exportOptions.plist` (currently `method: development` — must become `app-store`/`ad-hoc` for distribution) + the `APP_STORE_CONNECT_*` secrets. iOS builds require a macOS runner; `release.yml` currently has no iOS job. |
| Verify | TestFlight processing succeeds (it rejects bad signing outright). |

## Key-handling rules (all platforms)

- Private keys/certs exist ONLY as CI secrets or in an HSM — never in the
  repo, never in `wrangler.worker.toml`, never in build logs
  (`scripts/sign-linux-artifacts.mjs` already writes the key to a
  0600 temp file and shreds it).
- Every secret name is catalogued in `docs/PRODUCTION_CONFIG.md` §4.
- A release run without a required key must FAIL (already true in
  `release.yml` for Linux/Windows publishing paths) — never silently ship
  unsigned artifacts under a signed-looking name (artifact names carry
  `unsigned` when applicable; `scripts/prepare-artifact.mjs` records the
  "why not").
