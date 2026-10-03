/**
 * Yayra Floating Browser - Floating Circle Controller
 */

export class FloatingCircleController {
  constructor(eventBus, initialMode = 'circle-first') {
    this.eventBus = eventBus;
    this.mode = initialMode;
    this.state = {
      x: 30,
      y: 120,
      radius: 28,
      isVisible: true,
      isExpanded: false,
      isDragging: false,
      snapSide: 'left',
      badgeCount: 0,
      opacity: 0.92
    };
  }

  getState() {
    return { ...this.state };
  }

  getPosition() {
    return { x: this.state.x, y: this.state.y };
  }

  isExpanded() {
    return this.state.isExpanded;
  }

  getMode() {
    return this.mode;
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.eventBus?.emit('floating:mode-changed', { mode });
  }

  toggleExpand() {
    this.state.isExpanded = !this.state.isExpanded;
    this.eventBus?.emit('floating:circle-toggled', { isExpanded: this.state.isExpanded });
    return this.state.isExpanded;
  }

  setExpanded(expanded) {
    if (this.state.isExpanded === expanded) return;
    this.state.isExpanded = expanded;
    this.eventBus?.emit('floating:circle-toggled', { isExpanded: expanded });
  }

  setPosition(x, y) {
    this.state.x = x;
    this.state.y = y;
  }

  snapToNearestEdge(screenWidth, screenHeight, margin = 16) {
    const centerX = this.state.x + this.state.radius;
    const isCloserToLeft = centerX < screenWidth / 2;

    this.state.x = isCloserToLeft ? margin : screenWidth - (this.state.radius * 2) - margin;
    this.state.y = Math.max(margin, Math.min(screenHeight - (this.state.radius * 2) - margin, this.state.y));
    this.state.snapSide = isCloserToLeft ? 'left' : 'right';

    return this.state.snapSide;
  }

  setBadgeCount(count) {
    this.state.badgeCount = Math.max(0, count);
  }

  setVisibility(visible) {
    this.state.isVisible = visible;
  }
}
