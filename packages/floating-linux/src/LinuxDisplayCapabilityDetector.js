/**
 * Yayra Floating Browser - Linux Display Server & Compositor Capability Detector
 */

export class LinuxDisplayCapabilityDetector {
  static detect(env = process.env) {
    const waylandDisplay = env.WAYLAND_DISPLAY;
    const xdgSessionType = env.XDG_SESSION_TYPE?.toLowerCase();
    const xdgCurrentDesktop = env.XDG_CURRENT_DESKTOP?.toLowerCase() || '';
    const gdkBackend = env.GDK_BACKEND?.toLowerCase();

    const isWayland = Boolean(waylandDisplay || xdgSessionType === 'wayland' || gdkBackend === 'wayland');

    if (!isWayland) {
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

    if (xdgCurrentDesktop.includes('gnome') || xdgCurrentDesktop.includes('ubuntu')) {
      return {
        server: 'wayland-gnome',
        isWayland: true,
        canGlobalPosition: false,
        canKeepAbove: true,
        canInteractiveMove: true,
        canInteractiveResize: true,
        canEdgeSnap: false,
        supportsLayerShell: false,
        supportsAppIndicator: true,
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
        supportsLayerShell: true,
        supportsAppIndicator: true,
        warningMessage: 'On KDE Wayland, windows float using standard xdg_toplevel with KWin keep-above.'
      };
    }

    if (xdgCurrentDesktop.includes('sway') || xdgCurrentDesktop.includes('wlroots') || xdgCurrentDesktop.includes('hyprland')) {
      return {
        server: 'wayland-wlroots',
        isWayland: true,
        canGlobalPosition: true,
        canKeepAbove: true,
        canInteractiveMove: true,
        canInteractiveResize: true,
        canEdgeSnap: true,
        supportsLayerShell: true,
        supportsAppIndicator: true
      };
    }

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
