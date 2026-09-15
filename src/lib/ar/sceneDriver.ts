// src/lib/ar/sceneDriver.ts
import * as THREE from 'three';
import { createFloorEstimator } from './floorEstimate';
import { createFloorLine, FLOOR_LINE_LENGTH_M } from './floorLine';
import { createGravePin, createPinLights } from './gravePin';
import { calculateBearing, calculateDistanceMeters } from '../geospatial';
import { smoothValue } from './smoothing';
import { createNorthAlignment, engineYawDeg, graveWorldPosition, yawRadToward } from './worldAlignment';
import type { XR8Api, XR8PipelineModule, XR8Reality } from './xr8';

// Everything that happens inside the engine's frame loop: measure the floor, align north, place the line from
// the feet to the grave and the pin at the grave. The screen only feeds it GPS and compass readings.

// Camera height above the floor until the floor has been measured from tracked points
export const EYE_HEIGHT_M = 1.5;
// Within this the line is hidden and only the pin marks the spot
export const ARRIVED_M = 5;
// Arrival only clears again beyond this, so a metre of GPS wobble cannot flicker the line and the pill
export const ARRIVED_EXIT_M = 6.5;
// A fix can describe a point seconds old, so keep this much camera history to pair it with
export const POSE_HISTORY_MS = 15_000;
// Frames that turn more than this are mid-turn, about 90 degrees per second
export const STEADY_YAW_DEG_PER_FRAME = 1.5;
// Screen spots (0..1 from the top left) probed for ground points: the lower middle of the view
const FLOOR_PROBES: Array<[number, number]> = [[0.3, 0.7], [0.5, 0.75], [0.7, 0.7], [0.5, 0.9]];
const FLOOR_PROBE_EVERY = 6;
// Per-frame easing: the floor and the line follow smoothly, the grave settles after each fix, north drifts slowly
const FLOOR_ALPHA = 0.08;
const GRAVE_ALPHA = 0.1;
const NORTH_ALPHA = 0.02;
// North can also be learned from walking: the GPS direction of travel against the engine's own motion. A fix
// must be this far from the last one used, and the engine must have moved this far too, before it counts.
const TRAVEL_MIN_GPS_M = 4;
const TRAVEL_MIN_ENGINE_M = 2;
const TRAVEL_ALPHA = 0.5;
// The eased grave point is treated as converged on the fix once it is within this of the goal, since floating
// point easing can approach a target forever without ever landing on it exactly
const GRAVE_SETTLE_M = 1e-4;

export type TrackingState = 'initialising' | 'limited' | 'normal';

export interface DriverState {
  tracking: TrackingState;
  floorMeasured: boolean;
  aligned: boolean;
  // The whole screen reads arrival from here, so the pill, the text and the button never disagree
  arrived: boolean;
}

export interface SceneDriver {
  pipelineModule: XR8PipelineModule;
  // From each smoothed GPS fix: where the grave is from the phone, when the fix was taken, and where it was,
  // so north can be learned from walking on a phone with no compass
  setTarget(target: { bearingDeg: number; distanceM: number; at?: number; lat?: number; lng?: number }): void;
  setHeading(headingDeg: number | null): void;
  onState(listener: (state: DriverState) => void): () => void;
  state(): DriverState;
  dispose(): void;
}

function trackingFrom(reality: XR8Reality): TrackingState {
  if (reality.trackingStatus === 'NORMAL') return 'normal';
  return reality.trackingReason === 'INITIALIZING' ? 'initialising' : 'limited';
}

// Signed degrees from b to a, wrapping at 360
function yawDelta(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180;
}

export function createSceneDriver(
  XR8: Pick<XR8Api, 'Threejs' | 'XrController'>,
  now: () => number = () => performance.now(),
  // Wall time, shared with the GPS fixes so a fix can be paired with the pose from its own moment
  clock: () => number = () => Date.now()
): SceneDriver {
  const line = createFloorLine();
  line.group.name = 'floor-line';
  const pin = createGravePin();
  pin.group.name = 'grave-pin';
  const lights = createPinLights();
  let floor = createFloorEstimator();
  const north = createNorthAlignment();
  const forward = new THREE.Vector3();

  let camera: THREE.PerspectiveCamera | null = null;
  let scene: THREE.Scene | null = null;
  let heading: number | null = null;
  let target: { bearingDeg: number; distanceM: number; at?: number; lat?: number; lng?: number } | null = null;
  // The last fix used for travel alignment, with the engine feet at that moment
  let lastTravelFix: { lat: number; lng: number; feet: { x: number; z: number } } | null = null;
  // The grave's world point is derived once per fix, from where the phone was at that moment
  let targetPending = false;
  // Feet captured at the moment of the fix, so the grave stays planted in the world while the person walks
  // between fixes rather than being recomputed from wherever the camera is now
  let fixFeet: { x: number; z: number } | null = null;
  // Recent camera poses, oldest first, so a fix that describes a point seconds old is paired with the pose
  // from that moment instead of the live one
  let poses: Array<{ t: number; x: number; z: number }> = [];
  let grave: { x: number; z: number } | null = null;
  let floorY = 0;
  let frame = 0;
  let previousYaw: number | null = null;
  let startedAt = now();
  let disposed = false;
  let current: DriverState = { tracking: 'initialising', floorMeasured: false, aligned: false, arrived: false };
  const listeners = new Set<(state: DriverState) => void>();

  const setState = (next: Partial<DriverState>) => {
    const merged = { ...current, ...next };
    if (
      merged.tracking === current.tracking &&
      merged.floorMeasured === current.floorMeasured &&
      merged.aligned === current.aligned &&
      merged.arrived === current.arrived
    ) {
      return;
    }
    current = merged;
    listeners.forEach((listener) => listener(current));
  };

  // The recorded pose closest to a wall-clock moment, or null when the buffer cannot cover it
  const poseAt = (at: number): { x: number; z: number } | null => {
    if (poses.length === 0 || at < poses[0].t) return null;
    let best = poses[0];
    for (const pose of poses) {
      if (Math.abs(pose.t - at) < Math.abs(best.t - at)) best = pose;
    }
    return { x: best.x, z: best.z };
  };

  // A walk of a few metres gives a GPS course and an engine direction for the same movement; their difference
  // is north. This is the only alignment a phone without a compass gets, and it corrects a compass too.
  const learnFromTravel = (lat: number, lng: number, feet: { x: number; z: number }) => {
    if (!lastTravelFix) {
      lastTravelFix = { lat, lng, feet };
      return;
    }
    if (calculateDistanceMeters(lastTravelFix.lat, lastTravelFix.lng, lat, lng) < TRAVEL_MIN_GPS_M) return;
    const dx = feet.x - lastTravelFix.feet.x;
    const dz = feet.z - lastTravelFix.feet.z;
    if (Math.hypot(dx, dz) >= TRAVEL_MIN_ENGINE_M) {
      const course = calculateBearing(lastTravelFix.lat, lastTravelFix.lng, lat, lng);
      north.update(course, engineYawDeg({ x: dx, z: dz }), north.offsetDeg() === null ? 1 : TRAVEL_ALPHA);
    }
    lastTravelFix = { lat, lng, feet };
  };

  const probeFloor = () => {
    if (!camera) return;
    for (const [x, y] of FLOOR_PROBES) {
      try {
        for (const hit of XR8.XrController.hitTest(x, y, ['FEATURE_POINT', 'ESTIMATED_SURFACE'])) {
          floor.addSample(hit.position.y, camera.position.y);
        }
      } catch {
        // No tracker on this device: the assumed floor stays
      }
    }
  };

  const place = () => {
    if (!camera || !grave) return;
    const feet = { x: camera.position.x, z: camera.position.z };
    const distance = Math.hypot(grave.x - feet.x, grave.z - feet.z);
    const yaw = yawRadToward(feet, grave);
    // Hysteresis: arrival holds until the person is clearly walking away again
    const arrived = current.arrived ? distance <= ARRIVED_EXIT_M : distance <= ARRIVED_M;
    setState({ arrived });
    line.group.position.set(feet.x, floorY, feet.z);
    line.group.rotation.y = yaw;
    line.setLength(Math.min(distance, FLOOR_LINE_LENGTH_M));
    line.group.visible = !arrived;
    // The pin marks the grave itself while it is within the line's reach; beyond that it sits at the line's end
    if (distance <= FLOOR_LINE_LENGTH_M) {
      pin.group.position.set(grave.x, floorY, grave.z);
    } else {
      pin.group.position.set(feet.x - Math.sin(yaw) * FLOOR_LINE_LENGTH_M, floorY, feet.z - Math.cos(yaw) * FLOOR_LINE_LENGTH_M);
    }
    pin.group.visible = true;
  };

  const pipelineModule: XR8PipelineModule = {
    name: 'qabrmap-scene',
    onStart: () => {
      // The engine is a page-wide singleton, so a start can still reach a driver the screen has thrown away
      if (disposed) return;
      const xr = XR8.Threejs.xrScene();
      scene = xr.scene;
      camera = xr.camera;
      scene.add(line.group, pin.group, ...lights);
      line.group.visible = false;
      pin.group.visible = false;
      camera.position.set(0, EYE_HEIGHT_M, 0);
      XR8.XrController.updateCameraProjectionMatrix({ origin: camera.position, facing: camera.quaternion });
      startedAt = now();
      // A restarted engine should not carry a stale world over: forget the old grave, floor and frame count
      grave = null;
      fixFeet = null;
      lastTravelFix = null;
      poses = [];
      previousYaw = null;
      targetPending = target !== null;
      floorY = 0;
      frame = 0;
      floor = createFloorEstimator();
    },
    onUpdate: ({ processCpuResult }) => {
      if (!camera || disposed) return;
      frame += 1;
      const reality = processCpuResult.reality;
      if (reality) setState({ tracking: trackingFrom(reality) });
      const tracking = current.tracking;

      const t = clock();
      poses.push({ t, x: camera.position.x, z: camera.position.z });
      while (poses.length > 0 && t - poses[0].t > POSE_HISTORY_MS) poses.shift();

      if (tracking === 'normal' && frame % FLOOR_PROBE_EVERY === 0) probeFloor();
      const measured = floor.floorY();
      if (measured !== null) {
        floorY = smoothValue(floorY, measured, FLOOR_ALPHA);
        setState({ floorMeasured: true });
      }

      camera.getWorldDirection(forward);
      const yaw = engineYawDeg({ x: forward.x, z: forward.z });
      // The compass lags the engine through a turn, so a yaw read mid-turn pairs a stale heading with a fresh
      // yaw and would pollute the offset. Learn north only from frames where the phone barely moved.
      const steady = previousYaw === null || Math.abs(yawDelta(yaw, previousYaw)) <= STEADY_YAW_DEG_PER_FRAME;
      previousYaw = yaw;
      if (heading !== null && tracking === 'normal' && steady) {
        north.update(heading, yaw, NORTH_ALPHA);
      }
      const offset = north.offsetDeg();
      setState({ aligned: offset !== null });

      if (offset !== null && target && targetPending) {
        if (!fixFeet) fixFeet = { x: camera.position.x, z: camera.position.z };
        const goal = graveWorldPosition({
          feet: fixFeet,
          bearingDeg: target.bearingDeg,
          distanceM: target.distanceM,
          offsetDeg: offset,
        });
        // The first fix places the grave outright; later fixes ease it so it never jumps
        grave = grave ? { x: smoothValue(grave.x, goal.x, GRAVE_ALPHA), z: smoothValue(grave.z, goal.z, GRAVE_ALPHA) } : goal;
        targetPending = Math.hypot(grave.x - goal.x, grave.z - goal.z) > GRAVE_SETTLE_M;
      }

      place();
      const elapsed = (now() - startedAt) / 1000;
      line.animate(elapsed);
      pin.animate(elapsed);
    },
  };

  return {
    pipelineModule,
    setTarget(next) {
      if (!Number.isFinite(next.bearingDeg) || !Number.isFinite(next.distanceM)) return;
      target = next;
      targetPending = true;
      // Plant from where the phone stood when the fix was taken, not from where it has walked to since
      const recorded = next.at === undefined ? null : poseAt(next.at);
      fixFeet = recorded ?? (camera ? { x: camera.position.x, z: camera.position.z } : null);
      if (fixFeet && Number.isFinite(next.lat) && Number.isFinite(next.lng)) {
        learnFromTravel(next.lat as number, next.lng as number, fixFeet);
      }
    },
    setHeading(next) {
      heading = next;
    },
    onState(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    state: () => current,
    dispose() {
      disposed = true;
      listeners.clear();
      scene?.remove(line.group, pin.group, ...lights);
      line.dispose();
      pin.dispose();
      lights.forEach((light) => light.dispose());
    },
  };
}
