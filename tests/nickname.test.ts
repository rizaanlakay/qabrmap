import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import type { Grave } from '../src/types';
import { mapDbPerson, personToDb } from '../src/lib/supabase/mappers';
import { SyncManager } from '../src/lib/offline/sync';
import { offlineDb } from '../src/lib/offline/db';

function graveWithPerson(id: string, firstName: string, surname: string, nickname?: string): Grave {
  return {
    id,
    cemeteryId: 'cem_nickname_test',
    graveNumber: '',
    latitude: -33.9675,
    longitude: 18.5033,
    positionAccuracyMeters: 4,
    positionConfidence: 'MEDIUM',
    status: 'MAPPED',
    photoCount: 1,
    person: { id: `person_${id}`, firstName, surname, fullName: `${firstName} ${surname}`, nickname },
    createdAt: '2026-09-15T10:00:00Z',
    updatedAt: '2026-09-15T10:00:00Z',
  };
}

describe('Nickname Tests', () => {
  it('maps a nickname to and from the persons table', () => {
    const person = mapDbPerson({ id: 'p1', first_name: 'Abdul', surname: 'Narker', full_name: 'Abdul Narker', nickname: 'Boeta Dul' });
    expect(person.nickname).toBe('Boeta Dul');
    expect(personToDb(person).nickname).toBe('Boeta Dul');
  });

  it('treats a missing nickname as empty', () => {
    const person = mapDbPerson({ id: 'p2', first_name: 'Fatima', surname: 'Davids', full_name: 'Fatima Davids', nickname: null });
    expect(person.nickname).toBeUndefined();
    expect(personToDb(person).nickname).toBeNull();
  });

  it('finds graves by nickname when searching offline', async () => {
    await offlineDb.graves.bulkPut([
      graveWithPerson('grave_nick_1', 'Abdul', 'Narker', 'Boeta Dul'),
      graveWithPerson('grave_nick_2', 'Fatima', 'Davids'),
    ]);
    const results = await new SyncManager().searchOfflineGraves('boeta', 'cem_nickname_test');
    expect(results.map((g) => g.id)).toEqual(['grave_nick_1']);
  });
});
