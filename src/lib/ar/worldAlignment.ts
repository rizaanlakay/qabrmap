import { smoothAngle } from './smoothing';

// The engine's world starts with the camera facing -z and knows nothing about north. The compass supplies
// north once tracking is steady, and these helpers turn compass bearings into rotations in that world.

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;
const normalise = (deg: number) => ((deg % 360) + 360) % 360;

// Degrees clockwise (seen from above) that the camera has turned since tracking started
export function engineYawDeg(forward: { x: number; z: number }): number {
  return normalise(Math.round(toDeg(Math.atan2(forward.x, -forward.z)) * 1e6) / 1e6);
}

export interface NorthAlignment {
  update(headingDeg: number, engineYawDeg: number, alpha: number): void;
  // Compass heading of the engine's starting direction, or null before the first update
  offsetDeg(): number | null;
}

// Compass heading minus engine yaw is the heading the engine calls "straight ahead". It should be constant;
// easing it lets slow drift through while compass noise cannot swing the line.
export function createNorthAlignment(): NorthAlignment {
  let offset: number | null = null;
  return {
    update(headingDeg, yawDeg, alpha) {
      const measured = normalise(headingDeg - yawDeg);
      offset = smoothAngle(offset, measured, offset === null ? 1 : alpha);
    },
    offsetDeg: () => offset,
  };
}

// rotation.y that turns a group's -z toward the compass bearing. Clockwise from above is negative about +y.
export function worldYawRadForBearing(bearingDeg: number, offsetDeg: number): number {
  return toRad(offsetDeg - bearingDeg);
}

// The point distanceM along a bearing from the feet, in engine world coordinates
export function graveWorldPosition(input: {
  feet: { x: number; z: number };
  bearingDeg: number;
  distanceM: number;
  offsetDeg: number;
}): { x: number; z: number } {
  const yaw = worldYawRadForBearing(input.bearingDeg, input.offsetDeg);
  return { x: input.feet.x - Math.sin(yaw) * input.distanceM, z: input.feet.z - Math.cos(yaw) * input.distanceM };
}

// rotation.y that points a group's -z from one world point at another
export function yawRadToward(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}
