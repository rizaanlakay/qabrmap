// Offline cache for QabrMap: cemeteries and graves kept on the phone for search and maps without signal.
// Survey captures are processed by src/lib/surveys, not here.

import { offlineDb } from './db';
import { Cemetery, Grave } from '@/types';

export class SyncManager {
  public isOnline(): boolean {
    if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
      return navigator.onLine;
    }
    return true;
  }

  /**
   * Downloads and caches cemetery boundary, graves, and search index for offline use
   */
  public async cacheCemeteryForOffline(cemetery: Cemetery, graves: Grave[]): Promise<void> {
    await offlineDb.transaction('rw', [offlineDb.cemeteries, offlineDb.graves], async () => {
      await offlineDb.cemeteries.put(cemetery);
      await offlineDb.graves.bulkPut(graves);
    });
  }

  /**
   * Retrieves offline cached cemetery
   */
  public async getCachedCemetery(cemeteryId: string): Promise<Cemetery | undefined> {
    return await offlineDb.cemeteries.get(cemeteryId);
  }

  /**
   * Retrieves offline cached graves for cemetery
   */
  public async getCachedGraves(cemeteryId: string): Promise<Grave[]> {
    return await offlineDb.graves.where('cemeteryId').equals(cemeteryId).toArray();
  }

  /**
   * Searches offline cached graves
   */
  public async searchOfflineGraves(query: string, cemeteryId?: string): Promise<Grave[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    let collection = offlineDb.graves.toCollection();
    if (cemeteryId) {
      collection = offlineDb.graves.where('cemeteryId').equals(cemeteryId);
    }

    return await collection
      .filter((grave) => {
        const numMatch = grave.graveNumber.toLowerCase().includes(q);
        const nameMatch = grave.person?.fullName.toLowerCase().includes(q) ?? false;
        const surnameMatch = grave.person?.surname.toLowerCase().includes(q) ?? false;
        const nicknameMatch = grave.person?.nickname?.toLowerCase().includes(q) ?? false;
        return numMatch || nameMatch || surnameMatch || nicknameMatch;
      })
      .toArray();
  }
}

export const syncManager = new SyncManager();
