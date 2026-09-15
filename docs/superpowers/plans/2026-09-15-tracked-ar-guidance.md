# Tracked AR Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The AR guidance screen draws its chevron line and a 3D pin on the real floor using the 8th Wall engine's world tracking, aligned to north with the compass and to the grave with GPS, falling back to the existing sensor-driven screen when the engine cannot start.

**Architecture:** Pure modules hold the maths (`worldAlignment`), the three.js objects (`floorLine`, `gravePin`) and the per-frame logic (`sceneDriver`, driven through a fake engine in tests). A new screen owns the engine lifecycle, GPS, compass and the existing UI; the old screen is renamed and kept as the fallback; a thin switch component keeps the page's props unchanged.

**Tech Stack:** Next.js 14 App Router (client components), React 18, TypeScript, three.js 0.170, 8th Wall engine binary 1.0.0 (CDN), Vitest 2 (Node environment, no DOM).

**Spec:** `docs/superpowers/specs/2026-09-15-tracked-ar-guidance-design.md`

## Global Constraints

- Never use em dashes in code comments, UI copy, commit messages or docs. Use commas, colons, periods or parentheses.
- Runtime imports inside `src/lib/**` use relative paths (`./smoothing`), because Vitest has no `@/` alias. Type-only imports may use `@/types`. Components may use `@/`.
- Tests run in plain Node: no `document`, no `window`, no WebGL. three.js geometry and math work in Node; anything touching `document` must be guarded.
- Constants: line length 12 m, arrival 5 m, eye height 1.5 m, floor probes every 6 frames at `[[0.3, 0.7], [0.5, 0.75], [0.7, 0.7], [0.5, 0.9]]`, floor and line easing 0.08 per frame, grave easing 0.1 per frame, north alignment easing 0.02 per frame while tracking is NORMAL, pin 0.9 m tall, 0.5 m wide, 0.2 m thick, bounce `0.12 + 0.18 * |sin(2.2 t)|`, spin 0.6 rad/s.
- Match the surrounding code: 2-space indent, single quotes, short comments that explain why, Tailwind in the existing style.
- Always `git add` explicit paths, never `git add -A` or `git add .`. The two untracked PostGIS migration files in the checkout belong to the user; never stage them.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  ```
- Run one test file: `npx vitest run tests/<file>.test.ts`. Run all tests: `npx vitest run`. Type check: `npx tsc --noEmit`. Baseline before this plan: 48 files, 357 tests passing, type check clean. If node crashes with "Fatal process out of memory", wait a minute and run again.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/ar/worldAlignment.ts` | Create | Engine yaw, north offset, bearing to world yaw, grave world position |
| `tests/world_alignment.test.ts` | Create | Alignment maths tests |
| `src/lib/ar/floorLine.ts` | Modify | `setLength`, texture guarded for Node |
| `tests/floor_line.test.ts` | Create | Length and chevron visibility |
| `src/lib/ar/gravePin.ts` | Create | Extruded 3D pin, bounce and spin, lights |
| `tests/grave_pin.test.ts` | Create | Pin origin at the tip, animation moves and spins |
| `src/lib/ar/sceneDriver.ts` | Create | Pipeline module: floor, alignment, line and pin placement |
| `tests/scene_driver.test.ts` | Create | Driver against a fake engine |
| `src/lib/ar/xr8.ts` | Modify | `preloadXR8` |
| `src/components/screens/NavigationScreen.tsx` | Modify | Preload when nearby |
| `src/components/screens/ProfileScreen.tsx` | Modify | Licence block |
| `src/components/screens/ARSensorGuidanceScreen.tsx` | Rename from `ARGuidanceScreen.tsx` | The existing sensor-driven screen, unchanged |
| `src/components/screens/ARTrackedGuidanceScreen.tsx` | Create | Engine-driven screen |
| `src/components/screens/ARGuidanceScreen.tsx` | Create (new content) | Switch: tracked first, sensor on fallback |
| `src/app/ar-spike/page.tsx` | Delete | Spike removed |

---

### Task 1: World alignment maths

**Files:**
- Create: `src/lib/ar/worldAlignment.ts`
- Test: `tests/world_alignment.test.ts`

**Interfaces:**
- Consumes: `smoothAngle(prev, next, alpha)` from `src/lib/ar/smoothing.ts`.
- Produces:
  ```ts
  export function engineYawDeg(forward: { x: number; z: number }): number;
  export interface NorthAlignment { update(headingDeg: number, engineYawDeg: number, alpha: number): void; offsetDeg(): number | null }
  export function createNorthAlignment(): NorthAlignment;
  export function worldYawRadForBearing(bearingDeg: number, offsetDeg: number): number;
  export function graveWorldPosition(input: { feet: { x: number; z: number }; bearingDeg: number; distanceM: number; offsetDeg: number }): { x: number; z: number };
  export function yawRadToward(from: { x: number; z: number }, to: { x: number; z: number }): number;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/world_alignment.test.ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/world_alignment.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/ar/worldAlignment.ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/world_alignment.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ar/worldAlignment.ts tests/world_alignment.test.ts
git commit -m "feat(ar): align the tracked world to the compass

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Floor line length and Node-safe texture

**Files:**
- Modify: `src/lib/ar/floorLine.ts`
- Test: `tests/floor_line.test.ts`

**Interfaces:**
- Produces: `FloorLine.setLength(metres: number): void` (clamped 0.5..12) and `FloorLine.length(): number`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/floor_line.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CHEVRON_COUNT, createFloorLine, FLOOR_LINE_LENGTH_M } from '../src/lib/ar/floorLine';

function chevrons(group: THREE.Group): THREE.Mesh[] {
  return group.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.name === 'chevron');
}

describe('Floor Line Tests', () => {
  it('builds without a DOM', () => {
    const line = createFloorLine();
    expect(chevrons(line.group)).toHaveLength(CHEVRON_COUNT);
    expect(line.length()).toBe(FLOOR_LINE_LENGTH_M);
    line.dispose();
  });

  it('shortens to the grave and hides chevrons past the end', () => {
    const line = createFloorLine();
    line.setLength(4);
    line.animate(0);
    expect(line.length()).toBe(4);
    const visible = chevrons(line.group).filter((c) => c.visible);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((c) => -c.position.z <= 4)).toBe(true);
    const strip = line.group.getObjectByName('strip') as THREE.Mesh;
    expect(strip.position.z).toBeCloseTo(-2, 9);
    line.dispose();
  });

  it('clamps the length', () => {
    const line = createFloorLine();
    line.setLength(0);
    expect(line.length()).toBe(0.5);
    line.setLength(50);
    expect(line.length()).toBe(FLOOR_LINE_LENGTH_M);
    line.dispose();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/floor_line.test.ts`
Expected: FAIL, `document is not defined` or `setLength` missing.

- [ ] **Step 3: Implement**

In `src/lib/ar/floorLine.ts`:

- Add `export const MIN_LINE_LENGTH_M = 0.5;`.
- Extend the interface:
  ```ts
  export interface FloorLine {
    group: THREE.Group;
    animate: (elapsed: number) => void;
    // Ends the line at the grave when it is closer than the full length
    setLength: (metres: number) => void;
    length: () => number;
    dispose: () => void;
  }
  ```
- Make the texture optional: change `chevronTexture()` to return `THREE.CanvasTexture | null`, returning `null` when `typeof document === 'undefined'` (tests run in Node). The chevron material becomes `new THREE.MeshBasicMaterial({ map: texture ?? undefined, color: texture ? 0xffffff : 0x34d399, transparent: true, depthWrite: false })`, and `dispose` only disposes the texture when it exists.
- Name the meshes: `strip.name = 'strip'` and `chevron.name = 'chevron'`.
- Track the length:
  ```ts
  let currentLength = FLOOR_LINE_LENGTH_M;
  const setLength = (metres: number) => {
    currentLength = Math.min(FLOOR_LINE_LENGTH_M, Math.max(MIN_LINE_LENGTH_M, metres));
    // The strip is a plane along local y, which lies along -z once it is flat on the floor
    strip.scale.y = currentLength / FLOOR_LINE_LENGTH_M;
    strip.position.z = -currentLength / 2;
  };
  ```
- In `animate`, after setting `chevron.position.z`, add `chevron.visible = distance <= currentLength;`.
- Return `{ group, animate, setLength, length: () => currentLength, dispose }`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/floor_line.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ar/floorLine.ts tests/floor_line.test.ts
git commit -m "feat(ar): let the floor line end at the grave and build without a DOM

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The 3D grave pin

**Files:**
- Create: `src/lib/ar/gravePin.ts`
- Test: `tests/grave_pin.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PIN_HEIGHT_M = 0.9; export const PIN_WIDTH_M = 0.5; export const PIN_THICKNESS_M = 0.2;
  export interface GravePin { group: THREE.Group; animate: (elapsed: number) => void; dispose: () => void }
  export function createGravePin(): GravePin;
  export function createPinLights(): THREE.Light[];
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/grave_pin.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createGravePin, createPinLights, PIN_HEIGHT_M, PIN_THICKNESS_M, PIN_WIDTH_M } from '../src/lib/ar/gravePin';

describe('Grave Pin Tests', () => {
  it('is a solid pin standing on its tip with the spec dimensions', () => {
    const pin = createGravePin();
    const box = new THREE.Box3().setFromObject(pin.group);
    const size = box.getSize(new THREE.Vector3());
    expect(box.min.y).toBeGreaterThanOrEqual(-0.03); // the tip, plus a little bevel
    expect(size.y).toBeCloseTo(PIN_HEIGHT_M, 1);
    expect(size.x).toBeCloseTo(PIN_WIDTH_M, 1);
    expect(size.z).toBeCloseTo(PIN_THICKNESS_M, 1);
    expect(PIN_THICKNESS_M).toBe(0.2);
    pin.dispose();
  });

  it('bounces above the floor and spins slowly', () => {
    const pin = createGravePin();
    pin.animate(0);
    const restY = pin.group.children[0].position.y;
    pin.animate(0.7);
    const upY = pin.group.children[0].position.y;
    expect(upY).toBeGreaterThan(restY);
    expect(upY).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(pin.group.rotation.y).toBeCloseTo(0.42, 9);
    pin.animate(10.472);
    expect(pin.group.rotation.y).toBeCloseTo(6.2832, 3); // one full turn every ten and a half seconds
    pin.dispose();
  });

  it('comes with lights so the solid pin has shading', () => {
    const lights = createPinLights();
    expect(lights.some((light) => light instanceof THREE.HemisphereLight)).toBe(true);
    expect(lights.some((light) => light instanceof THREE.DirectionalLight)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/grave_pin.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/ar/gravePin.ts
import * as THREE from 'three';

// A solid map pin standing on the floor at the grave's spot. Extruded so it has real thickness and reads as an
// object in the scene, and it bounces and turns slowly so the eye finds it.

export const PIN_HEIGHT_M = 0.9;
export const PIN_WIDTH_M = 0.5;
export const PIN_THICKNESS_M = 0.2;
const HEAD_RADIUS_M = PIN_WIDTH_M / 2;
const HEAD_CENTRE_Y = PIN_HEIGHT_M - HEAD_RADIUS_M;
const HOLE_RADIUS_M = 0.09;
const BEVEL_M = 0.015;
// Bounce: never touching the floor, up to 0.3 m; spin: one turn every ten and a half seconds
const BOUNCE_BASE_M = 0.12;
const BOUNCE_HEIGHT_M = 0.18;
const BOUNCE_RATE = 2.2;
const SPIN_RATE = 0.6;

export interface GravePin {
  group: THREE.Group;
  animate: (elapsed: number) => void;
  dispose: () => void;
}

// Teardrop outline: round head with a hole, sides curving down to a point at the origin
function pinShape(): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(-HEAD_RADIUS_M * 1.15, HEAD_CENTRE_Y * 0.7, -HEAD_RADIUS_M, HEAD_CENTRE_Y);
  shape.absarc(0, HEAD_CENTRE_Y, HEAD_RADIUS_M, Math.PI, 0, true);
  shape.quadraticCurveTo(HEAD_RADIUS_M * 1.15, HEAD_CENTRE_Y * 0.7, 0, 0);
  const hole = new THREE.Path();
  hole.absarc(0, HEAD_CENTRE_Y, HOLE_RADIUS_M, 0, Math.PI * 2, false);
  shape.holes.push(hole);
  return shape;
}

export function createGravePin(): GravePin {
  const group = new THREE.Group();
  const geometry = new THREE.ExtrudeGeometry(pinShape(), {
    depth: PIN_THICKNESS_M - 2 * BEVEL_M,
    bevelEnabled: true,
    bevelThickness: BEVEL_M,
    bevelSize: BEVEL_M,
    bevelSegments: 3,
    curveSegments: 24,
  });
  // Centre the thickness on the group so the pin stands on its tip at the group's origin
  geometry.translate(0, 0, -(PIN_THICKNESS_M - 2 * BEVEL_M) / 2);
  const material = new THREE.MeshStandardMaterial({
    color: 0x34d399,
    emissive: 0x065f46,
    emissiveIntensity: 0.35,
    roughness: 0.4,
    metalness: 0.1,
  });
  const body = new THREE.Mesh(geometry, material);
  body.name = 'pin-body';
  group.add(body);

  const animate = (elapsed: number) => {
    body.position.y = BOUNCE_BASE_M + BOUNCE_HEIGHT_M * Math.abs(Math.sin(elapsed * BOUNCE_RATE));
    group.rotation.y = elapsed * SPIN_RATE;
  };
  animate(0);

  const dispose = () => {
    geometry.dispose();
    material.dispose();
  };

  return { group, animate, dispose };
}

// Soft sky light plus a key light, enough for the standard material to show the pin's edges
export function createPinLights(): THREE.Light[] {
  const sky = new THREE.HemisphereLight(0xffffff, 0x2f4f3f, 1.2);
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(1, 3, 2);
  return [sky, key];
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/grave_pin.test.ts`
Expected: PASS, 3 tests. If the width or height assertion is off by more than 0.05 because of the bevel, loosen `toBeCloseTo(..., 1)` stays (it allows 0.05); adjust `HEAD_RADIUS_M * 1.15` only if the width overshoots.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ar/gravePin.ts tests/grave_pin.test.ts
git commit -m "feat(ar): solid bouncing, spinning grave pin

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Scene driver

**Files:**
- Create: `src/lib/ar/sceneDriver.ts`
- Test: `tests/scene_driver.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3, `createFloorEstimator` and `MIN_SAMPLES_FOR_FLOOR` from `./floorEstimate`, `XR8Api`, `XR8PipelineModule` from `./xr8`, `smoothValue` from `./smoothing`.
- Produces:
  ```ts
  export type TrackingState = 'initialising' | 'limited' | 'normal';
  export interface DriverState { tracking: TrackingState; floorMeasured: boolean; aligned: boolean }
  export interface SceneDriver {
    pipelineModule: XR8PipelineModule;
    setTarget(target: { bearingDeg: number; distanceM: number }): void;
    setHeading(headingDeg: number | null): void;
    onState(listener: (state: DriverState) => void): () => void;
    state(): DriverState;
    dispose(): void;
  }
  export function createSceneDriver(XR8: Pick<XR8Api, 'Threejs' | 'XrController'>, now?: () => number): SceneDriver;
  export const EYE_HEIGHT_M = 1.5; export const ARRIVED_M = 5;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/scene_driver.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ARRIVED_M, createSceneDriver, EYE_HEIGHT_M } from '../src/lib/ar/sceneDriver';
import { FLOOR_LINE_LENGTH_M } from '../src/lib/ar/floorLine';

// The engine, reduced to what the driver touches: a three.js scene and camera, and a hit test that returns
// ground points a set distance below the camera
function fakeEngine(floorBelowCameraM = 1.4) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  return {
    scene,
    camera,
    XR8: {
      Threejs: { pipelineModule: () => ({ name: 'three' }), xrScene: () => ({ scene, camera, renderer: {} as THREE.WebGLRenderer }) },
      XrController: {
        pipelineModule: () => ({ name: 'xr' }),
        configure: () => {},
        updateCameraProjectionMatrix: () => {},
        recenter: () => {},
        hitTest: () => [{ type: 'FEATURE_POINT', position: { x: 0, y: camera.position.y - floorBelowCameraM, z: -2 }, distance: 2 }],
      },
    },
  };
}

const normal = { processCpuResult: { reality: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, trackingStatus: 'NORMAL' as const, trackingReason: 'UNSPECIFIED' as const } } };
const initialising = { processCpuResult: { reality: { ...normal.processCpuResult.reality, trackingStatus: 'LIMITED' as const, trackingReason: 'INITIALIZING' as const } } };

describe('Scene Driver Tests', () => {
  it('starts hidden, reports tracking states, and shows the line once aligned', () => {
    const engine = fakeEngine();
    let clock = 0;
    const driver = createSceneDriver(engine.XR8, () => clock);
    const states: string[] = [];
    driver.onState((s) => states.push(`${s.tracking}/${s.aligned}`));
    driver.pipelineModule.onStart?.({ canvasWidth: 390, canvasHeight: 780 });
    expect(engine.camera.position.y).toBe(EYE_HEIGHT_M);

    driver.pipelineModule.onUpdate?.(initialising);
    expect(driver.state().tracking).toBe('initialising');
    const line = engine.scene.getObjectByName('floor-line') as THREE.Group;
    const pin = engine.scene.getObjectByName('grave-pin') as THREE.Group;
    expect(line.visible).toBe(false);
    expect(pin.visible).toBe(false);

    driver.setHeading(0);
    driver.setTarget({ bearingDeg: 90, distanceM: 10 });
    clock = 16;
    driver.pipelineModule.onUpdate?.(normal);
    expect(driver.state().tracking).toBe('normal');
    expect(driver.state().aligned).toBe(true);
    expect(line.visible).toBe(true);
    expect(pin.visible).toBe(true);
    expect(states).toContain('normal/true');
    driver.dispose();
  });

  it('points the line east and puts the pin 10 m east when tracking started facing north', () => {
    const engine = fakeEngine();
    const driver = createSceneDriver(engine.XR8, () => 0);
    driver.pipelineModule.onStart?.({ canvasWidth: 390, canvasHeight: 780 });
    driver.setHeading(0);
    driver.setTarget({ bearingDeg: 90, distanceM: 10 });
    driver.pipelineModule.onUpdate?.(normal);
    const line = engine.scene.getObjectByName('floor-line') as THREE.Group;
    const pin = engine.scene.getObjectByName('grave-pin') as THREE.Group;
    expect(line.rotation.y).toBeCloseTo(-Math.PI / 2, 6);
    expect(pin.position.x).toBeCloseTo(10, 6);
    expect(pin.position.z).toBeCloseTo(0, 6);
    driver.dispose();
  });

  it('keeps the pin at the line end when the grave is further than the line', () => {
    const engine = fakeEngine();
    const driver = createSceneDriver(engine.XR8, () => 0);
    driver.pipelineModule.onStart?.({ canvasWidth: 390, canvasHeight: 780 });
    driver.setHeading(0);
    driver.setTarget({ bearingDeg: 0, distanceM: 40 });
    driver.pipelineModule.onUpdate?.(normal);
    const pin = engine.scene.getObjectByName('grave-pin') as THREE.Group;
    expect(pin.position.z).toBeCloseTo(-FLOOR_LINE_LENGTH_M, 6);
    driver.dispose();
  });

  it('hides the line but keeps the pin on arrival', () => {
    const engine = fakeEngine();
    const driver = createSceneDriver(engine.XR8, () => 0);
    driver.pipelineModule.onStart?.({ canvasWidth: 390, canvasHeight: 780 });
    driver.setHeading(0);
    driver.setTarget({ bearingDeg: 0, distanceM: ARRIVED_M - 1 });
    driver.pipelineModule.onUpdate?.(normal);
    const line = engine.scene.getObjectByName('floor-line') as THREE.Group;
    const pin = engine.scene.getObjectByName('grave-pin') as THREE.Group;
    expect(line.visible).toBe(false);
    expect(pin.visible).toBe(true);
    driver.dispose();
  });

  it('lowers the line onto the measured floor', () => {
    const engine = fakeEngine(1.4);
    const driver = createSceneDriver(engine.XR8, () => 0);
    driver.pipelineModule.onStart?.({ canvasWidth: 390, canvasHeight: 780 });
    driver.setHeading(0);
    driver.setTarget({ bearingDeg: 0, distanceM: 8 });
    for (let i = 0; i < 400; i++) driver.pipelineModule.onUpdate?.(normal);
    const line = engine.scene.getObjectByName('floor-line') as THREE.Group;
    expect(driver.state().floorMeasured).toBe(true);
    expect(line.position.y).toBeCloseTo(EYE_HEIGHT_M - 1.4, 1);
    driver.dispose();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/scene_driver.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
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
        targetPending = grave.x !== goal.x || grave.z !== goal.z;
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
```

Note on `targetPending`: after the first fix the grave is placed outright and the flag clears; on later fixes the flag stays true while the eased point still differs from the goal, so easing continues over the following frames and stops when it converges. If a floating-point tail keeps the flag set forever, compare with a tolerance of 1e-4 m instead of strict equality.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/scene_driver.test.ts tests/world_alignment.test.ts tests/floor_line.test.ts tests/grave_pin.test.ts`
Expected: PASS. The "lowers the line" test: the fake hit test returns one point per probe (four per probe round), a round every 6 frames, so 8 samples arrive by frame 12 and the floor eases to `1.5 - 1.4 = 0.1` well within 400 frames.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ar/sceneDriver.ts tests/scene_driver.test.ts
git commit -m "feat(ar): scene driver that places the line and pin in the tracked world

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Preload, profile licence block

**Files:**
- Modify: `src/lib/ar/xr8.ts`
- Modify: `src/components/screens/NavigationScreen.tsx`
- Modify: `src/components/screens/ProfileScreen.tsx`

**Interfaces:**
- Produces: `export function preloadXR8(): void` in `src/lib/ar/xr8.ts`.

- [ ] **Step 1: preloadXR8**

Append to `src/lib/ar/xr8.ts`:

```ts
// Starts the download early (about 6.5 MB) so the AR screen opens without a wait; failures are left for the
// AR screen to report
export function preloadXR8(): void {
  if (typeof window === 'undefined') return;
  loadXR8().catch(() => {});
}
```

- [ ] **Step 2: Navigation preload**

In `src/components/screens/NavigationScreen.tsx` import `preloadXR8` from `@/lib/ar/xr8` and, next to the existing effect that reads `isNearby` (about line 1126, `if (isNearby) snapSheet(true);`), add:

```ts
  // The AR engine is a large download, so fetch it as soon as the "Open AR" prompt appears
  useEffect(() => {
    if (isNearby) preloadXR8();
  }, [isNearby]);
```

- [ ] **Step 3: Profile licence block**

In `src/components/screens/ProfileScreen.tsx` import `XR_ENGINE_LICENSE_URL, XR_ENGINE_NOTICE` from `@/lib/ar/xr8`, and directly above the `{/* Sign Out Button */}` comment insert:

```tsx
        {/* Required by the XR engine licence wherever the engine is used */}
        <div className="bg-white border border-slate-200 rounded-2xl p-3 text-[11px] text-slate-500 leading-relaxed">
          <span className="block text-xs font-semibold text-slate-800 mb-1">Open source and licences</span>
          {XR_ENGINE_NOTICE}{' '}
          <a href={XR_ENGINE_LICENSE_URL} target="_blank" rel="noopener noreferrer" className="underline text-emerald-800">
            Licence
          </a>
        </div>
```

- [ ] **Step 4: Type check and commit**

Run: `npx tsc --noEmit`

```bash
git add src/lib/ar/xr8.ts src/components/screens/NavigationScreen.tsx src/components/screens/ProfileScreen.tsx
git commit -m "feat(ar): preload the AR engine near the grave and show its licence notice

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The tracked AR screen, the switch, and the spike removal

**Files:**
- Rename: `src/components/screens/ARGuidanceScreen.tsx` to `src/components/screens/ARSensorGuidanceScreen.tsx` (with `git mv`), changing only the exported component name to `ARSensorGuidanceScreen` and its props interface name to `ARSensorGuidanceScreenProps`
- Create: `src/components/screens/ARTrackedGuidanceScreen.tsx`
- Create: `src/components/screens/ARGuidanceScreen.tsx`
- Delete: `src/app/ar-spike/page.tsx`

**Interfaces:**
- `ARGuidanceScreen` keeps exactly the props `page.tsx` passes today: `targetGrave`, `userLocation`, `onUpdateUserLocation`, `onClose`, `onConfirmVisit` (and the optional `distanceMeters`).
- `ARTrackedGuidanceScreen` takes the same props plus `onFallback: (reason: string) => void`.

- [ ] **Step 1: Rename the sensor screen**

```bash
git mv src/components/screens/ARGuidanceScreen.tsx src/components/screens/ARSensorGuidanceScreen.tsx
```

In the renamed file rename `ARGuidanceScreenProps` to `ARSensorGuidanceScreenProps` and `export const ARGuidanceScreen` to `export const ARSensorGuidanceScreen`. Nothing else changes.

- [ ] **Step 2: The switch**

```tsx
// src/components/screens/ARGuidanceScreen.tsx
'use client';

import React, { useState } from 'react';
import { ARSensorGuidanceScreen, ARSensorGuidanceScreenProps } from './ARSensorGuidanceScreen';
import { ARTrackedGuidanceScreen } from './ARTrackedGuidanceScreen';

// The tracked screen paints the line on the real floor; if its engine cannot start on this phone or
// connection, the sensor-driven screen takes over with the same props
export const ARGuidanceScreen: React.FC<ARSensorGuidanceScreenProps> = (props) => {
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  if (fallbackReason) return <ARSensorGuidanceScreen {...props} />;
  return <ARTrackedGuidanceScreen {...props} onFallback={setFallbackReason} />;
};
```

Export `ARSensorGuidanceScreenProps` from the renamed file (add `export` to the interface).

- [ ] **Step 3: The tracked screen**

```tsx
// src/components/screens/ARTrackedGuidanceScreen.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import * as THREE from 'three';
import { X } from 'lucide-react';
import { Grave } from '@/types';
import { calculateDistanceMeters, calculateBearing } from '@/lib/geospatial';
import { isUsableGpsFix } from '@/lib/geospatial/routeProgress';
import { useWakeLock } from '@/lib/device/useWakeLock';
import { useCompassHeading } from '@/lib/device/useCompassHeading';
import type { CompassStatus } from '@/lib/device/compass';
import { graveNumberLabel } from '@/lib/ui/graveLabels';
import { pruneFixes, smoothFixes, TimedFix } from '@/lib/capture/gpsFixes';
import { smoothAngle, smoothValue } from '@/lib/ar/smoothing';
import { loadXR8, XR8Api, XR_ENGINE_LICENSE_URL, XR_ENGINE_NOTICE } from '@/lib/ar/xr8';
import { ARRIVED_M, createSceneDriver, DriverState } from '@/lib/ar/sceneDriver';
import type { VisitFix } from '@/lib/graves/visits';
import { VisitConfirmButton } from '@/components/common/VisitConfirmButton';
import { LookForThisGrave } from '@/components/common/LookForThisGrave';

interface ARTrackedGuidanceScreenProps {
  targetGrave: Grave;
  userLocation?: { lat: number; lng: number };
  distanceMeters?: number;
  onUpdateUserLocation?: (loc: { lat: number; lng: number }) => void;
  onClose: () => void;
  onConfirmVisit?: (grave: Grave, fix: VisitFix) => Promise<Grave>;
  // Called once when the engine cannot start; the caller shows the sensor screen instead
  onFallback: (reason: string) => void;
}

// Sensor smoothing for the badge and turn text, as on the sensor screen
const ALPHA_POSITION = 0.3;
const ALPHA_ORIENTATION = 0.25;

function describeMissingHeading(status: CompassStatus): string {
  if (status === 'needs-permission') return 'Tap the screen to start the compass';
  if (status === 'denied') return 'Allow motion access for this site in Settings';
  if (status === 'unsupported') return 'Compass not available on this device';
  return 'Waiting for compass…';
}

// What the status pill says for each stage of tracking
function describeTracking(state: DriverState, arrived: boolean, accuracy: number): string {
  if (state.tracking === 'initialising') return 'Move the phone slowly sideways so it can find the floor';
  if (state.tracking === 'limited') return 'Tracking is limited. Point at the ground and move slowly';
  if (!state.aligned) return 'Waiting for the compass…';
  return arrived ? `± ${accuracy} m. Not the right name? Look around this spot.` : 'Follow the line';
}

export const ARTrackedGuidanceScreen: React.FC<ARTrackedGuidanceScreenProps> = ({
  targetGrave,
  userLocation,
  distanceMeters: initialDistance = 8,
  onUpdateUserLocation,
  onClose,
  onConfirmVisit,
  onFallback,
}) => {
  useWakeLock(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const driverRef = useRef<ReturnType<typeof createSceneDriver> | null>(null);
  const [engineStatus, setEngineStatus] = useState<'loading' | 'camera' | 'running'>('loading');
  const [driverState, setDriverState] = useState<DriverState>({ tracking: 'initialising', floorMeasured: false, aligned: false });
  const { heading: phoneHeading, status: compassStatus } = useCompassHeading();

  // Callbacks read through refs so the engine and GPS effects run once
  const onFallbackRef = useRef(onFallback);
  const onUpdateUserLocationRef = useRef(onUpdateUserLocation);
  useEffect(() => {
    onFallbackRef.current = onFallback;
    onUpdateUserLocationRef.current = onUpdateUserLocation;
  }, [onFallback, onUpdateUserLocation]);

  // Own GPS watch, smoothed like the capture screen
  const fixesRef = useRef<TimedFix[]>([]);
  const [fix, setFix] = useState<VisitFix | null>(null);
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!isUsableGpsFix(pos.coords.latitude, pos.coords.longitude)) return;
        const now = Date.now();
        fixesRef.current = pruneFixes(fixesRef.current, now);
        fixesRef.current.push({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: now });
        const smoothed = smoothFixes(fixesRef.current, now);
        setFix(smoothed);
        if (smoothed) onUpdateUserLocationRef.current?.({ lat: smoothed.lat, lng: smoothed.lng });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const here = fix ?? userLocation;
  const rawDistance = here ? calculateDistanceMeters(here.lat, here.lng, targetGrave.latitude, targetGrave.longitude) : initialDistance;
  const rawBearing = here ? calculateBearing(here.lat, here.lng, targetGrave.latitude, targetGrave.longitude) : 0;

  const [liveDistance, setLiveDistance] = useState<number | null>(null);
  const [targetBearing, setTargetBearing] = useState<number | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  useEffect(() => {
    setLiveDistance((prev) => smoothValue(prev, rawDistance, ALPHA_POSITION));
    setTargetBearing((prev) => smoothAngle(prev, rawBearing, ALPHA_POSITION));
  }, [rawDistance, rawBearing]);
  useEffect(() => {
    if (phoneHeading !== null) setHeading((prev) => smoothAngle(prev, phoneHeading, ALPHA_ORIENTATION));
  }, [phoneHeading]);

  const distance = liveDistance ?? rawDistance;
  const bearing = targetBearing ?? rawBearing;
  const arrived = distance <= ARRIVED_M;

  // Feed the scene: the grave from each fix, the compass whenever it changes
  useEffect(() => {
    if (here) driverRef.current?.setTarget({ bearingDeg: rawBearing, distanceM: rawDistance });
  }, [here, rawBearing, rawDistance]);
  useEffect(() => {
    driverRef.current?.setHeading(phoneHeading);
  }, [phoneHeading]);

  // Start the engine once; anything that stops it starting hands over to the sensor screen
  useEffect(() => {
    let cancelled = false;
    let engine: XR8Api | null = null;
    let onResize: (() => void) | null = null;

    const start = async () => {
      let XR8: XR8Api;
      try {
        XR8 = await loadXR8();
      } catch (err) {
        onFallbackRef.current(err instanceof Error ? err.message : 'engine-load');
        return;
      }
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      engine = XR8;
      // The engine sizes its buffer and inline style from the canvas attributes, so they must match the screen
      const fitCanvas = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
      };
      fitCanvas();
      onResize = fitCanvas;
      window.addEventListener('resize', onResize);
      window.THREE = THREE;

      const driver = createSceneDriver(XR8);
      driverRef.current = driver;
      driver.onState(setDriverState);
      driver.setHeading(phoneHeading);

      try {
        XR8.XrController.configure({ scale: 'absolute', disableWorldTracking: false });
        XR8.addCameraPipelineModules([
          XR8.XrController.pipelineModule(),
          XR8.GlTextureRenderer.pipelineModule(),
          XR8.Threejs.pipelineModule(),
          {
            name: 'qabrmap-screen',
            onStart: () => {
              fitCanvas();
              setEngineStatus('running');
            },
            onCameraStatusChange: ({ status }) => {
              if (status === 'requesting') setEngineStatus('camera');
              if (status === 'failed') onFallbackRef.current('camera');
            },
            onException: (error) => onFallbackRef.current(error instanceof Error ? error.message : 'engine'),
          },
          driver.pipelineModule,
        ]);
        XR8.run({ canvas, allowedDevices: XR8.XrConfig.device().ANY });
      } catch (err) {
        onFallbackRef.current(err instanceof Error ? err.message : 'engine-start');
      }
    };
    void start();

    return () => {
      cancelled = true;
      if (onResize) window.removeEventListener('resize', onResize);
      driverRef.current?.dispose();
      driverRef.current = null;
      try {
        engine?.stop();
      } catch {
        // An engine that never started has nothing to stop
      }
    };
    // The heading is fed through setHeading above; the engine must not restart when it changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let guidanceText = 'Keep straight';
  const diffAngle = heading === null ? 0 : ((bearing - heading + 540) % 360) - 180;
  if (arrived) guidanceText = 'You are at the grave';
  else if (heading === null) guidanceText = describeMissingHeading(compassStatus);
  else if (Math.abs(diffAngle) > 120) guidanceText = 'Turn Around';
  else if (diffAngle > 35) guidanceText = `Turn Right (${Math.round(diffAngle)}°)`;
  else if (diffAngle < -35) guidanceText = `Turn Left (${Math.abs(Math.round(diffAngle))}°)`;

  const accuracy = Math.max(1, targetGrave.positionAccuracyMeters || 1);
  const numberLabel = graveNumberLabel(targetGrave);
  const pill =
    engineStatus === 'loading'
      ? 'Loading the AR engine…'
      : engineStatus === 'camera'
        ? 'Starting the camera…'
        : describeTracking(driverState, arrived, accuracy);

  return (
    <div className="flex-1 flex flex-col relative bg-black overflow-hidden select-none">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* Top bar, as on the sensor screen */}
      <div className="absolute top-0 inset-x-0 z-30 px-4 pt-3 pb-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between text-white">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/30 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5 stroke-[2.2]" />
        </button>
        <h1 className="text-sm font-bold tracking-wide text-white drop-shadow">Approaching your destination</h1>
        <div className="w-9 h-9" aria-hidden="true" />
      </div>

      {/* Distance badge */}
      <div className="absolute top-[22%] inset-x-0 z-20 flex justify-center pointer-events-none">
        <div className="bg-brand-dark/95 backdrop-blur-md border border-emerald-500/60 rounded-2xl py-2 px-5 shadow-2xl text-center text-white">
          <div className="text-xl font-extrabold text-white tracking-wide">{Math.round(distance)} m</div>
          <div className="text-xs text-emerald-300 font-semibold mt-0.5">{guidanceText}</div>
        </div>
      </div>

      {/* What to do right now */}
      <div className="absolute inset-x-0 bottom-36 z-30 flex justify-center pointer-events-none px-6">
        <div className="max-w-[300px] bg-black/60 backdrop-blur-md border border-white/20 rounded-xl px-4 py-2 text-sm font-semibold text-white text-center" role="status">
          {pill}
        </div>
      </div>

      {/* Grave card */}
      <div className="absolute bottom-10 inset-x-5 z-30 pointer-events-auto">
        <div className="bg-white/95 backdrop-blur-md rounded-2xl p-3 shadow-2xl border border-white/40">
          <div className="flex items-center space-x-3.5">
            <div className="w-14 h-14 rounded-xl overflow-hidden relative shrink-0 bg-slate-100 border border-slate-200">
              <Image src={targetGrave.primaryPhotoUrl || '/sample-gravestone.svg'} alt={targetGrave.person?.fullName || 'Target Grave'} fill className="object-cover" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xs font-bold text-slate-900 truncate">{targetGrave.person?.fullName || numberLabel || 'Grave'}</h2>
              {numberLabel && <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">{numberLabel}</div>}
              <div className="text-[10px] text-slate-500 truncate mt-0.5">{targetGrave.cemeteryName || 'Athlone Muslim Cemetery'}</div>
            </div>
          </div>
          {targetGrave.gravePhotoUrl && <LookForThisGrave url={targetGrave.gravePhotoUrl} />}
          {arrived && onConfirmVisit && <VisitConfirmButton grave={targetGrave} fix={fix} onConfirm={onConfirmVisit} />}
        </div>
      </div>

      {/* Required by the XR engine licence */}
      <div className="absolute bottom-0 inset-x-0 z-30 px-4 pb-2 text-[9px] text-white/50 text-center pointer-events-auto">
        {XR_ENGINE_NOTICE}{' '}
        <a href={XR_ENGINE_LICENSE_URL} className="underline" target="_blank" rel="noopener noreferrer">
          Licence
        </a>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Remove the spike**

```bash
git rm src/app/ar-spike/page.tsx
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` and `npx vitest run` (expect 52 files, about 374 tests). Check `src/app/page.tsx` still imports `ARGuidanceScreen` from the same path and passes the same props; no change should be needed there.

- [ ] **Step 6: Commit**

```bash
git add src/components/screens/ARSensorGuidanceScreen.tsx src/components/screens/ARTrackedGuidanceScreen.tsx src/components/screens/ARGuidanceScreen.tsx
git commit -m "feat(ar): guide along a tracked floor line with a 3D pin, falling back to the sensor screen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(`git rm` and `git mv` already staged the removal and the rename.)

---

### Task 7: Final verification

- [ ] **Step 1:** `npx vitest run` and `npx tsc --noEmit`; expect all green.
- [ ] **Step 2:** Em dash scan over the branch: `git diff cdaa450 --name-only | xargs grep -l $'\xe2\x80\x94' || echo "no em dashes"` (one pre-existing em dash in GraveDetailsScreen.tsx is out of scope).
- [ ] **Step 3:** Update the spec status line to `Status: implemented on main; needs a phone walk` and commit it.
- [ ] **Step 4:** Hand over: what to test on the phone (start-up coaching, the line on the floor while walking, the pin at the spot, arrival, the fallback with the network off).
