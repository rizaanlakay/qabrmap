import { describe, it, expect } from 'vitest';
import { AR_CAMERA_HFOV_DEG, AR_EYE_HEIGHT_M, projectGroundTarget } from '../src/lib/ar/markerProjection';
import { smoothAngle, smoothValue } from '../src/lib/ar/smoothing';

const view = { viewportWidth: 400, viewportHeight: 800 };
// Looking straight at a ground point 10 m away means tilting the camera down by this much
const lookAt10m = -(Math.atan2(AR_EYE_HEIGHT_M, 10) * 180) / Math.PI;

describe('AR Marker Projection Tests', () => {
  it('puts a target straight ahead in the centre of the screen', () => {
    const p = projectGroundTarget({ bearingDiffDeg: 0, pitchDeg: lookAt10m, distanceM: 10, ...view });
    expect(p.x).toBeCloseTo(200, 6);
    expect(p.y).toBeCloseTo(400, 6);
    expect(p.onScreen).toBe(true);
  });

  it('moves right for a target to the right and left for one to the left', () => {
    const right = projectGroundTarget({ bearingDiffDeg: 20, pitchDeg: lookAt10m, distanceM: 10, ...view });
    const left = projectGroundTarget({ bearingDiffDeg: -20, pitchDeg: lookAt10m, distanceM: 10, ...view });
    expect(right.x).toBeGreaterThan(200);
    expect(left.x).toBeLessThan(200);
    expect(right.x - 200).toBeCloseTo(200 - left.x, 6);
  });

  it('sits below the centre when the camera is level, and above it when tilted well down', () => {
    expect(projectGroundTarget({ bearingDiffDeg: 0, pitchDeg: 0, distanceM: 10, ...view }).y).toBeGreaterThan(400);
    expect(projectGroundTarget({ bearingDiffDeg: 0, pitchDeg: -40, distanceM: 10, ...view }).y).toBeLessThan(400);
  });

  it('is off screen beyond half the field of view, with an edge angle pointing that way', () => {
    expect(AR_CAMERA_HFOV_DEG).toBe(65);
    const p = projectGroundTarget({ bearingDiffDeg: 60, pitchDeg: lookAt10m, distanceM: 10, ...view });
    expect(p.onScreen).toBe(false);
    expect(p.x).toBeGreaterThan(400);
    expect(Math.abs(p.edgeAngleDeg)).toBeLessThan(10);
    const behind = projectGroundTarget({ bearingDiffDeg: -150, pitchDeg: lookAt10m, distanceM: 10, ...view });
    expect(behind.onScreen).toBe(false);
    expect(behind.x).toBeLessThan(0);
  });

  it('grows as the grave gets closer, within limits', () => {
    const at = (distanceM: number) => projectGroundTarget({ bearingDiffDeg: 0, pitchDeg: 0, distanceM, ...view }).scale;
    expect(at(1)).toBe(1.6);
    expect(at(8)).toBe(1);
    expect(at(40)).toBe(0.5);
  });

  it('reports pixels per metre at the target distance for the accuracy ring', () => {
    const p = projectGroundTarget({ bearingDiffDeg: 0, pitchDeg: 0, distanceM: 10, ...view });
    expect(p.pxPerMeter).toBeCloseTo(200 / (Math.tan((32.5 * Math.PI) / 180) * 10), 6);
  });
});

describe('AR Smoothing Tests', () => {
  it('starts at the first value and eases toward later ones', () => {
    expect(smoothValue(null, 10, 0.25)).toBe(10);
    expect(smoothValue(10, 20, 0.25)).toBe(12.5);
  });

  it('takes the short way round the compass', () => {
    expect(smoothAngle(null, 350, 0.25)).toBe(350);
    expect(smoothAngle(350, 10, 0.5)).toBe(0);
    expect(smoothAngle(10, 350, 0.5)).toBe(0);
    // An exact half turn has no short way; it goes anticlockwise
    expect(smoothAngle(0, 180, 0.5)).toBe(270);
  });
});
