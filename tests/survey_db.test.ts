import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import { QabrMapDatabase } from '../src/lib/offline/db';

describe('Survey Database Tests', () => {
  it('opens a version 1 database as the current version, keeping cached graves and dropping the old queue', async () => {
    const name = 'QabrMapDB_upgrade_test';
    const v1 = new Dexie(name);
    v1.version(1).stores({
      cemeteries: 'id, slug, name, city',
      graves: 'id, cemeteryId, graveNumber, status, positionConfidence, [cemeteryId+graveNumber]',
      surveySessions: 'id, cemeteryId, status',
      offlineUploadQueue: 'id, cemeteryId, status, createdAt',
    });
    await v1.table('graves').put({ id: 'grave_1', cemeteryId: 'cem_athlone', graveNumber: '1402', status: 'MAPPED', positionConfidence: 'HIGH' });
    await v1.table('offlineUploadQueue').put({ id: 'queue_1', cemeteryId: 'cem_athlone', status: 'queued', createdAt: '2026-09-15' });
    v1.close();

    const db = new QabrMapDatabase(name);
    await db.open();
    expect(db.verno).toBe(3);
    expect(db.tables.map((table) => table.name).sort()).toEqual(['cemeteries', 'graves', 'mapGraves', 'surveyCaptures', 'surveyQueueState', 'surveys']);
    await expect(db.graves.get('grave_1')).resolves.toMatchObject({ graveNumber: '1402' });
    db.close();
  });

  it('stores a capture with its photo and finds captures by survey and user', async () => {
    const db = new QabrMapDatabase('QabrMapDB_capture_test');
    await db.surveyCaptures.put({
      id: 'capture_1',
      surveyId: 'survey_1',
      userId: 'user-1',
      cemeteryId: 'cem_athlone',
      createdAt: '2026-09-15T10:00:00.000Z',
      photo: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
      thumbnail: 'data:image/jpeg;base64,/9j/',
      telemetry: { latitude: -33.968, longitude: 18.503, gpsAccuracy: 4, headingDegrees: 62, timestamp: '2026-09-15T10:00:00.000Z' },
      insideBoundary: true,
      status: 'queued',
      readAttempts: 0,
      saveFailures: 0,
      manualRetries: 0,
      nextAttemptAt: 0,
      attempt: { graveId: 'grave_a', personId: 'person_a' },
    });

    const stored = await db.surveyCaptures.get('capture_1');
    expect(stored?.photo).toBeInstanceOf(Blob);
    expect(stored?.photo?.size).toBe(3);
    await expect(db.surveyCaptures.where('surveyId').equals('survey_1').count()).resolves.toBe(1);
    await expect(db.surveyCaptures.where('userId').equals('user-1').count()).resolves.toBe(1);

    // Removing the photo once saved must drop the Blob, not keep an empty field
    await db.surveyCaptures.update('capture_1', { photo: undefined });
    expect('photo' in ((await db.surveyCaptures.get('capture_1')) ?? {})).toBe(false);
    db.close();
  });
});
