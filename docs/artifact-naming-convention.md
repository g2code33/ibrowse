# Yayra Floating Browser: Canonical Artifact Naming Convention

This specification defines the standardized naming format for all release binaries, installers, archives, and checksum files produced by the **Yayra** release pipeline.

---

## 1. Naming Format Standard

All artifacts follow the canonical structure:
```
yayra-[platform]-[arch]-[version](-channel)(-signing).[ext]
```

Where:
- `productName`: Fixed as `yayra`.
- `platform`: `android`, `windows`, `linux`, `ios`, `web`.
- `arch`: `x64`, `amd64`, `arm64`, `universal`.
- `version`: Full semantic version (e.g. `0.1.0`).
- `channel`: Optional channel tag (e.g. `beta`, `nightly`). Omitted for `stable`.
- `signing`: `-unsigned` appended if signing keys were unavailable during CI build; omitted for fully signed production builds.
- `ext`: Target package extension (`apk`, `aab`, `exe`, `msi`, `deb`, `AppImage`, `zip`, `tar.gz`).

---

## 2. Platform Artifact Matrix

| Platform | Target Type | Release File Name | Architecture | Distribution Channel |
| :--- | :--- | :--- | :--- | :--- |
| **Android** | Debug APK | `yayra-android-debug.apk` | universal | Internal QA / Testing |
| **Android** | Release APK | `yayra-android-0.1.0-release.apk` | universal | Direct Download / Sideload |
| **Android** | Release AAB | `yayra-android-0.1.0-release.aab` | multi-ABI | Google Play Console |
| **Windows** | NSIS Setup EXE | `yayra-setup-0.1.0.exe` | `x64` | Direct Download (End-users) |
| **Windows** | Portable EXE | `yayra-portable-0.1.0-x64.exe` | `x64` | Standalone Portable |
| **Windows** | WiX MSI | `yayra-0.1.0-x64.msi` | `x64` | Enterprise / GPO Deployment |
| **Linux** | Debian Package | `yayra_0.1.0_amd64.deb` | `amd64` | Debian / Ubuntu / Mint / Pop |
| **Linux** | AppImage | `yayra-0.1.0.AppImage` | `x86_64` | Universal Linux Portable |
| **Linux** | Tarball | `yayra-linux-x64-0.1.0.tar.gz` | `x86_64` | Generic Binary Archive |
| **Web / PWA** | Web Bundle | `yayra-pwa-0.1.0.tar.gz` | universal | Cloudflare Pages / Web CDN |

---

## 3. Checksums & Verification Manifests

Every release distribution directory includes:
- `SHA256SUMS.txt`: Cryptographic SHA-256 hashes for each artifact in the directory.
- `build-info.json`: Build provenance metadata (commit SHA, timestamp, runner OS, version, signing status).
- `updates/manifest.json`: Structured update manifest consumed by the Yayra in-app auto-update client.
