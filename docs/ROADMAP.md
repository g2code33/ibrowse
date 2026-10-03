# Yayra Development Roadmap

This roadmap outlines the multi-phase engineering plan to take the Yayra Floating Browser from foundational architecture to production release across Android, Windows, and Linux.

---

## Phase 1: Architecture Validation & Project Foundation *(Current Milestone - Complete)*
- [x] Repository reconnaissance and rebranding from baseline to **Yayra** (`com.yayra.app`).
- [x] Establish modular package architecture:
  - `@yayra/shared-core` (State machine, event bus, tab/window coordination, lifecycle ownership).
  - `@yayra/shared-ui` (Glassmorphism design tokens, floating circle & window frame components).
  - `@yayra/browser-contract` (Universal `IBrowserEngine`, `IBrowserSession`, and security policy).
  - `@yayra/browser-android`, `@yayra/browser-windows`, `@yayra/browser-linux` (Native engine bridge contracts).
  - `@yayra/floating-android`, `@yayra/floating-windows`, `@yayra/floating-linux` (Floating overlay controllers).
  - `@yayra/persistence` (Local-first offline storage, settings, history, bookmark tree).
  - `@yayra/platform-packaging` (Android APK/AAB, Windows EXE/MSI, Linux DEB).
- [x] Create Architecture Decision Records (ADR 0001 - 0005).
- [x] Create Platform Capability Matrix, Dependency Inventory, Build Instructions, and Architecture Validation Checklist.
- [x] Verify local CI test gates (29 automated tests passing).

---

## Phase 2: Native Engine Integration & Floating Overlay Core
- [ ] **Android**:
  - Implement JNI / Capacitor bridge connecting `AndroidOverlayManager` to `YayraFloatWindowService`.
  - Wire `android.webkit.WebView` with hardware layer acceleration and `onRenderProcessGone` handler.
  - Implement touch fling physics and spring edge snapping.
- [ ] **Windows**:
  - Implement C++/Win32 host integrating `Microsoft.Web.WebView2` with transparent direct composition.
  - Apply Windows 11 DWM Acrylic / Mica system backdrop effect.
  - Connect custom titlebar `WM_NCHITTEST` dragging.
- [ ] **Linux**:
  - Implement GTK3/GTK4 WebKitGTK wrapper (`yayra_webkit_view`).
  - Configure RGBA visual colormap and `_NET_WM_STATE_ABOVE` overlay behavior.

---

## Phase 3: Glassmorphism UI, Dual Desktop Modes & Navigation Suite
- [ ] Implement runtime switching for **Circle-First Mode** vs **Browser-First Mode** across Windows and Linux.
- [ ] Bind Settings UI modal to update desktop mode and persist to `@yayra/persistence`.
- [ ] Polish glassmorphism CSS backdrop filters, specular border reflection, and light/dark theme adaptation.
- [ ] Integrate tab management UI (tab strip, new tab button, tab close, active tab switching).
- [ ] Omnibox URL auto-complete and search engine query delegation (DuckDuckGo, SearXNG, Google, Bing).

---

## Phase 4: Local-First Persistence, History & Privacy Features
- [ ] Implement SQLite / IndexedDB hybrid persistence adapter for local storage.
- [ ] Implement full-text search index over visited URLs and page titles in `HistoryRepository`.
- [ ] Implement hierarchical bookmark manager with folder support and favicon caching.
- [ ] Implement session restore with crash recovery and incognito tab isolation.
- [ ] Built-in network ad & tracker blocker using EasyList block rules compiled locally.

---

## Phase 5: Hardening, Packaging Distribution & Production Release
- [ ] **Android Packaging**:
  - Automated APK (`assembleRelease`) and AAB (`bundleRelease`) signing pipelines.
  - Battery optimization whitelist guide for background overlay persistence.
- [ ] **Windows Packaging**:
  - NSIS 64-bit installer with custom uninstaller and desktop shortcuts.
  - WiX 64-bit MSI enterprise deployment package.
- [ ] **Linux Packaging**:
  - Native 64-bit Debian package (`.deb`) with `postinst` icon cache hooks and FreeDesktop menu integration.
  - Standalone portable AppImage.
- [ ] Security audit: Origin isolation, strict CSP enforcement, memory leak profiling under 24-hour continuous stress testing.
- [ ] Stable v1.0.0 release.
