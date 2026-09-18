// tests/vision_driver.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createVisionDriver, VisionDeps } from '../src/lib/ar/vision/visionDriver';
import { VISION_CONFIG } from '../src/lib/ar/vision/config';
import type { MatcherClient, MatchResult } from '../src/lib/ar/vision/matcherClient';
import type { GrayFrame } from '../src/lib/ar/vision/framePump';

// The engine, reduced to what the vision driver touches. The pixel array module hands back a 720 x 960 image
// from its second call on, as the real one does.
function fakeEngine(withPixelArray = true) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 0.45, 0.1, 100);
  camera.position.set(0, 1.5, 0);
  camera.updateProjectionMatrix();
  let reads = 0;
  const XR8 = {
    GlTextureRenderer: { pipelineModule: () => ({ name: 'gltexturerenderer' }), setTextureProvider: () => {} },
    Threejs: { pipelineModule: () => ({ name: 'three' }), xrScene: () => ({ scene, camera, renderer: {} as THREE.WebGLRenderer }) },
    XrController: {
      pipelineModule: () => ({ name: 'xr' }),
      configure: () => {},
      updateCameraProjectionMatrix: () => {},
      recenter: () => {},
      hitTest: () => [{ type: 'FEATURE_POINT', position: { x: 0, y: 1.5, z: -3 }, distance: 3 }],
    },
    CameraPixelArray: withPixelArray
      ? {
          pipelineModule: () => ({
            name: 'camerapixelarray',
            onProcessGpu: () => {
              reads += 1;
              return reads === 1 ? {} : { rows: 960, cols: 720, rowBytes: 720, pixels: new Uint8Array(720 * 960) };
            },
          }),
        }
      : undefined,
  };
  return { XR8, scene, camera, reads: () => reads };
}

function fakeMatcher(readyOk = true, referenceFeatures = 1000) {
  const frames: GrayFrame[] = [];
  let resolveMatch: ((result: MatchResult | null) => void) | null = null;
  let disposed = false;
  const client: MatcherClient = {
    ready: Promise.resolve(readyOk),
    setReference: () => Promise.resolve(referenceFeatures),
    match: (frame) => {
      frames.push(frame);
      return new Promise((resolve) => {
        resolveMatch = resolve;
      });
    },
    busy: () => resolveMatch !== null,
    reset: () => {},
    dispose: () => {
      disposed = true;
    },
  };
  return {
    client,
    frames,
    isDisposed: () => disposed,
    answer: async (result: MatchResult | null) => {
      const resolve = resolveMatch;
      resolveMatch = null;
      resolve?.(result);
      await flush();
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const tracking = (status: 'NORMAL' | 'LIMITED') => ({
  processCpuResult: { reality: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, trackingStatus: status, trackingReason: 'UNSPECIFIED' as const } },
});

// The stone found in the middle of the 432 x 960 visible part of the frame
const found = (inliers: number): MatchResult => ({
  quad: [{ x: 166, y: 400 }, { x: 266, y: 400 }, { x: 266, y: 560 }, { x: 166, y: 560 }],
  inliers, good: inliers + 8, frameFeatures: 2000, points: [], ms: 1500,
});
const missed: MatchResult = { quad: null, inliers: 4, good: 6, frameFeatures: 2000, points: [], ms: 1400 };

function setUp(options: { pixelArray?: boolean; matcher?: ReturnType<typeof fakeMatcher>; loadFails?: boolean } = {}) {
  const engine = fakeEngine(options.pixelArray ?? true);
  const matcher = options.matcher ?? fakeMatcher();
  let clock = 0;
  const deps: VisionDeps = {
    config: VISION_CONFIG,
    makeMatcher: () => matcher.client,
    loadReference: () =>
      options.loadFails ? Promise.reject(new Error('blocked')) : Promise.resolve({ width: 480, height: 640, levels: [] }),
    now: () => clock,
  };
  const driver = createVisionDriver(engine.XR8, deps);
  const phases: string[] = [];
  driver.onState((state) => phases.push(state.phase));
  // One engine frame: every module's GPU step, then every module's update
  const frame = (status: 'NORMAL' | 'LIMITED' = 'NORMAL') => {
    clock += 33;
    for (const module of driver.pipelineModules) module.onProcessGpu?.({ frameStartResult: {} });
    for (const module of driver.pipelineModules) module.onUpdate?.(tracking(status));
  };
  const start = () => driver.pipelineModules.forEach((module) => module.onStart?.({ canvasWidth: 360, canvasHeight: 800 }));
  return { engine, matcher, driver, phases, frame, start, advance: (ms: number) => { clock += ms; } };
}

describe('Vision Driver Tests', () => {
  it('stays off and reads no frames until it is prepared and active', () => {
    const t = setUp();
    t.start();
    for (let i = 0; i < 5; i++) t.frame();
    expect(t.driver.state().phase).toBe('off');
    expect(t.engine.reads()).toBe(0);
  });

  it('loads, then scans once active, sending only the visible part of the frame', async () => {
    const t = setUp();
    t.start();
    t.driver.prepare('https://photos.example/grave.jpg');
    expect(t.driver.state().phase).toBe('loading');
    await flush();
    expect(t.driver.state().phase).toBe('off');
    t.driver.setActive(true);
    expect(t.driver.state().phase).toBe('scanning');

    for (let i = 0; i < 4; i++) t.frame();
    expect(t.matcher.frames).toHaveLength(1);
    // 720 x 960 shown on a 360 x 800 canvas: the middle 432 columns
    expect(t.matcher.frames[0]).toMatchObject({ width: 432, height: 960 });
    expect(t.matcher.frames[0].pixels).toHaveLength(432 * 960);
  });

  it('does not read frames while a match is in flight or tracking is limited', async () => {
    const t = setUp();
    t.start();
    t.driver.prepare('photo');
    await flush();
    t.driver.setActive(true);
    for (let i = 0; i < 4; i++) t.frame('LIMITED');
    expect(t.engine.reads()).toBe(0);
    for (let i = 0; i < 4; i++) t.frame();
    const readsWhileBusy = t.engine.reads();
    for (let i = 0; i < 20; i++) t.frame();
    expect(t.engine.reads()).toBe(readsWhileBusy);
    expect(t.matcher.frames).toHaveLength(1);
  });

  it('outlines a found stone in the world at the depth of the tracked point, then calls a repeat likely', async () => {
    const t = setUp();
    t.start();
    t.driver.prepare('photo');
    await flush();
    t.driver.setActive(true);
    for (let i = 0; i < 4; i++) t.frame();
    await t.matcher.answer(found(30));

    expect(t.driver.state().phase).toBe('potential');
    const group = t.engine.scene.getObjectByName('stone-highlight') as THREE.Group;
    expect(group.visible).toBe(true);
    const border = group.getObjectByName('stone-highlight-border') as THREE.Mesh;
    const positions = border.geometry.getAttribute('position');
    // The fake hit test puts tracked points 3 m ahead of a camera at z = 0 looking down -z
    expect(positions.getZ(0)).toBeCloseTo(-3, 5);
    // Centred on screen, so centred on the camera's axis
    expect((positions.getX(0) + positions.getX(1)) / 2).toBeCloseTo(0, 5);

    t.advance(VISION_CONFIG.minIntervalMs);
    for (let i = 0; i < 4; i++) t.frame();
    await t.matcher.answer(found(30));
    expect(t.driver.state().phase).toBe('likely');
    expect(t.phases).toEqual(['loading', 'off', 'scanning', 'potential', 'likely']);
  });

  it('removes the outline after enough failed matches with it in view', async () => {
    const t = setUp();
    t.start();
    t.driver.prepare('photo');
    await flush();
    t.driver.setActive(true);
    for (let i = 0; i < 4; i++) t.frame();
    await t.matcher.answer(found(30));
    for (let miss = 0; miss < VISION_CONFIG.maxMisses; miss++) {
      t.advance(VISION_CONFIG.minIntervalMs);
      for (let i = 0; i < 4; i++) t.frame();
      await t.matcher.answer(missed);
    }
    expect(t.driver.state().phase).toBe('scanning');
    expect((t.engine.scene.getObjectByName('stone-highlight') as THREE.Group).visible).toBe(false);
  });

  it('keeps the outline when the matcher errors or the visitor stops being near', async () => {
    const t = setUp();
    t.start();
    t.driver.prepare('photo');
    await flush();
    t.driver.setActive(true);
    for (let i = 0; i < 4; i++) t.frame();
    await t.matcher.answer(found(30));
    for (let n = 0; n < VISION_CONFIG.maxMisses + 2; n++) {
      t.advance(VISION_CONFIG.minIntervalMs);
      for (let i = 0; i < 4; i++) t.frame();
      await t.matcher.answer(null);
    }
    expect(t.driver.state().phase).toBe('potential');
    t.driver.setActive(false);
    expect(t.driver.state().phase).toBe('potential');
  });

  it('becomes unavailable, once, when the engine cannot hand over frames', () => {
    const t = setUp({ pixelArray: false });
    t.start();
    t.driver.prepare('photo');
    t.driver.setActive(true);
    for (let i = 0; i < 4; i++) t.frame();
    expect(t.phases).toEqual(['unavailable']);
    expect(t.driver.state().debug.reason).toMatch(/camera frames/);
  });

  it('becomes unavailable when the matcher cannot start, the photo is blocked, or it has no features', async () => {
    const dead = setUp({ matcher: fakeMatcher(false) });
    dead.driver.prepare('photo');
    await flush();
    expect(dead.driver.state().phase).toBe('unavailable');
    expect(dead.matcher.isDisposed()).toBe(true);

    const blocked = setUp({ loadFails: true });
    blocked.driver.prepare('photo');
    await flush();
    expect(blocked.driver.state().phase).toBe('unavailable');
    expect(blocked.driver.state().debug.reason).toBe('blocked');

    const blank = setUp({ matcher: fakeMatcher(true, 0) });
    blank.start();
    blank.driver.prepare('photo');
    await flush();
    blank.driver.setActive(true);
    for (let i = 0; i < 4; i++) blank.frame();
    expect(blank.driver.state().phase).toBe('unavailable');
    expect(blank.engine.reads()).toBe(0);
  });

  it('only prepares once, and cleans up on dispose', async () => {
    const t = setUp();
    t.start();
    t.driver.prepare('photo');
    t.driver.prepare('photo');
    await flush();
    t.driver.setActive(true);
    for (let i = 0; i < 4; i++) t.frame();
    await t.matcher.answer(found(30));
    t.driver.dispose();
    expect(t.matcher.isDisposed()).toBe(true);
    expect(t.engine.scene.getObjectByName('stone-highlight')).toBeUndefined();
    // A late answer after dispose changes nothing
    await t.matcher.answer(found(30));
    expect(t.driver.state().phase).toBe('potential');
  });

  it('carries the last frame and its outline in the debug state only when debug is on', async () => {
    const t = setUp();
    t.start();
    t.driver.prepare('photo');
    await flush();
    t.driver.setActive(true);
    for (let i = 0; i < 4; i++) t.frame();
    await t.matcher.answer(found(30));
    expect(t.driver.state().debug.preview).toBeNull();

    t.driver.setDebug(true);
    t.advance(VISION_CONFIG.minIntervalMs);
    for (let i = 0; i < 4; i++) t.frame();
    await t.matcher.answer(found(30));
    const debug = t.driver.state().debug;
    expect(debug.preview).toMatchObject({ width: 432, height: 960 });
    expect(debug).toMatchObject({ matchesRun: 2, matchesFound: 2, matchMs: 1500, inliers: 30, depthFromHit: true });
    expect(debug.depthM).toBeCloseTo(3, 5);
  });
});
