// tests/vision_frame_mapping.test.ts
import { describe, it, expect } from 'vitest';
import { cropGray, visibleFrameRect } from '../src/lib/ar/vision/frameMapping';

describe('Vision Frame Mapping Tests', () => {
  it('cuts the sides of a frame that is wider than the screen', () => {
    // The engine feed in portrait on a tall phone: 720 x 960 shown on 360 x 800
    expect(visibleFrameRect(720, 960, 360, 800)).toEqual({ x: 144, y: 0, width: 432, height: 960 });
  });

  it('cuts the top and bottom of a frame that is taller than the screen', () => {
    expect(visibleFrameRect(720, 960, 800, 600)).toEqual({ x: 0, y: 210, width: 720, height: 540 });
  });

  it('keeps the whole frame when the shapes agree', () => {
    expect(visibleFrameRect(720, 960, 360, 480)).toEqual({ x: 0, y: 0, width: 720, height: 960 });
  });

  it('falls back to the whole frame when a size is missing', () => {
    expect(visibleFrameRect(720, 960, 0, 0)).toEqual({ x: 0, y: 0, width: 720, height: 960 });
  });

  it('copies out exactly the rows and columns of the rectangle', () => {
    // 4 x 3 image whose pixel value is its index
    const pixels = Uint8Array.from({ length: 12 }, (_, i) => i);
    expect(Array.from(cropGray(pixels, 4, { x: 1, y: 1, width: 2, height: 2 }))).toEqual([5, 6, 9, 10]);
  });
});
