// waiting: listening but no reading yet; needs-permission: iOS, still waiting for a tap to ask
export type CompassStatus = 'waiting' | 'needs-permission' | 'active' | 'denied' | 'unsupported';

// deviceorientationabsolute events are measured from north; plain deviceorientation events usually are not
export type CompassSource = 'absolute' | 'relative';

export interface OrientationReading {
  alpha?: number | null;
  webkitCompassHeading?: number | null;
}

// Heading in whole degrees clockwise from north, or null when the reading isn't tied to north
export function readCompassHeading(reading: OrientationReading, source: CompassSource): number | null {
  const iosHeading = reading.webkitCompassHeading;
  if (typeof iosHeading === 'number' && Number.isFinite(iosHeading)) {
    return wholeDegrees(iosHeading);
  }
  if (source === 'absolute' && typeof reading.alpha === 'number' && Number.isFinite(reading.alpha)) {
    return wholeDegrees(360 - reading.alpha);
  }
  return null;
}

function wholeDegrees(deg: number): number {
  return ((Math.round(deg) % 360) + 360) % 360;
}

// not-required: the browser sends headings without asking (Android, desktop)
export type CompassPermission = 'unknown' | 'granted' | 'denied' | 'not-required';

export type OrientationPermissionRequester = () => Promise<'granted' | 'denied'>;

export interface CompassPermissionStore {
  get(): CompassPermission;
  request(): Promise<CompassPermission>;
  subscribe(listener: (permission: CompassPermission) => void): () => void;
}

// iOS only sends headings after DeviceOrientationEvent.requestPermission has been called from a tap
export function getOrientationPermissionRequester(): OrientationPermissionRequester | null {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return null;
  const ctor = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
    requestPermission?: OrientationPermissionRequester;
  };
  const requestPermission = ctor.requestPermission;
  return typeof requestPermission === 'function' ? () => requestPermission.call(ctor) : null;
}

export function createCompassPermission(
  getRequester: () => OrientationPermissionRequester | null
): CompassPermissionStore {
  let answer: 'granted' | 'denied' | null = null;
  let pending: Promise<CompassPermission> | null = null;
  const listeners = new Set<(permission: CompassPermission) => void>();

  const current = (): CompassPermission => answer ?? (getRequester() ? 'unknown' : 'not-required');

  return {
    get: current,
    request() {
      const requester = getRequester();
      if (answer || !requester) return Promise.resolve(current());
      if (!pending) {
        // Called synchronously from the tap handler, because iOS only shows the prompt inside the tap
        pending = requester()
          .then(
            (result) => {
              answer = result === 'granted' ? 'granted' : 'denied';
              const settled = answer;
              listeners.forEach((listener) => listener(settled));
            },
            () => {
              // iOS won't prompt outside a tap; stay unknown so the next tap can ask
            }
          )
          .then(() => current())
          .finally(() => {
            pending = null;
          });
      }
      return pending;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// Shared by every screen, so motion access is only asked for once
export const compassPermission = createCompassPermission(getOrientationPermissionRequester);
