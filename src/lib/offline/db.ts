// Dexie IndexedDB Database for QabrMap
// Stores cemeteries, graves and the map's grave points for offline use, and survey captures waiting to be read and saved.

import Dexie, { type EntityTable } from 'dexie';
import { Cemetery, Grave, MapGrave, Survey, SurveyCapture, SurveyQueueState } from '@/types';

export class QabrMapDatabase extends Dexie {
  cemeteries!: EntityTable<Cemetery, 'id'>;
  graves!: EntityTable<Grave, 'id'>;
  mapGraves!: EntityTable<MapGrave, 'id'>;
  surveys!: EntityTable<Survey, 'id'>;
  surveyCaptures!: EntityTable<SurveyCapture, 'id'>;
  surveyQueueState!: EntityTable<SurveyQueueState, 'userId'>;

  // The name is only changed by tests, which need a database of their own
  constructor(name = 'QabrMapDB') {
    super(name);
    this.version(1).stores({
      cemeteries: 'id, slug, name, city',
      graves: 'id, cemeteryId, graveNumber, status, positionConfidence, [cemeteryId+graveNumber]',
      surveySessions: 'id, cemeteryId, status',
      offlineUploadQueue: 'id, cemeteryId, status, createdAt',
    });
    // Surveys now keep their captures on the phone. The old upload queue and the sample survey table are dropped.
    this.version(2).stores({
      surveySessions: null,
      offlineUploadQueue: null,
      surveys: 'id, userId, status, startedAt',
      surveyCaptures: 'id, surveyId, userId, status, createdAt, nextAttemptAt',
      surveyQueueState: 'userId',
    });
    // The cemetery map keeps a slim row per grave, so a cemetery of thousands still opens without signal
    this.version(3).stores({
      mapGraves: 'id, cemeteryId',
    });
  }
}

export const offlineDb = new QabrMapDatabase();
