// src/lib/ar/sceneDriver.ts
import * as THREE from 'three';
import { createFloorEstimator } from './floorEstimate';
import { createFloorLine, FLOOR_LINE_LENGTH_M } from './floorLine';
import { createGravePin, createPinLights } from './gravePin';
import { smoothValue } from './smoothing';
import { createNorthAlignment, engineYawDeg, graveWorldPosition, yawRadToward } from './worldAlignment';
import type { XR8Api, XR8PipelineModule, XR8Reality } from './xr8';

// Everything that happens inside the engine's frame loop: measure the floor, align north, place the line from
// the feet to the grave and the pin at the grave. The screen only feeds it GPS and compass readings.

// Camera height above the floor until the floor has been measured from tracked points
export const EYE_HEIGHT_M = 1.5;
// Within this the line is hidden and only the pin marks the spot
export const ARRIVED_M = 5;
// Screen spots (0..1 from the top left) probed for ground points: the lower middle of the view
const FLOOR_PROBES: Array<[number, number]> = [[0.3, 0.7], [0.5, 0.75], [0.7, 0.7], [0.5, 0.9]];
const FLOOR_PROBE_EVERY = 6;
// Per-frame easing: the floor and the line follow smoothly, the grave settles after each fix, north drifts slowly
const FLOOR_ALPHA = 0.08;
const GRAVE_ALPHA = 0.1;
const NORTH_ALPHA = 0.02;
// The eased grave point is treated as converged on the fix once it is within this of the goal, since floating
// point easing can approach a target forever without ever landing on it exactly
const GRAVE_SETTLE_M = 1e-4;

export type TrackingState = 'initialising' | 'limited' | 'normal';

export interface DriverState {
  tracking: TrackingState;
  floorMeasured: boolean;
  aligned: boolean;
}

export interface SceneDriver {
  pipelineModule: XR8PipelineModule;
  // From each smoothed GPS fix: where the grave is from the phone right now
  setTarget(target: { bearingDeg: number; distanceM: number }): void;
  setHeading(headingDeg: number | null): void;
  onState(listener: (state: DriverState) => void): () => void;
  state(): DriverState;
  dispose(): void;
}

function trackingFrom(reality: XR8Reality): TrackingState {
  if (reality.trackingStatus === 'NORMAL') return 'normal';
  return reality.trackingReason === 'INITIALIZING' ? 'initialising' : 'limited';
}

export function createSceneDriver(
  XR8: Pick<XR8Api, 'Threejs' | 'XrController'>,
  now: () => number = () => performance.now()
): SceneDriver {
  const line = createFloorLine();
  line.group.name = 'floor-line';
  const pin = createGravePin();
  pin.group.name = 'grave-pin';
  const lights = createPinLights();
  const floor = createFloorEstimator();
  const north = createNorthAlignment();
  const forward = new THREE.Vector3();

  let camera: THREE.PerspectiveCamera | null = null;
  let scene: THREE.Scene | null = null;
  let heading: number | null = null;
  let target: { bearingDeg: number; distanceM: number } | null = null;
  // The grave's world point is derived once per fix, from where the phone was at that moment
  let targetPending = false;
  let grave: { x: number; z: number } | null = null;
  let floorY = 0;
  let frame = 0;
  let startedAt = now();
  let current: DriverState = { tracking: 'initialising', floorMeasured: false, aligned: false };
  const listeners = new Set<(state: DriverState) => void>();

  const setState = (next: Partial<DriverState>) => {
    const merged = { ...current, ...next };
    if (merged.tracking === current.tracking && merged.floorMeasured === current.floorMeasured && merged.aligned === current.aligned) return;
    current = merged;
    listeners.forEach((listener) => listener(current));
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
    line.group.position.set(feet.x, floorY, feet.z);
    line.group.rotation.y = yaw;
    line.setLength(Math.min(distance, FLOOR_LINE_LENGTH_M));
    line.group.visible = distance > ARRIVED_M;
    // The pin marks the grave, or the end of the line while the grave is still out of the line's reach
    const pinDistance = Math.min(distance, FLOOR_LINE_LENGTH_M);
    pin.group.position.set(feet.x - Math.sin(yaw) * pinDistance, floorY, feet.z - Math.cos(yaw) * pinDistance);
    pin.group.visible = true;
  };

  const pipelineModule: XR8PipelineModule = {
    name: 'qabrmap-scene',
    onStart: () => {
      const xr = XR8.Threejs.xrScene();
      scene = xr.scene;
      camera = xr.camera;
      scene.add(line.group, pin.group, ...lights);
      line.group.visible = false;
      pin.group.visible = false;
      camera.position.set(0, EYE_HEIGHT_M, 0);
      XR8.XrController.updateCameraProjectionMatrix({ origin: camera.position, facing: camera.quaternion });
      startedAt = now();
    },
    onUpdate: ({ processCpuResult }) => {
      if (!camera) return;
      frame += 1;
      const reality = processCpuResult.reality;
      if (reality) setState({ tracking: trackingFrom(reality) });
      const tracking = current.tracking;

      if (tracking === 'normal' && frame % FLOOR_PROBE_EVERY === 0) probeFloor();
      const measured = floor.floorY();
      if (measured !== null) {
        floorY = smoothValue(floorY, measured, FLOOR_ALPHA);
        setState({ floorMeasured: true });
      }

      camera.getWorldDirection(forward);
      if (heading !== null && tracking === 'normal') {
        north.update(heading, engineYawDeg({ x: forward.x, z: forward.z }), NORTH_ALPHA);
      }
      const offset = north.offsetDeg();
      setState({ aligned: offset !== null });

      if (offset !== null && target && targetPending) {
        const goal = graveWorldPosition({
          feet: { x: camera.position.x, z: camera.position.z },
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
      target = next;
      targetPending = true;
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
      listeners.clear();
      scene?.remove(line.group, pin.group, ...lights);
      line.dispose();
      pin.dispose();
    },
  };
}
