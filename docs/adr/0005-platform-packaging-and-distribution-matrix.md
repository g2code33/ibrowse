# ADR 0005: Platform Packaging and Distribution Matrix

## Status
Accepted

## Context
Yayra must be packageable and distributable across the three primary target platforms without introducing proprietary app store lock-ins or mandatory Snap installations on Linux:
* **Android**: Must support standalone `.apk` (direct side-loading / distribution) and `.aab` (Google Play Android App Bundle with resource splitting).
* **Windows**: Must support 64-bit `.exe` (NSIS interactive installer + standalone portable executable) and 64-bit `.msi` (standard enterprise Windows Installer package).
* **Linux**: Must support native 64-bit `.deb` packages for Debian, Ubuntu, Linux Mint, and derivatives. Avoid forcing Snap as the mandatory installation method.

## Decision
We configure native build and packaging definitions in `packages/platform-packaging` and root automation scripts:

| Platform | Target Artifacts | Packaging Tooling | Configuration Location |
|---|---|---|---|
| **Android** | APK (`assembleRelease`), AAB (`bundleRelease`) | Gradle Android Application Plugin + R8 | `packages/platform-packaging/android/build.gradle` |
| **Windows** | 64-bit NSIS EXE (`yayra-setup-<version>.exe`), Portable EXE, 64-bit MSI | NSIS (`makensis`), WiX Toolset (`candle`/`light`), electron-builder | `packages/platform-packaging/windows/installer.nsi`, `yayra.wxs` |
| **Linux** | 64-bit DEB (`yayra_<version>_amd64.deb`), AppImage | `dpkg-deb`, native control scripts, electron-builder | `packages/platform-packaging/linux/control`, `scripts/build-deb.sh` |

## Consequences
### Positive
* Comprehensive native packaging matrix satisfying end users, side-loaders, and enterprise administrators.
* Linux users have clean native `.deb` integration with FreeDesktop `.desktop` specs, MIME types, and hicolor icons.
* Zero paid packaging dependencies or proprietary licensing restrictions.
