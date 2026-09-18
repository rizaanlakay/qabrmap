// The engine draws the camera image to the canvas centre-cropped to fill it, so only part of each frame is on
// screen. Matching just that part is cheaper, and it is the part the visitor is pointing the phone at.

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function visibleFrameRect(frameW: number, frameH: number, canvasW: number, canvasH: number): FrameRect {
  if (frameW <= 0 || frameH <= 0 || canvasW <= 0 || canvasH <= 0) return { x: 0, y: 0, width: Math.max(0, frameW), height: Math.max(0, frameH) };
  const canvasAspect = canvasW / canvasH;
  if (frameW / frameH > canvasAspect) {
    // Frame is wider than the screen: the sides are cut
    const width = Math.min(frameW, Math.round(frameH * canvasAspect));
    return { x: Math.floor((frameW - width) / 2), y: 0, width, height: frameH };
  }
  const height = Math.min(frameH, Math.round(frameW / canvasAspect));
  return { x: 0, y: Math.floor((frameH - height) / 2), width: frameW, height };
}

// One byte per pixel in, one byte per pixel out
export function cropGray(pixels: Uint8Array, frameW: number, rect: FrameRect): Uint8Array {
  const out = new Uint8Array(rect.width * rect.height);
  for (let row = 0; row < rect.height; row++) {
    const start = (rect.y + row) * frameW + rect.x;
    out.set(pixels.subarray(start, start + rect.width), row * rect.width);
  }
  return out;
}
