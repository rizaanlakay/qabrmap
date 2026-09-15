import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CHEVRON_COUNT, createFloorLine, FLOOR_LINE_LENGTH_M } from '../src/lib/ar/floorLine';

function chevrons(group: THREE.Group): THREE.Mesh[] {
  return group.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.name === 'chevron');
}

describe('Floor Line Tests', () => {
  it('builds without a DOM', () => {
    const line = createFloorLine();
    expect(chevrons(line.group)).toHaveLength(CHEVRON_COUNT);
    expect(line.length()).toBe(FLOOR_LINE_LENGTH_M);
    line.dispose();
  });

  it('shortens to the grave and hides chevrons past the end', () => {
    const line = createFloorLine();
    line.setLength(4);
    line.animate(0);
    expect(line.length()).toBe(4);
    const visible = chevrons(line.group).filter((c) => c.visible);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((c) => -c.position.z <= 4)).toBe(true);
    const strip = line.group.getObjectByName('strip') as THREE.Mesh;
    expect(strip.position.z).toBeCloseTo(-2, 9);
    line.dispose();
  });

  it('clamps the length', () => {
    const line = createFloorLine();
    line.setLength(0);
    expect(line.length()).toBe(0.5);
    line.setLength(50);
    expect(line.length()).toBe(FLOOR_LINE_LENGTH_M);
    line.dispose();
  });
});
