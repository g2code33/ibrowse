# Yayra Floating Browser: Versioning & Release Policy

This document establishes the official semantic versioning standards, lockstep synchronization rules, Android version code calculation formulas, and upgrade compatibility guarantees for **Yayra**.

---

## 1. Semantic Versioning Specification (SemVer 2.0.0)

Yayra follows strict **Semantic Versioning 2.0.0** formatted as `MAJOR.MINOR.PATCH[-PRERELEASE]`:

- **MAJOR (X.0.0)**: Incompatible architectural migrations, database schema breaking changes requiring manual export, or platform API deprecations.
- **MINOR (0.Y.0)**: Backward-compatible feature releases (e.g. new floating modes, updated theme tokens, new browser contracts).
- **PATCH (0.0.Z)**: Backward-compatible security hardening, bug fixes, performance optimizations, and platform patch adjustments.

---

## 2. Multiplatform Version Lockstep

To prevent platform divergence and ensure update feeds remain reliable, all manifests are synchronized in lockstep by `scripts/version.mjs`:

| Platform / Manifest | File Location | Version Field |
| :--- | :--- | :--- |
| **Node / Root Package** | `package.json` & `package-lock.json` | `"version": "0.1.0"` |
| **Android Gradle** | `native/android/version.gradle` | `appVersionName = "0.1.0"` |
| **Android Packaging** | `packages/platform-packaging/android/build.gradle` | `versionName "0.1.0"` |
| **iOS Plist** | `native/ios/Info.plist` | `<string>0.1.0</string>` |
| **Web Manifest** | `public/manifest.webmanifest` | `"version": "0.1.0"`, `"cacheVersion": "0.1.0"` |
| **Electron Runtime** | `electron/app-version.json` | `{"version": "0.1.0"}` |
| **Debian Control** | `packages/platform-packaging/linux/control` | `Version: 0.1.0` |
| **Windows NSIS** | `packages/platform-packaging/windows/installer.nsi` | `VIProductVersion "0.1.0.0"` |
| **Windows MSI** | `packages/platform-packaging/windows/yayra.wxs` | `Version="0.1.0.0"` |

---

## 3. Android Version Code Formula

Android requires a monotonically increasing integer `versionCode` for APK/AAB distribution on Google Play.

Yayra calculates `versionCode` deterministically:
$$\text{versionCode} = (\text{MAJOR} \times 10000) + (\text{MINOR} \times 100) + \text{PATCH}$$

### Examples:
- `0.1.0` $\rightarrow (0 \times 10000) + (1 \times 100) + 0 = 100$ (or padded base 1000)
- `1.2.3` $\rightarrow (1 \times 10000) + (2 \times 100) + 3 = 10203$
- `2.0.1` $\rightarrow (2 \times 10000) + (0 \times 100) + 1 = 20001$

---

## 4. Upgrade Compatibility & Data Preservation

1. **Forward Compatibility**: Minor and patch upgrades must automatically migrate the SQLite database using `DatabaseMigrationRunner` without user intervention.
2. **Downgrade Protection**: Installers (NSIS, WiX MSI, Debian dpkg) refuse accidental downgrades to older versions that could result in database corruption.
3. **Data Preservation**: User browsing history, bookmarks, sessions, and custom preferences (`~/.config/yayra`, `%APPDATA%\yayra`, Android internal storage) must never be wiped during an in-place upgrade.

---

## 5. Version Verification & CI Enforcement

The verification script `node scripts/version.mjs --check` runs during every CI pull request and build gate to enforce 100% lockstep consistency across all files.
