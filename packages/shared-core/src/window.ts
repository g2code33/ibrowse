/**
 * Yayra Floating Browser - Window State Manager
 * Explicit separation between native window geometry/state and browser content state.
 */

import { WindowGeometry, WindowState } from './types.js';
import { EventBus } from './events.js';

export class WindowStateManager {
  private state: WindowState;
  private eventBus: EventBus;

  constructor(eventBus: EventBus, initialGeometry?: Partial<WindowGeometry>) {
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

  public getState(): Readonly<WindowState> {
    return { ...this.state, geometry: { ...this.state.geometry } };
  }

  public setPosition(x: number, y: number): void {
    this.state.geometry.x = Math.max(0, x);
    this.state.geometry.y = Math.max(0, y);
    this.eventBus?.emit('window:moved', { x: this.state.geometry.x, y: this.state.geometry.y });
  }

  public setSize(width: number, height: number, minWidth = 320, minHeight = 240): void {
    this.state.geometry.width = Math.max(minWidth, width);
    this.state.geometry.height = Math.max(minHeight, height);
    this.eventBus?.emit('window:resized', { width: this.state.geometry.width, height: this.state.geometry.height });
  }

  public minimize(dockToCircle = true): void {
    this.state.isMinimized = true;
    this.state.isVisible = false;
    this.state.isDockedToCircle = dockToCircle;
    this.eventBus?.emit('window:minimized', { dockedToCircle: dockToCircle });
  }

  public restore(): void {
    this.state.isMinimized = false;
    this.state.isVisible = true;
    this.state.isDockedToCircle = false;
    this.eventBus?.emit('window:restored', { geometry: { ...this.state.geometry } });
  }

  public setAlwaysOnTop(alwaysOnTop: boolean): void {
    this.state.isAlwaysOnTop = alwaysOnTop;
  }

  public setOpacity(opacity: number): void {
    this.state.opacity = Math.max(0.1, Math.min(1.0, opacity));
  }
}
