import type {
  AIStructuredExtraction,
  CaptureStatus,
  ReviewReason,
  SurveyCapture,
  SurveyCounts,
  SurveyQueueState,
} from '@/types';
import type { NewGraveForm } from '../capture/newGrave';

// The rules the survey queue follows. Pure, so the limits that protect the AI budget are easy to test.

export const AUTO_SAVE_NAME_CONFIDENCE = 0.9;
export const MAX_READ_ATTEMPTS = 3;
export const MAX_SAVE_FAILURES = 3;
export const MAX_MANUAL_RETRIES = 2;
export const CIRCUIT_BREAKER_LIMIT = 5;
export const RATE_LIMIT_WAIT_MS = 60_000;
// The account hit its daily read limit, so waiting a minute would only send refused requests
export const READ_LIMIT_WAIT_MS = 600_000;
export const MIN_WAKE_DELAY_MS = 30_000;
export const OFFLINE_RETRY_MS = 30_000;

export type AfterReading = { status: 'saving' } | { status: 'review'; reason: ReviewReason };

// Only a clear name read inside the survey's cemetery is saved without a person checking it
export function decideAfterReading(reading: AIStructuredExtraction, insideBoundary: boolean): AfterReading {
  if (!reading.firstName.trim() || !reading.surname.trim()) return { status: 'review', reason: 'no-name' };
  if (reading.fieldConfidences.fullName < AUTO_SAVE_NAME_CONFIDENCE) return { status: 'review', reason: 'low-confidence' };
  if (!insideBoundary) return { status: 'review', reason: 'outside-cemetery' };
  return { status: 'saving' };
}

// 30 seconds, 2 minutes, then 10 minutes
export function backoffMs(failures: number): number {
  if (failures <= 1) return 30_000;
  if (failures === 2) return 120_000;
  return 600_000;
}

// Each manual Retry allows one more attempt
export function readLimit(capture: Pick<SurveyCapture, 'manualRetries'>): number {
  return MAX_READ_ATTEMPTS + capture.manualRetries;
}

export function saveLimit(capture: Pick<SurveyCapture, 'manualRetries'>): number {
  return MAX_SAVE_FAILURES + capture.manualRetries;
}

export function isEligible(capture: SurveyCapture, userId: string, now: number): boolean {
  return (
    capture.userId === userId &&
    (capture.status === 'queued' || capture.status === 'saving') &&
    capture.nextAttemptAt <= now
  );
}

const PENDING: CaptureStatus[] = ['queued', 'reading', 'saving'];
const NEEDS_REVIEW: CaptureStatus[] = ['review', 'failed'];

// Counts are always worked out from the captures, never stored, so they can't drift
export function countCaptures(captures: Pick<SurveyCapture, 'status'>[]): SurveyCounts {
  return {
    captured: captures.length,
    saved: captures.filter((capture) => capture.status === 'saved').length,
    pending: captures.filter((capture) => PENDING.includes(capture.status)).length,
    review: captures.filter((capture) => NEEDS_REVIEW.includes(capture.status)).length,
  };
}

export function canRetry(capture: Pick<SurveyCapture, 'status' | 'manualRetries'>): boolean {
  return capture.status === 'failed' && capture.manualRetries < MAX_MANUAL_RETRIES;
}

// A capture that was read failed while saving, so it goes straight back to saving without another paid read
export function retryChanges(capture: SurveyCapture): Partial<SurveyCapture> {
  return {
    status: capture.reading ? 'saving' : 'queued',
    manualRetries: capture.manualRetries + 1,
    nextAttemptAt: 0,
    lastError: undefined,
  };
}

export type StepResult = 'progress' | 'failure' | 'offline' | 'signed-out' | 'rate-limited';

// Repeated failures pause the whole queue until the surveyor taps Resume. Losing signal isn't a failure.
export function nextQueueState(state: SurveyQueueState, step: StepResult): SurveyQueueState {
  if (step === 'progress') return state.consecutiveFailures === 0 ? state : { ...state, consecutiveFailures: 0 };
  if (step !== 'failure') return state;
  const consecutiveFailures = state.consecutiveFailures + 1;
  return { ...state, consecutiveFailures, pausedForErrors: state.pausedForErrors || consecutiveFailures >= CIRCUIT_BREAKER_LIMIT };
}

export function wakeDelayMs(earliestNextAttemptAt: number | null, now: number): number | null {
  if (earliestNextAttemptAt === null) return null;
  return Math.max(MIN_WAKE_DELAY_MS, earliestNextAttemptAt - now);
}

export type QueueActivity = 'idle' | 'working' | 'waiting' | 'offline' | 'signed-out' | 'paused';

const photos = (count: number) => `${count} ${count === 1 ? 'photo' : 'photos'}`;

export function surveyStatusLine(activity: QueueActivity, counts: SurveyCounts): string | null {
  if (activity === 'paused') return 'Reading paused after repeated errors';
  if (!counts.pending) return null;
  switch (activity) {
    case 'working':
      return `Reading ${counts.captured - counts.pending + 1} of ${counts.captured}…`;
    case 'offline':
      return `No signal: ${photos(counts.pending)} stored on this phone`;
    case 'signed-out':
      return 'Paused: sign in to keep processing';
    default:
      return `Retrying ${photos(counts.pending)} shortly`;
  }
}

export function formFromReading(reading: AIStructuredExtraction, cemeteryId: string): NewGraveForm {
  return {
    firstName: reading.firstName,
    middleNames: reading.middleNames.join(' '),
    surname: reading.surname,
    nickname: reading.nickname ?? '',
    graveNumber: reading.graveNumber,
    birthDate: reading.birthDate ?? '',
    deathDate: reading.deathDate ?? '',
    cemeteryId,
  };
}

export type CaptureFilter = 'all' | 'review' | 'pending' | 'saved';

export function matchesFilter(capture: Pick<SurveyCapture, 'status'>, filter: CaptureFilter): boolean {
  if (filter === 'review') return NEEDS_REVIEW.includes(capture.status);
  if (filter === 'pending') return PENDING.includes(capture.status);
  if (filter === 'saved') return capture.status === 'saved';
  return true;
}

const REVIEW_LABELS: Record<ReviewReason, string> = {
  'no-name': "Name couldn't be read",
  'low-confidence': 'Check the name',
  'outside-cemetery': 'Outside the cemetery',
  'possible-duplicate': 'May already be mapped',
  unreadable: 'No details found',
};

export function captureStatusLabel(capture: Pick<SurveyCapture, 'status' | 'reviewReason' | 'outcome'>): string {
  switch (capture.status) {
    case 'queued':
      return 'Queued';
    case 'reading':
      return 'Reading…';
    case 'saving':
      return 'Saving…';
    case 'review':
      return capture.reviewReason ? REVIEW_LABELS[capture.reviewReason] : 'Needs review';
    case 'saved':
      return capture.outcome === 'added-photo' ? 'Photo added to a mapped grave' : 'Saved';
    default:
      return "Couldn't be processed";
  }
}
