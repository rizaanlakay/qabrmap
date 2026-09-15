import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { dataStore } from '../src/lib/data/store';
import { offlineDb } from '../src/lib/offline/db';
import { Grave, GraveRelationship } from '../src/types';

function testGrave(id: string, overrides: Partial<Grave> = {}): Grave {
  return {
    id,
    cemeteryId: 'cem_mowbray',
    graveNumber: '1402',
    latitude: -33.93925,
    longitude: 18.46115,
    positionAccuracyMeters: 2.1,
    positionConfidence: 'HIGH',
    status: 'MAPPED',
    photoCount: 0,
    person: {
      id: `person_${id}`,
      firstName: 'Fatima',
      surname: 'Hendricks',
      fullName: 'Fatima Hendricks',
      gender: 'female',
      deathDate: '2018-05-14',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('My Cemeteries & Grave Relationship System', () => {
  it('starts with no saved cemeteries, graves or relationships', () => {
    expect(dataStore.isMyCemetery('cem_athlone')).toBe(false);
    expect(dataStore.isMyCemetery('cem_mowbray')).toBe(false);
    expect(dataStore.getMyCemeteryCount()).toBe(0);
    expect(dataStore.getGraveRelationship('grave_8660')).toBeUndefined();
    expect(dataStore.getGraveRelationship('grave_mowbray_grandmother')).toBeUndefined();
  });

  it('has no built-in sample graves', async () => {
    expect(await dataStore.getGraves()).toHaveLength(0);
    expect(await dataStore.getGraveById('grave_8660')).toBeUndefined();
  });

  it('counts graves mapped per cemetery from real graves and hides coverage without a total', async () => {
    const cemeteries = await dataStore.getCemeteries();
    expect(cemeteries.length).toBeGreaterThan(0);
    for (const cemetery of cemeteries) {
      expect(cemetery.mappedGravesCount).toBe(0);
      expect(cemetery.totalGravesEstimate).toBe(0);
      expect(cemetery.coveragePercentage).toBe(0);
    }
  });

  it('should toggle and track My cemeteries correctly', async () => {
    const stateAfterAdd = dataStore.toggleMyCemetery('cem_athlone');
    expect(stateAfterAdd).toBe(true);
    expect(dataStore.isMyCemetery('cem_athlone')).toBe(true);

    const myCems = await dataStore.getMyCemeteries();
    expect(myCems.some((c) => c.id === 'cem_athlone')).toBe(true);

    const stateAfterRemoval = dataStore.toggleMyCemetery('cem_athlone');
    expect(stateAfterRemoval).toBe(false);
    expect(dataStore.isMyCemetery('cem_athlone')).toBe(false);
  });

  it('should save, retrieve, and remove grave relationships', async () => {
    const graveId = 'grave_test_rel_1';
    const rel: GraveRelationship = {
      graveId,
      category: 'family',
      specificRelation: 'Father',
      notes: 'May Allah have mercy on his soul',
      savedAt: new Date().toISOString(),
    };

    dataStore.saveGraveRelationship(rel);

    const retrieved = dataStore.getGraveRelationship(graveId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.category).toBe('family');
    expect(retrieved?.specificRelation).toBe('Father');
    expect(retrieved?.notes).toBe('May Allah have mercy on his soul');

    // Update to Friend / Close Friend
    const friendRel: GraveRelationship = {
      graveId,
      category: 'friend',
      specificRelation: 'Close Friend',
      notes: 'Childhood friend from high school',
      savedAt: new Date().toISOString(),
    };
    dataStore.saveGraveRelationship(friendRel);

    const updated = dataStore.getGraveRelationship(graveId);
    expect(updated?.category).toBe('friend');
    expect(updated?.specificRelation).toBe('Close Friend');

    // Remove relationship
    dataStore.removeGraveRelationship(graveId);
    expect(dataStore.getGraveRelationship(graveId)).toBeUndefined();
  });

  it('should filter search results by loved ones and show grave counts', async () => {
    // Graves reach the device from the cloud; here they are placed in the offline cache directly
    await offlineDb.graves.bulkPut([
      testGrave('grave_test_grandmother'),
      testGrave('grave_test_unrelated', { graveNumber: '1403' }),
    ]);
    dataStore.saveGraveRelationship({
      graveId: 'grave_test_grandmother',
      category: 'family',
      specificRelation: 'Grandmother',
      notes: 'Beloved Grandmother, dearly missed',
      savedAt: new Date().toISOString(),
    });

    const savedResults = await dataStore.searchGraves('', 'saved');
    expect(savedResults.map((g) => g.id)).toEqual(['grave_test_grandmother']);
    expect(savedResults[0].relationship).toBeDefined();
    expect(savedResults[0].cemeteryName).toBe('Mowbray Muslim Cemetery');

    const mowbray = await dataStore.getCemeteryById('cem_mowbray');
    // Without a connection the count comes from the graves cached on this device
    expect(mowbray?.mappedGravesCount).toBe(2);
  });

  it('should return My cemeteries list with Grandmother at Mowbray showing Name, Surname, DOD, and relation', async () => {
    const entries = await dataStore.getMyCemeteriesGraves();
    expect(entries.length).toBeGreaterThanOrEqual(1);

    const gmEntry = entries.find((e) => e.grave.id === 'grave_test_grandmother');
    expect(gmEntry).toBeDefined();
    expect(gmEntry?.cemetery?.name).toBe('Mowbray Muslim Cemetery');
    expect(gmEntry?.grave.person?.firstName).toBe('Fatima');
    expect(gmEntry?.grave.person?.surname).toBe('Hendricks');
    expect(gmEntry?.grave.person?.deathDate).toBe('2018-05-14');
    expect(gmEntry?.relationship?.category).toBe('family');
    expect(gmEntry?.relationship?.specificRelation).toBe('Grandmother');
  });
});
