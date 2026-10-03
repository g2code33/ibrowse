/**
 * Yayra Floating Browser - Linux AppIndicator & StatusNotifierItem Manager
 */

export class LinuxAppIndicatorManager {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.isVisible = false;
    this.iconName = 'yayra';
    this.title = 'Yayra Floating Browser';
    this.menuItems = [];
  }

  initIndicator(title = 'Yayra Floating Browser', iconName = 'yayra') {
    this.title = title;
    this.iconName = iconName;
    this.isVisible = true;
  }

  setIcon(iconName) {
    this.iconName = iconName;
  }

  getIcon() {
    return this.iconName;
  }

  setTitle(title) {
    this.title = title;
  }

  getTitle() {
    return this.title;
  }

  isIndicatorVisible() {
    return this.isVisible;
  }

  setMenu(items) {
    this.menuItems = items;
  }

  getMenu() {
    return [...this.menuItems];
  }

  triggerMenuAction(actionId) {
    const item = this.menuItems.find((m) => m.id === actionId);
    if (item && item.enabled) {
      item.action();
      this.eventBus.emit('tray:menu-action', { action: actionId });
    }
  }

  destroy() {
    this.isVisible = false;
    this.menuItems = [];
  }
}
