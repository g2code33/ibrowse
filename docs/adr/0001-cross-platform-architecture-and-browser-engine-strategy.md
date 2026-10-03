# ADR 0001: Cross-Platform Architecture and Native Browser Engine Strategy

## Status
Accepted

## Context
Yayra is a production-quality, cross-platform floating browser designed to operate on **Android**, **Windows (64-bit)**, and **Debian-based Linux (64-bit)**.

Modern cross-platform development frameworks offer different approaches to web rendering and UI compositing:
1. **Kotlin Multiplatform (KMP) & Compose Multiplatform**: Excellent for shared business logic and desktop rendering via Skiko, but Compose Multiplatform does not natively render full-fidelity web engines across Android, Windows, and Linux out-of-the-box without platform-specific embedding bridges (e.g., embedding Android WebView via AndroidView, Windows WebView2 via HWNDInterop, and Linux WebKitGTK via GTK embedding).
2. **Universal Single-Engine Wrappers (e.g. Pure Electron)**: Heavyweight memory footprints on mobile and restricted system overlay capabilities on Android.
3. **Decoupled Contract Architecture**: Defining platform-agnostic domain contracts (`browser-contract`, `shared-core`, `shared-ui`, `persistence`) with specialized native engine bindings:
   - **Android**: `android.webkit.WebView` (Chromium Blink) with GeckoView alternative abstraction.
   - **Windows**: Microsoft Edge WebView2 (`Microsoft.Web.WebView2`) using Evergreen Chromium runtime.
   - **Linux**: WebKitGTK (`WebKitWebView` via WebKitGTK 4.1/6.0).

## Decision
We adopt a **Decoupled Contract Multi-Module Architecture**:
* **`shared-core`**: Houses pure business logic, tab navigation state machine, window state coordination, floating circle physics, event bus, and lifecycle coordinators.
* **`browser-contract`**: Exposes the universal `IBrowserEngine` and `IBrowserSession` interfaces.
* **`browser-android`**: Implements `IBrowserEngine` utilizing native Android WebView with leak-free teardown protocols and `onRenderProcessGone` recovery.
* **`browser-windows`**: Implements `IBrowserEngine` utilizing Win32 Edge WebView2 with direct composition and user-data folder isolation.
* **`browser-linux`**: Implements `IBrowserEngine` utilizing WebKitGTK 4.1/6.0 with process isolation and hardware acceleration.

## Consequences
### Positive
* Zero bloat: Each platform utilizes its OS-native, hardware-accelerated web engine.
* Shared logic: 100% of navigation rules, tab state, history indexing, bookmark trees, and settings are unified across all targets.
* No memory leaks: Native engines are explicitly lifecycle-managed and decoupled from the UI widgets.

### Negative
* Engine-specific subtleties (e.g., WebKitGTK vs Chromium Blink rendering quirks) must be verified through automated contract test suites.
