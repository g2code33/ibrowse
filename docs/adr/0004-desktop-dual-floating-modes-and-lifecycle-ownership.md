# ADR 0004: Desktop Dual Floating Modes and Lifecycle Ownership

## Status
Accepted

## Context
Desktop workflows on Windows and Linux differ among users:
* **Workflow A (Circle-First)**: Users keep a compact floating glassmorphism circle docked at the screen edge. Clicking the circle expands the floating browser window. Closing the browser restores the circle.
* **Workflow B (Browser-First)**: Users keep the floating browser window open on desktop as a secondary browser / companion. When they need screen space, they minimize the browser into the floating circle. Clicking the circle restores the browser window.

Both modes must be freely configurable by the user in Settings.

Additionally, browser webviews (Android WebView, WebView2, WebKitGTK) are prone to memory leaks if native handles are not explicitly detached and destroyed.

## Decision
1. **Dual Desktop Floating Modes**:
   - Implemented in `packages/floating-windows` (`WindowsFloatingController`) and `packages/floating-linux` (`LinuxFloatingController`).
   - Managed via the domain setting `desktopFloatingMode: 'circle-first' | 'browser-first'`.
   - **Mode: `circle-first`**:
     - Initial state: Circle visible at dock position, window minimized.
     - Circle click: Window restored and focused.
     - Window minimize/close: Window hidden, circle displayed.
   - **Mode: `browser-first`**:
     - Initial state: Window restored and visible at saved geometry, circle hidden.
     - Window minimize: Window hidden, circle docked to edge.
     - Circle click: Circle hidden, window restored.
2. **Explicit Lifecycle Ownership (`LifecycleCoordinator`)**:
   - `LifecycleCoordinator` registers all lifecycle-aware components (`ILifecycleAware`).
   - Ensures structured startup (`onInitialize`), activation (`onResume`), suspension (`onSuspend`), and teardown (`onDestroy`).
   - Native WebView instances are detached from view trees, navigated to `about:blank`, cleared of history, and explicitly disposed during teardown.

## Consequences
### Positive
* Tailored ergonomics for both casual overlay users (Circle-First) and heavy power users (Browser-First).
* Clean state transitions without ghost windows or orphaned overlay hooks.
* Zero memory leaks across repeated open/minimize/close cycles.
