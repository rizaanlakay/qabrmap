import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import type { DeviceTelemetry, Survey } from '../src/types';
import { QabrMapDatabase } from '../src/lib/offline/db';
import { SurveyStore } from '../src/lib/surveys/surveyStore';

const telemetry: DeviceTelemetry = {
  latitude: -33.968,
  longitude: 18.503,
  gpsAccuracy: 4,
  headingDegrees: 62,
  timestamp: '2026-09-15T10:00:00.000Z',
};

let databaseNumber = 0;
let store: SurveyStore;
let clockMs: number;

function idsFrom(prefix: string) {
  let n = 0;
  return () => `${prefix}${++n}`;
}

beforeEach(() => {
  clockMs = Date.parse('2026-09-15T10:00:00.000Z');
  store = new SurveyStore(new QabrMapDatabase(`QabrMapDB_store_test_${++databaseNumber}`), idsFrom('id'), () => new Date(clockMs));
});

async function startAthlone(userId = 'user-1'): Promise<Survey> {
  return store.startSurvey({ userId, cemeteryId: 'cem_athlone', cemeteryName: 'Athlone Muslim Cemetery', sectionNote: 'Row 12' });
}

async function addCapture(survey: Survey) {
  clockMs += 1000;
  return store.addCapture({
    survey,
    photo: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
    thumbnail: 'data:image/jpeg;base64,/9j/',
    telemetry,
    insideBoundary: true,
  });
}

describe('Survey Store Tests', () => {
  it('starts one active survey per surveyor and finishes it', async () => {
    const survey = await startAthlone();
    expect(survey).toEqual({
      id: 'survey_id1',
      userId: 'user-1',
      cemeteryId: 'cem_athlone',
      cemeteryName: 'Athlone Muslim Cemetery',
      sectionNote: 'Row 12',
      startedAt: '2026-09-15T10:00:00.000Z',
      status: 'ACTIVE',
    });
    await expect(startAthlone()).resolves.toEqual(survey);
    await expect(store.activeSurvey('user-1')).resolves.toEqual(survey);
    await expect(store.activeSurvey('user-2')).resolves.toBeUndefined();

    clockMs += 60_000;
    await expect(store.finishSurvey(survey.id)).resolves.toMatchObject({ status: 'COMPLETED', completedAt: '2026-09-15T10:01:00.000Z' });
    await expect(store.activeSurvey('user-1')).resolves.toBeUndefined();

    const next = await startAthlone();
    expect(next.id).not.toBe(survey.id);
    await expect(store.listSurveys('user-1')).resolves.toMatchObject([{ id: next.id }, { id: survey.id }]);
  });

  it('queues a capture with fresh save ids', async () => {
    const survey = await startAthlone();
    const capture = await addCapture(survey);
    expect(capture).toMatchObject({
      id: 'capture_id2',
      surveyId: survey.id,
      userId: 'user-1',
      cemeteryId: 'cem_athlone',
      createdAt: '2026-09-15T10:00:01.000Z',
      status: 'queued',
      readAttempts: 0,
      saveFailures: 0,
      manualRetries: 0,
      nextAttemptAt: 0,
      insideBoundary: true,
      attempt: { graveId: 'grave_id3', personId: 'person_id4' },
    });
    expect((await store.getCapture(capture.id))?.photo).toBeInstanceOf(Blob);
  });

  it('lists captures newest first, per survey and per surveyor', async () => {
    const survey = await startAthlone();
    const first = await addCapture(survey);
    const second = await addCapture(survey);
    const other = await addCapture(await startAthlone('user-2'));
    expect((await store.listCaptures(survey.id)).map((c) => c.id)).toEqual([second.id, first.id]);
    expect((await store.userCaptures('user-2')).map((c) => c.id)).toEqual([other.id]);
  });

  it('finds eligible captures oldest first, and the next time to wake', async () => {
    const survey = await startAthlone();
    const first = await addCapture(survey);
    const second = await addCapture(survey);
    const third = await addCapture(survey);
    await store.updateCapture(second.id, { status: 'saving', nextAttemptAt: 5000 });
    await store.updateCapture(third.id, { status: 'review' });

    expect((await store.eligibleCaptures('user-1', 4000)).map((c) => c.id)).toEqual([first.id]);
    expect((await store.eligibleCaptures('user-1', 5000)).map((c) => c.id)).toEqual([first.id, second.id]);
    await expect(store.eligibleCaptures('user-2', 5000)).resolves.toEqual([]);

    await store.updateCapture(first.id, { status: 'saved' });
    await expect(store.earliestNextAttempt('user-1')).resolves.toBe(5000);
    await store.updateCapture(second.id, { status: 'failed' });
    await expect(store.earliestNextAttempt('user-1')).resolves.toBeNull();
  });

  it('returns captures left mid-read to the queue after a restart', async () => {
    const survey = await startAthlone();
    const capture = await addCapture(survey);
    await store.updateCapture(capture.id, { status: 'reading', readAttempts: 1 });
    await expect(store.resetInterruptedReads('user-1')).resolves.toBe(1);
    await expect(store.getCapture(capture.id)).resolves.toMatchObject({ status: 'queued', readAttempts: 1 });
  });

  it('removes the photo and deletes captures', async () => {
    const survey = await startAthlone();
    const capture = await addCapture(survey);
    await store.updateCapture(capture.id, { status: 'saved', photo: undefined, graveId: 'grave_id3' });
    expect('photo' in ((await store.getCapture(capture.id)) ?? {})).toBe(false);
    await store.deleteCapture(capture.id);
    await expect(store.getCapture(capture.id)).resolves.toBeUndefined();
  });

  it('keeps the paused state per surveyor', async () => {
    await expect(store.getQueueState('user-1')).resolves.toEqual({ userId: 'user-1', consecutiveFailures: 0, pausedForErrors: false });
    await store.setQueueState({ userId: 'user-1', consecutiveFailures: 5, pausedForErrors: true });
    await expect(store.getQueueState('user-1')).resolves.toEqual({ userId: 'user-1', consecutiveFailures: 5, pausedForErrors: true });
    await expect(store.getQueueState('user-2')).resolves.toMatchObject({ pausedForErrors: false });
  });
});
