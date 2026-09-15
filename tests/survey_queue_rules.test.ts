import { describe, it, expect } from 'vitest';
import type { AIStructuredExtraction, SurveyCapture, SurveyQueueState } from '../src/types';
import {
  CIRCUIT_BREAKER_LIMIT,
  backoffMs,
  canRetry,
  captureStatusLabel,
  countCaptures,
  decideAfterReading,
  formFromReading,
  isEligible,
  matchesFilter,
  nextQueueState,
  readLimit,
  retryChanges,
  saveLimit,
  surveyStatusLine,
  wakeDelayMs,
} from '../src/lib/surveys/queueRules';

const reading: AIStructuredExtraction = {
  graveNumber: '1402',
  firstName: 'Yusuf',
  middleNames: ['Ahmed'],
  surname: 'Kamish',
  nickname: 'Boeta',
  fullName: 'Yusuf Ahmed Kamish',
  birthDate: '1952-02-02',
  deathDate: undefined,
  confidence: 0.93,
  rawOcrText: 'YUSUF KAMISH',
  otherText: [],
  fieldConfidences: { graveNumber: 0.9, fullName: 0.95, dates: 0.9 },
};

function capture(overrides: Partial<SurveyCapture> = {}): SurveyCapture {
  return {
    id: 'capture_1',
    surveyId: 'survey_1',
    userId: 'user-1',
    cemeteryId: 'cem_athlone',
    createdAt: '2026-09-15T10:00:00.000Z',
    thumbnail: 'data:image/jpeg;base64,/9j/',
    telemetry: { latitude: -33.968, longitude: 18.503, gpsAccuracy: 4, headingDegrees: 62, timestamp: '2026-09-15T10:00:00.000Z' },
    insideBoundary: true,
    status: 'queued',
    readAttempts: 0,
    saveFailures: 0,
    manualRetries: 0,
    nextAttemptAt: 0,
    attempt: { graveId: 'grave_a', personId: 'person_a' },
    ...overrides,
  };
}

const state: SurveyQueueState = { userId: 'user-1', consecutiveFailures: 0, pausedForErrors: false };

describe('Auto Save Decision Tests', () => {
  it('saves a clear reading of a name inside the cemetery', () => {
    expect(decideAfterReading(reading, true)).toEqual({ status: 'saving' });
  });

  it('sends anything less certain to review, in order', () => {
    expect(decideAfterReading({ ...reading, firstName: ' ' }, false)).toEqual({ status: 'review', reason: 'no-name' });
    expect(decideAfterReading({ ...reading, surname: '' }, true)).toEqual({ status: 'review', reason: 'no-name' });
    expect(decideAfterReading({ ...reading, fieldConfidences: { ...reading.fieldConfidences, fullName: 0.89 } }, false)).toEqual({
      status: 'review',
      reason: 'low-confidence',
    });
    expect(decideAfterReading({ ...reading, fieldConfidences: { ...reading.fieldConfidences, fullName: 0.9 } }, true)).toEqual({
      status: 'saving',
    });
    expect(decideAfterReading(reading, false)).toEqual({ status: 'review', reason: 'outside-cemetery' });
  });
});

describe('Retry Limit Tests', () => {
  it('backs off 30 seconds, 2 minutes, then 10 minutes', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(600_000);
    expect(backoffMs(9)).toBe(600_000);
  });

  it('allows 3 reads or saves, plus one per manual retry, and at most 2 manual retries', () => {
    expect(readLimit(capture())).toBe(3);
    expect(saveLimit(capture({ manualRetries: 2 }))).toBe(5);
    expect(canRetry(capture({ status: 'failed', manualRetries: 1 }))).toBe(true);
    expect(canRetry(capture({ status: 'failed', manualRetries: 2 }))).toBe(false);
    expect(canRetry(capture({ status: 'review', manualRetries: 0 }))).toBe(false);
  });

  it('retries a failed read by reading again, and a failed save by saving again', () => {
    expect(retryChanges(capture({ status: 'failed', readAttempts: 3, lastError: 'boom' }))).toEqual({
      status: 'queued',
      manualRetries: 1,
      nextAttemptAt: 0,
      lastError: undefined,
    });
    expect(retryChanges(capture({ status: 'failed', reading, saveFailures: 3, manualRetries: 1 }))).toEqual({
      status: 'saving',
      manualRetries: 2,
      nextAttemptAt: 0,
      lastError: undefined,
    });
  });
});

describe('Eligibility And Counts Tests', () => {
  it("only processes the signed-in surveyor's queued or saving captures whose wait is over", () => {
    expect(isEligible(capture(), 'user-1', 1000)).toBe(true);
    expect(isEligible(capture({ status: 'saving', nextAttemptAt: 1000 }), 'user-1', 1000)).toBe(true);
    expect(isEligible(capture({ nextAttemptAt: 1001 }), 'user-1', 1000)).toBe(false);
    expect(isEligible(capture(), 'user-2', 1000)).toBe(false);
    for (const status of ['reading', 'review', 'saved', 'failed'] as const) {
      expect(isEligible(capture({ status }), 'user-1', 1000)).toBe(false);
    }
  });

  it('derives the four counters from statuses', () => {
    const statuses = ['queued', 'reading', 'saving', 'review', 'failed', 'saved', 'saved'] as const;
    expect(countCaptures(statuses.map((status) => ({ status })))).toEqual({ captured: 7, saved: 2, pending: 3, review: 2 });
    expect(countCaptures([])).toEqual({ captured: 0, saved: 0, pending: 0, review: 0 });
  });

  it('filters the captures list', () => {
    expect(matchesFilter({ status: 'failed' }, 'review')).toBe(true);
    expect(matchesFilter({ status: 'reading' }, 'pending')).toBe(true);
    expect(matchesFilter({ status: 'saved' }, 'pending')).toBe(false);
    expect(matchesFilter({ status: 'saved' }, 'saved')).toBe(true);
    expect(matchesFilter({ status: 'queued' }, 'all')).toBe(true);
  });
});

describe('Circuit Breaker Tests', () => {
  it(`pauses after ${CIRCUIT_BREAKER_LIMIT} failures in a row`, () => {
    let current = state;
    for (let i = 0; i < CIRCUIT_BREAKER_LIMIT - 1; i++) current = nextQueueState(current, 'failure');
    expect(current).toEqual({ ...state, consecutiveFailures: 4, pausedForErrors: false });
    expect(nextQueueState(current, 'failure')).toEqual({ ...state, consecutiveFailures: 5, pausedForErrors: true });
  });

  it('resets on progress, and ignores offline, sign-in and rate limits', () => {
    const failing = { ...state, consecutiveFailures: 3 };
    expect(nextQueueState(failing, 'progress').consecutiveFailures).toBe(0);
    expect(nextQueueState(failing, 'offline')).toBe(failing);
    expect(nextQueueState(failing, 'signed-out')).toBe(failing);
    expect(nextQueueState(failing, 'rate-limited')).toBe(failing);
  });

  it('never wakes sooner than 30 seconds, and not at all with nothing waiting', () => {
    expect(wakeDelayMs(null, 1000)).toBeNull();
    expect(wakeDelayMs(5000, 1000)).toBe(30_000);
    expect(wakeDelayMs(601_000, 1000)).toBe(600_000);
  });
});

describe('Survey Status Text Tests', () => {
  const counts = { captured: 8, saved: 2, pending: 6, review: 0 };

  it('says what the queue is doing', () => {
    expect(surveyStatusLine('working', counts)).toBe('Reading 3 of 8…');
    expect(surveyStatusLine('offline', counts)).toBe('No signal: 6 photos stored on this phone');
    expect(surveyStatusLine('offline', { ...counts, pending: 1 })).toBe('No signal: 1 photo stored on this phone');
    expect(surveyStatusLine('signed-out', counts)).toBe('Paused: sign in to keep processing');
    expect(surveyStatusLine('paused', counts)).toBe('Reading paused after repeated errors');
    expect(surveyStatusLine('waiting', counts)).toBe('Retrying 6 photos shortly');
    expect(surveyStatusLine('idle', counts)).toBe('Retrying 6 photos shortly');
  });

  it('says nothing when nothing is waiting, unless the queue is paused', () => {
    const done = { captured: 8, saved: 8, pending: 0, review: 0 };
    expect(surveyStatusLine('idle', done)).toBeNull();
    expect(surveyStatusLine('offline', done)).toBeNull();
    expect(surveyStatusLine('paused', done)).toBe('Reading paused after repeated errors');
  });

  it('labels each capture', () => {
    expect(captureStatusLabel({ status: 'queued' })).toBe('Queued');
    expect(captureStatusLabel({ status: 'reading' })).toBe('Reading…');
    expect(captureStatusLabel({ status: 'saving' })).toBe('Saving…');
    expect(captureStatusLabel({ status: 'review', reviewReason: 'no-name' })).toBe("Name couldn't be read");
    expect(captureStatusLabel({ status: 'review', reviewReason: 'low-confidence' })).toBe('Check the name');
    expect(captureStatusLabel({ status: 'review', reviewReason: 'outside-cemetery' })).toBe('Outside the cemetery');
    expect(captureStatusLabel({ status: 'review', reviewReason: 'possible-duplicate' })).toBe('May already be mapped');
    expect(captureStatusLabel({ status: 'review', reviewReason: 'unreadable' })).toBe('No details found');
    expect(captureStatusLabel({ status: 'saved', outcome: 'created' })).toBe('Saved');
    expect(captureStatusLabel({ status: 'saved', outcome: 'added-photo' })).toBe('Photo added to a mapped grave');
    expect(captureStatusLabel({ status: 'failed' })).toBe("Couldn't be processed");
  });
});

describe('Form From Reading Tests', () => {
  it('fills the save form from a reading', () => {
    expect(formFromReading(reading, 'cem_athlone')).toEqual({
      firstName: 'Yusuf',
      middleNames: 'Ahmed',
      surname: 'Kamish',
      nickname: 'Boeta',
      graveNumber: '1402',
      birthDate: '1952-02-02',
      deathDate: '',
      cemeteryId: 'cem_athlone',
    });
  });
});
