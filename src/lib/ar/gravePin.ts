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
