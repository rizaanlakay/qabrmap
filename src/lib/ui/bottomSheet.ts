// Drag and snap maths for the navigation screen's swipeable bottom sheet

// Finger travel before a press turns into a drag, so taps still reach the sheet's buttons
export const SHEET_DRAG_THRESHOLD_PX = 6;
// Release speed (px per ms) that snaps in the flick direction wherever the sheet is
export const SHEET_FLICK_VELOCITY = 0.45;
// A pause this long (ms) before letting go means the release is not a flick
export const SHEET_FLICK_MAX_IDLE_MS = 100;
// A click this soon (ms) after a drag ends is the browser's click for that drag, not a new tap
export const SHEET_CLICK_SUPPRESS_MS = 300;
// Space kept below the stats row when the sheet is collapsed
export const SHEET_PEEK_GAP_PX = 16;
// The sheet always overlapped the map by 50px; keeping that makes expanded camera framing unchanged
export const SHEET_MAP_OVERLAP_PX = 50;
export const SHEET_SNAP_MS = 300;
export const SHEET_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';

export function clampSheetOffset(offset: number, collapsedOffset: number): number {
  return Math.min(Math.max(0, collapsedOffset), Math.max(0, offset));
}

// offset: px the sheet is slid down from fully expanded; velocity: px per ms, positive is downward
export function shouldCollapseSheet({
  offset,
  collapsedOffset,
  velocity,
}: {
  offset: number;
  collapsedOffset: number;
  velocity: number;
}): boolean {
  if (Math.abs(velocity) >= SHEET_FLICK_VELOCITY) return velocity > 0;
  return offset > collapsedOffset / 2;
}

// Map camera padding that keeps the route framed in the area above the visible part of the sheet
export function mapPaddingForSheet(visibleSheetPx: number) {
  return { top: 0, right: 0, bottom: Math.max(0, visibleSheetPx - SHEET_MAP_OVERLAP_PX), left: 0 };
}
