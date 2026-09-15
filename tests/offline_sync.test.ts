import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import type { Cemetery } from '../src/types';
import { offlineDb } from '../src/lib/offline/db';

describe('Offline Database & Sync Engine Unit Tests', () => {
  it('stores and retrieves items from Dexie database', async () => {
    const cemetery: Cemetery = {
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
      siteType: 'muslim_cemetery',
      siteStatus: 'active',
      aliases: [],
    };

    await offlineDb.cemeteries.put(cemetery);
    const retrieved = await offlineDb.cemeteries.get('test_cem');
    expect(retrieved?.name).toBe('Test Cemetery');
    expect(retrieved?.coveragePercentage).toBe(50);
  });
});
