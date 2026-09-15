import type { Survey, SurveyCapture, SurveyQueueState } from '@/types';
import type { ReadResult, SaveResult } from './queueAdapters';
import {
  OFFLINE_RETRY_MS,
  QueueActivity,
  RATE_LIMIT_WAIT_MS,
  StepResult,
  backoffMs,
  decideAfterReading,
  nextQueueState,
  readLimit,
  saveLimit,
  wakeDelayMs,
} from './queueRules';

// Processes a surveyor's queued captures one at a time: read the photo, decide, save. Storage, network,
// clock and timers are passed in, so every limit that protects the AI budget is tested without a browser.

export interface QueueStorage {
  eligibleCaptures(userId: string, now: number): Promise<SurveyCapture[]>;
  earliestNextAttempt(userId: string): Promise<number | null>;
  resetInterruptedReads(userId: string): Promise<number>;
  updateCapture(id: string, changes: Partial<SurveyCapture>): Promise<void>;
  getSurvey(surveyId: string): Promise<Survey | undefined>;
  getQueueState(userId: string): Promise<SurveyQueueState>;
  setQueueState(state: SurveyQueueState): Promise<void>;
}

export interface QueueWorkerDeps {
  storage: QueueStorage;
  readPhoto: (capture: SurveyCapture) => Promise<ReadResult>;
  saveCapture: (capture: SurveyCapture, survey: Survey) => Promise<SaveResult>;
  getUserId: () => Promise<string | null>;
  isOnline: () => boolean;
  now: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  runExclusive: (task: () => Promise<void>) => Promise<void>;
  onChange?: () => void;
  onError?: (err: unknown) => void;
}

export interface QueueWorker {
  wake(): Promise<void>;
  resume(): Promise<void>;
  signedIn(): Promise<void>;
  activity(): QueueActivity;
  subscribe(listener: (activity: QueueActivity) => void): () => void;
  stop(): void;
}

export function createQueueWorker(deps: QueueWorkerDeps): QueueWorker {
  let running = false;
  let wakeAgain = false;
  let stopped = false;
  // Kept in memory only: a restart tries once more, and a 401 costs no AI tokens
  let signedOut = false;
  let rateLimitedUntil = 0;
  let timer: unknown = null;
  let current: QueueActivity = 'idle';
  const recoveredUsers = new Set<string>();
  const listeners = new Set<(activity: QueueActivity) => void>();

  function setActivity(activity: QueueActivity) {
    if (activity === current) return;
    current = activity;
    listeners.forEach((listener) => listener(activity));
  }

  // At most one timer, so waiting never turns into a loop
  function schedule(ms: number | null) {
    if (timer !== null) {
      deps.clearTimer(timer);
      timer = null;
    }
    if (ms === null || stopped) return;
    timer = deps.setTimer(() => {
      timer = null;
      void wake();
    }, ms);
  }

  async function update(capture: SurveyCapture, changes: Partial<SurveyCapture>) {
    await deps.storage.updateCapture(capture.id, changes);
    deps.onChange?.();
  }

  async function readStep(capture: SurveyCapture, now: number): Promise<StepResult> {
    const limit = readLimit(capture);
    if (capture.readAttempts >= limit) {
      await update(capture, { status: 'failed', lastError: capture.lastError ?? "The photo couldn't be read." });
      return 'progress';
    }

    // Counted before the request, so a read cut off by the app closing still counts toward the cap
    const readAttempts = capture.readAttempts + 1;
    await update(capture, { status: 'reading', readAttempts });
    const result = await deps.readPhoto({ ...capture, readAttempts });

    switch (result.kind) {
      case 'reading': {
        const next = decideAfterReading(result.reading, capture.insideBoundary);
        await update(
          capture,
          next.status === 'review'
            ? { status: 'review', reviewReason: next.reason, reading: result.reading, lastError: undefined }
            : { status: 'saving', reading: result.reading, nextAttemptAt: 0, lastError: undefined }
        );
        return 'progress';
      }
      case 'unreadable':
        await update(capture, { status: 'review', reviewReason: 'unreadable', lastError: result.message });
        return 'progress';
      case 'offline':
        // No answer arrived, so the attempt isn't counted
        await update(capture, { status: 'queued', readAttempts: capture.readAttempts });
        return 'offline';
      case 'rate-limited':
        await update(capture, { status: 'queued', readAttempts: capture.readAttempts, nextAttemptAt: now + RATE_LIMIT_WAIT_MS });
        return 'rate-limited';
      case 'signed-out':
        await update(capture, { status: 'queued', readAttempts: capture.readAttempts });
        return 'signed-out';
      default:
        await update(
          capture,
          readAttempts >= limit
            ? { status: 'failed', lastError: result.message }
            : { status: 'queued', nextAttemptAt: now + backoffMs(readAttempts), lastError: result.message }
        );
        return 'failure';
    }
  }

  async function saveStep(capture: SurveyCapture, now: number): Promise<StepResult> {
    const survey = await deps.storage.getSurvey(capture.surveyId);
    if (!survey) {
      await update(capture, { status: 'failed', lastError: 'This survey is no longer on this phone.' });
      return 'progress';
    }
    const limit = saveLimit(capture);
    if (capture.saveFailures >= limit) {
      await update(capture, { status: 'failed', lastError: capture.lastError ?? "The grave couldn't be saved." });
      return 'progress';
    }

    // The save records its uploaded photo on this copy, which is stored whatever happens next
    const attempt = { ...capture.attempt };
    const result = await deps.saveCapture({ ...capture, attempt }, survey);

    switch (result.kind) {
      case 'created':
      case 'added-photo':
        await update(capture, {
          status: 'saved',
          outcome: result.kind,
          graveId: result.graveId,
          photo: undefined,
          attempt,
          matchCandidate: undefined,
          lastError: undefined,
        });
        return 'progress';
      case 'match-found':
        await update(capture, { status: 'review', reviewReason: 'possible-duplicate', matchCandidate: result.candidate, attempt });
        return 'progress';
      case 'offline':
        await update(capture, { attempt });
        return 'offline';
      case 'signed-out':
        await update(capture, { attempt });
        return 'signed-out';
      default: {
        const saveFailures = capture.saveFailures + 1;
        await update(
          capture,
          saveFailures >= limit
            ? { status: 'failed', saveFailures, attempt, lastError: result.message }
            : { saveFailures, attempt, nextAttemptAt: now + backoffMs(saveFailures), lastError: result.message }
        );
        return 'failure';
      }
    }
  }

  async function runOnce(): Promise<void> {
    const userId = await deps.getUserId();
    if (!userId || signedOut) {
      setActivity('signed-out');
      return;
    }
    let state = await deps.storage.getQueueState(userId);
    if (state.pausedForErrors) {
      setActivity('paused');
      return;
    }
    if (!recoveredUsers.has(userId)) {
      await deps.storage.resetInterruptedReads(userId);
      recoveredUsers.add(userId);
    }

    while (!stopped) {
      // The online event wakes the worker again
      if (!deps.isOnline()) {
        setActivity('offline');
        return;
      }
      const now = deps.now();
      if (rateLimitedUntil > now) {
        setActivity('waiting');
        schedule(rateLimitedUntil - now);
        return;
      }

      const [next] = await deps.storage.eligibleCaptures(userId, now);
      if (!next) {
        const delay = wakeDelayMs(await deps.storage.earliestNextAttempt(userId), now);
        schedule(delay);
        setActivity(delay === null ? 'idle' : 'waiting');
        return;
      }

      setActivity('working');
      const step = next.status === 'saving' ? await saveStep(next, now) : await readStep(next, now);

      const nextState = nextQueueState(state, step);
      if (nextState !== state) {
        state = nextState;
        await deps.storage.setQueueState(state);
      }
      if (state.pausedForErrors) {
        schedule(null);
        setActivity('paused');
        return;
      }
      if (step === 'signed-out') {
        signedOut = true;
        setActivity('signed-out');
        return;
      }
      if (step === 'rate-limited') rateLimitedUntil = now + RATE_LIMIT_WAIT_MS;
      if (step === 'offline') {
        // Requests can fail while the phone still reports a connection, so try again shortly in that case
        setActivity('offline');
        schedule(deps.isOnline() ? OFFLINE_RETRY_MS : null);
        return;
      }
    }
  }

  async function wake(): Promise<void> {
    if (stopped) return;
    if (running) {
      wakeAgain = true;
      return;
    }
    running = true;
    try {
      do {
        wakeAgain = false;
        await deps.runExclusive(runOnce);
      } while (wakeAgain && !stopped);
    } catch (err) {
      // A storage failure ends this run; the next trigger starts a fresh one
      deps.onError?.(err);
      setActivity('idle');
    } finally {
      running = false;
    }
  }

  return {
    wake,
    async resume() {
      const userId = await deps.getUserId();
      if (userId) await deps.storage.setQueueState({ userId, consecutiveFailures: 0, pausedForErrors: false });
      await wake();
    },
    async signedIn() {
      signedOut = false;
      await wake();
    },
    activity: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      stopped = true;
      schedule(null);
    },
  };
}

// Web Locks stop two tabs processing the same queue. Without them, one run at a time in this tab.
export function createExclusiveRunner(
  locks?: { request: LockManager['request'] },
  name = 'qabrmap-survey-queue'
): (task: () => Promise<void>) => Promise<void> {
  let busy = false;
  return async (task) => {
    if (locks) {
      await locks.request(name, { ifAvailable: true }, async (lock) => {
        if (lock) await task();
      });
      return;
    }
    if (busy) return;
    busy = true;
    try {
      await task();
    } finally {
      busy = false;
    }
  };
}
