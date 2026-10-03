# Yayra Floating Browser: Production Release Checklist

Follow this rigorous verification checklist before cutting and publishing any production release of **Yayra**.

---

## 1. Pre-Release Source & Version Verification

- [ ] **Lockstep Version Bump**: Run `node scripts/version.mjs <new-version>` to synchronize `package.json`, Android Gradle, iOS Plist, Web Manifest, Electron versions, and packaging files.
- [ ] **Version Lockstep Verification**: Execute `npm run verify:versions` (`node scripts/version.mjs --check`).
- [ ] **Branding Verification**: Execute `npm run verify:branding` (`node scripts/branding.mjs --check`).
- [ ] **Code Quality & Lint**: Run `npm run lint` across all repository source files.
- [ ] **Automated Test Suite**: Run `npm test` (verify all unit, contract, persistence, and security tests pass with 0 failures).
- [ ] **CI Verification Gates**: Run `npm run ci:gates`.

---

## 2. Platform Build & Packaging Verification

### Android
- [ ] Build **Debug APK**, **Release APK**, and **Release AAB**: `npm run package:android`.
- [ ] Verify `applicationId` equals `com.yayra.app`.
- [ ] Verify `targetSdkVersion` is set to 34 and `minSdkVersion` is 24.
- [ ] Verify `SYSTEM_ALERT_WINDOW` permission and floating service declarations in `AndroidManifest.xml`.
- [ ] Verify release signing configuration receives secrets from environment without committing keys to git.

### Windows (64-bit)
- [ ] Stage and package **NSIS EXE**: `release/yayra-setup-<version>.exe`.
- [ ] Stage and package **WiX MSI**: `release/yayra-<version>-x64.msi`.
- [ ] Verify 64-bit architecture constraint (`${RunningX64}`).
- [ ] Verify Microsoft Edge WebView2 runtime detection and fallback download logic.
- [ ] Verify application icons (`icon.ico`, `installer.ico`, `uninstaller.ico`).
- [ ] Verify start menu shortcut creation and Add/Remove Programs registry entries.
- [ ] Verify user browsing data preservation in `%APPDATA%\yayra` on uninstall.

### Linux (64-bit)
- [ ] Build **Debian Package**: `release/yayra_<version>_amd64.deb` (`npm run package:linux:deb`).
- [ ] Verify package architecture `amd64` and dependencies (`libwebkit2gtk-4.1-0`, `libgtk-3-0`, `libc6`).
- [ ] Verify desktop entry at `/usr/share/applications/yayra.desktop`.
- [ ] Verify all 9 standard hicolor icon resolutions in `/usr/share/icons/hicolor/`.
- [ ] Verify launcher script at `/usr/bin/yayra` with executable permissions (0755).
- [ ] Verify user configuration preservation in `~/.config/yayra` during upgrade/removal.

---

## 3. Installation & Upgrade Testing

- [ ] **Clean Installation**: Install freshly on a clean test environment (Android VM/device, Windows sandbox, Linux container).
- [ ] **Launch Test**: Verify floating circle renders with correct dimensions and glassmorphism styling.
- [ ] **Upgrade Test**: Install new version over existing installation; verify saved bookmarks, history, and settings persist seamlessly.
- [ ] **Uninstall Test**: Uninstall application; verify binaries are cleaned while user database is safely retained unless explicitly purged.

---

## 4. Integrity, Checksums & Release Staging

- [ ] Generate SHA-256 checksums for all distribution artifacts: `SHA256SUMS.txt`.
- [ ] Prepare artifact metadata and update manifest: `scripts/generate-update-manifest.mjs`.
- [ ] Create GitHub Release draft with version tag `v<version>`.
- [ ] Attach all platform packages and `SHA256SUMS.txt`.
- [ ] Verify live release feed with `scripts/release-verify.mjs`.
