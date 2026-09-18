import type * as THREE from 'three';
import type { XR8Api, XR8PipelineModule } from '../xr8';
import { createCandidateTracker } from './candidateTracker';
import type { VisionConfig } from './config';
import { cropGray, visibleFrameRect } from './frameMapping';
import { createFramePump, GrayFrame } from './framePump';
import type { MatcherClient, MatchResult, Point } from './matcherClient';
import type { ReferenceLevels } from './referenceLevels';
import { createStoneHighlight } from './stoneHighlight';
import { CameraPose, DepthHit, depthForQuad, isInView, pixelToNdc, snapshotPose, unprojectQuad } from './worldQuad';

// Finds the grave's photographed stone in the camera view and outlines it in the world. Sits beside the scene
// driver in the engine's pipeline and shares nothing with it: if anything here fails, the phase becomes
// 'unavailable' once and the AR screen carries on as it always has.

export type VisionPhase = 'off' | 'loading' | 'scanning' | 'potential' | 'likely' | 'unavailable';

// The last frame the matcher looked at, for the debug view
export interface VisionPreview {
  pixels: Uint8Array;
  width: number;
  height: number;
  quad: Point[] | null;
  points: Point[];
}

export interface VisionDebug {
  reason: string | null;
  frameWidth: number;
  frameHeight: number;
  matchMs: number;
  inliers: number;
  good: number;
  frameFeatures: number;
  referenceFeatures: number;
  matchesRun: number;
  matchesFound: number;
  depthM: number | null;
  depthFromHit: boolean;
  preview: VisionPreview | null;
}

export interface VisionState {
  phase: VisionPhase;
  debug: VisionDebug;
}

export interface VisionDriver {
  pipelineModules: XR8PipelineModule[];
  // Fetch the matcher and read the photo; safe to call again, only the first call does anything
  prepare(referenceUrl: string): void;
  setActive(active: boolean): void;
  // Roughly how far the grave is, for placing the outline when no tracked point is near it
  setFallbackDepth(metres: number): void;
  setDebug(enabled: boolean): void;
  onState(listener: (state: VisionState) => void): () => void;
  state(): VisionState;
  dispose(): void;
}

export interface VisionDeps {
  config: VisionConfig;
  makeMatcher: () => MatcherClient;
  loadReference: (url: string) => Promise<ReferenceLevels>;
  now?: () => number;
}

// Screen spots (0..1 from the top left) probed for tracked points when a frame is taken, so the outline can
// later be given the depth of whatever was near it at that moment
const HIT_GRID_X = [0.2, 0.35, 0.5, 0.65, 0.8];
const HIT_GRID_Y = [0.25, 0.4, 0.55, 0.7];

interface FrameContext {
  pose: CameraPose;
  hits: DepthHit[];
  width: number;
  height: number;
  expectedVisible: boolean;
  preview: Uint8Array | null;
}

export function createVisionDriver(
  XR8: Pick<XR8Api, 'Threejs' | 'XrController' | 'CameraPixelArray' | 'GlTextureRenderer'>,
  deps: VisionDeps
): VisionDriver {
  const { config } = deps;
  const now = deps.now ?? (() => performance.now());
  const pump = createFramePump(XR8, config.frameMaxDimension);
  const tracker = createCandidateTracker(config);
  const highlight = createStoneHighlight();
  const listeners = new Set<(state: VisionState) => void>();

  let matcher: MatcherClient | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let canvasW = 0, canvasH = 0;
  let prepared = false, ready = false, failed = false, active = false, disposed = false, debugOn = false;
  let trackingNormal = false;
  let awaitingFrame = false;
  let pendingFrame: GrayFrame | null = null;
  let lastRequestAt = -Infinity;
  let fallbackDepth: number = config.defaultDepthM;
  let startedAt = now();
  let debug: VisionDebug = {
    reason: null, frameWidth: 0, frameHeight: 0, matchMs: 0, inliers: 0, good: 0, frameFeatures: 0,
    referenceFeatures: 0, matchesRun: 0, matchesFound: 0, depthM: null, depthFromHit: false, preview: null,
  };
  let current: VisionState = { phase: 'off', debug };

  const phase = (): VisionPhase => {
    if (failed) return 'unavailable';
    if (!prepared) return 'off';
    if (!ready) return 'loading';
    const status = tracker.state().status;
    if (status !== 'scanning') return status;
    return active ? 'scanning' : 'off';
  };

  // Listeners hear every phase change; with debug on they also hear every match, for the readout
  const emit = (force: boolean) => {
    const next = phase();
    if (!force && next === current.phase) return;
    current = { phase: next, debug };
    listeners.forEach((listener) => listener(current));
  };

  const fail = (reason: string) => {
    if (failed || disposed) return;
    failed = true;
    debug = { ...debug, reason };
    pump?.cancel();
    matcher?.dispose();
    matcher = null;
    tracker.reset();
    highlight.setCorners(null);
    emit(true);
  };

  const probeHits = (): DepthHit[] => {
    const hits: DepthHit[] = [];
    for (const x of HIT_GRID_X) {
      for (const y of HIT_GRID_Y) {
        try {
          const hit = XR8.XrController.hitTest(x, y, ['FEATURE_POINT'])[0];
          if (hit) hits.push({ ndc: { x: x * 2 - 1, y: 1 - y * 2 }, position: hit.position });
        } catch {
          // No tracker on this device: the fallback depth is used
        }
      }
    }
    return hits;
  };

  const applyResult = (result: MatchResult | null, frame: FrameContext) => {
    if (disposed || failed) return;
    debug = { ...debug, matchesRun: debug.matchesRun + 1, frameWidth: frame.width, frameHeight: frame.height };
    if (result) {
      debug = { ...debug, matchMs: result.ms, inliers: result.inliers, good: result.good, frameFeatures: result.frameFeatures };
      if (frame.preview) debug = { ...debug, preview: { pixels: frame.preview, width: frame.width, height: frame.height, quad: result.quad, points: result.points } };
    }

    if (result && result.quad && result.inliers >= config.potentialInliers) {
      const quadNdc = result.quad.map((p) => pixelToNdc(p.x, p.y, frame.width, frame.height));
      const centre = { x: quadNdc.reduce((sum, p) => sum + p.x, 0) / 4, y: quadNdc.reduce((sum, p) => sum + p.y, 0) / 4 };
      const hitDepth = depthForQuad(frame.pose, frame.hits, centre, NaN, config);
      const depthFromHit = Number.isFinite(hitDepth);
      const depthM = depthFromHit ? hitDepth : depthForQuad(frame.pose, [], centre, fallbackDepth, config);
      const corners = unprojectQuad(frame.pose, quadNdc, depthM).map((c) => ({ x: c.x, y: c.y, z: c.z }));
      tracker.update({ inliers: result.inliers, corners, cameraPosition: frame.pose.position }, frame.expectedVisible);
      debug = { ...debug, matchesFound: debug.matchesFound + 1, depthM, depthFromHit };
    } else {
      // A match that errored says nothing about the stone, so it never counts against the outline
      tracker.update(null, result !== null && frame.expectedVisible);
    }

    const candidate = tracker.state();
    highlight.setCorners(candidate.corners);
    if (candidate.status !== 'scanning') highlight.setStatus(candidate.status);
    emit(debugOn);
  };

  const sendFrame = (frame: GrayFrame) => {
    if (!matcher || !camera) return;
    const rect = visibleFrameRect(frame.width, frame.height, canvasW, canvasH);
    if (rect.width < 32 || rect.height < 32) return;
    const pixels = cropGray(frame.pixels, frame.width, rect);
    const pose = snapshotPose(camera);
    const corners = tracker.state().corners;
    const centre = corners
      ? corners.reduce((acc, c) => ({ x: acc.x + c.x / 4, y: acc.y + c.y / 4, z: acc.z + c.z / 4 }), { x: 0, y: 0, z: 0 })
      : null;
    const context: FrameContext = {
      pose,
      hits: probeHits(),
      width: rect.width,
      height: rect.height,
      expectedVisible: centre !== null && isInView(pose, centre),
      // Copied before the buffer is handed to the worker
      preview: debugOn ? pixels.slice() : null,
    };
    matcher
      .match({ pixels, width: rect.width, height: rect.height })
      .then((result) => applyResult(result, context))
      .catch(() => {});
  };

  pump?.onFrame((frame) => {
    awaitingFrame = false;
    pendingFrame = frame;
  });

  const ownModule: XR8PipelineModule = {
    name: 'qabrmap-vision',
    onStart: ({ canvasWidth, canvasHeight }) => {
      // The engine is a page-wide singleton, so a start can still reach a driver the screen has thrown away
      if (disposed) return;
      canvasW = canvasWidth;
      canvasH = canvasHeight;
      const xr = XR8.Threejs.xrScene();
      scene = xr.scene;
      camera = xr.camera;
      scene.add(highlight.group);
      startedAt = now();
      // A restarted engine has a new world, so an outline placed in the old one means nothing
      tracker.reset();
      highlight.setCorners(null);
      awaitingFrame = false;
      pendingFrame = null;
      emit(false);
    },
    onCanvasSizeChange: ({ canvasWidth, canvasHeight }) => {
      canvasW = canvasWidth;
      canvasH = canvasHeight;
    },
    onUpdate: ({ processCpuResult }) => {
      if (disposed || failed || !camera) return;
      const reality = processCpuResult.reality;
      if (reality) trackingNormal = reality.trackingStatus === 'NORMAL';
      highlight.animate((now() - startedAt) / 1000);

      if (pendingFrame) {
        const frame = pendingFrame;
        pendingFrame = null;
        if (ready && active && trackingNormal) sendFrame(frame);
        return;
      }
      if (!pump || !matcher || !ready || !active || !trackingNormal || awaitingFrame || matcher.busy()) return;
      const t = now();
      if (t - lastRequestAt < config.minIntervalMs) return;
      lastRequestAt = t;
      awaitingFrame = true;
      pump.request();
    },
  };

  return {
    pipelineModules: pump ? [pump.pipelineModule, ownModule] : [ownModule],
    prepare(referenceUrl) {
      if (prepared || disposed) return;
      prepared = true;
      if (!pump) {
        fail('This AR engine build cannot hand over camera frames');
        return;
      }
      emit(false);
      const client = deps.makeMatcher();
      matcher = client;
      (async () => {
        if (!(await client.ready)) return fail('The matcher could not start');
        const reference = await deps.loadReference(referenceUrl);
        const features = await client.setReference(reference);
        if (features === 0) return fail('The photo has nothing to match on');
        if (disposed || failed) return;
        debug = { ...debug, referenceFeatures: features };
        ready = true;
        emit(true);
      })().catch((err) => fail(err instanceof Error ? err.message : 'The photo could not be read'));
    },
    setActive(next) {
      if (active === next) return;
      active = next;
      if (!active) {
        pump?.cancel();
        awaitingFrame = false;
        pendingFrame = null;
      }
      emit(false);
    },
    setFallbackDepth(metres) {
      if (Number.isFinite(metres) && metres > 0) fallbackDepth = metres;
    },
    setDebug(enabled) {
      debugOn = enabled;
      if (!enabled) debug = { ...debug, preview: null };
      emit(true);
    },
    onState(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    state: () => current,
    dispose() {
      disposed = true;
      listeners.clear();
      pump?.cancel();
      matcher?.dispose();
      matcher = null;
      scene?.remove(highlight.group);
      highlight.dispose();
    },
  };
}
