# Linux Floating Circle, Browser Window & Desktop Modes

## Architectural Overview

`yayra` provides native Linux floating-window capabilities across modern Debian- and Ubuntu-based desktop environments. The architecture separates window management from browser engine execution, utilizing GTK3/GTK4 top-level surfaces, WebKitGTK 4.1 / 6.0 rendering views, Cairo/RGBA glassmorphism styling, AppIndicator status integration, and compositor-aware display capabilities.

```
+-------------------------------------------------------------------------+
|                        Desktop Floating Orchestration                    |
|                                                                         |
|   +--------------------------+          +---------------------------+   |
|   |   Mode A: Circle-First   |          |   Mode B: Browser-First   |   |
|   |                          |          |                           |   |
|   |  - Floating Circle GtkWin| Click    |  - Floating Browser GtkWin|   |
|   |  - Browser Docked/Hidden |--------->|  - Bubble Hidden/Ready    |   |
|   |  - Minimized -> Bubble   |<---------|  - Minimized -> Bubble    |   |
|   +--------------------------+ Minimize +---------------------------+   |
+-------------------------------------------------------------------------+
                                    |
             +----------------------+----------------------+
             |                                             |
+---------------------------+                +----------------------------+
|   GTK_BUBBLE_WINDOW       |                |    GTK_BROWSER_WINDOW      |
| - skip_taskbar_hint(TRUE) |                | - skip_taskbar_hint(FALSE) |
| - keep_above(TRUE)        |                | - keep_above(TRUE)         |
| - RGBA Paintable (cairo)  |                | - RGBA Paintable (cairo)   |
| - Interactive Move Grab   |                | - WebKitGTK View Container |
| - Independent GtkWidget   |                | - Interactive Resize Grab  |
+---------------------------+                +----------------------------+
                                    |
+-------------------------------------------------------------------------+
|                      Linux Subsystem Integration                        |
|                                                                         |
|  - LinuxDisplayCapabilityDetector: Evaluates X11 vs GNOME/KDE/wlroots   |
|  - LinuxMonitorManager: GdkMonitor work area clamping & scaling         |
|  - LinuxAppIndicatorManager: libayatana-appindicator3 / SNI status      |
|  - SettingsRepository: Local-first persistence (modes, geometry)        |
+-------------------------------------------------------------------------+
```

---

## 1. Supported Desktop Environments & Display Servers

`yayra` has been designed and tested across major Linux desktop environments:

| Desktop Environment | Display Server | Floating Capability Status | Notes |
| :--- | :--- | :--- | :--- |
| **Ubuntu GNOME (20.04 / 22.04 / 24.04)** | Wayland (Default) | Fully Supported | Interactive titlebar move/resize; keep-above enabled; dimensions restored. |
| **Ubuntu GNOME** | X11 | Fully Supported | Unrestricted global coordinates, keep-above, magnetic edge snapping. |
| **Debian GNOME / XFCE / MATE** | X11 | Fully Supported | EWMH `_NET_WM_STATE_ABOVE`, full XMoveWindow coordinate control. |
| **KDE Plasma (5.27+ / 6.0)** | Wayland & X11 | Fully Supported | KWin keep-above, layer-shell integration where available. |
| **Sway / Hyprland / wlroots** | Wayland (Layer-Shell) | Fully Supported | `zwlr_layer_shell_v1` anchor-based positioning & overlay layering. |

---

## 2. Desktop Floating Modes

Both modes are selectable in **FloatBrowse Settings**:

### Mode A: Circle-first
- **Overview:** A compact, circular frosted-glass orb floats above all open applications.
- **Taskbar Isolation:** `gtk_window_set_skip_taskbar_hint(TRUE)` keeps the circle from cluttering the GNOME Dash or taskbars.
- **Activation:** Clicking the circle immediately reveals and presents the floating browser window.
- **Minimization:** Minimizing the browser collapses the session back into the floating bubble at its last screen position.

### Mode B: Browser-first
- **Overview:** The floating browser window remains open and active directly on the desktop.
- **Minimization:** Minimizing docks the active browsing session into the floating bubble.
- **Restoration:** Clicking the bubble re-opens the floating browser window to its exact dimensions and tab states.

---

## 3. Important Wayland Principles & Security Boundaries

### No False Promises
Wayland compositors (specifically GNOME's Mutter) enforce strict client isolation: clients cannot query global screen coordinates or force their own absolute placement on the screen without compositor protocols.

### Graceful Capability Adaptation
`LinuxDisplayCapabilityDetector` dynamically inspects the environment (`WAYLAND_DISPLAY`, `XDG_SESSION_TYPE`, `XDG_CURRENT_DESKTOP`, `GDK_BACKEND`):

1. **Restricted Positioning Handling:** When running under GNOME Wayland (`canGlobalPosition: false`), `yayra` disables absolute coordinate manipulation controls and gracefully relies on `gtk_window_begin_move_drag` and `gtk_window_begin_resize_drag`.
2. **Clear Limitation Explanation:** The Settings UI and system logs explain:
   > *"On GNOME Wayland, absolute window placement is governed by Mutter compositor. Interactive dragging and window size restoration are fully operational."*
3. **No Silent Full-Screen Fallback:** If a positioning API is restricted, `yayra` **never** falls back silently to a fullscreen or maximized window; it maintains its intended compact floating window frame.

---

## 4. Window Functionality & System Integration

### Always-On-Top (`gtk_window_set_keep_above`)
- Both the bubble and browser windows request topmost z-order layering (`gtk_window_set_keep_above(window, TRUE)`), matching `WS_EX_TOPMOST` semantics from Windows.

### Dragging & Resizing
- **Dragging:** Handled natively via `gtk_window_begin_move_drag(GTK_WINDOW(window), button, root_x, root_y, timestamp)` upon pointer grab.
- **Resizing:** Multi-direction sizing handles invoke `gtk_window_begin_resize_drag(GTK_WINDOW(window), edge, button, root_x, root_y, timestamp)`.

### Multi-Monitor Topologies & Work Area Clamping
- Queries `GdkDisplay` and `GdkMonitor` to retrieve monitor geometries and usable work areas (e.g. accounting for the 28px GNOME top panel or bottom docks).
- Clamps window coordinates inside `workArea` on X11 / layer-shell sessions.

### Display Scaling Awareness
- Respects `gdk_monitor_get_scale_factor` for fractional (125%, 150%) and integer (200% HiDPI) UI rendering.

### System Tray & AppIndicator (`libayatana-appindicator3`)
- Optional panel indicator with icon and context menu:
  - *Open Floating Browser*
  - *Always on Top* (Toggle)
  - *Switch to Browser-First / Circle-First*
  - *Settings...*
  - *Quit Yayra*

### Application Identity & Packaging
- **Launcher Entry:** `build/linux/yayra.desktop` and `build/linux/yayra-appimage.desktop`.
- **Identity:** `g_set_prgname("yayra")`, `g_set_application_name("yayra")`, `WM_CLASS("yayra", "yayra")`.
- **Icons:** Full hicolor icon set (16x16 through 512x512).
- **Clean Shutdown:** Signals (`SIGINT`, `SIGTERM`) destroy both GTK widgets cleanly to prevent orphaned windows.

---

## 5. Required System Dependencies

For Debian/Ubuntu systems (`.deb` / native binary):

```bash
sudo apt-get install -y \
  libgtk-3-0 \
  libwebkit2gtk-4.1-0 \
  libayatana-appindicator3-1 \
  gir1.2-gtk-3.0 \
  gir1.2-webkit2-4.1
```

*Note: `yayra` intentionally does not require Snap as a mandatory distribution method, ensuring lightweight local-first performance and full standard desktop environment compatibility.*
