# Yayra Linux Native Browser Engine (WebKitGTK)

## 1. Architectural Overview & Engine Evaluation

The Yayra Linux Native Browser Engine (`@yayra/browser-linux`) provides an isolated, leak-free, hardware-accelerated desktop browser runtime built directly on **WebKitGTK** for Debian-based 64-bit distributions (`x86_64` / `aarch64`).

```
┌────────────────────────────────────────────────────────────┐
│                  @yayra/browser-contract                   │
│         (IBrowserEngine, BrowserTab, UrlInterpreter)       │
└─────────────────────────────▲──────────────────────────────┘
                              │
┌─────────────────────────────┴──────────────────────────────┐
│                    LinuxWebKitEngine                       │
│     • Multiple Tab Coordination & History Stacks           │
│     • WebKitGTK Runtime Detection & Recovery Lifecycle     │
│     • Wayland / X11 Session Detection & Protocol Routing   │
│     • Hardened Security Invariants & Error Surface         │
└─────────────────────────────┬──────────────────────────────┘
                              │
┌─────────────────────────────▼──────────────────────────────┐
│                  Native Linux Components                   │
│  • yayra_webkit_runtime_detector (dlopen & pkg-config)     │
│  • yayra_webkit_view (Hardened GObject GtkBox container)   │
│  • WebKitWebView::load-failed-with-tls-errors (Strict TLS) │
│  • WebKitWebView::decide-policy (Scheme Allowlist & DL)    │
│  • WebKitWebView::permission-request (Native Dialog Gate)  │
└────────────────────────────────────────────────────────────┘
```

### Engine Selection: WebKitGTK 4.1 vs 6.0
Yayra targets **WebKitGTK 4.1** (GTK3 + libsoup-3.0) as the primary baseline with fallback detection for **WebKitGTK 6.0** (GTK4 + libsoup-3.0) and legacy 4.0:
* **WebKitGTK 4.1**: Provides the widest compatibility across Debian 11 (Bullseye), Debian 12 (Bookworm), Ubuntu 20.04/22.04 LTS, and Ubuntu 24.04 LTS without GTK4 transition ABI breakage.
* **Hardware Acceleration**: Configured with `WEBKIT_HARDWARE_ACCELERATION_POLICY_ALWAYS` leveraging Mesa DRI / VA-API / EGL.

### Integration Strategy & Compose Desktop Window Trade-offs
Direct in-process GTK widget embedding inside foreign UI toolkits (like Compose Desktop / Swing) without an isolated native surface introduces severe thread deadlocks and window airspace clipping because Glib/GTK and JVM/AWT maintain conflicting main loops.
1. **Native GTK Host Architecture (Implemented)**: The browser surface runs inside a native GTK3/GTK4 window container or dedicated native sub-process.
2. **Wayland Inter-Process Surface (`xdg_foreign`)**: Under Wayland, the native WebKitGTK surface pairs with the floating bubble host using `zxdg_exporter_v2` / `zxdg_importer_v2` protocols.
3. **X11 Subwindow / XComposite**: Under X11, standard window parenting and composite overlays manage positioning without airspace collisions.

---

## 2. Debian / Ubuntu Runtime Packages & Dependency Detection

### Required Runtime Dependencies
Yayra does **not** bundle system WebKit or GTK libraries indiscriminately; it relies on hardened, distribution-maintained packages to receive system security patches and hardware driver acceleration:

| Package Name | Minimum Version | Purpose |
| :--- | :--- | :--- |
| `libwebkit2gtk-4.1-0` | `>= 2.36.0` | Hardened WebKit engine and web process pool |
| `libgtk-3-0` | `>= 3.24.0` | GTK3 windowing and display abstraction |
| `libsoup-3.0-0` | `>= 3.0.0` | HTTP/2 and HTTP/3 networking backend |
| `libglib2.0-0` | `>= 2.64.0` | GObject type system and event loop |

*(Alternative GTK4/WebKit6 stack: `libwebkitgtk-6.0-4`, `libgtk-4-1`)*

### Runtime Probing & Recovery Guidance
`yayra_webkit_runtime_detector` probes system libraries via `dlopen`:
```c
YayraWebKitRuntimeInfo info = yayra_detect_webkit_runtime();
if (!info.is_available) {
    // Returns installation command:
    // "sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-0 libgtk-3-0 libsoup-3.0-0"
}
```

---

## 3. Security Invariants & Threat Mitigations

| Security Policy | Implementation | Threat Mitigation |
| :--- | :--- | :--- |
| **Strict TLS Certificate Verification** | `g_signal_connect(web_view, "load-failed-with-tls-errors", ...)` returns `TRUE`. | Stops page loading immediately upon invalid, self-signed, or expired certificates. Never allows TLS bypass. |
| **Dangerous Scheme Interception** | `decide-policy` (`WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION`) blocks `javascript:`, `data:`, `file:`, `vbscript:`. | Prevents top-level script injection, cross-site scripting (XSS), and privilege escalation. |
| **Filesystem Sandboxing** | `webkit_settings_set_enable_file_access_from_file_uris(FALSE)` & `webkit_settings_set_allow_file_access_from_file_urls(FALSE)`. | Restricts web documents from traversing `/etc`, `/home`, or system files. |
| **Explicit Permission Mediation** | `WebKitWebView::permission-request` intercepts camera, microphone, and geolocation requests. | Denies requests by default unless explicitly granted by the user via a native GTK dialog. |
| **Safe Download Routing** | `WebKitDownload` verifies destination directory, prevents path traversal, and stages files inside user `~/Downloads`. | Prevents drive-by downloads and unconfirmed filesystem writes. |
| **No Privileged JS Bridge** | Web views run with standard WebKit process isolation and no arbitrary root/shell execution bridges. | Protects the host Linux system from remote code execution. |

---

## 4. Multi-Tab & Session Management

- **Independent Tab Isolation**: Each `BrowserTab` retains an independent history stack, loading status, title, URL, and security state.
- **Private / Ephemeral Contexts**: Private tabs leverage `webkit_website_data_manager_new_ephemeral()` ensuring no cache, cookies, or IndexedDB storage persist to disk.
- **Session Serialization**: Full session state can be serialized (`exportSession()`) and restored (`restoreSession()`) locally without cloud synchronization.

---

## 5. Wayland vs. X11 Display Server Differences

| Feature | X11 Display Server | Wayland Compositor |
| :--- | :--- | :--- |
| **Window Positioning** | `gtk_window_move(x, y)` allows absolute desktop coordinates. | Security model forbids arbitrary client coordinate positioning. Uses `wlr-layer-shell` or compositor subsurfaces. |
| **Transparency & Glass** | RGBA visual support via `gdk_screen_get_rgba_visual()` with XComposite. | Native alpha channel buffer composition in Wayland surface buffers. |
| **Window Embedding** | `GtkPlug` / `GtkSocket` or X11 `XReparentWindow`. | `xdg_foreign` (`zxdg_exporter_v2` / `zxdg_importer_v2`) protocol handles cross-process embedding. |
| **Edge Snapping Physics** | Direct root window cursor polling via `gdk_device_get_position`. | Pointer surface motion events relative to active bubble window. |

---

## 6. Zero-Leak Disposal & Teardown

```c
void yayra_webkit_view_destroy_clean(YayraWebKitView *self) {
    if (!self) return;
    if (self->web_view) {
        webkit_web_view_stop_loading(self->web_view);
        // Disconnect all 8 signal handlers
        g_signal_handler_disconnect(self->web_view, self->title_sig);
        ...
        gtk_widget_destroy(GTK_WIDGET(self->web_view));
        self->web_view = NULL;
    }
    if (self->settings) g_object_unref(self->settings);
    if (self->web_context) g_object_unref(self->web_context);
}
```
All GObject signal handlers are explicitly disconnected and underlying WebKit process references are released upon tab closure.
