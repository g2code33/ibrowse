/**
 * Yayra Floating Browser - Lifecycle Coordinator
 * Explicit lifecycle ownership to prevent dangling native overlay hooks, memory leaks, and background battery drain.
 */

export type LifecycleState = 'uninitialized' | 'created' | 'active' | 'suspended' | 'destroyed';

export interface ILifecycleAware {
  onInitialize(): Promise<void>;
  onResume(): Promise<void>;
  onSuspend(): Promise<void>;
  onDestroy(): Promise<void>;
}

export class LifecycleCoordinator {
  private state: LifecycleState = 'uninitialized';
  private components: Set<ILifecycleAware> = new Set();

  public register(component: ILifecycleAware): () => void {
    this.components.add(component);
    return () => {
      this.components.delete(component);
    };
  }

  public async initialize(): Promise<void> {
    if (this.state !== 'uninitialized') return;
    for (const comp of Array.from(this.components)) {
      await comp.onInitialize();
    }
    this.state = 'created';
  }

  public async activate(): Promise<void> {
    if (this.state === 'destroyed') throw new Error('Cannot activate destroyed lifecycle');
    for (const comp of Array.from(this.components)) {
      await comp.onResume();
    }
    this.state = 'active';
  }

  public async suspend(): Promise<void> {
    if (this.state !== 'active') return;
    for (const comp of Array.from(this.components)) {
      await comp.onSuspend();
    }
    this.state = 'suspended';
  }

  public async destroy(): Promise<void> {
    if (this.state === 'destroyed') return;
    for (const comp of Array.from(this.components)) {
      try {
        await comp.onDestroy();
      } catch (err) {
        console.error('[LifecycleCoordinator] Error during component destruction:', err);
      }
    }
    this.components.clear();
    this.state = 'destroyed';
  }

  public getState(): LifecycleState {
    return this.state;
  }
}
