import { describe, it, expect, beforeEach } from 'vitest';
import { dataStore } from '../src/lib/data/store';
import { GraveRelationship } from '../src/types';

describe('My Cemeteries & Grave Relationship System', () => {
  it('should toggle and track My cemeteries correctly', async () => {
    // Initial state has Athlone and Mowbray by default
    expect(dataStore.isMyCemetery('cem_athlone')).toBe(true);
    expect(dataStore.getMyCemeteryCount()).toBeGreaterThanOrEqual(1);

    // Toggle off Athlone
    const stateAfterRemoval = dataStore.toggleMyCemetery('cem_athlone');
    expect(stateAfterRemoval).toBe(false);
    expect(dataStore.isMyCemetery('cem_athlone')).toBe(false);

    // Toggle back on Athlone
    const stateAfterAdd = dataStore.toggleMyCemetery('cem_athlone');
    expect(stateAfterAdd).toBe(true);
    expect(dataStore.isMyCemetery('cem_athlone')).toBe(true);

    const myCems = await dataStore.getMyCemeteries();
    expect(myCems.some((c) => c.id === 'cem_athlone')).toBe(true);
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

  it('should filter search results by loved ones', async () => {
    // grave_8660 has a seeded relationship in DataStore
    const savedResults = await dataStore.searchGraves('', 'saved');
    expect(savedResults.length).toBeGreaterThanOrEqual(1);
    expect(savedResults.some((g) => g.id === 'grave_8660')).toBe(true);
    expect(savedResults[0].relationship).toBeDefined();
  });

  it('should return My cemeteries list with Grandmother at Mowbray showing Name, Surname, DOD, and relation', async () => {
    const entries = await dataStore.getMyCemeteriesGraves();
    expect(entries.length).toBeGreaterThanOrEqual(1);

    const gmEntry = entries.find((e) => e.grave.id === 'grave_mowbray_grandmother');
    expect(gmEntry).toBeDefined();
    expect(gmEntry?.cemetery?.name).toBe('Mowbray Muslim Cemetery');
    expect(gmEntry?.grave.person?.firstName).toBe('Fatima');
    expect(gmEntry?.grave.person?.surname).toBe('Hendricks');
    expect(gmEntry?.grave.person?.deathDate).toBe('2018-05-14');
    expect(gmEntry?.relationship?.category).toBe('family');
    expect(gmEntry?.relationship?.specificRelation).toBe('Grandmother');
  });
});
