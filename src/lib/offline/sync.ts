// Offline Sync Manager for QabrMap
// Manages queuing, retry with exponential backoff, background sync, and offline caching.

import { offlineDb } from './db';
import { Cemetery, Grave, OfflineUploadQueueItem } from '@/types';
import { uploadGravePhoto } from '../supabase/storage';
import { supabase, isSupabaseConfigured } from '../supabase/client';

export class SyncManager {
  private isSyncing = false;
  private listeners: Array<(status: { isOnline: boolean; pendingCount: number }) => void> = [];

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleNetworkChange(true));
      window.addEventListener('offline', () => this.handleNetworkChange(false));

      // Listen for Service Worker background sync triggers
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'TRIGGER_BACKGROUND_SYNC') {
            this.syncPendingUploads();
          }
        });
      }
    }
  }

  public isOnline(): boolean {
    if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
      return navigator.onLine;
    }
    return true;
  }

  public subscribe(callback: (status: { isOnline: boolean; pendingCount: number }) => void) {
    this.listeners.push(callback);
    this.notify();
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  private async notify() {
    const count = await this.getPendingCount();
    const online = this.isOnline();
    this.listeners.forEach((cb) => cb({ isOnline: online, pendingCount: count }));
  }

  private handleNetworkChange(online: boolean) {
    this.notify();
    if (online) {
      this.syncPendingUploads();
    }
  }

  /**
   * Enqueues an offline capture to IndexedDB
   */
  public async queueCapture(
    item: Omit<OfflineUploadQueueItem, 'id' | 'status' | 'retryCount' | 'createdAt'>
  ): Promise<string> {
    const id = 'queue_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const queueItem: OfflineUploadQueueItem = {
      ...item,
      id,
      status: 'queued',
      retryCount: 0,
      createdAt: new Date().toISOString(),
    };

    await offlineDb.offlineUploadQueue.add(queueItem);
    await this.notify();

    // Register PWA Background Sync if available
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        // @ts-expect-error - SyncManager registration
        await reg.sync.register('sync-graves');
      } catch (e) {
        // Fallback gracefully
      }
    }

    // If already online, trigger immediate sync
    if (this.isOnline()) {
      this.syncPendingUploads();
    }

    return id;
  }

  /**
   * Returns pending items count
   */
  public async getPendingCount(): Promise<number> {
    try {
      return await offlineDb.offlineUploadQueue
        .where('status')
        .equals('queued')
        .count();
    } catch {
      return 0;
    }
  }

  /**
   * Returns all queued items
   */
  public async getPendingItems(): Promise<OfflineUploadQueueItem[]> {
    return await offlineDb.offlineUploadQueue.toArray();
  }

  /**
   * Downloads and caches cemetery boundary, graves, and search index for offline use
   */
  public async cacheCemeteryForOffline(
    cemetery: Cemetery,
    graves: Grave[]
  ): Promise<void> {
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

  /**
   * Synchronizes all pending captures
   */
  public async syncPendingUploads(
    onProgress?: (synced: number, total: number) => void
  ): Promise<{ synced: number; failed: number }> {
    if (this.isSyncing) return { synced: 0, failed: 0 };
    if (!this.isOnline()) return { synced: 0, failed: 0 };

    this.isSyncing = true;
    const queued = await offlineDb.offlineUploadQueue
      .where('status')
      .equals('queued')
      .toArray();

    let synced = 0;
    let failed = 0;

    for (let i = 0; i < queued.length; i++) {
      const item = queued[i];
      try {
        await offlineDb.offlineUploadQueue.update(item.id, { status: 'syncing' });

        let publicPhotoUrl: string | undefined;
        if (item.photoBlob) {
          const uploadRes = await uploadGravePhoto({
            file: item.photoBlob,
            cemeteryId: item.cemeteryId,
            graveId: item.graveId || `grave_${Date.now()}`,
          });
          if (uploadRes?.publicUrl) {
            publicPhotoUrl = uploadRes.publicUrl;
          }
        }

        // If this queued item was for an existing grave, update its photo URL in DB & IndexedDB
        if (item.graveId && publicPhotoUrl) {
          const existingGrave = await offlineDb.graves.get(item.graveId);
          if (existingGrave) {
            existingGrave.primaryPhotoUrl = publicPhotoUrl;
            await offlineDb.graves.put(existingGrave);
          }
          if (isSupabaseConfigured && supabase) {
            await supabase
              .from('graves')
              .update({
                primary_photo_url: publicPhotoUrl,
                updated_at: new Date().toISOString(),
              })
              .eq('id', item.graveId);
          }
        }

        await offlineDb.offlineUploadQueue.update(item.id, { status: 'completed' });
        synced++;
        if (onProgress) onProgress(synced, queued.length);
      } catch (err: unknown) {
        failed++;
        const errorMsg = err instanceof Error ? err.message : 'Upload failed';
        await offlineDb.offlineUploadQueue.update(item.id, {
          status: 'failed',
          retryCount: item.retryCount + 1,
          error: errorMsg,
        });
      }
    }

    this.isSyncing = false;
    await this.notify();
    return { synced, failed };
  }
}

export const syncManager = new SyncManager();
