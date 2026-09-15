import { describe, it, expect } from 'vitest';
import { getCaptureReadiness, MAX_CAPTURE_ACCURACY_M } from '../src/lib/capture/readiness';

const everythingReady = {
  cameraLive: true,
  accuracyMeters: 4,
  heading: 90,
  compassStatus: 'active' as const,
};

describe('Capture Readiness Tests', () => {
  it('waits for the camera first', () => {
    expect(getCaptureReadiness({ ...everythingReady, cameraLive: false, accuracyMeters: null })).toEqual({
      ready: false,
      blocker: 'camera',
      message: 'Camera is not available',
    });
  });

  it('waits for a GPS fix', () => {
    expect(getCaptureReadiness({ ...everythingReady, accuracyMeters: null })).toEqual({
      ready: false,
      blocker: 'gps',
      message: 'Locating…',
    });
  });

  it('needs GPS accuracy of 10 m or better', () => {
    expect(MAX_CAPTURE_ACCURACY_M).toBe(10);
    expect(getCaptureReadiness({ ...everythingReady, accuracyMeters: 10 }).ready).toBe(true);
    expect(getCaptureReadiness({ ...everythingReady, accuracyMeters: 10.4 })).toEqual({
      ready: false,
      blocker: 'gps-accuracy',
      message: 'Improving GPS (± 11 m)…',
    });
  });

  it('asks for a tap when iOS still needs compass permission', () => {
    expect(getCaptureReadiness({ ...everythingReady, heading: null, compassStatus: 'needs-permission' })).toEqual({
      ready: false,
      blocker: 'compass-permission',
      message: 'Tap the screen to start the compass',
    });
  });

  it('explains why there is no heading', () => {
    const noHeading = { ...everythingReady, heading: null };
    expect(getCaptureReadiness({ ...noHeading, compassStatus: 'waiting' }).message).toBe('Waiting for compass…');
    expect(getCaptureReadiness({ ...noHeading, compassStatus: 'denied' }).message).toBe(
      'Allow motion access for this site in Settings to map a grave'
    );
    expect(getCaptureReadiness({ ...noHeading, compassStatus: 'unsupported' })).toEqual({
      ready: false,
      blocker: 'compass',
      message: 'Compass not available on this device',
    });
  });

  it('is ready with a live camera, accurate GPS and a heading', () => {
    expect(getCaptureReadiness(everythingReady)).toEqual({
      ready: true,
      blocker: null,
      message: 'Position the gravestone in the frame',
    });
  });
});
