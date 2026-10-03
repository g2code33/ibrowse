# Engineering Decisions

Yayra is architected as a local-first cross-platform floating browser with modular contracts and native engine implementations.

| Fact | Choice | Why |
|---|---|---|
| App/product/executable name | `yayra` | Product name set explicitly by user. |
| Application ID / Package Name | `com.yayra.app` | Reverse-DNS standard identifier. |
| Targets | Android (APK + AAB), Windows 64-bit (EXE + MSI), Linux 64-bit (DEB + AppImage) | Cross-platform floating browser matrix. |
| Browser Engines | Android WebView (Android), WebView2 (Windows), WebKitGTK (Linux) | Native OS-level hardware-accelerated rendering per platform without heavyweight runtime duplication. |
| Floating UI System | Glassmorphism acrylic design tokens, system overlay on Android (`TYPE_APPLICATION_OVERLAY`), borderless top-most layered windows on Windows/Linux | Provides low-latency, 60/120fps floating bubble and window physics across all operating systems. |
| Desktop Modes | Configurable Circle-First vs Browser-First modes | Supports both compact bubble overlay and docked companion browser desktop workflows. |
| Persistence | Local-first repository pattern (IndexedDB / SQLite / File storage) | 100% offline, zero mandatory cloud backend, subscription, or account tracking. |
| Packaging Matrix | APK/AAB (Android), NSIS EXE / WiX MSI (Windows), DEB / AppImage (Linux) | Satisfies sideloaders, enterprise sysadmins, and Linux users without mandatory Snap lock-in. |
| Release channel | `stable` | Default production channel. |
| Default version | `0.1.0` | Initial project baseline. |
