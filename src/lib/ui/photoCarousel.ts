// Paging and swipe maths for the grave photo carousel

// Horizontal finger travel needed before a swipe changes photo
export const PHOTO_SWIPE_THRESHOLD_PX = 40;

// Arrows wrap around, so "next" on the last photo returns to the first
export function wrapPhotoIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

// 1 for next photo, -1 for previous, 0 when the gesture was too short or mostly vertical (a page scroll)
export function swipeStep(deltaX: number, deltaY: number): -1 | 0 | 1 {
  if (Math.abs(deltaX) < PHOTO_SWIPE_THRESHOLD_PX || Math.abs(deltaX) <= Math.abs(deltaY)) return 0;
  return deltaX < 0 ? 1 : -1;
}

export function photoCounterLabel(index: number, count: number): string {
  if (count <= 0) return 'No photos yet';
  return `Photo ${wrapPhotoIndex(index, count) + 1} of ${count}`;
}
