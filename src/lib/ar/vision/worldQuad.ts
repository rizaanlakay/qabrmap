import * as THREE from 'three';

// A match answer arrives a second or more after its frame was taken, and by then the phone has moved. So the
// camera is recorded with the frame, and the answer is placed in the world from where the camera was, not
// from where it is now.

export interface CameraPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  projectionMatrix: THREE.Matrix4;
  projectionMatrixInverse: THREE.Matrix4;
}

// Normalised device coordinates: -1..1, x to the right, y up
export interface Ndc {
  x: number;
  y: number;
}

// A tracked world point and where it was on screen when the frame was taken
export interface DepthHit {
  ndc: Ndc;
  position: { x: number; y: number; z: number };
}

// Hits further than this from the outline's centre (in NDC units) say nothing about the stone's distance
const HIT_RADIUS_NDC = 0.45;

export function snapshotPose(camera: THREE.PerspectiveCamera): CameraPose {
  const projectionMatrix = camera.projectionMatrix.clone();
  return {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    projectionMatrix,
    // Worked out here because the engine writes the projection matrix directly and may not keep the inverse
    projectionMatrixInverse: projectionMatrix.clone().invert(),
  };
}

// Frame pixels (origin top left) to NDC, for a frame that fills the screen
export function pixelToNdc(x: number, y: number, frameW: number, frameH: number): Ndc {
  return { x: (x / frameW) * 2 - 1, y: 1 - (y / frameH) * 2 };
}

function forwardOf(pose: CameraPose): THREE.Vector3 {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(pose.quaternion);
}

// The world points under each screen point, on the plane facing the camera at depthM in front of it
export function unprojectQuad(pose: CameraPose, quad: Ndc[], depthM: number): THREE.Vector3[] {
  return quad.map((p) => {
    const ray = new THREE.Vector3(p.x, p.y, 0.5).applyMatrix4(pose.projectionMatrixInverse);
    // Camera space looks down -z; stretch the ray until it reaches the plane
    ray.multiplyScalar(depthM / -ray.z);
    return ray.applyQuaternion(pose.quaternion).add(pose.position);
  });
}

// How far in front of the camera the outline sits: the tracked point nearest its centre, else the fallback
export function depthForQuad(
  pose: CameraPose,
  hits: DepthHit[],
  centre: Ndc,
  fallbackM: number,
  limits: { minDepthM: number; maxDepthM: number }
): number {
  const forward = forwardOf(pose);
  let best: { distance: number; depth: number } | null = null;
  for (const hit of hits) {
    const distance = Math.hypot(hit.ndc.x - centre.x, hit.ndc.y - centre.y);
    if (distance > HIT_RADIUS_NDC) continue;
    const depth = new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z).sub(pose.position).dot(forward);
    if (depth <= 0) continue;
    if (!best || distance < best.distance) best = { distance, depth };
  }
  const depth = best ? best.depth : fallbackM;
  return Math.min(limits.maxDepthM, Math.max(limits.minDepthM, depth));
}

// Whether a world point was on screen for a camera pose
export function isInView(pose: CameraPose, point: { x: number; y: number; z: number }): boolean {
  const local = new THREE.Vector3(point.x, point.y, point.z).sub(pose.position).applyQuaternion(pose.quaternion.clone().invert());
  if (local.z >= 0) return false;
  const ndc = local.applyMatrix4(pose.projectionMatrix);
  return Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
}
