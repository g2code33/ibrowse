/**
 * Yayra Floating Browser - Android Overlay Manager (ESM)
 */

import { FloatingCircleController } from '../../shared-core/src/floating.js';
import { WindowStateManager } from '../../shared-core/src/window.js';
import { EventBus } from '../../shared-core/src/events.js';

export class AndroidOverlayManager {
  constructor(circleController, windowManager, eventBus, config) {
    this.circleController = circleController || new FloatingCircleController();
    this.windowManager = windowManager || new WindowStateManager();
    this.eventBus = eventBus || new EventBus();
    this.isOverlayPermissionGranted = true;
    this.isBubbleActive = false;
    this.isWindowActive = false;
    this.attachedBrowserEngine = null;
    this.idleAlpha = config?.idleOpacity !== undefined ? config.idleOpacity : 0.85;
    this.activeAlpha = config?.activeOpacity !== undefined ? config.activeOpacity : 1.0;
    this.minWidth = config?.minWidth !== undefined ? config.minWidth : 280;
    this.minHeight = config?.minHeight !== undefined ? config.minHeight : 360;
    this.bounds = {
      x: 40,
      y: 100,
      width: 360,
      height: 540
    };
    this.listeners = new Map();
  }

  async checkPermission() {
    return this.isOverlayPermissionGranted;
  }

  setPermissionOverride(granted) {
    this.isOverlayPermissionGranted = granted;
    if (!granted) {
      this.hideFloatingCircle();
      this.hideBrowserWindow();
    }
  }

  async requestPermission() {
    this.isOverlayPermissionGranted = true;
    return true;
  }

  showFloatingCircle() {
    if (!this.isOverlayPermissionGranted) return false;
    this.isBubbleActive = true;
    this.circleController.setVisibility(true);
    this.emit('bubbleShown', { active: true });
    return true;
  }

  hideFloatingCircle() {
    this.isBubbleActive = false;
    this.circleController.setVisibility(false);
    this.emit('bubbleHidden', { active: false });
  }

  isBubbleVisible() {
    return this.isBubbleActive;
  }

  showBrowserWindow(engine) {
    if (!this.isOverlayPermissionGranted) return false;
    this.hideFloatingCircle();
    this.isWindowActive = true;
    if (engine) {
      this.attachBrowser(engine);
    }
    this.windowManager.restore();
    this.emit('windowShown', { bounds: this.bounds, engine: this.attachedBrowserEngine });
    return true;
  }

  hideBrowserWindow() {
    this.isWindowActive = false;
    this.windowManager.minimize(true);
    this.emit('windowHidden', { active: false });
  }

  isWindowVisible() {
    return this.isWindowActive;
  }

  attachBrowser(engine) {
    this.attachedBrowserEngine = engine;
    this.emit('browserAttached', { engine });
  }

  detachBrowser() {
    const detached = this.attachedBrowserEngine;
    this.attachedBrowserEngine = null;
    this.emit('browserDetached', { engine: detached });
    return detached;
  }

  getAttachedBrowser() {
    return this.attachedBrowserEngine;
  }

  minimize() {
    this.hideBrowserWindow();
    this.showFloatingCircle();
    this.emit('minimized', { sessionPreserved: true });
  }

  restore() {
    this.hideFloatingCircle();
    this.showBrowserWindow();
    this.emit('restored', { bounds: this.bounds });
  }

  closeWindow() {
    this.hideBrowserWindow();
    this.showFloatingCircle();
    this.emit('windowClosed', { serviceRunning: true });
  }

  stopCompleteFloatingExperience() {
    this.hideBrowserWindow();
    this.hideFloatingCircle();
    this.detachBrowser();
    this.emit('stopped', { active: false });
  }

  resize(width, height, maxW = 1080, maxH = 2400) {
    const clampedW = Math.max(this.minWidth, Math.min(width, maxW - this.bounds.x));
    const clampedH = Math.max(this.minHeight, Math.min(height, maxH - this.bounds.y));
    this.bounds.width = clampedW;
    this.bounds.height = clampedH;
    this.windowManager.setSize(clampedW, clampedH);
    this.emit('windowResized', { bounds: this.bounds });
    return { ...this.bounds };
  }

  move(deltaX, deltaY, maxW = 1080, maxH = 2400) {
    const newX = Math.max(0, Math.min(this.bounds.x + deltaX, maxW - this.bounds.width));
    const newY = Math.max(0, Math.min(this.bounds.y + deltaY, maxH - this.bounds.height));
    this.bounds.x = newX;
    this.bounds.y = newY;
    this.windowManager.setPosition(newX, newY);
    this.emit('windowMoved', { bounds: this.bounds });
    return { ...this.bounds };
  }

  getWindowBounds() {
    return { ...this.bounds };
  }

  setOpacity(alpha) {
    this.idleAlpha = Math.max(0.2, Math.min(1.0, alpha));
    this.emit('opacityChanged', { opacity: this.idleAlpha });
  }

  getOpacity() {
    return this.idleAlpha;
  }

  triggerTap() {
    this.emit('tap', {});
  }

  triggerLongPress(action = 'quick_actions') {
    this.emit('longPress', { action });
  }

  triggerDrag(deltaX, deltaY, screenWidth = 1080) {
    const pos = this.circleController.getPosition();
    const newX = pos.x + deltaX;
    const newY = pos.y + deltaY;
    this.circleController.setPosition(newX, newY);

    const snappedSide = (newX < screenWidth / 2) ? 'left' : 'right';
    this.emit('drag', { x: newX, y: newY, snappedSide });
    return { x: newX, y: newY, snappedSide };
  }

  expandToFloatingWindow() {
    this.circleController.setExpanded(true);
    this.showBrowserWindow();
  }

  collapseToCircle() {
    this.circleController.setExpanded(false);
    this.minimize();
  }

  isVisible() {
    return this.isBubbleActive || this.isWindowActive;
  }

  on(event, callback) {
    return this.addEventListener(event, callback);
  }

  addEventListener(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  emit(event, data) {
    const set = this.listeners.get(event);
    if (set) {
      for (const cb of set) {
        try {
          cb(data);
        } catch (e) {
          console.error(e);
        }
      }
    }
  }

  destroy() {
    this.stopCompleteFloatingExperience();
    this.listeners.clear();
  }
}
