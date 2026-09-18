// tests/vision_stone_highlight.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createStoneHighlight, LIKELY_COLOUR, POTENTIAL_COLOUR } from '../src/lib/ar/vision/stoneHighlight';

const SQUARE = [
  { x: -0.5, y: 1.5, z: -3 },
  { x: 0.5, y: 1.5, z: -3 },
  { x: 0.5, y: 0.5, z: -3 },
  { x: -0.5, y: 0.5, z: -3 },
];

describe('Vision Stone Highlight Tests', () => {
  it('is hidden until it has corners, and hidden again without them', () => {
    const highlight = createStoneHighlight();
    expect(highlight.group.visible).toBe(false);
    highlight.setCorners(SQUARE);
    expect(highlight.group.visible).toBe(true);
    highlight.setCorners(null);
    expect(highlight.group.visible).toBe(false);
    highlight.dispose();
  });

  it('puts the border between the corners and points a tenth of the way to the centre', () => {
    const highlight = createStoneHighlight();
    highlight.setCorners(SQUARE);
    const border = highlight.group.getObjectByName('stone-highlight-border') as THREE.Mesh;
    const positions = border.geometry.getAttribute('position');
    expect([positions.getX(0), positions.getY(0), positions.getZ(0)]).toEqual([-0.5, 1.5, -3]);
    expect(positions.getX(4)).toBeCloseTo(-0.45, 6);
    expect(positions.getY(4)).toBeCloseTo(1.45, 6);
    expect(border.geometry.getIndex()?.count).toBe(24);
    highlight.dispose();
  });

  it('is amber for a possibility and green for a likely match, and draws over the scene', () => {
    const highlight = createStoneHighlight();
    const border = highlight.group.getObjectByName('stone-highlight-border') as THREE.Mesh;
    const material = border.material as THREE.MeshBasicMaterial;
    expect(material.color.getHex()).toBe(POTENTIAL_COLOUR);
    highlight.setStatus('likely');
    expect(material.color.getHex()).toBe(LIKELY_COLOUR);
    expect(material.depthTest).toBe(false);
    highlight.dispose();
  });
});
