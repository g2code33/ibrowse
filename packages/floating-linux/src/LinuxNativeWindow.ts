/**
 * Yayra Floating Browser - Linux Native GTK / X11 / Wayland Window Representation
 * Models an independent native GTK top-level GtkWidget with keep-above,
 * RGBA visual transparency, interactive move/resize grabs, and display capability awareness.
 */

import { WindowGeometry } from '../../shared-core/src/types.js';
import { LinuxMonitorManager } from './LinuxMonitorManager.js';
import { LinuxDisplayCapabilities, LinuxDisplayCapabilityDetector } from './LinuxDisplayCapabilityDetector.js';

export interface LinuxWindowStyleFlags {
  isTopmost: boolean;        // gtk_window_set_keep_above
  isDecorated: boolean;      // gtk_window_set_decorated
  skipTaskbar: boolean;      // gtk_window_set_skip_taskbar_hint
  isLayerSurface: boolean;   // gtk-layer-shell surface
  isAppPaintable: boolean;   // gtk_widget_set_app_paintable (RGBA transparency)
  isResizable: boolean;      // gtk_window_set_resizable
}

export class LinuxNativeWindow {
  private id: string;
  private title: string;
  private geometry: WindowGeometry;
  private styles: LinuxWindowStyleFlags;
  private isVisible: boolean = false;
  private isMinimized: boolean = false;
  private opacity: number = 1.0;
  private monitorManager: LinuxMonitorManager;
  private capabilities: LinuxDisplayCapabilities;

  constructor(
    id: string,
    title: string,
    initialGeometry: WindowGeometry,
    styles: Partial<LinuxWindowStyleFlags> = {},
    monitorManager?: LinuxMonitorManager,
    capabilities?: LinuxDisplayCapabilities
  ) {
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
  }

  public getId(): string {
    return this.id;
  }

  public getTitle(): string {
    return this.title;
  }

  public getGeometry(): WindowGeometry {
    return { ...this.geometry };
  }

  public getStyles(): LinuxWindowStyleFlags {
    return { ...this.styles };
  }

  public isWindowVisible(): boolean {
    return this.isVisible;
  }

  public isWindowMinimized(): boolean {
    return this.isMinimized;
  }

  public show(): void {
    this.isVisible = true;
    this.isMinimized = false;
  }

  public hide(): void {
    this.isVisible = false;
  }

  public minimize(): void {
    this.isMinimized = true;
    this.isVisible = false;
  }

  public restore(): void {
    this.isMinimized = false;
    this.isVisible = true;
  }

  public setAlwaysOnTop(keepAbove: boolean): void {
    this.styles.isTopmost = keepAbove;
  }

  public setPosition(x: number, y: number, clamp = true): void {
    this.geometry.x = x;
    this.geometry.y = y;
    if (clamp && this.capabilities.canGlobalPosition) {
      const clamped = this.monitorManager.clampToMonitorWorkArea(this.geometry, this.geometry.monitorIndex);
      this.geometry = clamped;
    }
  }

  public setSize(width: number, height: number, clamp = true, minWidth = 280, minHeight = 240): void {
    this.geometry.width = Math.max(minWidth, width);
    this.geometry.height = Math.max(minHeight, height);
    if (clamp && this.capabilities.canGlobalPosition) {
      const clamped = this.monitorManager.clampToMonitorWorkArea(this.geometry, this.geometry.monitorIndex, minWidth, minHeight);
      this.geometry = clamped;
    }
  }

  public snapToMonitorEdges(threshold = 16) {
    if (!this.capabilities.canEdgeSnap) {
      return { left: false, right: false, top: false, bottom: false };
    }
    const res = this.monitorManager.calculateEdgeSnap(this.geometry, threshold, this.geometry.monitorIndex);
    this.geometry = res.snappedGeometry;
    return res.snappedEdges;
  }

  public beginInteractiveMove(): boolean {
    // gtk_window_begin_move_drag is supported across both X11 and Wayland
    return this.capabilities.canInteractiveMove;
  }

  public beginInteractiveResize(edge: number = 0): boolean {
    // gtk_window_begin_resize_drag is supported across both X11 and Wayland
    return this.capabilities.canInteractiveResize;
  }
}
