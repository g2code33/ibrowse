/**
 * Yayra Floating Browser - Win32 Native Window Representation
 */

import { WindowsMonitorManager } from './WindowsMonitorManager.js';

export class WindowsNativeWindow {
  constructor(id, title, initialGeometry, styles = {}, monitorManager) {
    this.id = id;
    this.title = title;
    this.hwnd = `0x${Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(8, '0')}`;
    this.geometry = { ...initialGeometry };
    this.styles = {
      isTopmost: styles.isTopmost ?? true,
      isToolWindow: styles.isToolWindow ?? false,
      isAppWindow: styles.isAppWindow ?? true,
      isLayered: styles.isLayered ?? true,
      isBorderless: styles.isBorderless ?? true,
      noActivate: styles.noActivate ?? false
    };
    this.monitorManager = monitorManager || new WindowsMonitorManager();
    this.isVisible = false;
    this.isMinimized = false;
    this.opacity = 1.0;
  }

  getHwnd() {
    return this.hwnd;
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

  show(activate = true) {
    this.isVisible = true;
    this.isMinimized = false;
    this.styles.noActivate = !activate;
  }

  hide() {
    this.isVisible = false;
  }

  minimize() {
    this.isMinimized = true;
    this.isVisible = false;
  }

  restore(activate = true) {
    this.isMinimized = false;
    this.isVisible = true;
    this.styles.noActivate = !activate;
  }

  setAlwaysOnTop(topmost) {
    this.styles.isTopmost = topmost;
  }

  setPosition(x, y, clamp = true) {
    this.geometry.x = x;
    this.geometry.y = y;
    if (clamp) {
      const clamped = this.monitorManager.clampToMonitorWorkArea(this.geometry, this.geometry.monitorIndex);
      this.geometry = clamped;
    }
  }

  setSize(width, height, clamp = true, minWidth = 280, minHeight = 240) {
    this.geometry.width = Math.max(minWidth, width);
    this.geometry.height = Math.max(minHeight, height);
    if (clamp) {
      const clamped = this.monitorManager.clampToMonitorWorkArea(this.geometry, this.geometry.monitorIndex, minWidth, minHeight);
      this.geometry = clamped;
    }
  }

  setOpacity(opacity) {
    this.opacity = Math.max(0.1, Math.min(1.0, opacity));
  }

  getOpacity() {
    return this.opacity;
  }

  snapToMonitorEdges(threshold = 16) {
    const res = this.monitorManager.calculateEdgeSnap(this.geometry, threshold, this.geometry.monitorIndex);
    this.geometry = res.snappedGeometry;
    return res.snappedEdges;
  }

  handleDpiChange(newDpi, suggestedGeometry) {
    if (suggestedGeometry) {
      this.geometry = { ...suggestedGeometry };
    }
  }
}
