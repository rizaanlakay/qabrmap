import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { SyncManager } from '../src/lib/offline/sync';
import { offlineDb } from '../src/lib/offline/db';

describe('Offline Database & Sync Engine Unit Tests', () => {
  it('stores and retrieves items from Dexie database', async () => {
    const cemetery = {
      id: 'test_cem',
      name: 'Test Cemetery',
      slug: 'test-cemetery',
      description: 'Test',
      country: 'South Africa',
      province: 'Western Cape',
      city: 'Cape Town',
      denomination: 'Muslim',
      originLat: -33.9,
      originLng: 18.5,
      totalGravesEstimate: 100,
      mappedGravesCount: 50,
      coveragePercentage: 50,
    };

    await offlineDb.cemeteries.put(cemetery);
    const retrieved = await offlineDb.cemeteries.get('test_cem');
    expect(retrieved?.name).toBe('Test Cemetery');
    expect(retrieved?.coveragePercentage).toBe(50);
  });

  it('enqueues offline capture and queries pending count', async () => {
    const sync = new SyncManager();

    const id = await sync.queueCapture({
      cemeteryId: 'test_cem',
      photoBlob: 'data:image/jpeg;base64,mock',
      telemetry: {
        latitude: -33.967521,
        longitude: 18.503277,
        gpsAccuracy: 3.5,
        headingDegrees: 62.0,
        timestamp: new Date().toISOString(),
      },
    });

    expect(id).toContain('queue_');
    const count = await sync.getPendingCount();
    expect(count).toBeGreaterThan(0);
  });
});
