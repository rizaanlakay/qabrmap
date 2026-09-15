// Works out where the real floor is from the 3D points the tracker locks onto. The engine only knows how the
// phone moved, not how high it started, so the ground has to be measured from points seen below the camera.

// A point must be at least this far below the camera to count as ground rather than a wall or a hand
export const MIN_DROP_BELOW_CAMERA_M = 0.4;
// And no further than this, which is beyond any hand-held height
export const MAX_DROP_BELOW_CAMERA_M = 2.5;
// Samples kept for the median; enough to ride out a few stray points
export const FLOOR_SAMPLE_WINDOW = 40;

export interface FloorEstimator {
  // Feeds one candidate point height and the camera height it was seen from. Returns true if it was kept.
  addSample: (pointY: number, cameraY: number) => boolean;
  // The floor height, or null until there are enough samples
  floorY: () => number | null;
  sampleCount: () => number;
}

export const MIN_SAMPLES_FOR_FLOOR = 8;

export function createFloorEstimator(windowSize: number = FLOOR_SAMPLE_WINDOW): FloorEstimator {
  const samples: number[] = [];
  return {
    addSample(pointY, cameraY) {
      const drop = cameraY - pointY;
      if (!Number.isFinite(drop) || drop < MIN_DROP_BELOW_CAMERA_M || drop > MAX_DROP_BELOW_CAMERA_M) return false;
      samples.push(pointY);
      if (samples.length > windowSize) samples.shift();
      return true;
    },
    floorY() {
      if (samples.length < MIN_SAMPLES_FOR_FLOOR) return null;
      const sorted = [...samples].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    },
    sampleCount: () => samples.length,
  };
}
