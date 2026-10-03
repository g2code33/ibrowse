/**
 * Yayra Floating Browser - Lifecycle Coordinator
 */

export class LifecycleCoordinator {
  constructor() {
    this.state = 'uninitialized';
    this.components = new Set();
  }

  register(component) {
    this.components.add(component);
    return () => {
      this.components.delete(component);
    };
  }

  async initialize() {
    if (this.state !== 'uninitialized') return;
    for (const comp of Array.from(this.components)) {
      if (typeof comp.onInitialize === 'function') await comp.onInitialize();
    }
    this.state = 'created';
  }

  async activate() {
    if (this.state === 'destroyed') throw new Error('Cannot activate destroyed lifecycle');
    for (const comp of Array.from(this.components)) {
      if (typeof comp.onResume === 'function') await comp.onResume();
    }
    this.state = 'active';
  }

  async suspend() {
    if (this.state !== 'active') return;
    for (const comp of Array.from(this.components)) {
      if (typeof comp.onSuspend === 'function') await comp.onSuspend();
    }
    this.state = 'suspended';
  }

  async destroy() {
    if (this.state === 'destroyed') return;
    for (const comp of Array.from(this.components)) {
      try {
        if (typeof comp.onDestroy === 'function') await comp.onDestroy();
      } catch (err) {
        console.error('[LifecycleCoordinator] Error during component destruction:', err);
      }
    }
    this.components.clear();
    this.state = 'destroyed';
  }

  getState() {
    return this.state;
  }
}
