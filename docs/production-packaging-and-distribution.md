# Yayra Floating Browser: Production Packaging & Distribution Architecture

This document describes the production packaging architecture, build targets, dependency models, signing configurations, and artifact generation workflows for **Yayra Floating Browser** across Android, Windows, and Linux.

---

## 1. Multiplatform Packaging Overview

| Platform | Primary Target Format | Secondary Format | Architecture | Application ID / Name | Runtime Dependency |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Android** | Release APK (`.apk`) | Release AAB (`.aab`) | universal / arm64 / x86_64 | `com.yayra.app` | Android System WebView (min API 24, target API 34) |
| **Windows** | 64-bit NSIS Setup (`.exe`) | 64-bit WiX MSI (`.msi`) | `x64` | `yayra` | Microsoft Edge WebView2 Evergreen Runtime |
| **Linux** | 64-bit Debian Package (`.deb`)| AppImage (`.AppImage`) | `amd64` | `yayra` | WebKitGTK (`libwebkit2gtk-4.1-0` or `libwebkitgtk-6.0-4`), GTK3/4 |

---

## 2. Android Packaging (APK & AAB)

### 2.1 Artifacts Generated
1. **Debug APK**: `release/yayra-debug.apk` (used for internal testing and CI validation).
2. **Release APK**: `release/yayra-release-0.1.0.apk` (sideloadable standalone binary).
3. **Release AAB**: `release/yayra-release-0.1.0.aab` (Android App Bundle for Google Play distribution).

### 2.2 Application Identification & Manifest
- **Application ID**: `com.yayra.app` (stable namespace).
- **Version Code**: Calculated dynamically from semver via formula: `(major * 10000) + (minor * 100) + patch` (e.g. `0.1.0` -> `1000`).
- **Target SDK**: 34 (Android 14) / **Min SDK**: 24 (Android 7.0 Nougat).
- **Permissions**:
  - `android.permission.INTERNET`
  - `android.permission.ACCESS_NETWORK_STATE`
  - `android.permission.SYSTEM_ALERT_WINDOW` (Required for drawing floating circle/window over other apps)
  - `android.permission.FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_SPECIAL_USE` (Floating window service persistence)
  - `android.permission.POST_NOTIFICATIONS`

### 2.3 Release Signing Security Model
- Private keys and keystores are **never** committed to version control.
- Gradle build configuration (`packages/platform-packaging/android/build.gradle`) reads signing credentials strictly from environment variables:
  - `ANDROID_KEYSTORE_PATH` (or base64 `ANDROID_KEYSTORE_BASE64`)
  - `ANDROID_KEYSTORE_PASSWORD`
  - `ANDROID_KEY_ALIAS`
  - `ANDROID_KEY_PASSWORD`
- When signing credentials are omitted, the build gracefully falls back to generating an unsigned release artifact marked as unsigned, preventing build pipeline breakage during local contributor development.

---

## 3. Windows Packaging (64-bit EXE & MSI)

### 3.1 64-bit NSIS Installer (`.exe`)
- **Script**: `packages/platform-packaging/windows/installer.nsi`
- **Output**: `release/yayra-setup-0.1.0.exe`
- **Architecture Enforcement**: Strictly enforces 64-bit Windows via `${RunningX64}` and `SetRegView 64`.
- **Branding & Visuals**: Uses custom icons (`build/icons/icon.ico`, `installer.ico`, `uninstaller.ico`).
- **WebView2 Detection**: Reads registry keys:
  - `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}\pv`
  - `HKCU\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}\pv`
  - Prompts and provides official Microsoft download link if missing.
- **Shortcuts & Uninstaller**: Registers Start Menu folder (`$SMPROGRAMS\Yayra`), Desktop shortcut (`$DESKTOP\Yayra.lnk`), and Add/Remove Programs registry entries.
- **User Data Preservation**: Ordinary uninstalls clean `$INSTDIR` binaries while preserving user browsing history, settings, and database in `%APPDATA%\yayra`.

### 3.2 64-bit WiX MSI Installer (`.msi`)
- **Definition**: `packages/platform-packaging/windows/yayra.wxs`
- **UpgradeCode**: `e87d894e-5264-4bf8-b809-58b2db51341e`
- **Major Upgrade**: `Schedule="afterInstallInitialize"` seamlessly replaces previous installations while blocking accidental downgrades.
- **Enterprise Features**: Standard MSI properties (`ALLUSERS=1`, silent execution `/qn`, group policy deployment readiness).

### 3.3 Windows Code Signing Workflow
- Code signing is injected during CI/release pipeline using `signtool.exe` or `electron-builder` with `CSC_LINK` and `CSC_KEY_PASSWORD` certificates stored in encrypted secret vaults.

---

## 4. Linux Packaging (64-bit Debian DEB)

### 4.1 Debian Package Architecture (`.deb`)
- **Package Name**: `yayra`
- **Architecture**: `amd64` (64-bit x86_64)
- **Output**: `release/yayra_0.1.0_amd64.deb`
- **Debian Control File**: `packages/platform-packaging/linux/control`
- **Dependencies**: `libc6 (>= 2.31)`, `libgtk-3-0 (>= 3.24.0) | libgtk-4-1 (>= 4.6.0)`, `libwebkit2gtk-4.1-0 | libwebkitgtk-6.0-4 | libwebkit2gtk-4.0-37`, `libsoup-3.0-0 | libsoup2.4-1`.
- **Recommends**: `ca-certificates`, `xdg-utils`
- **Suggests**: `libappindicator3-1 | libayatana-appindicator3-1`

### 4.2 Filesystem Layout
```
/usr/bin/yayra                                    -> Electron application launcher
/usr/share/applications/yayra.desktop             -> Freedesktop .desktop entry
/usr/share/icons/hicolor/<size>x<size>/apps/yayra.png -> Full icon theme (16px to 512px)
/usr/share/doc/yayra/copyright                    -> Debian machine-readable copyright
/usr/share/doc/yayra/changelog.gz                 -> Compressed release history
/opt/yayra/                                       -> Electron runtime and resources/app.asar
```

### 4.3 Maintainer Lifecycle Scripts
- **`postinst`**: Updates desktop MIME database (`update-desktop-database`) and refreshes GTK icon cache (`gtk-update-icon-cache /usr/share/icons/hicolor`).
- **`prerm`**: Safely terminates running Yayra instances before package file removal or upgrade.
- **`postrm`**: Cleans up desktop databases on removal; explicitly preserves user databases in `~/.config/yayra` unless purged with `apt purge`.

---

## 5. Automated Build Commands

```bash
# Android packaging
npm run package:android

# Windows EXE / MSI packaging
npm run package:windows

# Linux 64-bit Debian package
npm run package:linux:deb

# Package all platforms
npm run package:all
```
