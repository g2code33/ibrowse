# ADR 0002: Native Floating Window & Glassmorphism Overlay Strategy

## Status
Accepted

## Context
Yayra requires:
1. A system-wide floating glassmorphism circle (bubble) that sits on top of all applications and desktops.
2. A floating, draggable, and resizable browser window that can expand from and collapse into the circle.
3. Realistic glassmorphism visual styling (acrylic backdrop blur, specular border highlights, radial gradient lighting, translucent layers).

Each operating system manages system-wide overlays differently:
* **Android**: Requires `android.permission.SYSTEM_ALERT_WINDOW` and `WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY`. Must run within an active Foreground Service (`YayraFloatWindowService`) with an ongoing notification to prevent Android OS process kills.
* **Windows**: Requires frameless Win32 layered top-most windows (`WS_EX_LAYERED | WS_EX_TOPMOST | WS_POPUP`) and DWM System Backdrop attributes (`DwmSetWindowAttribute(DWMWA_SYSTEMBACKDROP_TYPE, DWMSBT_TRANSIENTWINDOW)`). Custom titlebar dragging is handled via `WM_NCHITTEST` returning `HTCAPTION`.
* **Linux**: Requires GTK3/GTK4 top-level windows configured with `gtk_window_set_keep_above(TRUE)`, `gtk_window_set_decorated(FALSE)`, and an RGBA visual colormap (`gdk_screen_get_rgba_visual`) under X11/XComposite or `wlr-layer-shell` subsurfaces on Wayland.

## Decision
1. **Glassmorphism Design Tokens**: Implemented in `@yayra/shared-ui` via CSS custom properties and backdrop filter pipelines (`backdrop-filter: blur(24px) saturate(180%)`, border specular reflections).
2. **Platform Floating Controllers**:
   - `packages/floating-android`: `AndroidOverlayManager` controlling WindowManager overlay parameters and edge-snapping spring physics.
   - `packages/floating-windows`: `WindowsFloatingController` managing layered window composition and Win32 drag/resize hooks.
   - `packages/floating-linux`: `LinuxFloatingController` managing GTK RGBA visual compositing and layer-shell hints.
3. **Strict Separation of State**:
   - Floating circle position/state is tracked in `FloatingCircleController`.
   - Browser window position/dimensions are tracked in `WindowStateManager`.
   - They do not mutate each other directly; coordination occurs via `EventBus`.

## Consequences
### Positive
* Smooth, high-performance 60/120fps dragging and edge snapping on all platforms.
* Native OS-level transparency and backdrop blur without third-party window managers.
* Independent window and bubble lifecycles.
