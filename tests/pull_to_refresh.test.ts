import { describe, it, expect } from 'vitest';
import {
  PULL_REFRESH_THRESHOLD_PX,
  PULL_MAX_PX,
  PULL_START_THRESHOLD_PX,
  dampPull,
  pullProgress,
  shouldRefresh,
  shouldBeginPull,
} from '../src/lib/ui/pullToRefresh';

describe('Cemetery list pull to refresh', () => {
  it('only begins a pull when the list is scrolled to the top and the finger moves down', () => {
    expect(shouldBeginPull({ scrollTop: 0, deltaY: PULL_START_THRESHOLD_PX })).toBe(true);
    expect(shouldBeginPull({ scrollTop: 0, deltaY: PULL_START_THRESHOLD_PX - 1 })).toBe(false);
    expect(shouldBeginPull({ scrollTop: 40, deltaY: 50 })).toBe(false);
    expect(shouldBeginPull({ scrollTop: 0, deltaY: -50 })).toBe(false);
  });

  it('damps the pull so it moves less than the finger and never passes the cap', () => {
    expect(dampPull(0)).toBe(0);
    expect(dampPull(-20)).toBe(0);
    expect(dampPull(100)).toBeLessThan(100);
    expect(dampPull(100)).toBeGreaterThan(0);
    expect(dampPull(300)).toBeGreaterThan(dampPull(100));
    expect(dampPull(10_000)).toBeLessThanOrEqual(PULL_MAX_PX);
  });

  it('reaches the refresh threshold with a realistic pull', () => {
    expect(dampPull(160)).toBeGreaterThanOrEqual(PULL_REFRESH_THRESHOLD_PX);
  });

  it('refreshes only when released at or past the threshold', () => {
    expect(shouldRefresh(PULL_REFRESH_THRESHOLD_PX)).toBe(true);
    expect(shouldRefresh(PULL_REFRESH_THRESHOLD_PX - 1)).toBe(false);
  });

  it('reports pull progress from 0 to 1', () => {
    expect(pullProgress(0)).toBe(0);
    expect(pullProgress(PULL_REFRESH_THRESHOLD_PX / 2)).toBeCloseTo(0.5);
    expect(pullProgress(PULL_REFRESH_THRESHOLD_PX * 3)).toBe(1);
  });
});
