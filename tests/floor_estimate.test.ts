import { describe, it, expect } from 'vitest';
import {
  createFloorEstimator,
  MAX_DROP_BELOW_CAMERA_M,
  MIN_DROP_BELOW_CAMERA_M,
  MIN_SAMPLES_FOR_FLOOR,
} from '../src/lib/ar/floorEstimate';

describe('Floor Estimate Tests', () => {
  it('ignores points that are not clearly below the camera', () => {
    const floor = createFloorEstimator();
    expect(floor.addSample(1.3, 1.5)).toBe(false); // a hand or a wall at camera height
    expect(floor.addSample(-1.5, 1.5)).toBe(false); // further down than any held phone
    expect(floor.addSample(Number.NaN, 1.5)).toBe(false);
    expect(floor.sampleCount()).toBe(0);
    expect(MIN_DROP_BELOW_CAMERA_M).toBe(0.4);
    expect(MAX_DROP_BELOW_CAMERA_M).toBe(2.5);
  });

  it('has no answer until enough ground points were seen', () => {
    const floor = createFloorEstimator();
    for (let i = 0; i < MIN_SAMPLES_FOR_FLOOR - 1; i++) floor.addSample(0, 1.5);
    expect(floor.floorY()).toBeNull();
    floor.addSample(0, 1.5);
    expect(floor.floorY()).toBe(0);
  });

  it('takes the median so a few stray points do not move the floor', () => {
    const floor = createFloorEstimator();
    for (let i = 0; i < 10; i++) floor.addSample(-0.5, 1.2);
    floor.addSample(0.3, 1.2); // a chair seat
    floor.addSample(0.2, 1.2);
    expect(floor.floorY()).toBe(-0.5);
  });

  it('keeps only the newest samples so a change of ground level is followed', () => {
    const floor = createFloorEstimator(10);
    for (let i = 0; i < 10; i++) floor.addSample(0, 1.5);
    for (let i = 0; i < 10; i++) floor.addSample(-0.3, 1.5);
    expect(floor.floorY()).toBe(-0.3);
    expect(floor.sampleCount()).toBe(10);
  });
});
