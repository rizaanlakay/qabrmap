// tests/vision_candidate_tracker.test.ts
import { describe, it, expect } from 'vitest';
import { createCandidateTracker, Observation } from '../src/lib/ar/vision/candidateTracker';
import { VISION_CONFIG } from '../src/lib/ar/vision/config';

const CAMERA = { x: 0, y: 1.5, z: 0 };

// A half-metre outline facing the camera, centred at (x, 1, -depth)
function stoneAt(x: number, depth: number, inliers: number): Observation {
  const h = 0.25;
  return {
    inliers,
    cameraPosition: CAMERA,
    corners: [
      { x: x - h, y: 1 + h, z: -depth },
      { x: x + h, y: 1 + h, z: -depth },
      { x: x + h, y: 1 - h, z: -depth },
      { x: x - h, y: 1 - h, z: -depth },
    ],
  };
}

describe('Vision Candidate Tracker Tests', () => {
  it('starts scanning and ignores a weak match', () => {
    const tracker = createCandidateTracker(VISION_CONFIG);
    expect(tracker.state().status).toBe('scanning');
    expect(tracker.update(stoneAt(0, 3, VISION_CONFIG.potentialInliers - 1), false).status).toBe('scanning');
    expect(tracker.state().corners).toBeNull();
  });

  it('calls one good match a possibility and the same place again likely', () => {
    const tracker = createCandidateTracker(VISION_CONFIG);
    expect(tracker.update(stoneAt(0, 3, 30), false).status).toBe('potential');
    expect(tracker.update(stoneAt(0.05, 3, 30), true).status).toBe('likely');
    expect(tracker.state().stable).toBe(2);
  });

  it('never calls a repeated but thin match likely', () => {
    const tracker = createCandidateTracker(VISION_CONFIG);
    tracker.update(stoneAt(0, 3, 12), false);
    tracker.update(stoneAt(0, 3, 12), true);
    expect(tracker.update(stoneAt(0, 3, 12), true).status).toBe('potential');
  });

  it('treats a match somewhere else as a new candidate that must earn its standing again', () => {
    const tracker = createCandidateTracker(VISION_CONFIG);
    tracker.update(stoneAt(0, 3, 30), false);
    tracker.update(stoneAt(0, 3, 30), true);
    const jumped = tracker.update(stoneAt(1.5, 3, 30), true);
    expect(jumped.status).toBe('potential');
    expect(jumped.stable).toBe(1);
    expect(jumped.corners?.[0].x).toBeCloseTo(1.25, 6);
  });

  it('sees one stone as the same candidate even when its guessed depth changes', () => {
    const tracker = createCandidateTracker(VISION_CONFIG);
    tracker.update(stoneAt(0, 3, 30), false);
    // Same direction from the camera, a metre and a half further along the line of sight
    expect(tracker.update(stoneAt(0, 4.5, 30), true).status).toBe('likely');
  });

  it('moves the outline part of the way toward each new answer', () => {
    const tracker = createCandidateTracker(VISION_CONFIG);
    tracker.update(stoneAt(0, 3, 30), false);
    const next = tracker.update(stoneAt(0.1, 3, 30), true);
    expect(next.corners?.[0].x).toBeCloseTo(-0.25 + 0.1 * VISION_CONFIG.smoothing, 6);
  });

  it('only counts a failed match when the outline was in view, and removes it after enough of them', () => {
    const tracker = createCandidateTracker(VISION_CONFIG);
    tracker.update(stoneAt(0, 3, 30), false);
    for (let i = 0; i < 10; i++) tracker.update(null, false);
    expect(tracker.state().status).toBe('potential');
    expect(tracker.state().misses).toBe(0);

    for (let i = 0; i < VISION_CONFIG.maxMisses - 1; i++) tracker.update(null, true);
    expect(tracker.state().corners).not.toBeNull();
    expect(tracker.update(null, true)).toEqual({ status: 'scanning', corners: null, stable: 0, misses: 0 });
  });

  it('forgives earlier misses after a good match and stays likely', () => {
    const tracker = createCandidateTracker(VISION_CONFIG);
    tracker.update(stoneAt(0, 3, 30), false);
    tracker.update(stoneAt(0, 3, 30), true);
    tracker.update(null, true);
    tracker.update(null, true);
    const back = tracker.update(stoneAt(0, 3, 12), true);
    expect(back.misses).toBe(0);
    expect(back.status).toBe('likely');
  });

  it('forgets everything on reset', () => {
    const tracker = createCandidateTracker(VISION_CONFIG);
    tracker.update(stoneAt(0, 3, 30), false);
    tracker.reset();
    expect(tracker.state()).toEqual({ status: 'scanning', corners: null, stable: 0, misses: 0 });
  });
});
