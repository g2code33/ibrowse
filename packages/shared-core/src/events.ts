/**
 * Yayra Floating Browser - Event Bus
 * Decoupled, type-safe pub/sub event dispatcher.
 */

import { NavigationEventPayloads, NavigationEventType } from './types.js';

export type EventCallback<T> = (payload: T) => void;

export class EventBus {
  private listeners: Map<string, Set<EventCallback<any>>> = new Map();

  public on<K extends NavigationEventType>(
    event: K,
    callback: EventCallback<NavigationEventPayloads[K]>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(callback);

    return () => {
      set.delete(callback);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  public emit<K extends NavigationEventType>(
    event: K,
    payload: NavigationEventPayloads[K]
  ): void {
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

  public clear(): void {
    this.listeners.clear();
  }
}
