/**
 * Yayra Floating Browser - Win32 Native Window Representation
 * Models an independent native HWND instance with extended window styles,
 * DWM backdrop flags, DPI scaling, and non-focus stealing activation.
 */

import { WindowGeometry } from '../../shared-core/src/types.js';
import { WindowsMonitorManager } from './WindowsMonitorManager.js';

export type WindowStyleFlags = {
  isTopmost: boolean;       // WS_EX_TOPMOST
  isToolWindow: boolean;    // WS_EX_TOOLWINDOW (hidden from taskbar/Alt-Tab)
  isAppWindow: boolean;     // WS_EX_APPWINDOW
  isLayered: boolean;       // WS_EX_LAYERED (Acrylic/Mica transparency)
  isBorderless: boolean;    // WS_POPUP
  noActivate: boolean;      // WS_EX_NOACTIVATE / SWP_NOACTIVATE
};

export class WindowsNativeWindow {
  private id: string;
  private hwnd: string;
  private title: string;
  private geometry: WindowGeometry;
  private styles: WindowStyleFlags;
  private isVisible: boolean = false;
  private isMinimized: boolean = false;
  private opacity: number = 1.0;
  private monitorManager: WindowsMonitorManager;

  constructor(
    id: string,
    title: string,
    initialGeometry: WindowGeometry,
    styles: Partial<WindowStyleFlags> = {},
    monitorManager?: WindowsMonitorManager
  ) {
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
  }

  public getHwnd(): string {
    return this.hwnd;
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

  public getStyles(): WindowStyleFlags {
    return { ...this.styles };
  }

  public isWindowVisible(): boolean {
    return this.isVisible;
  }

  public isWindowMinimized(): boolean {
    return this.isMinimized;
  }

  public show(activate = true): void {
    this.isVisible = true;
    this.isMinimized = false;
    this.styles.noActivate = !activate;
  }

  public hide(): void {
    this.isVisible = false;
  }

  public minimize(): void {
    this.isMinimized = true;
    this.isVisible = false;
  }

  public restore(activate = true): void {
    this.isMinimized = false;
    this.isVisible = true;
    this.styles.noActivate = !activate;
  }

  public setAlwaysOnTop(topmost: boolean): void {
    this.styles.isTopmost = topmost;
  }

  public setPosition(x: number, y: number, clamp = true): void {
    this.geometry.x = x;
    this.geometry.y = y;
    if (clamp) {
      const clamped = this.monitorManager.clampToMonitorWorkArea(this.geometry, this.geometry.monitorIndex);
      this.geometry = clamped;
    }
  }

  public setSize(width: number, height: number, clamp = true, minWidth = 280, minHeight = 240): void {
    this.geometry.width = Math.max(minWidth, width);
    this.geometry.height = Math.max(minHeight, height);
    if (clamp) {
      const clamped = this.monitorManager.clampToMonitorWorkArea(this.geometry, this.geometry.monitorIndex, minWidth, minHeight);
      this.geometry = clamped;
    }
  }

  public setOpacity(opacity: number): void {
    this.opacity = Math.max(0.1, Math.min(1.0, opacity));
  }

  public getOpacity(): number {
    return this.opacity;
  }

  public snapToMonitorEdges(threshold = 16) {
    const res = this.monitorManager.calculateEdgeSnap(this.geometry, threshold, this.geometry.monitorIndex);
    this.geometry = res.snappedGeometry;
    return res.snappedEdges;
  }

  public handleDpiChange(newDpi: number, suggestedGeometry?: WindowGeometry): void {
    if (suggestedGeometry) {
      this.geometry = { ...suggestedGeometry };
    }
  }
}
