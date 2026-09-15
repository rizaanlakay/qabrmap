import { describe, it, expect, vi } from 'vitest';
import { createCompassPermission, readCompassHeading } from '../src/lib/device/compass';

describe('Compass Heading Tests', () => {
  it('uses the iOS compass heading, including due north', () => {
    expect(readCompassHeading({ webkitCompassHeading: 90, alpha: 10 }, 'relative')).toBe(90);
    expect(readCompassHeading({ webkitCompassHeading: 0 }, 'relative')).toBe(0);
    expect(readCompassHeading({ webkitCompassHeading: 359.6 }, 'relative')).toBe(0);
  });

  it('converts alpha from an absolute orientation event to a clockwise heading', () => {
    expect(readCompassHeading({ alpha: 90 }, 'absolute')).toBe(270);
    expect(readCompassHeading({ alpha: 0 }, 'absolute')).toBe(0);
    expect(readCompassHeading({ alpha: 270.4 }, 'absolute')).toBe(90);
  });

  it('ignores alpha from a relative event, which is not measured from north', () => {
    expect(readCompassHeading({ alpha: 90 }, 'relative')).toBeNull();
  });

  it('returns null when there is no usable reading', () => {
    expect(readCompassHeading({ alpha: null }, 'absolute')).toBeNull();
    expect(readCompassHeading({}, 'absolute')).toBeNull();
    expect(readCompassHeading({ webkitCompassHeading: Number.NaN }, 'relative')).toBeNull();
  });
});

describe('Compass Permission Tests', () => {
  it('needs no permission where the browser never asks (Android, desktop)', async () => {
    const permission = createCompassPermission(() => null);
    expect(permission.get()).toBe('not-required');
    await expect(permission.request()).resolves.toBe('not-required');
  });

  it('asks once on iOS and remembers the answer', async () => {
    const requester = vi.fn(async () => 'granted' as const);
    const permission = createCompassPermission(() => requester);
    const listener = vi.fn();
    permission.subscribe(listener);

    expect(permission.get()).toBe('unknown');
    await expect(permission.request()).resolves.toBe('granted');
    expect(permission.get()).toBe('granted');
    expect(listener).toHaveBeenCalledWith('granted');

    await expect(permission.request()).resolves.toBe('granted');
    expect(requester).toHaveBeenCalledTimes(1);
  });

  it('remembers a refusal instead of asking again', async () => {
    const requester = vi.fn(async () => 'denied' as const);
    const permission = createCompassPermission(() => requester);
    await expect(permission.request()).resolves.toBe('denied');
    await expect(permission.request()).resolves.toBe('denied');
    expect(requester).toHaveBeenCalledTimes(1);
  });

  it('asks again on the next tap when iOS refused to prompt without one', async () => {
    const requester = vi
      .fn<() => Promise<'granted' | 'denied'>>()
      .mockRejectedValueOnce(new DOMException('Requesting device orientation access requires a user gesture', 'NotAllowedError'))
      .mockResolvedValueOnce('granted');
    const permission = createCompassPermission(() => requester);

    await expect(permission.request()).resolves.toBe('unknown');
    expect(permission.get()).toBe('unknown');
    await expect(permission.request()).resolves.toBe('granted');
    expect(requester).toHaveBeenCalledTimes(2);
  });

  it('shows one prompt when several taps ask at once', async () => {
    const requester = vi.fn(async () => 'granted' as const);
    const permission = createCompassPermission(() => requester);
    await Promise.all([permission.request(), permission.request()]);
    expect(requester).toHaveBeenCalledTimes(1);
  });
});
