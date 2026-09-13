// Dexie IndexedDB Database for QabrMap
// Stores cemeteries, graves, search index, survey sessions, and offline upload queue locally.

import Dexie, { type EntityTable } from 'dexie';
import {
  Cemetery,
  Grave,
  SurveySession,
  OfflineUploadQueueItem,
} from '@/types';

export class QabrMapDatabase extends Dexie {
  cemeteries!: EntityTable<Cemetery, 'id'>;
  graves!: EntityTable<Grave, 'id'>;
  surveySessions!: EntityTable<SurveySession, 'id'>;
  offlineUploadQueue!: EntityTable<OfflineUploadQueueItem, 'id'>;

  constructor() {
    super('QabrMapDB');
    this.version(1).stores({
      cemeteries: 'id, slug, name, city',
      graves: 'id, cemeteryId, graveNumber, status, positionConfidence, [cemeteryId+graveNumber]',
      surveySessions: 'id, cemeteryId, status',
      offlineUploadQueue: 'id, cemeteryId, status, createdAt',
    });
  }
}

export const offlineDb = new QabrMapDatabase();
