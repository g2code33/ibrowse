# Yayra Android Floating Bubble & WindowManager Integration

> **Wired into the app (v1.0.0):** these Kotlin sources are no longer
> documentation-only. `scripts/ensure-capacitor-platform.mjs` (run by
> `npm run build:android`) copies them into the generated `android/`
> project, enables the Kotlin gradle plugin, injects the
> `SYSTEM_ALERT_WINDOW`/foreground-service permissions and the
> `YayraFloatBubbleService` declaration into `AndroidManifest.xml`,
> registers `YayraOverlayPlugin` in `MainActivity`, and installs
> `assets/brand/logomain1-transparent.png` as `res/drawable/yayra_bubble_logo`
> so the bubble renders as the **logo only** (no circular plate), matching
> every other platform. The web shell (`BrowserShell.js`) feature-detects
> `window.Capacitor.Plugins.YayraOverlay`, asks for the "Display over other
> apps" permission once, starts the service, and suppresses its in-page
> fallback bubble while the OS-level bubble is live - so the bubble truly
> floats over **every opened app**, not just inside Yayra.

## 1. Architectural Overview

The Yayra Android Floating Bubble (`@yayra/floating-android`) delivers a persistent, system-wide glassmorphism floating circle. It uses Android `WindowManager` overlay surfaces anchored to a user-controlled, policy-compliant Foreground Service, ensuring smooth edge-docking physics and seamless transition to the browser.

```
┌────────────────────────────────────────────────────────────┐
│                    YayraFloatBubbleService                 │
│   • Android 14/15 Compliant User-Controlled Service        │
│   • Ongoing Low-Priority Notification with Quick Actions   │
│   • Zero Restart Loops (START_NOT_STICKY)                  │
└─────────────────────────────┬──────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                   YayraFloatBubbleManager                  │
│   • WindowManager (TYPE_APPLICATION_OVERLAY) Lifecycle    │
│   • Edge Snapping Physics (Left/Right Spring Magnet)       │
│   • Display Cutout & System Bar Inset Avoidance            │
│   • Position Persistence (SharedPreferences x/y ratio)     │
└──────────────┬──────────────────────────────┬──────────────┘
               │                              │
┌──────────────▼──────────────┐ ┌─────────────▼──────────────┐
│   YayraFloatingBubbleView   │ │    YayraQuickActionsView   │
│  • ~60dp Translucent Orb    │ │  • Radial Glass Menu       │
│  • Cyan/Blue Glow Shader    │ │  • New Tab / Search / Close│
│  • Tap vs Drag vs Hold      │ │  • Touch Dismissal Gate    │
└─────────────────────────────┘ └────────────────────────────┘
```

---

## 2. Floating Appearance & Canvas Shaders

| Visual Property | Value / Specification | Implementation Details |
| :--- | :--- | :--- |
| **Bubble Diameter** | `60dp` (~150-180px on High-DPI) | `TypedValue.applyDimension(COMPLEX_UNIT_DIP, 60f, displayMetrics)` |
| **Glass Sphere** | Acrylic 3-stop radial gradient | `#38bdf8` (top-left highlight) → `#0e7490` → `#060b19` (bottom-right depth) |
| **Orbital Ring** | Cyan elliptical vector | `-25°` rotation, stroke `2.5px`, color `#38bdf8` |
| **Glowing Core** | High-intensity luminous center | Radial white `#ffffff` center to cyan `#22d3ee` drop-shadow glow |
| **Translucent Border**| Ultra-thin glass refraction | `1.5px` stroke, `rgba(255, 255, 255, 0.45)` |
| **Adjustable Opacity**| `0.20` to `1.00` (default `0.85`) | Interactive alpha modulation with idle dimming |
| **Haptic & Scale** | Spring scaling on touch | `0.92x` on touch-down, `1.05x` during drag, `HapticFeedbackConstants.KEYBOARD_TAP` |

---

## 3. Gesture Detection & Motion Physics

### Tap vs. Drag Disambiguation
To prevent false-positive taps during movement:
1. **Touch Slop Gate**: Queries `ViewConfiguration.get(context).scaledTouchSlop` (~8dp). The gesture remains in "pending tap" state until the Euclidean distance $\sqrt{\Delta x^2 + \Delta y^2} > \text{touchSlop}$.
2. **Tap Timeout**: If released within `ViewConfiguration.getTapTimeout()` and distance $< \text{touchSlop}$, executes `onBubbleTap()`.
3. **Long Press Detector**: If held stationary for $\ge \text{ViewConfiguration.getLongPressTimeout()}$ (~500ms), triggers `onBubbleLongPress()` with `HapticFeedbackConstants.LONG_PRESS` and expands `YayraQuickActionsView`.

### Edge Snapping & Safe Inset Boundaries
- **Horizontal Snapping**:
  $$\text{targetX} = \begin{cases} \text{safeMargin} & \text{if } x_{\text{release}} < \frac{\text{screenWidth}}{2} \\ \text{screenWidth} - \text{width} - \text{safeMargin} & \text{if } x_{\text{release}} \ge \frac{\text{screenWidth}}{2} \end{cases}$$
- **Deceleration Interpolator**: Position transitions smoothly over 260ms via `ValueAnimator` with `DecelerateInterpolator(1.5f)`.
- **System Inset Clamping**: Clamps vertical position within $[\text{statusBarHeight} + \text{safeMargin}, \text{screenHeight} - \text{navBarHeight} - \text{height} - \text{safeMargin}]$.
- **Display Cutout / Notch Mode**: Configured with `LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES` to avoid obstruction under camera cutouts.

---

## 4. Permissions & Onboarding Lifecycle

### SYSTEM_ALERT_WINDOW Verification
- Probed via `Settings.canDrawOverlays(context)`.
- Onboarding intent directs user to exact app settings:
  ```kotlin
  Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
  ```
- **Runtime Revocation Handling**: If the user revokes overlay permission in system settings while the service is active, `YayraFloatBubbleService` detects the revocation on resumed commands, immediately tears down all `WindowManager` views, and gracefully stops itself.

---

## 5. Service Architecture & Android 14/15 Policies

### Compliant Foreground Service
* **Android 14+ (API 34) & Android 15+ (API 35)**:
  * Declares `android:foregroundServiceType="specialUse"` in `AndroidManifest.xml` alongside `<property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" .../>`.
  * Evaluated against Android 14 restrictions: only launched upon explicit user interaction from the UI dashboard.
* **Low-Disturbance Ongoing Notification**:
  * Channel: `yayra_floating_bubble_channel` with `NotificationManager.IMPORTANCE_LOW`.
  * Action buttons: "Open" (launches browser) and "Close" (terminates foreground service).
* **Anti-Abuse Process Policy**:
  * Service returns `START_NOT_STICKY`. If killed under memory pressure, it does not loop restart without user intent.
  * All views are removed from `WindowManager` on `onDestroy()`.

---

## 6. Persistence & Screen Rotation

- **Relative Ratio Persistence**: Bubble coordinates are persisted as screen width/height percentages (`xPercent`, `yPercent`) in `SharedPreferences`.
- **Configuration & Rotation Changes**: When orientation flips (portrait $\leftrightarrow$ landscape), `onConfigurationChanged` re-queries display metrics, recalculates the bounds, and re-docks the bubble to the nearest safe edge.
