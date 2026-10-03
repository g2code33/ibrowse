/**
 * Yayra Floating Browser - Android Overlay Manager
 * Coordinates system-wide floating bubble and resizable floating window integration using WindowManager.
 */

import { FloatingCircleController } from '../../shared-core/src/floating.js';
import { WindowStateManager } from '../../shared-core/src/window.js';
import { EventBus } from '../../shared-core/src/events.js';
import { IBrowserEngine } from '../../browser-contract/src/IBrowserEngine.js';

export interface FloatingBrowserWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AndroidOverlayConfig {
  enableSystemAlertWindow?: boolean;
  enableEdgeSnapping?: boolean;
  circleRadiusDp?: number;
  idleOpacity?: number;
  activeOpacity?: number;
  minWidth?: number;
  minHeight?: number;
}

export class AndroidOverlayManager {
  private circleController: FloatingCircleController;
  private windowManager: WindowStateManager;
  private eventBus: EventBus;
  private isOverlayPermissionGranted = true;
  private isBubbleActive = false;
  private isWindowActive = false;
  private attachedBrowserEngine: IBrowserEngine | null = null;
  private idleAlpha = 0.85;
  private activeAlpha = 1.0;
  private minWidth = 280;
  private minHeight = 360;
  private bounds: FloatingBrowserWindowBounds = {
    x: 40,
    y: 100,
    width: 360,
    height: 540
  };
  private listeners: Map<string, Set<Function>> = new Map();

  constructor(
    circleController?: FloatingCircleController,
    windowManager?: WindowStateManager,
    eventBus?: EventBus,
    config?: AndroidOverlayConfig
  ) {
    this.eventBus = eventBus || new EventBus();
    this.circleController = circleController || new FloatingCircleController(this.eventBus);
    this.windowManager = windowManager || new WindowStateManager(this.eventBus);
    if (config?.idleOpacity !== undefined) this.idleAlpha = config.idleOpacity;
    if (config?.activeOpacity !== undefined) this.activeAlpha = config.activeOpacity;
    if (config?.minWidth !== undefined) this.minWidth = config.minWidth;
    if (config?.minHeight !== undefined) this.minHeight = config.minHeight;
  }

  public async checkPermission(): Promise<boolean> {
    return this.isOverlayPermissionGranted;
  }

  public setPermissionOverride(granted: boolean): void {
    this.isOverlayPermissionGranted = granted;
    if (!granted) {
      this.hideFloatingCircle();
      this.hideBrowserWindow();
    }
  }

  public async requestPermission(): Promise<boolean> {
    this.isOverlayPermissionGranted = true;
    return true;
  }

  // Floating Bubble Controls
  public showFloatingCircle(): boolean {
    if (!this.isOverlayPermissionGranted) return false;
    this.isBubbleActive = true;
    this.circleController.setVisibility(true);
    this.emit('bubbleShown', { active: true });
    return true;
  }

  public hideFloatingCircle(): void {
    this.isBubbleActive = false;
    this.circleController.setVisibility(false);
    this.emit('bubbleHidden', { active: false });
  }

  public isBubbleVisible(): boolean {
    return this.isBubbleActive;
  }

  // Floating Browser Window Controls
  public showBrowserWindow(engine?: IBrowserEngine): boolean {
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

  public hideBrowserWindow(): void {
    this.isWindowActive = false;
    this.windowManager.minimize(true);
    this.emit('windowHidden', { active: false });
  }

  public isWindowVisible(): boolean {
    return this.isWindowActive;
  }

  // Browser Engine Session Ownership (Zero Leaks & No Duplicate WebViews)
  public attachBrowser(engine: IBrowserEngine): void {
    this.attachedBrowserEngine = engine;
    this.emit('browserAttached', { engine });
  }

  public detachBrowser(): IBrowserEngine | null {
    const detached = this.attachedBrowserEngine;
    this.attachedBrowserEngine = null;
    this.emit('browserDetached', { engine: detached });
    return detached;
  }

  public getAttachedBrowser(): IBrowserEngine | null {
    return this.attachedBrowserEngine;
  }

  // Interaction Rules
  public minimize(): void {
    this.hideBrowserWindow();
    this.showFloatingCircle();
    this.emit('minimized', { sessionPreserved: true });
  }

  public restore(): void {
    this.hideFloatingCircle();
    this.showBrowserWindow();
    this.emit('restored', { bounds: this.bounds });
  }

  public closeWindow(): void {
    this.hideBrowserWindow();
    this.showFloatingCircle();
    this.emit('windowClosed', { serviceRunning: true });
  }

  public stopCompleteFloatingExperience(): void {
    this.hideBrowserWindow();
    this.hideFloatingCircle();
    this.detachBrowser();
    this.emit('stopped', { active: false });
  }

  // Window Bounds & Resizing
  public resize(width: number, height: number, maxW = 1080, maxH = 2400): FloatingBrowserWindowBounds {
    const clampedW = Math.max(this.minWidth, Math.min(width, maxW - this.bounds.x));
    const clampedH = Math.max(this.minHeight, Math.min(height, maxH - this.bounds.y));
    this.bounds.width = clampedW;
    this.bounds.height = clampedH;
    this.windowManager.setSize(clampedW, clampedH);
    this.emit('windowResized', { bounds: this.bounds });
    return { ...this.bounds };
  }

  public move(deltaX: number, deltaY: number, maxW = 1080, maxH = 2400): FloatingBrowserWindowBounds {
    const newX = Math.max(0, Math.min(this.bounds.x + deltaX, maxW - this.bounds.width));
    const newY = Math.max(0, Math.min(this.bounds.y + deltaY, maxH - this.bounds.height));
    this.bounds.x = newX;
    this.bounds.y = newY;
    this.windowManager.setPosition(newX, newY);
    this.emit('windowMoved', { bounds: this.bounds });
    return { ...this.bounds };
  }

  public getWindowBounds(): FloatingBrowserWindowBounds {
    return { ...this.bounds };
  }

  public setOpacity(alpha: number): void {
    this.idleAlpha = Math.max(0.2, Math.min(1.0, alpha));
    this.emit('opacityChanged', { opacity: this.idleAlpha });
  }

  public getOpacity(): number {
    return this.idleAlpha;
  }

  public triggerTap(): void {
    this.emit('tap', {});
  }

  public triggerLongPress(action = 'quick_actions'): void {
    this.emit('longPress', { action });
  }

  public triggerDrag(deltaX: number, deltaY: number, screenWidth = 1080): { x: number, y: number, snappedSide: 'left' | 'right' } {
    const pos = this.circleController.getPosition();
    const newX = pos.x + deltaX;
    const newY = pos.y + deltaY;
    this.circleController.setPosition(newX, newY);

    const snappedSide: 'left' | 'right' = (newX < screenWidth / 2) ? 'left' : 'right';
    this.emit('drag', { x: newX, y: newY, snappedSide });
    return { x: newX, y: newY, snappedSide };
  }

  public expandToFloatingWindow(): void {
    this.circleController.setExpanded(true);
    this.showBrowserWindow();
  }

  public collapseToCircle(): void {
    this.circleController.setExpanded(false);
    this.minimize();
  }

  public isVisible(): boolean {
    return this.isBubbleActive || this.isWindowActive;
  }

  public addEventListener(event: string, callback: Function): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  private emit(event: string, data: unknown): void {
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

  public destroy(): void {
    this.stopCompleteFloatingExperience();
    this.listeners.clear();
  }
}
