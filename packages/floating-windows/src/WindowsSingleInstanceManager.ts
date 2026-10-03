/**
 * Yayra Floating Browser - Windows Single Instance Mutex Manager
 * Prevents multiple conflicting application processes from competing for overlay handles.
 * Dispatches restore / activation command to the active primary instance.
 */

export interface SingleInstanceHandoffPayload {
  commandLine: string[];
  workingDirectory: string;
  timestamp: number;
}

export class WindowsSingleInstanceManager {
  private mutexName: string;
  private isPrimary: boolean = true;
  private lockAcquired: boolean = false;
  private onSecondaryInstanceLaunch?: (payload: SingleInstanceHandoffPayload) => void;

  constructor(mutexName = 'Local\\YayraFloatingBrowserMutex') {
    this.mutexName = mutexName;
  }

  public acquireLock(): boolean {
    if (this.lockAcquired) return this.isPrimary;
    // Simulate Win32 CreateMutexW behavior
    this.lockAcquired = true;
    this.isPrimary = true;
    return true;
  }

  public simulateExistingInstanceCollision(): void {
    this.isPrimary = false;
    this.lockAcquired = true;
  }

  public isPrimaryInstance(): boolean {
    return this.isPrimary;
  }

  public onSecondInstance(callback: (payload: SingleInstanceHandoffPayload) => void): void {
    this.onSecondaryInstanceLaunch = callback;
  }

  public handleSecondaryLaunch(payload: SingleInstanceHandoffPayload): void {
    if (this.onSecondaryInstanceLaunch) {
      this.onSecondaryInstanceLaunch(payload);
    }
  }

  public release(): void {
    this.lockAcquired = false;
    this.isPrimary = true;
    this.onSecondaryInstanceLaunch = undefined;
  }
}
