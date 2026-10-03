/**
 * Yayra Floating Browser - Window State Manager
 */

export class WindowStateManager {
  constructor(eventBus, initialGeometry) {
    this.eventBus = eventBus;
    this.state = {
      geometry: {
        x: initialGeometry?.x ?? 100,
        y: initialGeometry?.y ?? 100,
        width: initialGeometry?.width ?? 800,
        height: initialGeometry?.height ?? 600
      },
      isVisible: true,
      isMinimized: false,
      isMaximized: false,
      isAlwaysOnTop: true,
      isDockedToCircle: false,
      opacity: 0.95,
      zIndex: 9999
    };
  }

  getState() {
    return { ...this.state, geometry: { ...this.state.geometry } };
  }

  setPosition(x, y) {
    this.state.geometry.x = Math.max(0, x);
    this.state.geometry.y = Math.max(0, y);
    this.eventBus?.emit('window:moved', { x: this.state.geometry.x, y: this.state.geometry.y });
  }

  setSize(width, height, minWidth = 320, minHeight = 240) {
    this.state.geometry.width = Math.max(minWidth, width);
    this.state.geometry.height = Math.max(minHeight, height);
    this.eventBus?.emit('window:resized', { width: this.state.geometry.width, height: this.state.geometry.height });
  }

  minimize(dockToCircle = true) {
    this.state.isMinimized = true;
    this.state.isVisible = false;
    this.state.isDockedToCircle = dockToCircle;
    this.eventBus?.emit('window:minimized', { dockedToCircle: dockToCircle });
  }

  restore() {
    this.state.isMinimized = false;
    this.state.isVisible = true;
    this.state.isDockedToCircle = false;
    this.eventBus?.emit('window:restored', { geometry: { ...this.state.geometry } });
  }

  setAlwaysOnTop(alwaysOnTop) {
    this.state.isAlwaysOnTop = alwaysOnTop;
  }

  setOpacity(opacity) {
    this.state.opacity = Math.max(0.1, Math.min(1.0, opacity));
  }
}
