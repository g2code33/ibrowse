# Yayra Floating Browser: Installation & Setup Guide

This guide provides step-by-step installation instructions for end-users and system administrators on **Android**, **Windows**, and **Linux**.

---

## 1. Android Installation

### Option A: Standard Release APK (Sideloading)
1. Download `yayra-android-0.1.0-release.apk` from the official releases page.
2. If prompted, allow your browser or file manager permission to **Install Unknown Apps** in Android Settings.
3. Open the APK file and tap **Install**.
4. Launch **Yayra** from your app drawer.
5. **Grant Overlay Permission**: When prompted, enable **Display over other apps** (`SYSTEM_ALERT_WINDOW`) so Yayra can render the floating circle and browser window.

### Option B: Google Play Store (AAB)
1. Search for **Yayra Floating Browser** on Google Play.
2. Tap **Install**. Google Play handles automatic architecture selection (arm64-v8a / armeabi-v7a / x86_64).

---

## 2. Windows Installation

### Option A: Standard 64-bit EXE Installer (Recommended for Users)
1. Download `yayra-setup-0.1.0.exe`.
2. Double-click the installer executable.
3. Follow the wizard steps to choose the installation folder (defaults to `%LOCALAPPDATA%\Programs\yayra`).
4. **WebView2 Requirement**: If Microsoft Edge WebView2 is not detected, the installer will prompt you to download the Evergreen bootstrapper from Microsoft.
5. Once complete, launch Yayra from the Desktop or Start Menu.

### Option B: 64-bit Enterprise MSI Installer (Recommended for IT Administrators)
For enterprise deployment via Active Directory Group Policy (GPO), Microsoft Intune, or SCCM:
```cmd
msiexec /i yayra-0.1.0-x64.msi /qn /norestart
```

### Uninstallation on Windows
- Open **Settings > Apps > Installed apps**, select **Yayra**, and click **Uninstall**.
- *Note*: Your browsing history, bookmarks, and settings in `%APPDATA%\yayra` are preserved unless manually deleted.

---

## 3. Linux Installation

### Option A: 64-bit Debian Package (`.deb`) (Ubuntu, Debian, Linux Mint, Pop!_OS)

#### Via Graphical Software Center
1. Download `yayra_0.1.0_amd64.deb`.
2. Double-click the `.deb` file to open it in **Ubuntu Software**, **GNOME Software**, or **GDeBi**.
3. Click **Install**.

#### Via Terminal (`apt` / `dpkg`)
```bash
# Recommended: resolves all required runtime dependencies automatically
sudo apt install ./yayra_0.1.0_amd64.deb

# Or via dpkg with dependency resolution
sudo dpkg -i yayra_0.1.0_amd64.deb
sudo apt install -f
```

#### Required Dependencies
- `libc6 (>= 2.31)`
- `libgtk-3-0` or `libgtk-4-1`
- `libwebkit2gtk-4.1-0` or `libwebkitgtk-6.0-4`
- `libsoup-3.0-0` or `libsoup2.4-1`

### Option B: Portable AppImage
```bash
chmod +x yayra-0.1.0.AppImage
./yayra-0.1.0.AppImage
```

### Uninstallation on Linux
```bash
# Remove application binaries while preserving your local browsing data (~/.config/yayra)
sudo apt remove yayra

# Complete purge (removes system-wide configurations)
sudo apt purge yayra
```
