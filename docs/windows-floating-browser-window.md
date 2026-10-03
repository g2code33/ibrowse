# Windows Floating Circle, Browser Window & Desktop Modes

## Architecture & System Overview

`yayra` implements a high-performance native Windows floating-window architecture utilizing native Win32 `HWND`s, DirectComposition / DWM Acrylic/Mica glassmorphism backdrops, Per-Monitor V2 DPI awareness, and decoupled floating state management.

The native Windows floating subsystem provides two distinct, user-selectable desktop modes:

```
+-------------------------------------------------------------------------+
|                        Desktop Floating Orchestration                    |
|                                                                         |
|   +--------------------------+          +---------------------------+   |
|   |   Mode A: Circle-First   |          |   Mode B: Browser-First   |   |
|   |                          |          |                           |   |
|   |  - Topmost Bubble HWND   | Click    |  - Topmost Browser HWND   |   |
|   |  - Browser Docked/Hidden |--------->|  - Bubble Hidden/Ready    |   |
|   |  - Minimized -> Bubble   |<---------|  - Minimized -> Bubble    |   |
|   +--------------------------+ Minimize +---------------------------+   |
+-------------------------------------------------------------------------+
                                    |
             +----------------------+----------------------+
             |                                             |
+---------------------------+                +----------------------------+
|   HWND_BUBBLE (Native)    |                |    HWND_BROWSER (Native)   |
| - WS_EX_TOPMOST           |                | - WS_EX_TOPMOST            |
| - WS_EX_TOOLWINDOW        |                | - WS_EX_APPWINDOW          |
| - WS_EX_LAYERED           |                | - WS_EX_LAYERED            |
| - Acrylic Mica Backdrop   |                | - WebView2 Engine View     |
| - Non-focus stealing      |                | - Custom Hit Test Resizing |
+---------------------------+                +----------------------------+
             |                                             |
             +----------------------+----------------------+
                                    |
+-------------------------------------------------------------------------+
|                     Subsystem & Lifecycle Services                      |
|                                                                         |
|  - WindowsMonitorManager: Multi-monitor topology & Work Area clamping   |
|  - WindowsTrayManager: Win32 System Tray & Context Menu integration     |
|  - WindowsSingleInstanceManager: Mutex collision detection & handoff   |
|  - SettingsRepository: Local-first persistence for geometry & options   |
+-------------------------------------------------------------------------+
```

---

## 1. Desktop Floating Modes

### Mode A: Circle-First
1. **Initial State:** A small, circular frosted-glass bubble (`HWND_BUBBLE`, ~56x56 DIPs) floats always-on-top above all open desktop windows.
2. **Taskbar Hygiene:** Uses `WS_EX_TOOLWINDOW` so the bubble does not clutter the Windows Taskbar or Alt+Tab switcher.
3. **Activation:** Clicking the bubble expands and restores the floating browser window (`HWND_BROWSER`), smoothly transferring user attention without unexpected screen flash.
4. **Minimization:** Clicking minimize on the floating browser immediately hides the browser window and restores the circle in its last docked coordinate.

### Mode B: Browser-First
1. **Initial State:** The floating browser window (`HWND_BROWSER`) remains directly visible on the desktop as an always-on-top floating frame.
2. **Taskbar Presence:** Configured with `WS_EX_APPWINDOW` for convenient window discovery.
3. **Minimization:** Minimizing the browser docks the active session into the floating bubble on the screen edge.
4. **Restoration:** Clicking the floating bubble restores the browser window to its exact dimensions and position.

Both modes are persisted locally and configurable via the **Settings Modal**.

---

## 2. Configuration & Settings Matrix

All settings are stored in local-first storage (`LocalFirstStore` / `SettingsRepository`) with zero mandatory cloud accounts:

| Setting Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `desktopFloatingMode` | `'circle-first' \| 'browser-first'` | `'circle-first'` | Toggles between Mode A and Mode B desktop orchestration. |
| `startFloatingOnLaunch` | `boolean` | `true` | Automatically mounts floating overlay when `yayra` starts. |
| `alwaysOnTop` | `boolean` | `true` | Enforces `WS_EX_TOPMOST` / `HWND_TOPMOST` on all floating surfaces. |
| `rememberPosition` | `boolean` | `true` | Persists `(x, y)` desktop coordinates and active monitor index. |
| `rememberSize` | `boolean` | `true` | Persists `(width, height)` dimensions across sessions. |
| `minimizeToBubble` | `boolean` | `true` | Minimizing collapses into the floating circle rather than taskbar. |
| `closeToTray` | `boolean` | `true` | Closing the window hides to the Windows System Tray / Bubble. |
| `startWithWindows` | `boolean` | `false` | Registers `yayra` in Windows startup registry `Run` key (disabled by default). |

---

## 3. Native Win32 Window Functionality

### Always-On-Top & Focus Management
- Configured with `WS_EX_TOPMOST`.
- Z-order updates use `SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)`.
- Bubble interactions utilize `SWP_NOACTIVATE` to prevent stealing keyboard focus from fullscreen or foreground games/work applications.

### Borderless Dragging & Custom Hit Testing
- Draggable header regions respond to `WM_NCHITTEST` by returning `HTCAPTION`.
- 8-direction sizing borders evaluate proximity (8px threshold) to return:
  - `HTLEFT`, `HTRIGHT`, `HTTOP`, `HTBOTTOM`
  - `HTTOPLEFT`, `HTTOPRIGHT`, `HTBOTTOMLEFT`, `HTBOTTOMRIGHT`

### Magnetic Edge Snapping
- During movement or resizing, distance to monitor work area boundaries (`mi.rcWork`) is computed.
- If distance is within the 16px magnetic threshold, coordinates snap directly to:
  - Left: `rcWork.left`
  - Right: `rcWork.right - width`
  - Top: `rcWork.top`
  - Bottom: `rcWork.bottom - height`

### Multi-Monitor Topologies & Work Area Clamping
- Queries `MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)` and `GetMonitorInfoW`.
- Safely clamps `x`, `y`, `width`, and `height` to prevent windows from escaping into off-screen coordinate space or covering the Windows Taskbar.
- Supports virtual multi-monitor setups (e.g., Primary 1920x1080 at offset `x=0`, Secondary 2560x1440 at offset `x=1920`).

### Per-Monitor V2 DPI Scaling
- Responds to `WM_DPICHANGED` messages.
- Scales logical DIP coordinates using `GetDpiForWindow`:
  $$\text{pixels} = \text{round}\left(\text{dips} \times \frac{\text{dpi}}{96}\right)$$
  $$\text{dips} = \text{round}\left(\text{pixels} \div \frac{\text{dpi}}{96}\right)$$
- Supports standard scaling presets: 100% (96 DPI), 125% (120 DPI), 150% (144 DPI), 200% (192 DPI).

---

## 4. System Tray & Single-Instance Mutex

### Windows System Tray (`Shell_NotifyIconW`)
- Adds notification icon with tooltip: *"Yayra Floating Browser"*.
- Handles `WM_USER + 100`:
  - **Left Click:** Toggles browser/bubble visibility.
  - **Right Click:** Displays native context menu with options:
    - *Open Floating Browser*
    - *Always on Top* (Checked/Unchecked toggle)
    - *Switch to Browser-First / Circle-First*
    - *Settings...*
    - *Exit Yayra*
- Supports balloon notification dispatch (`NIF_INFO`).

### Single-Instance Mutex (`Local\YayraFloatingBrowserMutex`)
- Invokes `CreateMutexW(NULL, TRUE, L"Local\\YayraFloatingBrowserSingleInstanceMutex")`.
- If `GetLastError() == ERROR_ALREADY_EXISTS`, finds the active `HWND` via `FindWindowW` and posts `WM_YAYRA_SECOND_INSTANCE` to bring the primary window to the front.
- Gracefully terminates duplicate processes, preventing CPU and memory waste.

---

## 5. Keyboard Accessibility

| Shortcut | Scope | Action |
| :--- | :--- | :--- |
| `Escape` | Window Active | Minimizes the floating browser window back to bubble/tray. |
| `Alt + F` / `Ctrl + F` | Global / Local | Toggles floating browser visibility. |
| `Enter` / `Space` | Bubble Focused | Expands the bubble into the floating browser window. |
| `Alt + F4` | Browser Active | Executes `closeToTray` behavior (minimizes to bubble/tray). |

---

## 6. Verification & Automated Test Coverage

The test suite in `tests/windows-floating-modes.test.mjs` verifies:
- Mode A vs Mode B state machine and UI synchronization.
- All 8 settings persistence cycles through `SettingsRepository`.
- `WS_EX_TOPMOST`, `WS_EX_TOOLWINDOW`, and non-focus stealing flags.
- Multi-monitor boundary detection, coordinate offset math, and work area clamping.
- Per-Monitor DPI scaling transformations (96, 120, 144, 192 DPI).
- Magnetic edge snapping calculations against work areas.
- System tray notification lifecycle and context menu actions.
- Single-instance mutex collision detection and second-instance messaging.
- Keyboard navigation and shortcut processing.
- Session geometry restoration across application restarts.
