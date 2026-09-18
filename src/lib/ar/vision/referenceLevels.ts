import type { VisionConfig } from './config';

// Turns the grave's photo into the copies the matcher compares against. A close-up photo shows the stone far
// larger than the camera does from a few metres, so it is matched at several sizes.

export interface ReferenceLevel {
  // Size of this copy relative to the full-scale reference
  s: number;
  image: { data: ArrayBuffer; width: number; height: number };
}

export interface ReferenceLevels {
  // Size of the full-scale reference, which the outline is expressed in
  width: number;
  height: number;
  levels: ReferenceLevel[];
}

type SizeConfig = Pick<VisionConfig, 'referenceBasePx' | 'referenceScales' | 'referenceMinSidePx'>;

// The photo is shrunk to the base size, never enlarged; copies too small to hold features are skipped
export function referenceSizes(photoW: number, photoH: number, config: SizeConfig) {
  const baseScale = Math.min(1, config.referenceBasePx / Math.max(photoW, photoH));
  const width = Math.max(1, Math.round(photoW * baseScale));
  const height = Math.max(1, Math.round(photoH * baseScale));
  const levels = config.referenceScales
    .map((s) => ({ s, width: Math.round(width * s), height: Math.round(height * s) }))
    .filter((level) => Math.min(level.width, level.height) >= config.referenceMinSidePx);
  return { width, height, levels };
}

// Fetched rather than drawn from an <img>, so a photo host without CORS fails here, cleanly, instead of
// tainting a canvas
export async function loadReferenceLevels(url: string, config: SizeConfig): Promise<ReferenceLevels> {
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) throw new Error(`The reference photo could not be loaded (${response.status})`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const sizes = referenceSizes(bitmap.width, bitmap.height, config);
    if (sizes.levels.length === 0) throw new Error('The reference photo is too small to match');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('No 2D canvas on this device');
    const levels = sizes.levels.map((level) => {
      canvas.width = level.width;
      canvas.height = level.height;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, level.width, level.height);
      const image = ctx.getImageData(0, 0, level.width, level.height);
      return { s: level.s, image: { data: image.data.buffer as ArrayBuffer, width: level.width, height: level.height } };
    });
    return { width: sizes.width, height: sizes.height, levels };
  } finally {
    bitmap.close();
  }
}
