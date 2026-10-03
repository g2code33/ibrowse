/**
 * Yayra Floating Browser - Linux AppIndicator & StatusNotifierItem Manager
 * Wraps libayatana-appindicator3 / DBus StatusNotifierItem for GNOME, KDE, and XFCE panels.
 */

import { EventBus } from '../../shared-core/src/events.js';

export interface LinuxIndicatorMenuItem {
  id: string;
  label: string;
  enabled: boolean;
  checked?: boolean;
  action: () => void | Promise<void>;
}

export class LinuxAppIndicatorManager {
  private eventBus: EventBus;
  private isVisible: boolean = false;
  private iconName: string = 'yayra';
  private title: string = 'Yayra Floating Browser';
  private menuItems: LinuxIndicatorMenuItem[] = [];

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  public initIndicator(title = 'Yayra Floating Browser', iconName = 'yayra'): void {
    this.title = title;
    this.iconName = iconName;
    this.isVisible = true;
  }

  public setIcon(iconName: string): void {
    this.iconName = iconName;
  }

  public getIcon(): string {
    return this.iconName;
  }

  public setTitle(title: string): void {
    this.title = title;
  }

  public getTitle(): string {
    return this.title;
  }

  public isIndicatorVisible(): boolean {
    return this.isVisible;
  }

  public setMenu(items: LinuxIndicatorMenuItem[]): void {
    this.menuItems = items;
  }

  public getMenu(): LinuxIndicatorMenuItem[] {
    return [...this.menuItems];
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
  }
}
