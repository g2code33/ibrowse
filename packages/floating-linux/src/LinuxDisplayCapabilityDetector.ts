/**
 * Yayra Floating Browser - Linux Display Server & Compositor Capability Detector
 * Evaluates X11, GNOME Wayland (Mutter), KDE Wayland (KWin), and wlroots Layer-Shell capabilities.
 * Gracefully reports limitations without falling back to full-screen.
 */

export type LinuxDisplayServer = 'x11' | 'wayland-gnome' | 'wayland-kde' | 'wayland-wlroots' | 'wayland-generic' | 'unknown';

export interface LinuxDisplayCapabilities {
  server: LinuxDisplayServer;
  isWayland: boolean;
  canGlobalPosition: boolean;       // Unrestricted absolute (x,y) positioning
  canKeepAbove: boolean;             // Always-on-top (_NET_WM_STATE_ABOVE / layer-shell / keep-above)
  canInteractiveMove: boolean;      // User titlebar drag via gtk_window_begin_move_drag
  canInteractiveResize: boolean;    // Resize via gtk_window_begin_resize_drag
  canEdgeSnap: boolean;             // Magnetic edge snapping against screen/work area
  supportsLayerShell: boolean;      // zwlr_layer_shell_v1 protocol available
  supportsAppIndicator: boolean;     // libayatana-appindicator3 / KStatusNotifierItem
  warningMessage?: string;          // Human-readable explanation if capabilities are restricted
}

export class LinuxDisplayCapabilityDetector {
  public static detect(env: Record<string, string | undefined> = process.env): LinuxDisplayCapabilities {
    const waylandDisplay = env.WAYLAND_DISPLAY;
    const xdgSessionType = env.XDG_SESSION_TYPE?.toLowerCase();
    const xdgCurrentDesktop = env.XDG_CURRENT_DESKTOP?.toLowerCase() || '';
    const gdkBackend = env.GDK_BACKEND?.toLowerCase();

    const isWayland = Boolean(waylandDisplay || xdgSessionType === 'wayland' || gdkBackend === 'wayland');

    if (!isWayland) {
      // Standard X11 Environment (Mutter/X11, KWin/X11, XFWM4, etc.)
      return {
        server: 'x11',
        isWayland: false,
        canGlobalPosition: true,
        canKeepAbove: true,
        canInteractiveMove: true,
        canInteractiveResize: true,
        canEdgeSnap: true,
        supportsLayerShell: false,
        supportsAppIndicator: true
      };
    }

    // Wayland Environment: determine compositor type
    if (xdgCurrentDesktop.includes('gnome') || xdgCurrentDesktop.includes('ubuntu')) {
      return {
        server: 'wayland-gnome',
        isWayland: true,
        canGlobalPosition: false, // Mutter does not expose unrestricted absolute client window placement
        canKeepAbove: true,        // Supported via gtk_window_set_keep_above
        canInteractiveMove: true,  // Interactive dragging is supported via xdg_toplevel.move
        canInteractiveResize: true,// Interactive resizing is supported via xdg_toplevel.resize
        canEdgeSnap: false,        // Client-side snapping is restricted without global coordinate knowledge
        supportsLayerShell: false, // Mutter does not implement wlr-layer-shell
        supportsAppIndicator: true, // Supported via Ubuntu AppIndicator extension
        warningMessage: 'On GNOME Wayland, absolute window placement is governed by Mutter compositor. Interactive dragging and window size restoration are fully operational.'
      };
    }

    if (xdgCurrentDesktop.includes('kde') || xdgCurrentDesktop.includes('plasma')) {
      return {
        server: 'wayland-kde',
        isWayland: true,
        canGlobalPosition: false,
        canKeepAbove: true,
        canInteractiveMove: true,
        canInteractiveResize: true,
        canEdgeSnap: false,
        supportsLayerShell: true,  // KWin 5.27+ supports layer-shell
        supportsAppIndicator: true,
        warningMessage: 'On KDE Wayland, windows float using standard xdg_toplevel with KWin keep-above.'
      };
    }

    if (xdgCurrentDesktop.includes('sway') || xdgCurrentDesktop.includes('wlroots') || xdgCurrentDesktop.includes('hyprland')) {
      return {
        server: 'wayland-wlroots',
        isWayland: true,
        canGlobalPosition: true,   // Supported via wlr-layer-shell anchor margins
        canKeepAbove: true,        // Supported via OVERLAY / TOP layer
        canInteractiveMove: true,
        canInteractiveResize: true,
        canEdgeSnap: true,
        supportsLayerShell: true,
        supportsAppIndicator: true
      };
    }

    // Generic Wayland fallback
    return {
      server: 'wayland-generic',
      isWayland: true,
      canGlobalPosition: false,
      canKeepAbove: true,
      canInteractiveMove: true,
      canInteractiveResize: true,
      canEdgeSnap: false,
      supportsLayerShell: false,
      supportsAppIndicator: true,
      warningMessage: 'Running under generic Wayland compositor. Interactive floating window operations are enabled.'
    };
  }
}
