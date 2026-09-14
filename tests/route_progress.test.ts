import { describe, it, expect } from 'vitest';
import { calculateDistanceMeters, RouteStep } from '../src/lib/geospatial';
import {
  REROUTE_MIN_INTERVAL_MS,
  REROUTE_OFF_ROUTE_METERS,
  computeRouteProgress,
  formatManeuverDistance,
  isUsableGpsFix,
  projectOntoRoute,
  shouldReroute,
} from '../src/lib/geospatial/routeProgress';

// A straight road running east through Athlone with a turn halfway along
const LAT = -33.967;
const ROUTE: [number, number][] = [
  [18.5, LAT],
  [18.505, LAT],
  [18.51, LAT],
];
const step = (type: string, lng: number, distanceMeters: number): RouteStep => ({
  instruction: `${type} step`,
  streetName: 'Test Road',
  distanceMeters,
  durationSeconds: 0,
  type,
  location: [lng, LAT],
});
const STEPS = [step('depart', 18.5, 460), step('turn', 18.505, 460), step('arrive', 18.51, 0)];
const metersBetween = (fromLng: number, toLng: number) => calculateDistanceMeters(LAT, fromLng, LAT, toLng);

describe('Driving Route Progress Tests', () => {
  it('counts down to the next turn while driving the first step', () => {
    const progress = computeRouteProgress({ route: ROUTE, steps: STEPS, position: { lat: LAT, lng: 18.502 }, totalDurationSeconds: 120 })!;
    expect(progress.stepIndex).toBe(0);
    expect(progress.distanceToNextManeuverMeters).toBeCloseTo(metersBetween(18.502, 18.505), -1);
    expect(progress.remainingMeters).toBeCloseTo(metersBetween(18.502, 18.51), -1);
    expect(progress.remainingSeconds).toBeCloseTo(120 * (metersBetween(18.502, 18.51) / metersBetween(18.5, 18.51)), 0);
  });

  it('moves to the next step once the turn is reached', () => {
    const progress = computeRouteProgress({ route: ROUTE, steps: STEPS, position: { lat: LAT, lng: 18.507 }, totalDurationSeconds: 120 })!;
    expect(progress.stepIndex).toBe(1);
    expect(progress.distanceToNextManeuverMeters).toBeCloseTo(metersBetween(18.507, 18.51), -1);
  });

  it('measures how far the driver has strayed from the route', () => {
    const projection = projectOntoRoute({ lat: LAT + 0.0009, lng: 18.503 }, ROUTE);
    expect(projection.offRouteMeters).toBeCloseTo(100, -1);
    expect(projection.lng).toBeCloseTo(18.503, 5);
  });

  it('asks for new directions only when there is no route or the driver is off it', () => {
    expect(shouldReroute({ hasRoute: false, offRouteMeters: 0, msSinceLastFetch: 0 })).toBe(true);
    expect(shouldReroute({ hasRoute: true, offRouteMeters: 12, msSinceLastFetch: 60_000 })).toBe(false);
    expect(
      shouldReroute({ hasRoute: true, offRouteMeters: REROUTE_OFF_ROUTE_METERS + 1, msSinceLastFetch: REROUTE_MIN_INTERVAL_MS })
    ).toBe(true);
    expect(shouldReroute({ hasRoute: true, offRouteMeters: 200, msSinceLastFetch: REROUTE_MIN_INTERVAL_MS - 1 })).toBe(false);
  });

  it('rounds turn distances the way in-car navigation does', () => {
    expect(formatManeuverDistance(43)).toBe('40 m');
    expect(formatManeuverDistance(237)).toBe('250 m');
    expect(formatManeuverDistance(995)).toBe('1.0 km');
    expect(formatManeuverDistance(1234)).toBe('1.2 km');
    expect(formatManeuverDistance(-5)).toBe('0 m');
  });

  it('ignores GPS fixes that are not a real position', () => {
    expect(isUsableGpsFix(-33.966843, 18.515116)).toBe(true);
    expect(isUsableGpsFix(0, 0)).toBe(false);
    expect(isUsableGpsFix(Number.NaN, 18.5)).toBe(false);
    expect(isUsableGpsFix(-91, 18.5)).toBe(false);
    expect(isUsableGpsFix(0, 18.5)).toBe(true);
  });

  it('returns nothing for a route too short to follow', () => {
    expect(computeRouteProgress({ route: [[18.5, LAT]], steps: [], position: { lat: LAT, lng: 18.5 }, totalDurationSeconds: null })).toBeNull();
  });
});
