import { describe, it, expect } from 'vitest';
import {
  clampSheetOffset,
  shouldCollapseSheet,
  mapPaddingForSheet,
  SHEET_FLICK_VELOCITY,
  SHEET_MAP_OVERLAP_PX,
} from '../src/lib/ui/bottomSheet';

describe('Navigation Bottom Sheet Tests', () => {
  it('keeps the drag offset between expanded and collapsed', () => {
    expect(clampSheetOffset(120, 200)).toBe(120);
    expect(clampSheetOffset(-40, 200)).toBe(0);
    expect(clampSheetOffset(260, 200)).toBe(200);
    expect(clampSheetOffset(50, -10)).toBe(0);
  });

  it('snaps to the nearest position on a slow release', () => {
    expect(shouldCollapseSheet({ offset: 150, collapsedOffset: 200, velocity: 0.1 })).toBe(true);
    expect(shouldCollapseSheet({ offset: 60, collapsedOffset: 200, velocity: -0.1 })).toBe(false);
  });

  it('follows the flick direction on a fast release', () => {
    expect(shouldCollapseSheet({ offset: 20, collapsedOffset: 200, velocity: SHEET_FLICK_VELOCITY })).toBe(true);
    expect(shouldCollapseSheet({ offset: 180, collapsedOffset: 200, velocity: -SHEET_FLICK_VELOCITY })).toBe(false);
  });

  it('pads the map camera by the visible sheet minus its map overlap', () => {
    expect(mapPaddingForSheet(330)).toEqual({ top: 0, right: 0, bottom: 330 - SHEET_MAP_OVERLAP_PX, left: 0 });
    expect(mapPaddingForSheet(20).bottom).toBe(0);
  });
});
