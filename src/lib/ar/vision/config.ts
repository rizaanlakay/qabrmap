// Starting values for finding the photographed stone in the AR view. They come from one desk test on one
// grave, so expect to tune them after phone visits.

// Pinned so a new build can't change behaviour under us; fetched by the worker only when matching is near
export const OPENCV_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js';
export const MATCHER_WORKER_URL = '/vision/stone-matcher.worker.js';

export const VISION_CONFIG = {
  // Against the screen's smoothed GPS distance: fetch the matcher, then start matching
  loadDistanceM: 30,
  matchDistanceM: 15,
  // Longest side of the camera image asked of the engine; its feed is 960 x 720
  frameMaxDimension: 960,
  minIntervalMs: 250,
  // Matched points that agree on one placement of the photo. Out of view the desk test never saw more than 4.
  potentialInliers: 10,
  likelyInliers: 20,
  // Matches in the same place before a candidate is called likely
  stableMatches: 2,
  // Failed matches, with the outline in view, before it is removed
  maxMisses: 4,
  // A candidate further than this share of its size from the last one is a different candidate
  sameCandidateRatio: 0.6,
  // Each new answer moves the outline this far toward itself
  smoothing: 0.6,
  ratioTest: 0.75,
  // OpenCV's default is 0.001; dull engraved stone needs less to yield keypoints
  akazeThreshold: 0.0006,
  // The photo is matched at several sizes because a close-up shows the stone far larger than the camera does
  referenceBasePx: 800,
  referenceScales: [1, 0.6, 0.35, 0.2],
  referenceMinSidePx: 48,
  // Depth for the outline when neither a tracked point nor the grave pin can supply one
  defaultDepthM: 3,
  minDepthM: 0.8,
  maxDepthM: 12,
} as const;

export type VisionConfig = typeof VISION_CONFIG;
