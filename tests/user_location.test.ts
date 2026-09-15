import { describe, it, expect } from 'vitest';
import {
  GeolocationLike,
  LOCATE_OPTIONS,
  LOCATION_DENIED_MESSAGE,
  LOCATION_UNAVAILABLE_MESSAGE,
  locateUser,
} from '../src/lib/device/userLocation';

function geolocationThatReturns(lat: number, lng: number, accuracy: number): GeolocationLike {
  return {
    getCurrentPosition(success) {
      success({ coords: { latitude: lat, longitude: lng, accuracy }, timestamp: 1_700_000_000_000 } as GeolocationPosition);
    },
  };
}

function geolocationThatFails(code: number): GeolocationLike {
  return {
    getCurrentPosition(_success, error) {
      error({ code, message: 'x', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
    },
  };
}

describe('locateUser', () => {
  it('returns the fix as a ready position', async () => {
    const result = await locateUser(geolocationThatReturns(-33.9, 18.5, 12));
    expect(result).toEqual({ status: 'ready', position: { lat: -33.9, lng: 18.5, accuracy: 12, at: 1_700_000_000_000 } });
  });

  it('reports a refused permission as denied with a message that says how to fix it', async () => {
    const result = await locateUser(geolocationThatFails(1));
    expect(result).toEqual({ status: 'denied', message: LOCATION_DENIED_MESSAGE });
    expect(LOCATION_DENIED_MESSAGE).toMatch(/allow location/i);
  });

  it('reports a timeout or missing fix as unavailable', async () => {
    expect(await locateUser(geolocationThatFails(2))).toEqual({ status: 'unavailable', message: LOCATION_UNAVAILABLE_MESSAGE });
    expect(await locateUser(geolocationThatFails(3))).toEqual({ status: 'unavailable', message: LOCATION_UNAVAILABLE_MESSAGE });
  });

  it('reports a browser without geolocation as unavailable', async () => {
    expect(await locateUser(undefined)).toEqual({ status: 'unavailable', message: LOCATION_UNAVAILABLE_MESSAGE });
  });

  it('asks for a fresh, accurate fix but gives up after ten seconds', () => {
    expect(LOCATE_OPTIONS).toEqual({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
  });
});
