/**
 * Yayra Floating Browser - Event Bus
 */

export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event);
    set.add(callback);

    return () => {
      set.delete(callback);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  emit(event, payload) {
    const set = this.listeners.get(event);
    if (!set) return;

    for (const callback of Array.from(set)) {
      try {
        callback(payload);
      } catch (error) {
        console.error(`[EventBus] Error handling event ${event}:`, error);
      }
    }
  }

  clear() {
    this.listeners.clear();
  }
}
