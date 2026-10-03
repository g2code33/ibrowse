# Yayra Dependency Inventory

This document lists all development, runtime, and platform dependencies utilized in the Yayra Floating Browser project.
**Every dependency is 100% Free and Open-Source Software (FOSS) or native OS API. There are ZERO paid dependencies, subscriptions, or mandatory cloud services.**

## 1. Core Runtime & Shared Modules

| Package / Module | Version | License | Purpose | Paid / Cloud? |
|---|---|---|---|---|
| `@yayra/shared-core` | `0.1.0` | MIT / Apache-2.0 | Tab management, window coordination, event bus, lifecycle | Free / Local |
| `@yayra/shared-ui` | `0.1.0` | MIT / Apache-2.0 | Glassmorphism design system, floating circle, floating window frame | Free / Local |
| `@yayra/browser-contract` | `0.1.0` | MIT / Apache-2.0 | Abstract engine, session, and security policy interfaces | Free / Local |
| `@yayra/persistence` | `0.1.0` | MIT / Apache-2.0 | Local-first storage adapter, history, bookmarks, settings | Free / Local |

## 2. Platform Engine Bindings

| Platform | Native Engine / SDK | Minimum Version | License | Cost / Backend |
|---|---|---|---|---|
| **Android** | `android.webkit.WebView` / Android SDK | API 24 (Android 7.0+) | Apache 2.0 (AOSP) | 100% Free / Native |
| **Android (Alt)** | Mozilla GeckoView | 120.0+ | MPL 2.0 | 100% Free / Open Source |
| **Windows** | Microsoft Edge WebView2 Evergreen Runtime | Evergreen / Win10+ | Microsoft WebView2 License (Royalty-free) | 100% Free / Local Native |
| **Linux** | WebKitGTK 4.1 / 6.0 (`libwebkit2gtk-4.1-0`) | 2.38+ | LGPL-2.1 / BSD | 100% Free / Local Native |

## 3. Platform Packaging & Build Tooling

| Tool | Version | License | Purpose |
|---|---|---|---|
| **Node.js** | `>= 22.0.0` | MIT | Cross-platform build scripts, verification, and tests |
| **TypeScript** | `5.6.3` | Apache-2.0 | Static type checking and interface contracts |
| **Electron-Builder** | `26.15.3` | MIT | Desktop bundle packaging for Windows & Linux |
| **Capacitor CLI / Core** | `6.2.2` | MIT | Android native project sync and asset staging |
| **Android Gradle Plugin** | `8.2.0+` | Apache-2.0 | APK and AAB compilation |
| **dpkg-deb** | Standard Debian/Ubuntu tool | GPL-2.0+ | Native `.deb` archive generation |
| **NSIS** | `3.x` | zlib/libpng | Windows 64-bit EXE installer compilation |
| **WiX Toolset** | `3.14+ / 4.x` | MS-RL | Windows 64-bit MSI installer compilation |

## 4. Policy on Proprietary & Cloud Dependencies
* **No mandatory user accounts or logins.**
* **No external database hosting (Firebase, Supabase, AWS RDS, etc.).**
* **No paid commercial browser shells or proprietary licensing.**
* **No mandatory Canonical Snap requirement on Linux (Native DEB is first-class).**
