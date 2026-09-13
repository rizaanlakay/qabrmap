import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dataUrlToBlob, uploadGravePhoto, GRAVE_PHOTOS_BUCKET } from '../src/lib/supabase/storage';
import { syncManager } from '../src/lib/offline/sync';
import { offlineDb } from '../src/lib/offline/db';

describe('Supabase Storage & Gravestone Photo Management Tests', () => {
  beforeEach(async () => {
    await offlineDb.offlineUploadQueue.clear();
    await offlineDb.graves.clear();
  });

  it('correctly converts base64 DataURL into binary Blob and extracts MIME type', () => {
    // 1x1 transparent GIF / mock jpeg base64
    const mockJpegDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    const result = dataUrlToBlob(mockJpegDataUrl);

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.blob).toBeDefined();
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.blob.type).toBe('image/jpeg');
  });

  it('correctly parses PNG DataURLs', () => {
    const mockPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const result = dataUrlToBlob(mockPngDataUrl);

    expect(result.mimeType).toBe('image/png');
    expect(result.blob.type).toBe('image/png');
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it('bypasses upload for existing remote HTTP / static SVG URLs', async () => {
    const staticUrl = '/sample-gravestone.svg';
    const res = await uploadGravePhoto({
      file: staticUrl,
      cemeteryId: 'cem_mowbray',
    });

    expect(res).toBeDefined();
    expect(res?.publicUrl).toBe(staticUrl);
    expect(res?.path).toBe('');

    const remoteUrl = 'https://mtrfkytpzvdeieicuuia.supabase.co/storage/v1/object/public/grave-photos/mowbray/grave_1.jpg';
    const remoteRes = await uploadGravePhoto({
      file: remoteUrl,
    });
    expect(remoteRes?.publicUrl).toBe(remoteUrl);
  });

  it('uses grave-photos as the target storage bucket', () => {
    expect(GRAVE_PHOTOS_BUCKET).toBe('grave-photos');
  });

  it('enqueues photo into offline queue and syncPendingUploads completes successfully', async () => {
    const graveId = 'grave_test_offline_1';
    await offlineDb.graves.put({
      id: graveId,
      cemeteryId: 'cem_athlone',
      graveNumber: 'A-101',
      latitude: -33.9,
      longitude: 18.5,
      positionAccuracyMeters: 2.0,
      positionConfidence: 'HIGH',
      status: 'MAPPED',
      primaryPhotoUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      photoCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Enqueue an upload
    await offlineDb.offlineUploadQueue.add({
      id: 'queue_test_1',
      graveId,
      cemeteryId: 'cem_athlone',
      photoBlob: '/sample-gravestone.svg', // will bypass storage network call
      telemetry: {
        latitude: -33.9,
        longitude: 18.5,
        gpsAccuracy: 2.0,
        timestamp: new Date().toISOString(),
      },
      status: 'queued',
      retryCount: 0,
      createdAt: new Date().toISOString(),
    });

    const pendingBefore = await syncManager.getPendingCount();
    expect(pendingBefore).toBe(1);

    const syncResult = await syncManager.syncPendingUploads();
    expect(syncResult.synced).toBe(1);
    expect(syncResult.failed).toBe(0);

    const pendingAfter = await syncManager.getPendingCount();
    expect(pendingAfter).toBe(0);
  });
});
