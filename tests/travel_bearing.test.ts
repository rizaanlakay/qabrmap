import { describe, it, expect } from 'vitest';
import { TRAVEL_BEARING_MIN_METERS, nextTravelBearing } from '../src/lib/geospatial/routeProgress';
import { buildOsrmRouteUrl, parseBearingParam } from '../src/lib/geospatial/osrm';

const LAT = -33.967;

describe('Travel Bearing Tests', () => {
  it('has no bearing until the driver has moved', () => {
    const state = nextTravelBearing(null, { lat: LAT, lng: 18.5 });
    expect(state.bearing).toBeNull();
  });

  it('reads the direction of travel once the driver has moved far enough', () => {
    const start = nextTravelBearing(null, { lat: LAT, lng: 18.5 });
    const east = nextTravelBearing(start, { lat: LAT, lng: 18.501 });
    expect(east.bearing).toBeCloseTo(90, 0);
  });

  it('keeps the last bearing through GPS jitter smaller than the minimum move', () => {
    const start = nextTravelBearing(null, { lat: LAT, lng: 18.5 });
    const east = nextTravelBearing(start, { lat: LAT, lng: 18.501 });
    // About 2 m north: well under the minimum, so this is noise rather than a turn
    const jitter = nextTravelBearing(east, { lat: LAT + 0.00002, lng: 18.501 });
    expect(TRAVEL_BEARING_MIN_METERS).toBeGreaterThan(2);
    expect(jitter.bearing).toBeCloseTo(90, 0);
    expect(jitter.anchor).toEqual(east.anchor);
  });

  it('follows a turn', () => {
    const start = nextTravelBearing(null, { lat: LAT, lng: 18.5 });
    const east = nextTravelBearing(start, { lat: LAT, lng: 18.501 });
    const north = nextTravelBearing(east, { lat: LAT + 0.001, lng: 18.501 });
    expect(north.bearing).toBeCloseTo(0, 0);
  });
});

describe('OSRM Route URL Tests', () => {
  const trip = { profile: 'driving', startLng: 18.49, startLat: -33.95, endLng: 18.5265, endLat: -33.9675 } as const;

  it('asks for the start to be matched to the driver direction of travel', () => {
    const url = new URL(buildOsrmRouteUrl({ ...trip, bearing: 24 }));
    expect(url.pathname).toContain('/driving/18.49,-33.95;18.5265,-33.9675');
    // One entry per coordinate: the start is constrained, the destination is left open
    expect(url.searchParams.get('bearings')).toBe('24,45;');
  });

  it('leaves the bearing out when the direction of travel is unknown', () => {
    const url = new URL(buildOsrmRouteUrl({ ...trip, bearing: null }));
    expect(url.searchParams.has('bearings')).toBe(false);
  });

  it('accepts only whole-circle bearings from the query string', () => {
    expect(parseBearingParam('24.4')).toBe(24);
    expect(parseBearingParam('359.7')).toBe(0);
    expect(parseBearingParam(null)).toBeNull();
    expect(parseBearingParam('')).toBeNull();
    expect(parseBearingParam('north')).toBeNull();
    expect(parseBearingParam('-5')).toBeNull();
    expect(parseBearingParam('400')).toBeNull();
  });
});
