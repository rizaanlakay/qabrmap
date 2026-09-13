import { describe, it, expect } from 'vitest';
import { MOCK_CEMETERIES } from '../src/lib/data/mockData';
import {
  calculateDistanceMeters,
  calculateBearing,
  formatBearingToCardinal,
  isPointInPolygon,
} from '../src/lib/geospatial';

describe('Dual-Mode Navigation & Entrance Routing', () => {
  it('has verified entrance coordinates and names for all 4 Cape Town cemeteries', () => {
    expect(MOCK_CEMETERIES.length).toBe(4);

    const mowbray = MOCK_CEMETERIES.find((c) => c.id === 'cem_mowbray');
    expect(mowbray).toBeDefined();
    expect(mowbray?.entranceLat).toBeCloseTo(-33.9376, 3);
    expect(mowbray?.entranceLng).toBeCloseTo(18.4619, 3);
    expect(mowbray?.entranceName).toBe('Browning Road Main Gate');

    const athlone = MOCK_CEMETERIES.find((c) => c.id === 'cem_athlone');
    expect(athlone).toBeDefined();
    expect(athlone?.entranceLat).toBeCloseTo(-33.967, 3);
    expect(athlone?.entranceLng).toBeCloseTo(18.5265, 3);
    expect(athlone?.entranceName).toBe('Johnstone Road Gate');

    const wynberg = MOCK_CEMETERIES.find((c) => c.id === 'cem_wynberg');
    expect(wynberg).toBeDefined();
    expect(wynberg?.entranceLat).toBeCloseTo(-34.0028, 3);
    expect(wynberg?.entranceLng).toBeCloseTo(18.4673, 3);
    expect(wynberg?.entranceName).toBe('Brodie Road Gate');

    const mountview = MOCK_CEMETERIES.find((c) => c.id === 'cem_mountview');
    expect(mountview).toBeDefined();
    expect(mountview?.entranceLat).toBeCloseTo(-33.9811, 3);
    expect(mountview?.entranceLng).toBeCloseTo(18.5303, 3);
    expect(mountview?.entranceName).toBe('Mohan Avenue Gate');
  });

  it('correctly evaluates isPointInPolygon inside and outside boundary', () => {
    const mowbray = MOCK_CEMETERIES.find((c) => c.id === 'cem_mowbray')!;
    const polygonRing = mowbray.boundary!.coordinates[0] as [number, number][];

    // Inside Mowbray Cemetery grounds (-33.939, 18.461)
    const insidePoint: [number, number] = [18.461, -33.939];
    expect(isPointInPolygon(insidePoint, polygonRing)).toBe(true);

    // Far away in Athlone (-33.968, 18.527)
    const outsidePoint: [number, number] = [18.527, -33.968];
    expect(isPointInPolygon(outsidePoint, polygonRing)).toBe(false);
  });

  it('determines driving mode when user is beyond walking distance (e.g. Athlone to Mowbray)', () => {
    const userAthlone = { lat: -33.96782, lng: 18.50302 };
    const mowbray = MOCK_CEMETERIES.find((c) => c.id === 'cem_mowbray')!;

    const distToEntrance = calculateDistanceMeters(
      userAthlone.lat,
      userAthlone.lng,
      mowbray.entranceLat!,
      mowbray.entranceLng!
    );

    // Athlone is ~5 km from Mowbray
    expect(distToEntrance).toBeGreaterThan(3000);

    const polygonRing = mowbray.boundary!.coordinates[0] as [number, number][];
    const isInside = isPointInPolygon([userAthlone.lng, userAthlone.lat], polygonRing);
    expect(isInside).toBe(false);

    // Navigation mode rule: beyond 350m and not inside -> Driving
    const shouldDrive = distToEntrance > 350 && !isInside;
    expect(shouldDrive).toBe(true);
  });

  it('determines walking mode when user is inside or within 350m of entrance gate', () => {
    const mowbray = MOCK_CEMETERIES.find((c) => c.id === 'cem_mowbray')!;
    // User standing 50m from Browning Road Gate
    const userAtGate = { lat: -33.9379, lng: 18.4621 };

    const distToEntrance = calculateDistanceMeters(
      userAtGate.lat,
      userAtGate.lng,
      mowbray.entranceLat!,
      mowbray.entranceLng!
    );

    expect(distToEntrance).toBeLessThan(350);

    // When <= 350m, should automatically transition to walking mode
    const isBeyondWalking = distToEntrance > 350;
    expect(isBeyondWalking).toBe(false);
  });
});
