/**
 * Yayra Floating Browser - Windows System Tray Manager
 * Wraps Win32 Shell_NotifyIconW operations, taskbar notifications,
 * and context menu interactions.
 */

import { EventBus } from '../../shared-core/src/events.js';

export interface TrayMenuItem {
  id: string;
  label: string;
  enabled: boolean;
  checked?: boolean;
  action: () => void | Promise<void>;
}

export interface TrayNotificationOptions {
  title: string;
  message: string;
  iconType?: 'info' | 'warning' | 'error' | 'none';
  timeoutMs?: number;
}

export class WindowsTrayManager {
  private eventBus: EventBus;
  private isVisible: boolean = false;
  private tooltip: string = 'Yayra Floating Browser';
  private menuItems: TrayMenuItem[] = [];
  private lastNotification: TrayNotificationOptions | null = null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  public initTray(tooltip = 'Yayra Floating Browser'): void {
    this.tooltip = tooltip;
    this.isVisible = true;
  }

  public setTooltip(tooltip: string): void {
    this.tooltip = tooltip;
  }

  public getTooltip(): string {
    return this.tooltip;
  }

  public isTrayVisible(): boolean {
    return this.isVisible;
  }

  public setContextMenu(items: TrayMenuItem[]): void {
    this.menuItems = items;
  }

  public getContextMenu(): TrayMenuItem[] {
    return [...this.menuItems];
  }

  public showNotification(options: TrayNotificationOptions): void {
    this.lastNotification = options;
  }

  public getLastNotification(): TrayNotificationOptions | null {
    return this.lastNotification;
  }

  public handleClick(button: 'left' | 'right' | 'double'): void {
    this.eventBus.emit('tray:clicked', { button });
  }

  public triggerMenuAction(actionId: string): void {
    const item = this.menuItems.find((m) => m.id === actionId);
    if (item && item.enabled) {
      item.action();
      this.eventBus.emit('tray:menu-action', { action: actionId });
    }
  }

  public destroy(): void {
    this.isVisible = false;
    this.menuItems = [];
    this.lastNotification = null;
  }
}
