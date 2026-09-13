import { describe, it, expect } from 'vitest';
import { MOCK_CEMETERIES, MOCK_GRAVES } from '../src/lib/data/mockData';

// Point-in-polygon ray-casting test
function isPointInPolygon(point: [number, number], vs: [number, number][]): boolean {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

describe('Cemetery Boundaries & Spatial Enclosure', () => {
  it('records valid closed boundary polygons for key Cape Town cemeteries', () => {
    const mowbray = MOCK_CEMETERIES.find((c) => c.id === 'cem_mowbray');
    const athlone = MOCK_CEMETERIES.find((c) => c.id === 'cem_athlone');
    const wynberg = MOCK_CEMETERIES.find((c) => c.id === 'cem_wynberg');
    const mountview = MOCK_CEMETERIES.find((c) => c.id === 'cem_mountview');
    const epping = MOCK_CEMETERIES.find((c) => c.id === 'cem_epping');

    expect(mowbray?.boundary?.coordinates[0].length).toBeGreaterThan(4);
    expect(athlone?.boundary?.coordinates[0].length).toBeGreaterThan(4);
    expect(wynberg?.boundary?.coordinates[0].length).toBeGreaterThan(4);
    expect(mountview?.boundary?.coordinates[0].length).toBeGreaterThan(4);
    expect(epping).toBeUndefined();

    // Verify all 4 authentic cemeteries have closed polygon rings
    for (const cem of [mowbray!, athlone!, wynberg!, mountview!]) {
      const coords = cem.boundary!.coordinates[0];
      const first = coords[0];
      const last = coords[coords.length - 1];
      expect(first[0]).toBe(last[0]);
      expect(first[1]).toBe(last[1]);
    }
  });

  it('verifies Mowbray Cemetery geographic center and real-world coordinates', () => {
    const mowbray = MOCK_CEMETERIES.find((c) => c.id === 'cem_mowbray')!;
    expect(mowbray.originLat).toBeCloseTo(-33.93908, 4);
    expect(mowbray.originLng).toBeCloseTo(18.46112, 4);

    // Verify boundary encompasses Browning Road / Observatory / Mowbray area
    const coords = mowbray.boundary!.coordinates[0] as [number, number][];
    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);

    expect(Math.min(...lats)).toBeLessThan(-33.940);
    expect(Math.max(...lats)).toBeGreaterThan(-33.938);
    expect(Math.min(...lons)).toBeLessThan(18.460);
    expect(Math.max(...lons)).toBeGreaterThan(18.463);
  });

  it('verifies ALL Mowbray graves are located strictly inside the cemetery boundary', () => {
    const mowbray = MOCK_CEMETERIES.find((c) => c.id === 'cem_mowbray')!;
    const mowbrayBoundary = mowbray.boundary!.coordinates[0] as [number, number][];

    const mowbrayGraves = MOCK_GRAVES.filter((g) => g.cemeteryId === 'cem_mowbray');
    expect(mowbrayGraves.length).toBeGreaterThan(50);

    for (const grave of mowbrayGraves) {
      const inside = isPointInPolygon([grave.longitude, grave.latitude], mowbrayBoundary);
      expect(inside, `Grave ${grave.graveNumber} (${grave.latitude}, ${grave.longitude}) must be inside Mowbray boundary`).toBe(true);
    }
  });

  it('verifies grandmother Fatima Hendricks grave 1402 is located inside Mowbray boundary', () => {
    const mowbray = MOCK_CEMETERIES.find((c) => c.id === 'cem_mowbray')!;
    const mowbrayBoundary = mowbray.boundary!.coordinates[0] as [number, number][];

    const gmGrave = MOCK_GRAVES.find((g) => g.id === 'grave_mowbray_grandmother');
    expect(gmGrave).toBeDefined();
    expect(gmGrave?.person?.fullName).toBe('Fatima Hendricks');

    const inside = isPointInPolygon([gmGrave!.longitude, gmGrave!.latitude], mowbrayBoundary);
    expect(inside).toBe(true);
  });

  it('computes bounding box directly from cemetery boundary to ensure entire boundary is in view', () => {
    const mowbray = MOCK_CEMETERIES.find((c) => c.id === 'cem_mowbray')!;
    const coords = mowbray.boundary!.coordinates[0] as [number, number][];

    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lng, lat] of coords) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }

    expect(minLng).toBeCloseTo(18.4587, 3);
    expect(maxLng).toBeCloseTo(18.4635, 3);
    expect(minLat).toBeCloseTo(-33.9406, 3);
    expect(maxLat).toBeCloseTo(-33.9375, 3);

    // Span should be ~440m width and ~340m height
    const latSpan = maxLat - minLat;
    const lngSpan = maxLng - minLng;
    expect(latSpan).toBeGreaterThan(0.002);
    expect(latSpan).toBeLessThan(0.005);
    expect(lngSpan).toBeGreaterThan(0.003);
    expect(lngSpan).toBeLessThan(0.006);
  });
});
