import { describe, it, expect } from 'vitest';
import {
  PHOTO_SWIPE_THRESHOLD_PX,
  photoCounterLabel,
  swipeStep,
  wrapPhotoIndex,
} from '../src/lib/ui/photoCarousel';

describe('Grave Photo Carousel Tests', () => {
  it('wraps arrow navigation around both ends', () => {
    expect(wrapPhotoIndex(3, 3)).toBe(0);
    expect(wrapPhotoIndex(-1, 3)).toBe(2);
    expect(wrapPhotoIndex(1, 3)).toBe(1);
    expect(wrapPhotoIndex(5, 0)).toBe(0);
  });

  it('turns a clear horizontal swipe into next or previous', () => {
    expect(swipeStep(-PHOTO_SWIPE_THRESHOLD_PX, 5)).toBe(1);
    expect(swipeStep(PHOTO_SWIPE_THRESHOLD_PX + 10, -8)).toBe(-1);
  });

  it('ignores short or mostly vertical gestures so the page can scroll', () => {
    expect(swipeStep(-(PHOTO_SWIPE_THRESHOLD_PX - 1), 0)).toBe(0);
    expect(swipeStep(-60, 90)).toBe(0);
  });

  it('labels the current photo, or the lack of photos', () => {
    expect(photoCounterLabel(1, 3)).toBe('Photo 2 of 3');
    expect(photoCounterLabel(3, 3)).toBe('Photo 1 of 3');
    expect(photoCounterLabel(0, 0)).toBe('No photos yet');
  });
});
