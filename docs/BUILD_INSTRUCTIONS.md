# Yayra Build Instructions

This guide provides instructions for building and verifying the Yayra Floating Browser across **Android**, **Windows**, and **Linux (Debian/Ubuntu)**.

---

## 1. Prerequisites

### Host Environment Requirements
* **Node.js**: `v22.x` or later.
* **npm**: `v10.x` or later.
* **Linux packages (for native DEB packaging & WebKitGTK)**:
  ```bash
  sudo apt-get update && sudo apt-get install -y dpkg-dev build-essential libgtk-3-dev libwebkit2gtk-4.1-dev
  ```
* **Android SDK (for native Android builds)**:
  * Android SDK Build-Tools 34.0.0
  * JDK 17 (OpenJDK 17)
* **Windows Build Tools (for Windows builds on Windows hosts)**:
  * Visual Studio 2022 C++ Build Tools
  * NSIS 3.x
  * WiX Toolset v3.14+ (for MSI builds)

---

## 2. Quickstart & Verification Gates

Run the automated CI gate suite to verify type contracts, lint rules, branding lockstep, unit tests, and desktop smoke fallbacks:

```bash
# 1. Install dependencies
npm ci

# 2. Run all local quality gates
npm run ci:gates
```

Individual target checks:
```bash
# Run unit and contract test suites
npm test

# Run TypeScript static type verification
npm run typecheck

# Verify branding asset lockstep
npm run verify:branding

# Run packaging configuration verification
npm run verify:packaging
```

---

## 3. Platform-Specific Build Instructions

### A. Android (APK & AAB)
1. Synchronize assets to the native Android directory:
   ```bash
   npm run build:web
   node scripts/ensure-capacitor-platform.mjs android
   npx cap sync android
   ```
2. Build Standalone APK:
   ```bash
   cd android && ./gradlew assembleRelease
   # Output: android/app/build/outputs/apk/release/app-release-unsigned.apk
   ```
3. Build Google Play Android App Bundle (AAB):
   ```bash
   cd android && ./gradlew bundleRelease
   # Output: android/app/build/outputs/bundle/release/app-release.aab
   ```

### B. Linux (64-bit DEB & AppImage)
1. Build the web bundle:
   ```bash
   npm run build:web
   ```
2. Package native 64-bit Debian package:
   ```bash
   ./packages/platform-packaging/scripts/build-deb.sh
   # Output: release/yayra_0.1.0_amd64.deb
   ```
3. Package the Linux release targets (self-contained Electron DEB plus AppImage):
   ```bash
   npm run package:linux
   # Output: release/yayra_0.1.0_amd64.deb, release/yayra-0.1.0.AppImage
   ```
   Both artifacts are produced by electron-builder. The DEB embeds the Electron
   runtime and `resources/app.asar`, so installing it opens a standalone Yayra
   application window rather than delegating to a system browser.

### C. Windows (64-bit EXE & MSI)
1. Build the web bundle:
   ```bash
   npm run build:web
   ```
2. Package Windows 64-bit NSIS Setup & Portable:
   ```bash
   npm run package:win
   # Output: release/yayra-setup-0.1.0.exe, release/yayra-0.1.0.exe
   ```
3. Build WiX 64-bit MSI (on Windows with WiX installed):
   ```cmd
   candle.exe packages/platform-packaging/windows/yayra.wxs -out release/yayra.wixobj
   light.exe release/yayra.wixobj -out release/yayra-0.1.0-x64.msi
   ```

---

## 4. Verification in Current Environment

When running inside sandboxes or CI environments where native Windows/Android toolchains are not active:
* The TypeScript contract suite, persistence engine, event bus, and mode controllers are validated via `npm test`.
* Debian packaging (`.deb`) is verified locally via `dpkg-deb`.
* Electron packaging configurations and `.desktop` / icon mappings are verified via `scripts/verify-packaging.mjs`.
