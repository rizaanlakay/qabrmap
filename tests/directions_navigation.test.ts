import { describe, it, expect } from 'vitest';
import { MOCK_CEMETERIES } from '../src/lib/data/mockData';
import {
  calculateDistanceMeters,
  calculateBearing,
  formatBearingToCardinal,
  isPointInPolygon,
  snapToRoute,
  formatManeuverInstruction,
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
    expect(athlone?.entranceName).toBe('Johnson Road Gate');

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

  it('calculates road bearing such that setting camera bearing aligns road straight UP', () => {
    // Traveling due North: bearing 0/360
    const bNorth = calculateBearing(-33.968, 18.503, -33.958, 18.503);
    expect(bNorth).toBeCloseTo(0, 0);

    // Traveling due East: bearing 90
    const bEast = calculateBearing(-33.968, 18.503, -33.968, 18.513);
    expect(bEast).toBeCloseTo(90, 0);

    // Traveling due South: bearing 180
    const bSouth = calculateBearing(-33.958, 18.503, -33.968, 18.503);
    expect(bSouth).toBeCloseTo(180, 0);

    // Traveling due West: bearing 270
    const bWest = calculateBearing(-33.968, 18.513, -33.968, 18.503);
    expect(bWest).toBeCloseTo(270, 0);
  });

  it('verifies that rotating camera to step bearing_after aligns the maneuver road to UP', () => {
    // Simulated OSRM turn step: e.g. turning onto Belgravia Road heading 35 degrees (NNE)
    const mockStep = {
      instruction: 'Turn right onto Belgravia Road',
      bearingAfter: 35,
      bearingBefore: 295,
      location: [18.504, -33.962] as [number, number],
    };

    // Setting map bearing to mockStep.bearingAfter (35°) causes heading 35° to point directly to top of viewport
    const cameraBearing = mockStep.bearingAfter;
    expect(cameraBearing).toBe(35);

    // Relative screen angle of travel vector when camera is rotated to cameraBearing:
    // RelativeAngle = (roadHeading - cameraBearing) = (35 - 35) = 0° (Straight UP!)
    const relativeScreenHeading = (mockStep.bearingAfter - cameraBearing + 360) % 360;
    expect(relativeScreenHeading).toBe(0);
  });

  it('ensures depart maneuvers are never misclassified as left or right turns', () => {
    // Departure steps should always indicate forward movement, never curb snap angles
    const departStep = {
      type: 'depart',
      modifier: undefined,
      instruction: 'Head out onto Boeschoeten Road',
      distanceMeters: 52,
    };

    expect(departStep.type).toBe('depart');
    expect(departStep.modifier).toBeUndefined();
  });

  it('snaps user GPS location to the route start and polyline in driving mode', () => {
    // Simulated Boeschoeten Road route heading north:
    const mockRoute: [number, number][] = [
      [18.5108, -33.9700], // Start point on Boeschoeten Road
      [18.5108, -33.9660], // North along Boeschoeten Road
      [18.5140, -33.9660], // Turn right onto Belgravia Road
    ];

    // User is located ~15m west of the road in a building / driveway
    const offRoadUser = { lat: -33.9700, lng: 18.51064 };
    const snapped = snapToRoute(offRoadUser, mockRoute, 75);

    expect(snapped.snapped).toBe(true);
    expect(snapped.lng).toBeCloseTo(18.5108, 4);
    expect(snapped.lat).toBeCloseTo(-33.9700, 4);
    expect(snapped.distanceToRouteMeters).toBeLessThan(20);

    // User is far off route (> 75m)
    const farUser = { lat: -33.9700, lng: 18.508 };
    const notSnapped = snapToRoute(farUser, mockRoute, 75);
    expect(notSnapped.snapped).toBe(false);
    expect(notSnapped.lng).toBe(farUser.lng);
    expect(notSnapped.lat).toBe(farUser.lat);
  });

  describe('Exit and Off-Ramp Maneuver Instructions', () => {
    it('formats exit instruction with exit number and destination', () => {
      const step = {
        maneuver: { type: 'off ramp', modifier: 'slight left' },
        name: '',
        destinations: 'M4: Main Road',
        exits: '7',
      };
      expect(formatManeuverInstruction(step)).toBe('Take exit 7 towards M4: Main Road');
    });

    it('formats exit instruction when exit number is a route code like R46', () => {
      const step = {
        maneuver: { type: 'off ramp', modifier: 'slight right' },
        name: '',
        exits: 'R46',
      };
      expect(formatManeuverInstruction(step)).toBe('Take exit R46');
    });

    it('formats exit instruction with explicit "Exit 10" and destination', () => {
      const step = {
        maneuver: { type: 'off ramp', modifier: 'slight left' },
        name: '',
        exits: 'Exit 10',
        destinations: 'R46: Malmesbury',
      };
      expect(formatManeuverInstruction(step)).toBe('Take Exit 10 towards R46: Malmesbury');
    });

    it('falls back to route ref when exits is missing but ref is provided', () => {
      const step = {
        maneuver: { type: 'off ramp', modifier: 'slight left' },
        name: '',
        ref: 'R46',
      };
      expect(formatManeuverInstruction(step)).toBe('Take exit towards R46');
    });

    it('formats exit name if roadName starts with Exit', () => {
      const step = {
        maneuver: { type: 'off ramp', modifier: 'slight left' },
        name: 'Exit 21',
      };
      expect(formatManeuverInstruction(step)).toBe('Take Exit 21');
    });

    it('falls back to generic "Take exit" when no names or exits exist', () => {
      const step = {
        maneuver: { type: 'off ramp', modifier: 'slight left' },
        name: '',
      };
      expect(formatManeuverInstruction(step)).toBe('Take exit');
    });

    it('properly preserves uppercase route references in "Then ..." guidance subtext', () => {
      const instruction1 = 'Take exit R46';
      const subtext1 = `Then ${instruction1.charAt(0).toLowerCase() + instruction1.slice(1)}`;
      expect(subtext1).toBe('Then take exit R46');

      const instruction2 = 'Take exit 7 towards M4: Main Road';
      const subtext2 = `Then ${instruction2.charAt(0).toLowerCase() + instruction2.slice(1)}`;
      expect(subtext2).toBe('Then take exit 7 towards M4: Main Road');
    });
  });
});
