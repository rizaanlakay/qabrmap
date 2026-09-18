// tests/vision_reference_levels.test.ts
import { describe, it, expect } from 'vitest';
import { referenceSizes } from '../src/lib/ar/vision/referenceLevels';
import { VISION_CONFIG } from '../src/lib/ar/vision/config';

describe('Vision Reference Levels Tests', () => {
  it('shrinks a large photo to the base size and makes every smaller copy', () => {
    const sizes = referenceSizes(3000, 4000, VISION_CONFIG);
    expect(sizes.width).toBe(600);
    expect(sizes.height).toBe(800);
    expect(sizes.levels.map((l) => [l.s, l.width, l.height])).toEqual([
      [1, 600, 800],
      [0.6, 360, 480],
      [0.35, 210, 280],
      [0.2, 120, 160],
    ]);
  });

  it('never enlarges a small photo', () => {
    const sizes = referenceSizes(480, 640, VISION_CONFIG);
    expect(sizes.width).toBe(480);
    expect(sizes.height).toBe(640);
  });

  it('skips copies too small to hold features', () => {
    const sizes = referenceSizes(200, 200, VISION_CONFIG);
    // 0.2 of 200 is 40 px, under the 48 px floor
    expect(sizes.levels.map((l) => l.s)).toEqual([1, 0.6, 0.35]);
  });

  it('has no copies at all for a thumbnail', () => {
    expect(referenceSizes(40, 40, VISION_CONFIG).levels).toEqual([]);
  });
});
