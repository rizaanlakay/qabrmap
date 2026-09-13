/**
 * Screen Wake Lock Service
 * Keeps the mobile device display on while navigating in cemeteries or using AR guidance.
 * Implements the Screen Wake Lock API with automatic visibilitychange re-acquisition and graceful fallbacks.
 */

export class ScreenWakeLockService {
  private sentinel: any = null;
  private listeners: Set<(isActive: boolean) => void> = new Set();
  private enabled: boolean = false;
  private activeCount: number = 0;

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  isActive(): boolean {
    return !!this.sentinel && !this.sentinel.released;
  }

  subscribe(listener: (isActive: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.isActive());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const active = this.isActive();
    this.listeners.forEach((listener) => {
      try {
        listener(active);
      } catch (err) {
        console.error('WakeLock listener error:', err);
      }
    });
  }

  /**
   * Request a Screen Wake Lock sentinel.
   */
  async request(): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }

    if (this.isActive()) {
      return true;
    }

    try {
      const sentinel = await (navigator as any).wakeLock.request('screen');
      this.sentinel = sentinel;

      sentinel.addEventListener('release', () => {
        // If the OS released it (e.g. user pressed lock button or tab switched), clear reference
        if (this.sentinel === sentinel) {
          this.sentinel = null;
          this.notify();
        }
      });

      this.notify();
      return true;
    } catch (err) {
      console.warn('Screen Wake Lock request failed:', err);
      this.sentinel = null;
      this.notify();
      return false;
    }
  }

  /**
   * Release the Screen Wake Lock sentinel if currently held.
   */
  async release(): Promise<void> {
    if (this.sentinel && !this.sentinel.released) {
      try {
        await this.sentinel.release();
      } catch (err) {
        console.warn('Screen Wake Lock release failed:', err);
      }
    }
    this.sentinel = null;
    this.notify();
  }

  private handleVisibilityChange = (): void => {
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      this.enabled &&
      this.activeCount > 0
    ) {
      this.request();
    }
  };

  /**
   * Retain a wake lock (reference counted for multiple screens/components).
   */
  async acquire(): Promise<boolean> {
    this.activeCount++;
    this.enabled = true;

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    return this.request();
  }

  /**
   * Release reference to wake lock. Releases sentinel when reference count drops to 0.
   */
  async drop(): Promise<void> {
    this.activeCount = Math.max(0, this.activeCount - 1);
    if (this.activeCount === 0) {
      this.enabled = false;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      }
      await this.release();
    }
  }

  /**
   * Direct force reset (useful for testing or app teardown).
   */
  async reset(): Promise<void> {
    this.activeCount = 0;
    this.enabled = false;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    await this.release();
  }
}

// Global singleton instance
export const wakeLockService = new ScreenWakeLockService();
