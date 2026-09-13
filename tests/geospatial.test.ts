import { describe, it, expect } from 'vitest';
import {
  calculateDistanceMeters,
  calculateBearing,
  formatBearingToCardinal,
  estimateMonocularDistance,
  estimateTargetBearing,
  projectForwardGeodesic,
  reconcileMultiObservations,
  toLocalCemeteryCoordinates,
  fromLocalCemeteryCoordinates,
  processPhotoToGravePosition,
} from '../src/lib/geospatial';

describe('Geospatial Engine Unit Tests', () => {
  // Test coordinates: Athlone Muslim Cemetery (-33.967521, 18.503277)
  const lat1 = -33.967521;
  const lon1 = 18.503277;

  it('calculates accurate Haversine distance in meters', () => {
    // 0.0001 degrees latitude is approximately 11.1 meters
    const lat2 = lat1 + 0.0001;
    const lon2 = lon1;
    const distance = calculateDistanceMeters(lat1, lon1, lat2, lon2);
    expect(distance).toBeGreaterThan(10.5);
    expect(distance).toBeLessThan(11.5);
  });

  it('calculates forward bearing and formats to cardinal', () => {
    // Point directly North
    const bearingNorth = calculateBearing(lat1, lon1, lat1 + 0.001, lon1);
    expect(bearingNorth).toBe(0);

    // Point North-East
    const bearingNE = calculateBearing(lat1, lon1, lat1 + 0.001, lon1 + 0.001);
    expect(bearingNE).toBeGreaterThan(35);
    expect(bearingNE).toBeLessThan(55);

    const formatted = formatBearingToCardinal(42);
    expect(formatted).toBe('42° NE');
  });

  it('estimates monocular distance from gravestone bounding box (pinhole model)', () => {
    // Gravestone filling 70% of the frame (close up)
    const closeDistance = estimateMonocularDistance({ x: 0.2, y: 0.1, width: 0.6, height: 0.7 });
    expect(closeDistance).toBeGreaterThan(0.8);
    expect(closeDistance).toBeLessThan(2.0);

    // Gravestone filling 25% of the frame (further away)
    const farDistance = estimateMonocularDistance({ x: 0.35, y: 0.3, width: 0.3, height: 0.25 });
    expect(farDistance).toBeGreaterThan(closeDistance);
  });

  it('computes forward geodesic projection', () => {
    const projected = projectForwardGeodesic(lat1, lon1, 10, 0); // 10m North
    expect(projected.latitude).toBeGreaterThan(lat1);
    expect(projected.longitude).toBeCloseTo(lon1, 5);
  });

  it('reconciles multiple observations with inverse-variance weighting', () => {
    const observations = [
      { latitude: -33.96752, longitude: 18.50327, accuracyMeters: 4.0 },
      { latitude: -33.967522, longitude: 18.503278, accuracyMeters: 2.0 },
      { latitude: -33.967521, longitude: 18.503276, accuracyMeters: 2.5 },
    ];

    const reconciled = reconcileMultiObservations(observations);
    expect(reconciled.confidence).toBe('HIGH');
    expect(reconciled.positionAccuracyMeters).toBeLessThan(2.0); // Variance decreases with corroboration
    expect(reconciled.latitude).toBeCloseTo(-33.967521, 5);
  });

  it('transforms to local cemetery coordinates (x, y, z) and back', () => {
    const originLat = -33.967521;
    const originLng = 18.503277;

    const local = toLocalCemeteryCoordinates(originLat, originLng, 25, originLat, originLng, 20);
    expect(local.x).toBe(0);
    expect(local.y).toBe(0);
    expect(local.z).toBe(5);

    // Inverse test
    const inverse = fromLocalCemeteryCoordinates(10, 20, originLat, originLng);
    const roundTrip = toLocalCemeteryCoordinates(inverse.latitude, inverse.longitude, 0, originLat, originLng, 0);
    expect(roundTrip.x).toBeCloseTo(10, 1);
    expect(roundTrip.y).toBeCloseTo(20, 1);
  });
});
