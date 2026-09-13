import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ScreenWakeLockService } from '../src/lib/device/wakeLockService';

describe('Screen Wake Lock Service Unit Tests', () => {
  let service: ScreenWakeLockService;

  beforeEach(() => {
    service = new ScreenWakeLockService();
  });

  afterEach(async () => {
    await service.reset();
    vi.restoreAllMocks();
    // Clean up wakeLock on global navigator if defined
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      delete (navigator as any).wakeLock;
    }
  });

  it('handles environment without navigator.wakeLock gracefully', async () => {
    // In standard node test environment without wakeLock
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      delete (navigator as any).wakeLock;
    }

    expect(service.isSupported()).toBe(false);
    expect(service.isActive()).toBe(false);

    const result = await service.request();
    expect(result).toBe(false);
    expect(service.isActive()).toBe(false);
  });

  it('acquires and releases wake lock when navigator.wakeLock is supported', async () => {
    let released = false;
    const releaseListeners: Array<() => void> = [];

    const mockSentinel = {
      get released() {
        return released;
      },
      release: vi.fn(async () => {
        released = true;
        releaseListeners.forEach((fn) => fn());
      }),
      addEventListener: vi.fn((event: string, cb: () => void) => {
        if (event === 'release') {
          releaseListeners.push(cb);
        }
      }),
    };

    const mockRequest = vi.fn(async (type: string) => {
      if (type === 'screen') {
        released = false;
        return mockSentinel;
      }
      throw new Error('Unsupported type');
    });

    Object.defineProperty(globalThis.navigator, 'wakeLock', {
      value: { request: mockRequest },
      configurable: true,
      writable: true,
    });

    expect(service.isSupported()).toBe(true);
    expect(service.isActive()).toBe(false);

    let activeState = false;
    const unsubscribe = service.subscribe((isActive) => {
      activeState = isActive;
    });

    const acquired = await service.acquire();
    expect(acquired).toBe(true);
    expect(mockRequest).toHaveBeenCalledWith('screen');
    expect(service.isActive()).toBe(true);
    expect(activeState).toBe(true);

    // Now drop
    await service.drop();
    expect(mockSentinel.release).toHaveBeenCalled();
    expect(service.isActive()).toBe(false);
    expect(activeState).toBe(false);

    unsubscribe();
  });

  it('handles external OS release event (e.g. phone screen sleep / tab switch)', async () => {
    let released = false;
    const releaseListeners: Array<() => void> = [];

    const mockSentinel = {
      get released() {
        return released;
      },
      release: vi.fn(async () => {
        released = true;
      }),
      addEventListener: vi.fn((event: string, cb: () => void) => {
        if (event === 'release') releaseListeners.push(cb);
      }),
    };

    Object.defineProperty(globalThis.navigator, 'wakeLock', {
      value: {
        request: vi.fn(async () => mockSentinel),
      },
      configurable: true,
      writable: true,
    });

    await service.acquire();
    expect(service.isActive()).toBe(true);

    // Simulate the browser/OS firing 'release' on sentinel
    released = true;
    releaseListeners.forEach((cb) => cb());

    expect(service.isActive()).toBe(false);
  });

  it('manages reference counting across multiple active navigation/AR screens', async () => {
    let released = false;
    const mockSentinel = {
      get released() {
        return released;
      },
      release: vi.fn(async () => {
        released = true;
      }),
      addEventListener: vi.fn(),
    };

    Object.defineProperty(globalThis.navigator, 'wakeLock', {
      value: {
        request: vi.fn(async () => {
          released = false;
          return mockSentinel;
        }),
      },
      configurable: true,
      writable: true,
    });

    // Screen 1 (CemeteryMapScreen) acquires
    await service.acquire();
    expect(service.isActive()).toBe(true);

    // User opens Screen 2 (NavigationScreen)
    await service.acquire();
    expect(service.isActive()).toBe(true);

    // User closes CemeteryMapScreen
    await service.drop();
    // Lock must remain active because NavigationScreen is still retaining it!
    expect(service.isActive()).toBe(true);
    expect(mockSentinel.release).not.toHaveBeenCalled();

    // User leaves NavigationScreen
    await service.drop();
    // Now it should release
    expect(mockSentinel.release).toHaveBeenCalled();
    expect(service.isActive()).toBe(false);
  });
});
