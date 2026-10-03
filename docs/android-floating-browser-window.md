# Yayra Android Resizable Floating Browser Window Integration

## 1. Architectural Overview & Session Ownership

The Yayra Android Resizable Floating Browser Window (`@yayra/floating-android`) bridges the hardened native Android browser engine (`@yayra/browser-android`) to a system-wide, draggable, resizable `WindowManager` overlay surface.

```
┌────────────────────────────────────────────────────────────┐
│                    YayraTabManager                         │
│   • Owns all persistent WebView instances & DOM sessions   │
│   • Maintains session state independently of overlays      │
└─────────────────────────────┬──────────────────────────────┘
                              │
                    (Attach / Detach)
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                YayraFloatingWindowManager                  │
│   • WindowManager (TYPE_APPLICATION_OVERLAY) Hosting       │
│   • Draggable Titlebar & Resizing Handles                  │
│   • Clamps within Screen Metrics (min 280dp x 360dp)       │
└─────────────────────────────▲──────────────────────────────┘
                              │
               (Minimize / Restore / Close)
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                 YayraFloatBubbleManager                    │
│   • ~60dp Glassmorphism Bubble with Edge Snapping          │
│   • Tap restores Browser; Long-press opens Quick Actions   │
└────────────────────────────────────────────────────────────┘
```

---

## 2. Window Design & Visual Geometry

| Window Element | Specifications | Implementation |
| :--- | :--- | :--- |
| **Window Frame** | Rounded corners (`18dp`), translucent acrylic glass | `Color.argb(225, 13, 23, 54)` with `clipToOutline = true` |
| **Draggable Titlebar** | Top header with movement tracking | Tracks `MotionEvent.ACTION_MOVE` and updates `windowParams.x/y` |
| **Window Controls** | Minimize (`−`), Maximize (`□`), Close (`×`) | Custom touch buttons with distinct color coding (`#ef4444` close) |
| **Navigation Toolbar** | Back (`←`), Forward (`→`), Reload (`↻`), Omnibox | Integrated omnibox with search resolution & "Go" action |
| **Loading Indicator** | Horizontal progress bar (`0%` to `100%`) | Cyan gradient bar directly beneath navigation toolbar |
| **WebView Container** | Isolated `FrameLayout` host | Hosts the active `WebView` without owning its lifecycle |
| **Resizing Handle** | Bottom-right cyan corner handle (`22dp`) | Tracks touch deltas and dynamically resizes width & height |

---

## 3. Dimensions & Display Clamping Rules

- **Default Adaptive Sizing**:
  - Portrait Mode: `width = 85%` screen width, `height = 60%` screen height.
  - Landscape Mode: `width = 55%` screen width, `height = 75%` screen height.
- **Minimum Dimensions**:
  $$\text{minWidth} = 280\text{dp} \quad (\approx 700\text{px}-840\text{px on High-DPI})$$
  $$\text{minHeight} = 360\text{dp} \quad (\approx 900\text{px}-1080\text{px on High-DPI})$$
- **System Inset Clamping**:
  - `windowParams.x` is clamped to $[ \text{safeMargin}, \text{screenWidth} - \text{width} - \text{safeMargin} ]$.
  - `windowParams.y` is clamped to $[ \text{statusBarHeight} + \text{safeMargin}, \text{screenHeight} - \text{navBarHeight} - \text{height} - \text{safeMargin} ]$.
- **Orientation & Cutout Adaptation**: `onConfigurationChanged` recalculates bounds and re-clamps without resetting active browsing tabs.

---

## 4. Lifecycle & Interaction Rules Protocol

| Interaction | Trigger | Action & State Transitions |
| :--- | :--- | :--- |
| **Tap Bubble** | User taps the 60dp bubble | Hides bubble. Reattaches existing `WebView` instance into floating window. Restores previous position, size, and URL. |
| **Minimize** | User taps `−` on titlebar | Hides browser window overlay. Detaches `WebView` from view hierarchy (preserving DOM, cookies, and scroll). Shows bubble. |
| **Restore** | User taps bubble or notification "Open" | Hides bubble. Shows browser overlay. Reattaches the same `WebView` without duplicate creation. |
| **Maximize Toggle** | User taps `□` on titlebar | Expands window to fill safe display area (excluding status/nav bars) or restores pre-maximize dimensions. |
| **Close Window** | User taps `×` on titlebar | Closes browser overlay. Returns to floating bubble. Does **not** terminate the foreground service. |
| **Stop Service** | User taps notification "Close" | Destroys browser window, bubble, and WebView instances. Shuts down Foreground Service. |

---

## 5. Zero-Leak & Single-Instance Invariants

1. **WebView Instance Preservation**:
   - The overlay manager never invokes `webView.destroy()` when minimizing or closing the window.
   - `detachWebView()` unparents the view from the window container, keeping memory pointers valid.
2. **Renderer Process Crash Recovery**:
   - `onRenderProcessGone` traps unexpected renderer termination and cleanly re-initializes the surface without crashing the host overlay service.
3. **No Duplicate WebViews**:
   - Restoring a window always reattaches the existing `WebView` instance reference, verified by object identity checks.
