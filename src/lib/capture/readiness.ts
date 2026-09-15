import type { CompassStatus } from '../device/compass';

// AR guides people back to where the photo was taken, so a new grave needs an accurate fix
export const MAX_CAPTURE_ACCURACY_M = 10;
// Under trees or by a wall a phone may never get under 10 m; up to this the grave can still be saved for re-survey
export const MAX_LOW_ACCURACY_CAPTURE_M = 25;
export const LOW_ACCURACY_MESSAGE = 'Low accuracy. This grave will be marked for re-survey.';

export type CaptureBlocker = 'camera' | 'gps' | 'gps-accuracy' | 'compass-permission' | 'compass' | null;

export interface CaptureReadinessInput {
  cameraLive: boolean;
  accuracyMeters: number | null;
  heading: number | null;
  compassStatus: CompassStatus;
  // The user tapped "Capture anyway", so 10 m to 25 m is accepted for this camera session
  lowAccuracyAllowed?: boolean;
}

export interface CaptureReadiness {
  ready: boolean;
  blocker: CaptureBlocker;
  message: string;
  // The accuracy blocker could be waived with "Capture anyway"
  canCaptureAnyway: boolean;
  // The fix is worse than 10 m and the user chose to go ahead
  lowAccuracy: boolean;
}

function settlingMessage(accuracyMeters: number): string {
  return `Hold the phone still while GPS settles. ${Math.ceil(accuracyMeters)} m now, needs ${MAX_CAPTURE_ACCURACY_M} m.`;
}

// The first thing stopping the shutter, in the order a user can fix them
export function getCaptureReadiness({
  cameraLive,
  accuracyMeters,
  heading,
  compassStatus,
  lowAccuracyAllowed = false,
}: CaptureReadinessInput): CaptureReadiness {
  const blocked = (blocker: CaptureBlocker, message: string, lowAccuracy = false): CaptureReadiness => ({
    ready: false,
    blocker,
    message,
    canCaptureAnyway: false,
    lowAccuracy,
  });

  if (!cameraLive) return blocked('camera', 'Camera is not available');
  if (accuracyMeters === null) return blocked('gps', 'Locating…');

  const withinLowLimit = accuracyMeters <= MAX_LOW_ACCURACY_CAPTURE_M;
  const lowAccuracy = accuracyMeters > MAX_CAPTURE_ACCURACY_M;
  if (lowAccuracy && !(lowAccuracyAllowed && withinLowLimit)) {
    return { ...blocked('gps-accuracy', settlingMessage(accuracyMeters)), canCaptureAnyway: withinLowLimit && !lowAccuracyAllowed };
  }

  if (compassStatus === 'needs-permission') {
    return blocked('compass-permission', 'Tap the screen to start the compass', lowAccuracy);
  }
  if (heading === null) {
    const message =
      compassStatus === 'waiting'
        ? 'Waiting for compass…'
        : compassStatus === 'denied'
          ? 'Allow motion access for this site in Settings to map a grave'
          : 'Compass not available on this device';
    return blocked('compass', message, lowAccuracy);
  }

  return {
    ready: true,
    blocker: null,
    message: lowAccuracy ? LOW_ACCURACY_MESSAGE : 'Position the gravestone in the frame',
    canCaptureAnyway: false,
    lowAccuracy,
  };
}
