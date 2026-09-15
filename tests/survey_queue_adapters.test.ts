import { describe, it, expect } from 'vitest';
import type { Survey } from '../src/types';
import type { StoneReading } from '../src/lib/ai/stoneReading';
import { SaveGraveError, UNKNOWN_SAVE_MESSAGE } from '../src/lib/supabase/saveGraveErrors';
import {
  CLOUD_SYNC_INTERVAL_MS,
  cloudSyncDelayMs,
  mapCloudSurveyRow,
  readResultFromResponse,
  saveResultFromError,
  saveResultFromOutcome,
  surveySessionRow,
} from '../src/lib/surveys/queueAdapters';

const yusuf: StoneReading = {
  hasGraveDetails: true,
  firstName: 'Yusuf',
  middleNames: [],
  surname: 'Kamish',
  nickname: null,
  graveNumber: null,
  birthDate: '1952-02-02',
  deathDate: '2018-06-16',
  datesAsWritten: null,
  transcript: 'YUSUF KAMISH',
  confidence: { name: 0.95, graveNumber: 0, dates: 0.9 },
  notes: [],
};

const survey: Survey = {
  id: 'survey_1',
  userId: 'user-1',
  cemeteryId: 'cem_athlone',
  cemeteryName: 'Athlone Muslim Cemetery',
  sectionNote: 'Row 12',
  startedAt: '2026-09-15T10:00:00.000Z',
  status: 'ACTIVE',
};

const counts = { captured: 5, saved: 2, pending: 2, review: 1 };
const NOW = Date.parse('2026-09-15T10:05:00.000Z');

describe('Read Result Tests', () => {
  it('turns a reading into form details', () => {
    const result = readResultFromResponse(200, { reading: yusuf });
    expect(result).toMatchObject({ kind: 'reading', reading: { firstName: 'Yusuf', surname: 'Kamish', birthDate: '1952-02-02' } });
  });

  it('maps each failure to what the queue does next', () => {
    expect(readResultFromResponse(0, null)).toEqual({ kind: 'offline' });
    expect(readResultFromResponse(401, { error: 'Sign in to read a photo.' })).toEqual({ kind: 'signed-out' });
    expect(readResultFromResponse(429, { error: 'Too many photos are being read right now.' })).toEqual({
      kind: 'rate-limited',
      waitMs: 60_000,
    });
    expect(readResultFromResponse(429, { error: 'Too many photos read. Try again later.', code: 'read-limit' })).toEqual({
      kind: 'rate-limited',
      waitMs: 600_000,
    });
    expect(readResultFromResponse(422, { error: 'No grave details were found in this photo.' })).toEqual({
      kind: 'unreadable',
      message: 'No grave details were found in this photo.',
    });
    expect(readResultFromResponse(422, null)).toMatchObject({ kind: 'unreadable' });
    expect(readResultFromResponse(502, { error: "The photo couldn't be read." })).toEqual({ kind: 'error', message: "The photo couldn't be read." });
    expect(readResultFromResponse(503, null)).toMatchObject({ kind: 'error' });
    expect(readResultFromResponse(200, { reading: { name: 'broken' } })).toMatchObject({ kind: 'error' });
  });
});

describe('Save Result Tests', () => {
  it('passes saved, added and matched outcomes through', () => {
    expect(saveResultFromOutcome({ outcome: 'created', graveId: 'grave_1', personId: 'person_1', photoUrl: 'https://x/p.jpg' })).toEqual({
      kind: 'created',
      graveId: 'grave_1',
    });
    expect(saveResultFromOutcome({ outcome: 'added-photo', graveId: 'grave_2', personId: 'person_1', photoUrl: 'https://x/p.jpg' })).toEqual({
      kind: 'added-photo',
      graveId: 'grave_2',
    });
    const candidate = { graveId: 'grave_2', fullName: 'Yusuf Kamish', graveNumber: '', distanceMeters: 3, match: 'possible' as const };
    expect(saveResultFromOutcome({ outcome: 'match-found', candidate })).toEqual({ kind: 'match-found', candidate });
  });

  it('keeps offline and signed-out apart from real failures', () => {
    expect(saveResultFromError(new TypeError('Failed to fetch'))).toEqual({ kind: 'offline' });
    expect(saveResultFromError(new SaveGraveError('offline', 'offline'))).toEqual({ kind: 'offline' });
    expect(saveResultFromError({ code: '42501', message: 'Sign in to map a grave.' })).toEqual({ kind: 'signed-out' });
    expect(saveResultFromError(new SaveGraveError('signed-out', 'x'))).toEqual({ kind: 'signed-out' });
    expect(saveResultFromError({ code: '22023', message: 'GPS accuracy must be 10 m or better.' })).toEqual({
      kind: 'error',
      message: 'GPS accuracy must be 10 m or better.',
    });
    expect(saveResultFromError(new Error('boom'))).toEqual({ kind: 'error', message: UNKNOWN_SAVE_MESSAGE });
  });
});

describe('Cloud Survey Tests', () => {
  it('writes a new survey straight away', () => {
    expect(cloudSyncDelayMs(survey, counts, NOW)).toBe(0);
  });

  it('writes changed counts at most once a minute', () => {
    const synced = { ...survey, cloudSyncedAt: '2026-09-15T10:04:30.000Z', cloudCounts: { ...counts, saved: 1 } };
    expect(cloudSyncDelayMs(synced, counts, NOW)).toBe(30_000);
    expect(cloudSyncDelayMs(synced, counts, NOW + 30_000)).toBe(0);
    expect(cloudSyncDelayMs({ ...synced, cloudCounts: counts }, counts, NOW + CLOUD_SYNC_INTERVAL_MS)).toBeNull();
  });

  it('writes a finished survey straight away', () => {
    const finished: Survey = {
      ...survey,
      status: 'COMPLETED',
      completedAt: '2026-09-15T10:04:50.000Z',
      cloudSyncedAt: '2026-09-15T10:04:30.000Z',
      cloudCounts: counts,
    };
    expect(cloudSyncDelayMs(finished, counts, NOW)).toBe(0);
    expect(cloudSyncDelayMs({ ...finished, cloudSyncedAt: '2026-09-15T10:04:55.000Z' }, counts, NOW)).toBeNull();
  });

  it('maps a survey to a survey_sessions row, with Saved as processed', () => {
    expect(surveySessionRow(survey, counts)).toEqual({
      id: 'survey_1',
      user_id: 'user-1',
      cemetery_id: 'cem_athlone',
      cemetery_name: 'Athlone Muslim Cemetery',
      section_code: 'Row 12',
      started_at: '2026-09-15T10:00:00.000Z',
      completed_at: null,
      status: 'ACTIVE',
      captured_count: 5,
      processed_count: 2,
      pending_count: 2,
      review_count: 1,
    });
    expect(surveySessionRow({ ...survey, sectionNote: '' }, counts).section_code).toBeNull();
  });

  it('reads cloud rows for surveys from another phone', () => {
    expect(
      mapCloudSurveyRow({
        id: 'survey_9',
        cemetery_name: 'Mowbray Muslim Cemetery',
        section_code: null,
        started_at: '2026-09-01T08:00:00+00:00',
        completed_at: '2026-09-01T11:00:00+00:00',
        status: 'COMPLETED',
        captured_count: 40,
        processed_count: 35,
        pending_count: 0,
        review_count: 5,
      })
    ).toEqual({
      id: 'survey_9',
      cemeteryName: 'Mowbray Muslim Cemetery',
      sectionNote: '',
      startedAt: '2026-09-01T08:00:00+00:00',
      completedAt: '2026-09-01T11:00:00+00:00',
      status: 'COMPLETED',
      counts: { captured: 40, saved: 35, pending: 0, review: 5 },
    });
    expect(mapCloudSurveyRow({ id: 'survey_9' })).toBeNull();
  });
});
