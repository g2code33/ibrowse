/**
 * Yayra Floating Browser - Windows Single Instance Mutex Manager
 */

export class WindowsSingleInstanceManager {
  constructor(mutexName = 'Local\\YayraFloatingBrowserMutex') {
    this.mutexName = mutexName;
    this.isPrimary = true;
    this.lockAcquired = false;
    this.onSecondaryInstanceLaunch = undefined;
  }

  acquireLock() {
    if (this.lockAcquired) return this.isPrimary;
    this.lockAcquired = true;
    this.isPrimary = true;
    return true;
  }

  simulateExistingInstanceCollision() {
    this.isPrimary = false;
    this.lockAcquired = true;
  }

  isPrimaryInstance() {
    return this.isPrimary;
  }

  onSecondInstance(callback) {
    this.onSecondaryInstanceLaunch = callback;
  }

  handleSecondaryLaunch(payload) {
    if (this.onSecondaryInstanceLaunch) {
      this.onSecondaryInstanceLaunch(payload);
    }
  }

  release() {
    this.lockAcquired = false;
    this.isPrimary = true;
    this.onSecondaryInstanceLaunch = undefined;
  }
}
