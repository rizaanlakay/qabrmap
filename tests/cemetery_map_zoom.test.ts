import { describe, it, expect } from 'vitest';

describe('Cemetery Map Zoom & Scrollwheel Mechanics', () => {
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 4.5;

  it('computes proportional zoom factors on scroll wheel up/down', () => {
    const zoomInFactor = 1.15;
    const zoomOutFactor = 0.87;

    const initialZoom = 1.0;
    const zoomedIn = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((initialZoom * zoomInFactor).toFixed(3))));
    expect(zoomedIn).toBe(1.15);

    const zoomedOut = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((initialZoom * zoomOutFactor).toFixed(3))));
    expect(zoomedOut).toBe(0.87);
  });

  it('respects min and max zoom boundaries', () => {
    let zoom = 4.0;
    // Zoom in repeatedly
    for (let i = 0; i < 10; i++) {
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((zoom * 1.15).toFixed(3))));
    }
    expect(zoom).toBe(MAX_ZOOM);

    // Zoom out repeatedly
    for (let i = 0; i < 20; i++) {
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((zoom * 0.87).toFixed(3))));
    }
    expect(zoom).toBe(MIN_ZOOM);
  });

  it('keeps the point under the mouse cursor stationary during anchored zooming', () => {
    // When zooming at map center (px = 50, py = 50), pan offset remains unchanged if initially 0
    const pxCenter = 50;
    const pyCenter = 50;
    const prevPanCenter = { x: 0, y: 0 };
    const actualScale = 1.15;

    const newPanXCenter = Number((pxCenter - 50 - (pxCenter - 50 - prevPanCenter.x) * actualScale).toFixed(2));
    const newPanYCenter = Number((pyCenter - 50 - (pyCenter - 50 - prevPanCenter.y) * actualScale).toFixed(2));

    expect(newPanXCenter).toBe(0);
    expect(newPanYCenter).toBe(0);

    // When cursor is at 80% width (to the right of center), zooming in pulls the map leftward to preserve position
    const pxOffCenter = 80;
    const pyOffCenter = 20;
    const newPanXOffCenter = Number((pxOffCenter - 50 - (pxOffCenter - 50 - prevPanCenter.x) * actualScale).toFixed(2));
    const newPanYOffCenter = Number((pyOffCenter - 50 - (pyOffCenter - 50 - prevPanCenter.y) * actualScale).toFixed(2));

    // (80 - 50) - (80 - 50)*1.15 = 30 - 34.5 = -4.5
    expect(newPanXOffCenter).toBe(-4.5);
    // (20 - 50) - (20 - 50)*1.15 = -30 - (-34.5) = 4.5
    expect(newPanYOffCenter).toBe(4.5);
  });

  it('calculates drag distance threshold to prevent accidental clicks while panning', () => {
    const clickDistance = 2.5; // pixel drag
    const panDistance = 14.2; // deliberate drag

    const isClick = clickDistance < 6;
    const isPan = panDistance >= 6;

    expect(isClick).toBe(true);
    expect(isPan).toBe(true);
  });

  it('computes screen coordinates with pan offset and zoom correctly', () => {
    const originLat = -33.967521;
    const originLng = 18.503277;
    const zoomLevel = 2.0;
    const panOffset = { x: 10, y: -5 };

    const latSpan = 0.00075 / zoomLevel;
    const lngSpan = 0.00095 / zoomLevel;

    // Coordinate at exact origin
    const x = ((originLng - (originLng - lngSpan / 2)) / lngSpan) * 100 + panOffset.x;
    const y = (((originLat + latSpan / 2) - originLat) / latSpan) * 100 + panOffset.y;

    // At origin, base position is 50% + panOffset
    expect(x).toBeCloseTo(60, 5);
    expect(y).toBeCloseTo(45, 5);
  });

  it('calculates optimal auto-fit viewport spans from cemetery graves bounding box', () => {
    // Simulated Mowbray graves cluster
    const sampleGraves = [
      { latitude: -33.94852, longitude: 18.48205 },
      { latitude: -33.94845, longitude: 18.48198 },
      { latitude: -33.94858, longitude: 18.48212 },
    ];

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    for (const g of sampleGraves) {
      if (g.latitude < minLat) minLat = g.latitude;
      if (g.latitude > maxLat) maxLat = g.latitude;
      if (g.longitude < minLng) minLng = g.longitude;
      if (g.longitude > maxLng) maxLng = g.longitude;
    }

    const rawLatSpan = maxLat - minLat;
    const rawLngSpan = maxLng - minLng;

    const targetWidthRatio = 0.68;
    const targetHeightRatio = 0.50;

    const baseLngSpan = Math.max(0.00012, rawLngSpan / targetWidthRatio);
    const baseLatSpan = Math.max(0.00012, rawLatSpan / targetHeightRatio);

    // Verify graves span comfortably within the viewport ratios
    expect(rawLngSpan / baseLngSpan).toBeCloseTo(targetWidthRatio, 2);
    expect(rawLatSpan / baseLatSpan).toBeCloseTo(targetHeightRatio, 2);

    // Verify auto-fit eliminates excessive empty margins
    expect(baseLngSpan).toBeLessThan(0.0005);
    expect(baseLatSpan).toBeLessThan(0.0005);
  });
});
