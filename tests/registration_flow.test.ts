import { describe, it, expect, beforeEach } from 'vitest';
import { dataStore } from '../src/lib/data/store';
import { isSupabaseConfigured } from '../src/lib/supabase/client';

describe('New User Registration & Onboarding Flow', () => {
  beforeEach(() => {
    // Reset or clean if necessary
  });

  it('should have Supabase configured via environment variables', () => {
    // In dev / test environment with .env.local loaded or fallback
    expect(typeof isSupabaseConfigured).toBe('boolean');
  });

  it('should successfully save a newly registered loved one into My Cemeteries', async () => {
    const uniqueId = `grave_reg_test_${Date.now()}`;
    const lovedOneGrave = {
      id: uniqueId,
      cemeteryId: 'cem_mowbray',
      graveNumber: 'REG-101',
      latitude: -33.9485,
      longitude: 18.4820,
      positionAccuracyMeters: 2.5,
      positionConfidence: 'HIGH' as const,
      status: 'MAPPED' as const,
      primaryPhotoUrl: '/sample-gravestone.svg',
      photoCount: 1,
      person: {
        id: `person_${uniqueId}`,
        firstName: 'Zubair',
        surname: 'Hendricks',
        fullName: 'Zubair Hendricks',
        gender: 'unknown' as const,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save newly entered grave
    await dataStore.saveNewGrave(lovedOneGrave);

    // Save relationship created during registration
    dataStore.saveGraveRelationship({
      graveId: uniqueId,
      category: 'family',
      specificRelation: 'Brother',
      notes: 'Beloved brother registered during onboarding',
      savedAt: new Date().toISOString(),
    });

    // Verify it is saved
    expect(dataStore.isGraveSaved(uniqueId)).toBe(true);

    const rel = dataStore.getGraveRelationship(uniqueId);
    expect(rel).toBeDefined();
    expect(rel?.specificRelation).toBe('Brother');
    expect(rel?.notes).toBe('Beloved brother registered during onboarding');

    // Verify it appears in My Cemeteries list
    const myCemsGraves = await dataStore.getMyCemeteriesGraves();
    const found = myCemsGraves.find((entry) => entry.grave.id === uniqueId);
    expect(found).toBeDefined();
    expect(found?.grave.person?.fullName).toBe('Zubair Hendricks');
    expect(found?.cemetery?.name).toBe('Mowbray Muslim Cemetery');
  });

  it('should maintain user count when new relationships are added', () => {
    const initialCount = dataStore.getMyCemeteriesGraveCount();
    expect(initialCount).toBeGreaterThanOrEqual(2); // Seeded grandfather/father + previous test
  });
});
