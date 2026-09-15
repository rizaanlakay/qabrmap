export type UserLocationStatus = 'idle' | 'locating' | 'ready' | 'denied' | 'unavailable';

export interface UserPosition {
  lat: number;
  lng: number;
  accuracy: number;
  // Epoch milliseconds when the browser reported it
  at: number;
}

// The slice of navigator.geolocation this module uses, so tests can hand in a stub
export interface GeolocationLike {
  getCurrentPosition(
    success: (position: GeolocationPosition) => void,
    error: (error: GeolocationPositionError) => void,
    options?: PositionOptions
  ): void;
}

export type LocateResult =
  | { status: 'ready'; position: UserPosition }
  | { status: 'denied' | 'unavailable'; message: string };

// A fix from the last minute is fine for sorting cemeteries kilometres apart; ten seconds is long enough indoors
export const LOCATE_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 };

export const LOCATION_DENIED_MESSAGE = 'Location is off for this site. Allow location in your browser settings to see cemeteries near you.';
export const LOCATION_UNAVAILABLE_MESSAGE = 'Your location could not be found right now.';

export function locateUser(geolocation: GeolocationLike | undefined): Promise<LocateResult> {
  if (!geolocation) return Promise.resolve({ status: 'unavailable', message: LOCATION_UNAVAILABLE_MESSAGE });
  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      (fix) => {
        resolve({
          status: 'ready',
          position: {
            lat: fix.coords.latitude,
            lng: fix.coords.longitude,
            accuracy: fix.coords.accuracy,
            at: fix.timestamp,
          },
        });
      },
      (error) => {
        // Code 1 is a refusal; 2 (no fix) and 3 (timeout) both mean "not right now"
        if (error.code === 1) resolve({ status: 'denied', message: LOCATION_DENIED_MESSAGE });
        else resolve({ status: 'unavailable', message: LOCATION_UNAVAILABLE_MESSAGE });
      },
      LOCATE_OPTIONS
    );
  });
}
