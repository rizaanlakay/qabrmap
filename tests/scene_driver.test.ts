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

  it('keeps the grave planted while the person walks between fixes', () => {
    const engine = fakeEngine();
    const driver = createSceneDriver(engine.XR8, () => 0);
    driver.pipelineModule.onStart?.({ canvasWidth: 390, canvasHeight: 780 });
    driver.setHeading(0);
    driver.setTarget({ bearingDeg: 0, distanceM: 10 });
    driver.pipelineModule.onUpdate?.(normal);
    const pin = engine.scene.getObjectByName('grave-pin') as THREE.Group;
    const line = engine.scene.getObjectByName('floor-line') as THREE.Group;
    expect(pin.position.z).toBeCloseTo(-10, 6);
    // Walk 3 m toward the grave with no new fix: the pin must not move, the line must shorten
    engine.camera.position.z = -3;
    for (let i = 0; i < 5; i++) driver.pipelineModule.onUpdate?.(normal);
    expect(pin.position.z).toBeCloseTo(-10, 6);
    expect(line.position.z).toBeCloseTo(-3, 6);
    // The line group only exposes its mesh children in the scene; read the length back from the strip's scale
    expect((line.getObjectByName('strip') as THREE.Mesh).scale.y).toBeCloseTo(7 / FLOOR_LINE_LENGTH_M, 6);
    // The next fix measures from where the person now stands
    driver.setTarget({ bearingDeg: 0, distanceM: 7 });
    for (let i = 0; i < 200; i++) driver.pipelineModule.onUpdate?.(normal);
    expect(pin.position.z).toBeCloseTo(-10, 3);
    driver.dispose();
  });
});
