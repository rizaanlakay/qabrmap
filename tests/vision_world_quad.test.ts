// tests/vision_world_quad.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { depthForQuad, isInView, pixelToNdc, snapshotPose, unprojectQuad } from '../src/lib/ar/vision/worldQuad';

const LIMITS = { minDepthM: 0.8, maxDepthM: 12 };

function cameraAt(position: [number, number, number], yawDeg = 0) {
  const camera = new THREE.PerspectiveCamera(60, 0.5, 0.1, 100);
  camera.position.set(...position);
  camera.rotation.set(0, THREE.MathUtils.degToRad(yawDeg), 0);
  camera.updateProjectionMatrix();
  return camera;
}

describe('Vision World Quad Tests', () => {
  it('maps frame pixels to device coordinates with y up', () => {
    expect(pixelToNdc(0, 0, 400, 800)).toEqual({ x: -1, y: 1 });
    expect(pixelToNdc(400, 800, 400, 800)).toEqual({ x: 1, y: -1 });
    expect(pixelToNdc(200, 400, 400, 800)).toEqual({ x: 0, y: 0 });
  });

  it('places a centred outline on a plane facing the camera at the asked depth', () => {
    const pose = snapshotPose(cameraAt([1, 1.5, 2]));
    const quad = [{ x: -0.2, y: 0.2 }, { x: 0.2, y: 0.2 }, { x: 0.2, y: -0.2 }, { x: -0.2, y: -0.2 }];
    const corners = unprojectQuad(pose, quad, 4);
    for (const corner of corners) expect(corner.z).toBeCloseTo(2 - 4, 6);
    // Symmetric about the camera's axis, top above bottom, right of left
    expect(corners[0].x + corners[1].x).toBeCloseTo(2, 6);
    expect(corners[0].y).toBeGreaterThan(corners[3].y);
    expect(corners[1].x).toBeGreaterThan(corners[0].x);
  });

  it('projects back to the same screen points from the same pose', () => {
    const camera = cameraAt([0, 1.5, 0], 30);
    const pose = snapshotPose(camera);
    const quad = [{ x: -0.5, y: 0.4 }, { x: 0.1, y: 0.4 }, { x: 0.1, y: -0.3 }, { x: -0.5, y: -0.3 }];
    camera.updateMatrixWorld();
    unprojectQuad(pose, quad, 3).forEach((corner, i) => {
      const ndc = corner.clone().project(camera);
      expect(ndc.x).toBeCloseTo(quad[i].x, 5);
      expect(ndc.y).toBeCloseTo(quad[i].y, 5);
    });
  });

  it('follows the camera when it faces another way', () => {
    // Turned 90 degrees to the left, the camera looks down -x
    const pose = snapshotPose(cameraAt([0, 0, 0], 90));
    const [centre] = unprojectQuad(pose, [{ x: 0, y: 0 }], 5);
    expect(centre.x).toBeCloseTo(-5, 6);
    expect(centre.z).toBeCloseTo(0, 6);
  });

  it('takes its depth from the tracked point nearest the outline centre', () => {
    const pose = snapshotPose(cameraAt([0, 1.5, 0]));
    const hits = [
      { ndc: { x: 0.4, y: 0 }, position: { x: 1, y: 1.5, z: -6 } },
      { ndc: { x: 0.05, y: 0.05 }, position: { x: 0, y: 1.5, z: -2.5 } },
    ];
    expect(depthForQuad(pose, hits, { x: 0, y: 0 }, 3, LIMITS)).toBeCloseTo(2.5, 6);
  });

  it('ignores far-off points and points behind the camera, and clamps the fallback', () => {
    const pose = snapshotPose(cameraAt([0, 1.5, 0]));
    const hits = [
      { ndc: { x: 0.9, y: 0.9 }, position: { x: 3, y: 3, z: -4 } },
      { ndc: { x: 0, y: 0 }, position: { x: 0, y: 1.5, z: 2 } },
    ];
    expect(depthForQuad(pose, hits, { x: 0, y: 0 }, 3, LIMITS)).toBe(3);
    expect(depthForQuad(pose, [], { x: 0, y: 0 }, 40, LIMITS)).toBe(12);
    expect(depthForQuad(pose, [], { x: 0, y: 0 }, 0.1, LIMITS)).toBe(0.8);
  });

  it('knows whether a world point was on screen', () => {
    const pose = snapshotPose(cameraAt([0, 1.5, 0]));
    expect(isInView(pose, { x: 0, y: 1.5, z: -3 })).toBe(true);
    expect(isInView(pose, { x: 0, y: 1.5, z: 3 })).toBe(false);
    expect(isInView(pose, { x: 30, y: 1.5, z: -3 })).toBe(false);
  });
});
