/**
 * Yayra Floating Browser - Windows System Tray Manager
 */

export class WindowsTrayManager {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.isVisible = false;
    this.tooltip = 'Yayra Floating Browser';
    this.menuItems = [];
    this.lastNotification = null;
  }

  initTray(tooltip = 'Yayra Floating Browser') {
    this.tooltip = tooltip;
    this.isVisible = true;
  }

  setTooltip(tooltip) {
    this.tooltip = tooltip;
  }

  getTooltip() {
    return this.tooltip;
  }

  isTrayVisible() {
    return this.isVisible;
  }

  setContextMenu(items) {
    this.menuItems = items;
  }

  getContextMenu() {
    return [...this.menuItems];
  }

  showNotification(options) {
    this.lastNotification = options;
  }

  getLastNotification() {
    return this.lastNotification;
  }

  handleClick(button) {
    this.eventBus.emit('tray:clicked', { button });
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
    this.lastNotification = null;
  }
}
