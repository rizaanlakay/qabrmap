import type { VisionConfig } from './config';
import type { GrayFrame } from './framePump';
import type { ReferenceLevels } from './referenceLevels';

// Owns the matching worker (public/vision/stone-matcher.worker.js, which lists the messages). Nothing here
// throws into the AR frame loop: every failure resolves, and a dead worker simply stops answering.

export interface Point {
  x: number;
  y: number;
}

export interface MatchResult {
  // The outline in frame pixels, or null when the photo was not found
  quad: Point[] | null;
  inliers: number;
  good: number;
  frameFeatures: number;
  points: Point[];
  ms: number;
}

// The parts of Worker this uses, so tests can stand in a fake
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

export interface MatcherClient {
  // False when the worker or OpenCV could not start
  ready: Promise<boolean>;
  // Resolves with the number of features found in the photo; 0 means it cannot be matched
  setReference(reference: ReferenceLevels): Promise<number>;
  // Null when busy, dead, or the match failed
  match(frame: GrayFrame): Promise<MatchResult | null>;
  busy(): boolean;
  // Forget which part of the photo has been matching
  reset(): void;
  dispose(): void;
}

type WorkerMessage =
  | { type: 'ready' }
  | { type: 'fatal'; message: string }
  | { type: 'reference'; count: number }
  | { type: 'result'; id: number; result: MatchResult }
  | { type: 'error'; id?: number; for?: string; message: string };

type ClientConfig = Pick<VisionConfig, 'akazeThreshold' | 'ratioTest' | 'potentialInliers'>;

export function createMatcherClient(makeWorker: () => WorkerLike, cvUrl: string, config: ClientConfig): MatcherClient {
  let worker: WorkerLike | null = null;
  let dead = false;
  let nextId = 0;
  let pendingMatch: { id: number; resolve: (result: MatchResult | null) => void } | null = null;
  let pendingReference: ((count: number) => void) | null = null;
  let resolveReady: (ok: boolean) => void = () => {};
  const ready = new Promise<boolean>((resolve) => {
    resolveReady = resolve;
  });

  const fail = () => {
    dead = true;
    resolveReady(false);
    pendingMatch?.resolve(null);
    pendingMatch = null;
    pendingReference?.(0);
    pendingReference = null;
    worker?.terminate();
    worker = null;
  };

  try {
    worker = makeWorker();
    worker.onmessage = (event) => {
      const msg = event.data as WorkerMessage;
      if (msg.type === 'ready') resolveReady(true);
      else if (msg.type === 'fatal') fail();
      else if (msg.type === 'reference') {
        pendingReference?.(msg.count);
        pendingReference = null;
      } else if (msg.type === 'result') {
        if (pendingMatch && pendingMatch.id === msg.id) {
          pendingMatch.resolve(msg.result);
          pendingMatch = null;
        }
      } else if (msg.type === 'error') {
        if (msg.for === 'reference') {
          pendingReference?.(0);
          pendingReference = null;
        } else if (pendingMatch && pendingMatch.id === msg.id) {
          pendingMatch.resolve(null);
          pendingMatch = null;
        }
      }
    };
    worker.onerror = fail;
    worker.postMessage({ type: 'init', cvUrl, akazeThreshold: config.akazeThreshold });
  } catch {
    fail();
  }

  return {
    ready,
    setReference(reference) {
      if (dead || !worker) return Promise.resolve(0);
      pendingReference?.(0);
      return new Promise<number>((resolve) => {
        pendingReference = resolve;
        worker?.postMessage(
          { type: 'reference', levels: reference.levels, w: reference.width, h: reference.height },
          reference.levels.map((level) => level.image.data)
        );
      });
    },
    match(frame) {
      if (dead || !worker || pendingMatch) return Promise.resolve(null);
      const id = ++nextId;
      return new Promise<MatchResult | null>((resolve) => {
        pendingMatch = { id, resolve };
        const data = frame.pixels.buffer as ArrayBuffer;
        worker?.postMessage(
          { type: 'match', id, image: { data, width: frame.width, height: frame.height }, ratio: config.ratioTest, potential: config.potentialInliers },
          [data]
        );
      });
    },
    busy: () => pendingMatch !== null,
    reset() {
      if (!dead) worker?.postMessage({ type: 'reset' });
    },
    dispose() {
      dead = true;
      resolveReady(false);
      pendingMatch?.resolve(null);
      pendingMatch = null;
      pendingReference?.(0);
      pendingReference = null;
      worker?.terminate();
      worker = null;
    },
  };
}
