import type { VisionConfig } from './config';

// Decides what the visitor is told about the stone in view. One good match is only a possibility; the same
// place matched again is likely. It never reports more than "likely": the visitor reads the name.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Observation {
  // Matched points that agree on one placement of the photo
  inliers: number;
  // The outline's four corners in the world
  corners: Vec3[];
  // Where the camera was for this frame
  cameraPosition: Vec3;
}

export type CandidateStatus = 'scanning' | 'potential' | 'likely';

export interface CandidateState {
  status: CandidateStatus;
  corners: Vec3[] | null;
  stable: number;
  misses: number;
}

type TrackerConfig = Pick<
  VisionConfig,
  'potentialInliers' | 'likelyInliers' | 'stableMatches' | 'maxMisses' | 'sameCandidateRatio' | 'smoothing'
>;

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

function centreOf(corners: Vec3[]): Vec3 {
  const sum = corners.reduce((acc, c) => ({ x: acc.x + c.x, y: acc.y + c.y, z: acc.z + c.z }), { x: 0, y: 0, z: 0 });
  return { x: sum.x / corners.length, y: sum.y / corners.length, z: sum.z / corners.length };
}

function sizeOf(corners: Vec3[]): number {
  let total = 0;
  for (let i = 0; i < corners.length; i++) total += length(sub(corners[(i + 1) % corners.length], corners[i]));
  return total / corners.length;
}

function angleBetween(a: Vec3, b: Vec3): number {
  const la = length(a), lb = length(b);
  if (la === 0 || lb === 0) return 0;
  const cos = (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb);
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

export function createCandidateTracker(config: TrackerConfig) {
  let state: CandidateState = { status: 'scanning', corners: null, stable: 0, misses: 0 };

  // Same candidate when, seen from the new frame's camera, the two centres are close compared with the
  // outline's apparent size. Judged by direction, not position, because the outline's depth is a guess and
  // two good matches of one stone can sit a metre apart along the line of sight.
  const isSameCandidate = (next: Observation, previous: Vec3[]): boolean => {
    const toNext = sub(centreOf(next.corners), next.cameraPosition);
    const toPrevious = sub(centreOf(previous), next.cameraPosition);
    const apparentSize = sizeOf(next.corners) / Math.max(length(toNext), 1e-6);
    return angleBetween(toNext, toPrevious) < apparentSize * config.sameCandidateRatio;
  };

  return {
    state: () => state,
    reset() {
      state = { status: 'scanning', corners: null, stable: 0, misses: 0 };
    },
    // expectedVisible: the current outline was on screen for this frame, so a failed match counts against it
    update(observation: Observation | null, expectedVisible: boolean): CandidateState {
      const valid = observation !== null && observation.corners.length === 4 && observation.inliers >= config.potentialInliers;
      if (valid && observation) {
        const same = state.corners !== null && isSameCandidate(observation, state.corners);
        const corners = same && state.corners
          ? state.corners.map((c, i) => ({
              x: c.x + (observation.corners[i].x - c.x) * config.smoothing,
              y: c.y + (observation.corners[i].y - c.y) * config.smoothing,
              z: c.z + (observation.corners[i].z - c.z) * config.smoothing,
            }))
          : observation.corners;
        // A jump is a new candidate and has to earn its stability again
        const stable = same ? state.stable + 1 : 1;
        const earned = observation.inliers >= config.likelyInliers && stable >= config.stableMatches;
        const status: CandidateStatus = earned || (same && state.status === 'likely') ? 'likely' : 'potential';
        state = { status, corners, stable, misses: 0 };
      } else if (state.corners !== null && expectedVisible) {
        const misses = state.misses + 1;
        state = misses >= config.maxMisses ? { status: 'scanning', corners: null, stable: 0, misses: 0 } : { ...state, misses };
      }
      return state;
    },
  };
}

export type CandidateTracker = ReturnType<typeof createCandidateTracker>;
