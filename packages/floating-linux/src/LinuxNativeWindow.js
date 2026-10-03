/**
 * Yayra Floating Browser - Linux Native GTK / X11 / Wayland Window Representation
 */

import { LinuxMonitorManager } from './LinuxMonitorManager.js';
import { LinuxDisplayCapabilityDetector } from './LinuxDisplayCapabilityDetector.js';

export class LinuxNativeWindow {
  constructor(id, title, initialGeometry, styles = {}, monitorManager, capabilities) {
    this.id = id;
    this.title = title;
    this.geometry = { ...initialGeometry };
    this.capabilities = capabilities || LinuxDisplayCapabilityDetector.detect();
    this.styles = {
      isTopmost: styles.isTopmost ?? true,
      isDecorated: styles.isDecorated ?? false,
      skipTaskbar: styles.skipTaskbar ?? false,
      isLayerSurface: styles.isLayerSurface ?? this.capabilities.supportsLayerShell,
      isAppPaintable: styles.isAppPaintable ?? true,
      isResizable: styles.isResizable ?? true
    };
    this.monitorManager = monitorManager || new LinuxMonitorManager();
    this.isVisible = false;
    this.isMinimized = false;
    this.opacity = 1.0;
  }

  getId() {
    return this.id;
  }

  getTitle() {
    return this.title;
  }

  getGeometry() {
    return { ...this.geometry };
  }

  getStyles() {
    return { ...this.styles };
  }

  isWindowVisible() {
    return this.isVisible;
  }

  isWindowMinimized() {
    return this.isMinimized;
  }

  show() {
    this.isVisible = true;
    this.isMinimized = false;
  }

  hide() {
    this.isVisible = false;
  }

  minimize() {
    this.isMinimized = true;
    this.isVisible = false;
  }

  restore() {
    this.isMinimized = false;
    this.isVisible = true;
  }

  setAlwaysOnTop(keepAbove) {
    this.styles.isTopmost = keepAbove;
  }

  setPosition(x, y, clamp = true) {
    this.geometry.x = x;
    this.geometry.y = y;
    if (clamp && this.capabilities.canGlobalPosition) {
      const clamped = this.monitorManager.clampToMonitorWorkArea(this.geometry, this.geometry.monitorIndex);
      this.geometry = clamped;
    }
  }

  setSize(width, height, clamp = true, minWidth = 280, minHeight = 240) {
    this.geometry.width = Math.max(minWidth, width);
    this.geometry.height = Math.max(minHeight, height);
    if (clamp && this.capabilities.canGlobalPosition) {
      const clamped = this.monitorManager.clampToMonitorWorkArea(this.geometry, this.geometry.monitorIndex, minWidth, minHeight);
      this.geometry = clamped;
    }
  }

  snapToMonitorEdges(threshold = 16) {
    if (!this.capabilities.canEdgeSnap) {
      return { left: false, right: false, top: false, bottom: false };
    }
    const res = this.monitorManager.calculateEdgeSnap(this.geometry, threshold, this.geometry.monitorIndex);
    this.geometry = res.snappedGeometry;
    return res.snappedEdges;
  }

  beginInteractiveMove() {
    return this.capabilities.canInteractiveMove;
  }

  beginInteractiveResize(edge = 0) {
    return this.capabilities.canInteractiveResize;
  }
}
