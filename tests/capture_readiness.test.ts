import { describe, it, expect } from 'vitest';
import {
  getCaptureReadiness,
  LOW_ACCURACY_MESSAGE,
  MAX_CAPTURE_ACCURACY_M,
  MAX_LOW_ACCURACY_CAPTURE_M,
} from '../src/lib/capture/readiness';

const everythingReady = {
  cameraLive: true,
  accuracyMeters: 4,
  heading: 90,
  compassStatus: 'active' as const,
};

const notReady = { canCaptureAnyway: false, lowAccuracy: false };

describe('Capture Readiness Tests', () => {
  it('waits for the camera first', () => {
    expect(getCaptureReadiness({ ...everythingReady, cameraLive: false, accuracyMeters: null })).toEqual({
      ready: false,
      blocker: 'camera',
      message: 'Camera is not available',
      ...notReady,
    });
  });

  it('waits for a GPS fix', () => {
    expect(getCaptureReadiness({ ...everythingReady, accuracyMeters: null })).toEqual({
      ready: false,
      blocker: 'gps',
      message: 'Locating…',
      ...notReady,
    });
  });

  it('is ready at 10 m or better', () => {
    expect(MAX_CAPTURE_ACCURACY_M).toBe(10);
    expect(getCaptureReadiness({ ...everythingReady, accuracyMeters: 10 })).toEqual({
      ready: true,
      blocker: null,
      message: 'Position the gravestone in the frame',
      ...notReady,
    });
  });

  it('tells the user to hold still between 10 m and 25 m, and offers capture anyway', () => {
    expect(MAX_LOW_ACCURACY_CAPTURE_M).toBe(25);
    expect(getCaptureReadiness({ ...everythingReady, accuracyMeters: 13.2 })).toEqual({
      ready: false,
      blocker: 'gps-accuracy',
      message: 'Hold the phone still while GPS settles. 14 m now, needs 10 m.',
      canCaptureAnyway: true,
      lowAccuracy: false,
    });
  });

  it('does not offer capture anyway beyond 25 m, even when it was allowed', () => {
    expect(getCaptureReadiness({ ...everythingReady, accuracyMeters: 25.1, lowAccuracyAllowed: true })).toEqual({
      ready: false,
      blocker: 'gps-accuracy',
      message: 'Hold the phone still while GPS settles. 26 m now, needs 10 m.',
      canCaptureAnyway: false,
      lowAccuracy: false,
    });
  });

  it('is ready in low-accuracy mode once capture anyway is allowed', () => {
    expect(getCaptureReadiness({ ...everythingReady, accuracyMeters: 25, lowAccuracyAllowed: true })).toEqual({
      ready: true,
      blocker: null,
      message: LOW_ACCURACY_MESSAGE,
      canCaptureAnyway: false,
      lowAccuracy: true,
    });
  });

  it('is not in low-accuracy mode when the fix is good, even if capture anyway was allowed', () => {
    expect(getCaptureReadiness({ ...everythingReady, accuracyMeters: 6, lowAccuracyAllowed: true }).lowAccuracy).toBe(false);
  });

  it('still needs the compass in low-accuracy mode', () => {
    expect(
      getCaptureReadiness({ ...everythingReady, accuracyMeters: 18, lowAccuracyAllowed: true, heading: null, compassStatus: 'waiting' })
    ).toEqual({
      ready: false,
      blocker: 'compass',
      message: 'Waiting for compass…',
      canCaptureAnyway: false,
      lowAccuracy: true,
    });
  });

  it('asks for the compass permission tap before a heading', () => {
    expect(getCaptureReadiness({ ...everythingReady, heading: null, compassStatus: 'needs-permission' })).toEqual({
      ready: false,
      blocker: 'compass-permission',
      message: 'Tap the screen to start the compass',
      ...notReady,
    });
  });

  it('explains a missing heading by compass status', () => {
    expect(getCaptureReadiness({ ...everythingReady, heading: null, compassStatus: 'denied' }).message).toBe(
      'Allow motion access for this site in Settings to map a grave'
    );
    expect(getCaptureReadiness({ ...everythingReady, heading: null, compassStatus: 'unsupported' }).message).toBe(
      'Compass not available on this device'
    );
  });
});
