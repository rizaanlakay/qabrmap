import { describe, it, expect } from 'vitest';
import { FIX_WINDOW_MS, STILL_RADIUS_M, pruneFixes, smoothFixes } from '../src/lib/capture/gpsFixes';

// About 1 m of latitude near Cape Town
const ONE_METER_LAT = 0.000009;
const BASE = { lat: -33.9675, lng: 18.5033 };
const NOW = 1_000_000;

describe('GPS Fix Smoother Tests', () => {
  it('returns null when there are no fixes, or only stale ones', () => {
    expect(smoothFixes([], NOW)).toBeNull();
    expect(smoothFixes([{ ...BASE, accuracy: 4, at: NOW - FIX_WINDOW_MS - 1 }], NOW)).toBeNull();
  });

  it('drops fixes older than the window and keeps the rest', () => {
    const fresh = { ...BASE, accuracy: 4, at: NOW - 1000 };
    const stale = { ...BASE, accuracy: 2, at: NOW - FIX_WINDOW_MS - 1 };
    expect(pruneFixes([stale, fresh], NOW)).toEqual([fresh]);
  });

  it('uses the most accurate recent fix, and the latest one on a tie', () => {
    const fixes = [
      { lat: BASE.lat, lng: BASE.lng, accuracy: 12, at: NOW - 9000 },
      { lat: BASE.lat + 50 * ONE_METER_LAT, lng: BASE.lng, accuracy: 6, at: NOW - 5000 },
      { lat: BASE.lat + 100 * ONE_METER_LAT, lng: BASE.lng, accuracy: 6, at: NOW - 1000 },
    ];
    const fix = smoothFixes(fixes, NOW);
    expect(fix?.accuracy).toBe(6);
    expect(fix?.lat).toBeCloseTo(BASE.lat + 100 * ONE_METER_LAT, 7);
    // The timestamp is the best fix's, so a consumer can pair the fix with the pose from that moment
    expect(fix?.at).toBe(NOW - 1000);
  });

  it('averages fixes within the stillness radius of the best one and ignores the others', () => {
    const fixes = [
      { lat: BASE.lat + 20 * ONE_METER_LAT, lng: BASE.lng, accuracy: 5, at: NOW - 8000 }, // 20 m away, walking
      { lat: BASE.lat + 2 * ONE_METER_LAT, lng: BASE.lng, accuracy: 8, at: NOW - 3000 },
      { lat: BASE.lat, lng: BASE.lng, accuracy: 4, at: NOW - 1000 },
    ];
    const fix = smoothFixes(fixes, NOW);
    expect(STILL_RADIUS_M).toBe(3);
    // Inverse-variance mean of the two still fixes: weights 1/64 and 1/16, so the 4 m fix pulls hardest
    const expectedLat = (BASE.lat + 2 * ONE_METER_LAT) * (1 / 64) / (1 / 64 + 1 / 16) + BASE.lat * (1 / 16) / (1 / 64 + 1 / 16);
    expect(fix?.lat).toBeCloseTo(expectedLat, 9);
    expect(fix?.lng).toBeCloseTo(BASE.lng, 9);
  });

  it('never reports better accuracy than the best single fix', () => {
    const fixes = Array.from({ length: 10 }, (_, i) => ({ ...BASE, accuracy: 7, at: NOW - i * 500 }));
    expect(smoothFixes(fixes, NOW)?.accuracy).toBe(7);
  });
  it('follows a walking person instead of clinging to an older, more accurate fix', () => {
    // Walking north 6 m a second; the first fix happened to be the most accurate
    const fixes = [
      { lat: BASE.lat, lng: BASE.lng, accuracy: 3, at: NOW - 3000 },
      { lat: BASE.lat + 6 * ONE_METER_LAT, lng: BASE.lng, accuracy: 6, at: NOW - 2000 },
      { lat: BASE.lat + 12 * ONE_METER_LAT, lng: BASE.lng, accuracy: 6, at: NOW - 1000 },
    ];
    const fix = smoothFixes(fixes, NOW);
    expect(fix?.lat).toBeCloseTo(BASE.lat + 12 * ONE_METER_LAT, 7);
    expect(fix?.accuracy).toBe(6);
    expect(fix?.at).toBe(NOW - 1000);
  });

  it('still averages the whole window when standing still', () => {
    const fixes = Array.from({ length: 6 }, (_, i) => ({
      lat: BASE.lat + (i % 2) * ONE_METER_LAT,
      lng: BASE.lng,
      accuracy: i === 2 ? 3 : 6,
      at: NOW - i * 1000,
    }));
    const fix = smoothFixes(fixes, NOW);
    expect(fix?.accuracy).toBe(3);
    // Somewhere inside the 1 m spread, not pinned to any single reading
    expect(fix?.lat).toBeGreaterThan(BASE.lat);
    expect(fix?.lat).toBeLessThan(BASE.lat + ONE_METER_LAT);
  });
});
