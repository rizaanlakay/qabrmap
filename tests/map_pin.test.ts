import { describe, it, expect } from 'vitest';
import { calculateDistanceMeters } from '../src/lib/geospatial';
import { accuracyRing, checkPin, gravePosition, MAP_PIN_ACCURACY_M, MAX_PIN_DISTANCE_M } from '../src/lib/capture/mapPin';

const fix = { latitude: -33.9675, longitude: 18.5033, gpsAccuracy: 6 };

// About `meters` north of the fix
const north = (meters: number) => ({ latitude: fix.latitude + meters / 111_320, longitude: fix.longitude });

describe('checkPin', () => {
  it('reads as inside the accuracy circle when the pin is within the GPS accuracy', () => {
    const check = checkPin(fix, north(4));
    expect(check.tooFar).toBe(false);
    expect(check.message).toBe('Inside your GPS accuracy circle');
    expect(check.distanceMeters).toBeCloseTo(4, 0);
  });

  it('shows the distance once the pin is outside the accuracy circle', () => {
    const check = checkPin(fix, north(12));
    expect(check.tooFar).toBe(false);
    expect(check.message).toBe('12 m from your GPS fix');
  });

  it('refuses a pin more than 50 m from the fix', () => {
    expect(MAX_PIN_DISTANCE_M).toBe(50);
    const check = checkPin(fix, north(51));
    expect(check.tooFar).toBe(true);
    expect(check.message).toMatch(/^51 m from your GPS fix\. Move the map closer/);
    expect(checkPin(fix, north(50)).tooFar).toBe(false);
  });
});

describe('gravePosition', () => {
  it('is the phone fix without a pin', () => {
    expect(gravePosition(fix)).toEqual({ latitude: fix.latitude, longitude: fix.longitude, accuracyMeters: 6, pinned: false });
  });

  it('is the pin at the fixed pin accuracy when one was placed', () => {
    const mapPin = { latitude: -33.96752, longitude: 18.50331 };
    expect(gravePosition({ ...fix, mapPin })).toEqual({ ...mapPin, accuracyMeters: MAP_PIN_ACCURACY_M, pinned: true });
    expect(MAP_PIN_ACCURACY_M).toBe(1.5);
  });
});

describe('accuracyRing', () => {
  it('is a closed ring of [lng, lat] points at the radius from the fix', () => {
    const ring = accuracyRing(fix.latitude, fix.longitude, 8, 12);
    expect(ring).toHaveLength(13);
    expect(ring[0]).toEqual(ring[12]);
    for (const [lng, lat] of ring) {
      expect(calculateDistanceMeters(fix.latitude, fix.longitude, lat, lng)).toBeCloseTo(8, 1);
    }
    // First point is due north, so it shares the fix's longitude
    expect(ring[0][0]).toBeCloseTo(fix.longitude, 9);
    expect(ring[0][1]).toBeGreaterThan(fix.latitude);
  });
});
