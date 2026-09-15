import type { CompassStatus } from '../device/compass';

// AR guides people back to where the photo was taken, so a new grave needs an accurate fix
export const MAX_CAPTURE_ACCURACY_M = 10;

export type CaptureBlocker = 'camera' | 'gps' | 'gps-accuracy' | 'compass-permission' | 'compass' | null;

export interface CaptureReadinessInput {
  cameraLive: boolean;
  accuracyMeters: number | null;
  heading: number | null;
  compassStatus: CompassStatus;
}

export interface CaptureReadiness {
  ready: boolean;
  blocker: CaptureBlocker;
  message: string;
}

// The first thing stopping the shutter, in the order a user can fix them
export function getCaptureReadiness({
  cameraLive,
  accuracyMeters,
  heading,
  compassStatus,
}: CaptureReadinessInput): CaptureReadiness {
  if (!cameraLive) return { ready: false, blocker: 'camera', message: 'Camera is not available' };
  if (accuracyMeters === null) return { ready: false, blocker: 'gps', message: 'Locating…' };
  if (accuracyMeters > MAX_CAPTURE_ACCURACY_M) {
    return {
      ready: false,
      blocker: 'gps-accuracy',
      message: `Improving GPS (± ${Math.ceil(accuracyMeters)} m)…`,
    };
  }
  if (compassStatus === 'needs-permission') {
    return { ready: false, blocker: 'compass-permission', message: 'Tap Enable compass to record the direction' };
  }
  if (heading === null) {
    const message =
      compassStatus === 'waiting'
        ? 'Waiting for compass…'
        : compassStatus === 'denied'
          ? 'Compass permission was denied'
          : 'Compass not available on this device';
    return { ready: false, blocker: 'compass', message };
  }
  return { ready: true, blocker: null, message: 'Position the gravestone in the frame' };
}
