import { describe, it, expect } from 'vitest';
import {
  createNorthAlignment,
  engineYawDeg,
  graveWorldPosition,
  worldYawRadForBearing,
  yawRadToward,
} from '../src/lib/ar/worldAlignment';

describe('World Alignment Tests', () => {
  it('reads the engine yaw clockwise from the starting direction', () => {
    expect(engineYawDeg({ x: 0, z: -1 })).toBe(0); // still facing the way tracking started
    expect(engineYawDeg({ x: 1, z: 0 })).toBe(90); // turned right
    expect(engineYawDeg({ x: 0, z: 1 })).toBe(180);
    expect(engineYawDeg({ x: -1, z: 0 })).toBe(270);
  });

  it('takes the first heading as the north offset and eases later ones', () => {
    const north = createNorthAlignment();
    expect(north.offsetDeg()).toBeNull();
    north.update(40, 0, 0.02); // compass says 40 while the engine says 0: north offset 40
    expect(north.offsetDeg()).toBe(40);
    north.update(140, 90, 0.5); // the compass now reads 50 for the engine's forward: half way from 40
    expect(north.offsetDeg()).toBe(45);
    north.update(60, 0, 0.5); // and 60: half way again
    expect(north.offsetDeg()).toBe(52.5);
  });

  it('eases the short way round the compass', () => {
    const north = createNorthAlignment();
    north.update(350, 0, 1);
    north.update(10, 0, 0.5);
    expect(north.offsetDeg()).toBe(0);
  });

  it('turns a group so its forward points along a compass bearing', () => {
    // With north straight ahead, east is a quarter turn clockwise, which is negative about +y
    expect(worldYawRadForBearing(90, 0)).toBeCloseTo(-Math.PI / 2, 9);
    expect(worldYawRadForBearing(0, 0)).toBe(0);
    // If tracking started facing east (offset 90), north is a quarter turn to the left
    expect(worldYawRadForBearing(0, 90)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('places the grave along the bearing from the feet', () => {
    const east = graveWorldPosition({ feet: { x: 1, z: 2 }, bearingDeg: 90, distanceM: 10, offsetDeg: 0 });
    expect(east.x).toBeCloseTo(11, 9);
    expect(east.z).toBeCloseTo(2, 9);
    const north = graveWorldPosition({ feet: { x: 0, z: 0 }, bearingDeg: 0, distanceM: 5, offsetDeg: 0 });
    expect(north.x).toBeCloseTo(0, 9);
    expect(north.z).toBeCloseTo(-5, 9);
  });

  it('finds the yaw that points a group from one point at another', () => {
    expect(yawRadToward({ x: 0, z: 0 }, { x: 0, z: -3 })).toBeCloseTo(0, 9);
    expect(yawRadToward({ x: 0, z: 0 }, { x: 4, z: 0 })).toBeCloseTo(-Math.PI / 2, 9);
  });
});
