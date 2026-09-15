import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createGravePin, createPinLights, PIN_HEIGHT_M, PIN_THICKNESS_M, PIN_WIDTH_M } from '../src/lib/ar/gravePin';

describe('Grave Pin Tests', () => {
  it('is a solid pin standing on its tip with the spec dimensions', () => {
    const pin = createGravePin();
    const box = new THREE.Box3().setFromObject(pin.group);
    const size = box.getSize(new THREE.Vector3());
    expect(box.min.y).toBeGreaterThanOrEqual(-0.03); // the tip, plus a little bevel
    expect(size.y).toBeCloseTo(PIN_HEIGHT_M, 1);
    expect(size.x).toBeCloseTo(PIN_WIDTH_M, 1);
    expect(size.z).toBeCloseTo(PIN_THICKNESS_M, 1);
    expect(PIN_THICKNESS_M).toBe(0.2);
    pin.dispose();
  });

  it('bounces above the floor and spins slowly', () => {
    const pin = createGravePin();
    pin.animate(0);
    const restY = pin.group.children[0].position.y;
    pin.animate(0.7);
    const upY = pin.group.children[0].position.y;
    expect(upY).toBeGreaterThan(restY);
    expect(upY).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(pin.group.rotation.y).toBeCloseTo(0.42, 9);
    pin.animate(10.472);
    expect(pin.group.rotation.y).toBeCloseTo(6.2832, 3); // one full turn every ten and a half seconds
    pin.dispose();
  });

  it('comes with lights so the solid pin has shading', () => {
    const lights = createPinLights();
    expect(lights.some((light) => light instanceof THREE.HemisphereLight)).toBe(true);
    expect(lights.some((light) => light instanceof THREE.DirectionalLight)).toBe(true);
  });
});
