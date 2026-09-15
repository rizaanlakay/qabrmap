# Tracked AR guidance on the 8th Wall engine

Date: 2026-09-15
Status: approved design, not yet implemented

## Problem

The AR guidance screen draws a chevron line as a screen overlay driven by the compass and GPS. It does not track the world through the camera, so the line does not stay on the floor when the phone tilts or moves, and it reads as an animation over a video rather than arrows on the ground. Visual realism is what sells the AR feature, so the line and the marker must be anchored to the real floor.

The spike at `/ar-spike` proved the free 8th Wall engine binary tracks the world on the user's phone in the browser, keeps a three.js chevron line on the floor with real perspective, and can measure the floor height from tracked points. Accuracy of the grave position stays as it is: GPS still decides where the grave is.

## Decisions

| Topic | Decision |
|---|---|
| Engine | 8th Wall distributed engine binary 1.0.0 from jsDelivr, loaded on demand, world tracking in absolute scale |
| Renderer | three.js 0.170 through the engine's three.js pipeline module |
| Fallback | If the engine cannot load or start, or the camera fails, the existing sensor-driven screen is shown unchanged |
| Line | Chevron line on the measured floor from the phone's feet to the grave, up to 12 m long |
| Marker | A 3D pin, 20 cm thick, standing at the grave's spot on the floor, bouncing and slowly spinning |
| North | The compass heading at the moment tracking becomes NORMAL fixes the tracked world's north; drift is corrected slowly from the compass afterwards |
| Grave position in the world | Re-derived from each smoothed GPS fix as the phone's tracked position plus distance along the bearing, then eased |
| Arrival | 5 m or less: the line is hidden and only the pin marks the spot, with the "look around" pill |
| Floor | Median of tracked feature points well below the camera; 1.5 m below the starting camera until measured |
| Tracking states | Coaching text while initialising, a limited-tracking hint, a lost-tracking recovery |
| Preload | Navigation starts downloading the engine when it shows the "Open AR" prompt |
| Licence | The Niantic Spatial notice and licence link on the AR screen footer and on the profile screen |
| Spike | The `/ar-spike` route is removed once the screen ships |

## 1. Modules

### `src/lib/ar/xr8.ts` (exists)

`loadXR8()`, `XR8Api` and the pipeline module type, `XR_ENGINE_NOTICE`, `XR_ENGINE_LICENSE_URL`. Gains `preloadXR8()`, which starts `loadXR8()` and swallows the result, for navigation's preload.

### `src/lib/ar/floorEstimate.ts` (exists, tested)

Unchanged.

### `src/lib/ar/worldAlignment.ts` (new, pure, tested)

The engine's world starts with the camera facing -z and knows nothing about north.

- `engineYawDeg(forward: { x, z }): number`: degrees clockwise (seen from above) from the initial facing, `atan2(x, -z)` in degrees, normalised to 0..360.
- `createNorthAlignment()` returning `{ update(headingDeg, engineYawDeg, alpha), offsetDeg(): number | null }`. The offset is the compass heading minus the engine yaw, smoothed with `smoothAngle` from `src/lib/ar/smoothing.ts`. The first update takes the value as is; later updates ease with `alpha` (0.02 per frame while tracking is NORMAL, ignored while LIMITED) so compass noise cannot swing the line but slow drift is corrected.
- `worldYawRadForBearing(bearingDeg, offsetDeg): number`: the `rotation.y` that turns a group's -z toward compass bearing `bearingDeg`. Clockwise from above is a negative rotation about +y, so this is `toRad(offsetDeg - bearingDeg)`.
- `graveWorldPosition({ feet: { x, z }, bearingDeg, distanceM, offsetDeg }): { x, z }`: the point `distanceM` along the bearing from the feet in world coordinates.

### `src/lib/ar/floorLine.ts` (exists)

Gains `setLength(metres)`: the strip is scaled to the length and chevrons beyond it are hidden, so the line ends at the grave when it is closer than 12 m. Length is clamped to 0.5..12.

### `src/lib/ar/gravePin.ts` (new)

`createGravePin(): { group, animate(elapsed), dispose }`.

- Shape: a teardrop pin outline (round head with a hole, pointed foot) drawn as a `THREE.Shape`, extruded 0.2 m with a small bevel, 0.9 m tall and 0.5 m wide, so it reads as a solid object. `MeshStandardMaterial` emerald (`0x34d399`) with a slight emissive glow, plus a darker inner ring so the head reads from any side.
- The group's origin is at the tip, so `group.position` is the floor point.
- `animate(elapsed)`: bounce `0.12 + 0.18 * |sin(elapsed * 2.2)|` metres above the floor, spin `rotation.y = elapsed * 0.6` radians per second (one turn every 10 s).
- Scene lighting for it: a `HemisphereLight` and a `DirectionalLight` added once with the pin.

### `src/lib/ar/sceneDriver.ts` (new)

Owns everything inside the engine's pipeline module so the screen stays small: builds the line and pin, runs the floor estimator, applies the north alignment, and exposes a plain interface the screen calls with GPS data.

```
createSceneDriver(XR8): {
  pipelineModule: XR8PipelineModule;          // add to the engine
  setTarget({ bearingDeg, distanceM }): void;  // from each smoothed GPS fix
  setHeading(headingDeg | null): void;         // from the compass hook
  onState(listener: (state: DriverState) => void): void;
  dispose(): void;
}
DriverState = {
  tracking: 'initialising' | 'limited' | 'normal';
  floorMeasured: boolean;
  aligned: boolean;                            // north offset known
}
```

Per frame (`onUpdate`):

1. Read the camera's world position and forward vector from the three.js camera the engine drives.
2. Every 6th frame while tracking is NORMAL, hit-test the four floor probes and feed the estimator. Ease the floor height.
3. If the compass heading is known and tracking is NORMAL, update the north alignment with the engine yaw.
4. If aligned and a target is set: compute the grave's world position from the feet (camera x, z) at the latest fix and the target's bearing and distance; ease it (alpha 0.1). Place the line group at the feet on the floor, rotate it toward the grave, set its length to the distance, hide it when the distance is 5 m or less. Place the pin at the grave position on the floor; when the grave is further than 12 m, place it at the line's end instead.
5. Animate the line and the pin.

### Screens

- `src/components/screens/ARGuidanceScreen.tsx` becomes a thin switch: it renders `ARTrackedGuidanceScreen` and, on `onFallback`, `ARSensorGuidanceScreen` with the same props.
- `src/components/screens/ARSensorGuidanceScreen.tsx`: the current screen file, renamed, unchanged.
- `src/components/screens/ARTrackedGuidanceScreen.tsx` (new): the engine canvas, the top bar, the distance badge and turn text, a status pill for tracking states, the bottom card with the whole-grave photo and the visit button, and the attribution footer. It owns the GPS watch (same smoother as today), the compass hook, the engine start and stop, and feeds the scene driver. It calls `onFallback(reason)` when `loadXR8()` rejects, when the engine throws on start, or when the camera status is `failed`.

## 2. Screen behaviour

### Start

1. Show the camera-starting state and call `loadXR8()`. Navigation has usually preloaded it, so this is instant on a repeat visit.
2. Size the canvas to the viewport (the engine copies the canvas attributes), set `window.THREE`, configure absolute scale, add the XrController, GlTextureRenderer, three.js and scene-driver modules, run.
3. While the engine reports LIMITED and INITIALIZING: the status pill reads "Move the phone slowly sideways so it can find the floor". The line and pin are not shown.
4. When tracking turns NORMAL and the compass has a heading: north is aligned, the line and pin appear.

### Walking

- Line from the feet along the floor toward the grave, chevrons flowing away from the viewer. The pin stands at the grave's spot or at the line's end when the grave is beyond 12 m.
- Distance badge and turn text as today, from the same GPS and compass maths.
- Status pill reads "Follow the line".

### Arrival (5 m or less)

- The line is hidden. The pin stays at the spot, bouncing and spinning.
- Pill: "± 3 m. Not the right name? Look around this spot."
- "I found it" on the card, with the stand-at-the-stone sheet.

### Tracking lost or limited

- The pill shows "Tracking is limited. Point at the ground and move slowly". The line and pin keep their last world position (the engine keeps rendering with what it has) rather than disappearing.
- Fallback to the sensor screen only happens when the engine cannot start at all, not on limited tracking.

### Leaving

`XR8.stop()`, dispose the scene driver, stop the GPS watch. Returning to navigation hands the last fix back through `onUpdateUserLocation` as today.

## 3. Navigation preload

`NavigationScreen` calls `preloadXR8()` once when `isNearby` first becomes true. It does nothing on failure; the AR screen will try again and fall back.

## 4. Licence

`XR_ENGINE_NOTICE` and the licence link appear as a small footer line on the tracked AR screen and in a new "Open source and licences" block on `ProfileScreen`. Never shown on the sensor fallback, which does not use the engine.

## 5. Removal

`src/app/ar-spike/page.tsx` is deleted. Its logic lives on in `sceneDriver.ts` and the tracked screen.

## 6. Testing

- `tests/world_alignment.test.ts`: engine yaw from forward vectors (facing -z is 0, facing +x is 90), north offset first value and easing, `worldYawRadForBearing` (offset 0 and bearing 90 turns -z to +x), `graveWorldPosition` (10 m at bearing 90 with offset 0 lands at x + 10).
- `tests/floor_line.test.ts`: `setLength` clamps and hides chevrons beyond the length (three.js runs in Node for geometry without a renderer).
- `tests/grave_pin.test.ts`: the pin's origin is at the tip (its bounding box starts at y = 0) and `animate` moves and spins it.
- `tests/floor_estimate.test.ts`: exists.
- The scene driver's per-frame logic is exercised through a fake `XR8` with a fake camera in `tests/scene_driver.test.ts`: after tracking NORMAL and a heading, a target 10 m east places the line group rotated toward +x and the pin at x = 10 on the measured floor.
- The screens are checked by hand on the phone: start-up coaching, the line on the floor while walking, the pin at the spot, arrival, the fallback with the engine blocked (airplane mode).
