import * as THREE from 'three';
import type { Vec3 } from './candidateTracker';

// The outline drawn over the stone the matcher found: a flat border with a faint fill, placed in the world so
// the tracker keeps it on the stone between matches. Amber for a possibility, green for a likely match. It is
// drawn over everything, since the stone it marks is real and cannot hide it.

export const POTENTIAL_COLOUR = 0xf59e0b;
export const LIKELY_COLOUR = 0x22c55e;
// Border width as a share of the way from each corner to the centre
const BORDER_RATIO = 0.1;
const FILL_OPACITY = 0.14;
const PULSE_RATE = 3;

export interface StoneHighlight {
  group: THREE.Group;
  // Four world corners in order around the outline, or null to hide it
  setCorners(corners: Vec3[] | null): void;
  setStatus(status: 'potential' | 'likely'): void;
  animate(elapsed: number): void;
  dispose(): void;
}

export function createStoneHighlight(): StoneHighlight {
  const group = new THREE.Group();
  group.name = 'stone-highlight';
  group.visible = false;

  // Vertices 0..3 are the outer corners, 4..7 the inner ones
  const borderPositions = new THREE.BufferAttribute(new Float32Array(8 * 3), 3);
  const borderGeometry = new THREE.BufferGeometry();
  borderGeometry.setAttribute('position', borderPositions);
  const borderIndex: number[] = [];
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    borderIndex.push(i, next, 4 + next, i, 4 + next, 4 + i);
  }
  borderGeometry.setIndex(borderIndex);

  const fillPositions = new THREE.BufferAttribute(new Float32Array(4 * 3), 3);
  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute('position', fillPositions);
  fillGeometry.setIndex([0, 1, 2, 0, 2, 3]);

  const material = (opacity: number) =>
    new THREE.MeshBasicMaterial({
      color: POTENTIAL_COLOUR,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
  const borderMaterial = material(1);
  const fillMaterial = material(FILL_OPACITY);

  const border = new THREE.Mesh(borderGeometry, borderMaterial);
  border.name = 'stone-highlight-border';
  const fill = new THREE.Mesh(fillGeometry, fillMaterial);
  fill.name = 'stone-highlight-fill';
  for (const mesh of [fill, border]) {
    // The corners move with every match, so skip culling rather than keep a bounding sphere current
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    group.add(mesh);
  }

  return {
    group,
    setCorners(corners) {
      if (!corners || corners.length !== 4) {
        group.visible = false;
        return;
      }
      const centre = corners.reduce((acc, c) => ({ x: acc.x + c.x / 4, y: acc.y + c.y / 4, z: acc.z + c.z / 4 }), { x: 0, y: 0, z: 0 });
      corners.forEach((c, i) => {
        borderPositions.setXYZ(i, c.x, c.y, c.z);
        borderPositions.setXYZ(4 + i, c.x + (centre.x - c.x) * BORDER_RATIO, c.y + (centre.y - c.y) * BORDER_RATIO, c.z + (centre.z - c.z) * BORDER_RATIO);
        fillPositions.setXYZ(i, c.x, c.y, c.z);
      });
      borderPositions.needsUpdate = true;
      fillPositions.needsUpdate = true;
      group.visible = true;
    },
    setStatus(status) {
      const colour = status === 'likely' ? LIKELY_COLOUR : POTENTIAL_COLOUR;
      borderMaterial.color.setHex(colour);
      fillMaterial.color.setHex(colour);
    },
    animate(elapsed) {
      borderMaterial.opacity = 0.8 + 0.2 * Math.sin(elapsed * PULSE_RATE);
    },
    dispose() {
      borderGeometry.dispose();
      fillGeometry.dispose();
      borderMaterial.dispose();
      fillMaterial.dispose();
    },
  };
}
