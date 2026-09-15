import * as THREE from 'three';

// A line of chevrons lying on the ground (y = 0) that runs from the viewer's feet toward the target.
// Units are metres; the group is rotated about y to point at the target.

export const FLOOR_LINE_LENGTH_M = 12;
export const MIN_LINE_LENGTH_M = 0.5;
// Chevrons on the line at once, and metres per second they travel
export const CHEVRON_COUNT = 10;
export const CHEVRON_SPEED_MPS = 1.5;
const CHEVRON_WIDTH_M = 0.7;
const CHEVRON_DEPTH_M = 0.55;
const STRIP_WIDTH_M = 1.0;
// A hair above the floor so the strip and chevrons never fight the ground for depth
const STRIP_LIFT_M = 0.005;
const CHEVRON_LIFT_M = 0.01;

export interface FloorLine {
  group: THREE.Group;
  // Advances the chevron animation; elapsed is seconds since the line was created
  animate: (elapsed: number) => void;
  // Ends the line at the grave when it is closer than the full length
  setLength: (metres: number) => void;
  length: () => number;
  dispose: () => void;
}

// One emerald chevron pointing "up" the texture, which is forward once the plane lies on the floor.
// Returns null in Node (tests), where there is no document to draw the canvas with.
function chevronTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 26;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(16, 185, 129, 0.9)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(18, 100);
    ctx.lineTo(64, 34);
    ctx.lineTo(110, 100);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createFloorLine(): FloorLine {
  const group = new THREE.Group();
  const texture = chevronTexture();

  const stripMaterial = new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.22, depthWrite: false });
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(STRIP_WIDTH_M, FLOOR_LINE_LENGTH_M), stripMaterial);
  strip.name = 'strip';
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(0, STRIP_LIFT_M, -FLOOR_LINE_LENGTH_M / 2);
  group.add(strip);

  const chevronGeometry = new THREE.PlaneGeometry(CHEVRON_WIDTH_M, CHEVRON_DEPTH_M);
  const chevrons: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  for (let i = 0; i < CHEVRON_COUNT; i++) {
    const material = new THREE.MeshBasicMaterial({
      map: texture ?? undefined,
      color: texture ? 0xffffff : 0x34d399,
      transparent: true,
      depthWrite: false,
    });
    const chevron = new THREE.Mesh(chevronGeometry, material);
    chevron.name = 'chevron';
    chevron.rotation.x = -Math.PI / 2;
    chevron.position.y = CHEVRON_LIFT_M;
    group.add(chevron);
    chevrons.push(chevron);
  }

  let currentLength = FLOOR_LINE_LENGTH_M;
  const setLength = (metres: number) => {
    currentLength = Math.min(FLOOR_LINE_LENGTH_M, Math.max(MIN_LINE_LENGTH_M, metres));
    // The strip is a plane along local y, which lies along -z once it is flat on the floor
    strip.scale.y = currentLength / FLOOR_LINE_LENGTH_M;
    strip.position.z = -currentLength / 2;
  };

  const spacing = FLOOR_LINE_LENGTH_M / CHEVRON_COUNT;
  const animate = (elapsed: number) => {
    const travelled = (elapsed * CHEVRON_SPEED_MPS) % spacing;
    chevrons.forEach((chevron, i) => {
      const distance = i * spacing + travelled;
      chevron.position.z = -distance;
      // Fade in near the feet and out toward the line's own end, so a shortened line fades instead of popping
      const fadeIn = Math.min(1, distance / 1.5);
      const fadeOut = Math.min(1, (currentLength - distance) / 3);
      chevron.material.opacity = Math.max(0, Math.min(fadeIn, fadeOut));
      chevron.visible = distance <= currentLength;
    });
  };
  animate(0);

  const dispose = () => {
    strip.geometry.dispose();
    stripMaterial.dispose();
    chevronGeometry.dispose();
    chevrons.forEach((chevron) => chevron.material.dispose());
    texture?.dispose();
  };

  return { group, animate, setLength, length: () => currentLength, dispose };
}
