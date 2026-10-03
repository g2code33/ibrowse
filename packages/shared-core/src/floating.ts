/**
 * Yayra Floating Browser - Floating Circle Controller
 * Manages floating bubble geometry, snap calculations, edge physics, and desktop mode orchestration.
 */

import { DesktopFloatingMode, FloatingCircleState, SnapSide } from './types.js';
import { EventBus } from './events.js';

export class FloatingCircleController {
  private state: FloatingCircleState;
  private mode: DesktopFloatingMode;
  private eventBus: EventBus;

  constructor(eventBus: EventBus, initialMode: DesktopFloatingMode = 'circle-first') {
    this.eventBus = eventBus;
    this.mode = initialMode;
    this.state = {
      x: 30,
      y: 120,
      radius: 28, // 56px diameter
      isVisible: true,
      isExpanded: false,
      isDragging: false,
      snapSide: 'left',
      badgeCount: 0,
      opacity: 0.92
    };
  }

  public getState(): Readonly<FloatingCircleState> {
    return { ...this.state };
  }

  public getPosition(): { x: number; y: number } {
    return { x: this.state.x, y: this.state.y };
  }

  public isExpanded(): boolean {
    return this.state.isExpanded;
  }

  public getMode(): DesktopFloatingMode {
    return this.mode;
  }

  public setMode(mode: DesktopFloatingMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.eventBus?.emit('floating:mode-changed', { mode });
  }

  public toggleExpand(): boolean {
    this.state.isExpanded = !this.state.isExpanded;
    this.eventBus?.emit('floating:circle-toggled', { isExpanded: this.state.isExpanded });
    return this.state.isExpanded;
  }

  public setExpanded(expanded: boolean): void {
    if (this.state.isExpanded === expanded) return;
    this.state.isExpanded = expanded;
    this.eventBus?.emit('floating:circle-toggled', { isExpanded: expanded });
  }

  public setPosition(x: number, y: number): void {
    this.state.x = x;
    this.state.y = y;
  }

  public snapToNearestEdge(screenWidth: number, screenHeight: number, margin = 16): SnapSide {
    const centerX = this.state.x + this.state.radius;
    const isCloserToLeft = centerX < screenWidth / 2;

    this.state.x = isCloserToLeft ? margin : screenWidth - (this.state.radius * 2) - margin;
    // Bound Y inside screen viewport
    this.state.y = Math.max(margin, Math.min(screenHeight - (this.state.radius * 2) - margin, this.state.y));
    this.state.snapSide = isCloserToLeft ? 'left' : 'right';

    return this.state.snapSide;
  }

  public setBadgeCount(count: number): void {
    this.state.badgeCount = Math.max(0, count);
  }

  public setVisibility(visible: boolean): void {
    this.state.isVisible = visible;
  }
}
