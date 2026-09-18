import { describe, it, expect, vi } from 'vitest';
import {
  MIN_SEARCH_CHARS,
  RECENT_GRAVES_LIMIT,
  SEARCH_PAGE_SIZE,
  SearchGravesDeps,
  addRecentGrave,
  filterGravesLocally,
  inOrderOf,
  isSearchable,
  normaliseSearchQuery,
  pageOf,
  searchGravesRemote,
} from '../src/lib/graves/searchGraves';
import type { Grave } from '../src/types';

function grave(id: string, fullName: string | null, graveNumber = '', nickname?: string): Grave {
  const [firstName, ...rest] = (fullName ?? '').split(' ');
  return {
    id,
    cemeteryId: 'cem_johnson_road',
    person: fullName === null ? undefined : { id: `person_${id}`, firstName, surname: rest[rest.length - 1] ?? '', fullName, nickname },
    graveNumber,
    latitude: -33.98,
    longitude: 18.5,
    positionAccuracyMeters: 3,
    positionConfidence: 'HIGH',
    status: 'MAPPED',
    photoCount: 0,
    createdAt: '2026-09-15T10:00:00Z',
    updatedAt: '2026-09-15T10:00:00Z',
  };
}

const GRAVES = [
  grave('g1', 'Naqeeb Jones'),
  grave('g2', 'Jonas Naqeebullah'),
  grave('g3', 'Abdulmutaliep Taliep Petersen', '6567', 'Tiema'),
  grave('g4', null, 'A-6567'),
  grave('g5', 'Fatima Brink', '4667'),
];

// A database row as search_graves returns it: the grave with its person embedded, under "grave"
const row = (id: string, fullName: string) => ({
  grave: { id, cemetery_id: 'cem_johnson_road', grave_number: '', latitude: -33.98, longitude: 18.5, created_by: 'user-1', person: { id: `p_${id}`, first_name: fullName.split(' ')[0], surname: 'X', full_name: fullName } },
});

describe('Search Query Tests', () => {
  it('tidies spacing and needs two characters before searching', () => {
    expect(normaliseSearchQuery('  naqeeb   jones ')).toBe('naqeeb jones');
    expect(MIN_SEARCH_CHARS).toBe(2);
    expect(isSearchable(' j ')).toBe(false);
    expect(isSearchable('jo')).toBe(true);
    expect(isSearchable('')).toBe(false);
  });
});

describe('Local Grave Filter Tests', () => {
  const ids = (list: Grave[]) => list.map((g) => g.id);

  it('matches every word in any order, as the database does', () => {
    expect(ids(filterGravesLocally(GRAVES, 'jones naqeeb', 'all'))).toEqual(['g1']);
    expect(ids(filterGravesLocally(GRAVES, 'naqeeb', 'all'))).toEqual(['g1', 'g2']);
  });

  it('matches nicknames, since families often know someone only by theirs', () => {
    expect(ids(filterGravesLocally(GRAVES, 'tiema', 'names'))).toEqual(['g3']);
  });

  it('matches grave numbers, including a grave with no person', () => {
    expect(ids(filterGravesLocally(GRAVES, '6567', 'all'))).toEqual(['g3', 'g4']);
    expect(ids(filterGravesLocally(GRAVES, '6567', 'numbers'))).toEqual(['g3', 'g4']);
    expect(ids(filterGravesLocally(GRAVES, '6567', 'names'))).toEqual([]);
  });

  it('keeps names out of a grave number search', () => {
    expect(ids(filterGravesLocally(GRAVES, 'brink', 'numbers'))).toEqual([]);
  });

  it('returns everything for an empty query, for lists that are shown whole', () => {
    expect(filterGravesLocally(GRAVES, '  ', 'all')).toHaveLength(GRAVES.length);
  });
});

describe('Search Page Tests', () => {
  it('cuts a page out of a list and knows whether more follow', () => {
    const many = Array.from({ length: SEARCH_PAGE_SIZE + 5 }, (_, i) => grave(`g${i}`, `Person ${i}`));
    expect(pageOf(many, 0, 'device')).toMatchObject({ hasMore: true, source: 'device' });
    expect(pageOf(many, 0, 'device').graves).toHaveLength(SEARCH_PAGE_SIZE);
    const last = pageOf(many, SEARCH_PAGE_SIZE, 'device');
    expect(last.graves).toHaveLength(5);
    expect(last.hasMore).toBe(false);
  });
});

describe('Remote Grave Search Tests', () => {
  function makeDeps(result: { data: unknown; error: unknown }) {
    const rpc = vi.fn(async (..._args: unknown[]) => result);
    return { deps: { client: { rpc } } as unknown as SearchGravesDeps, rpc };
  }

  it('asks the database for one page and maps the rows', async () => {
    const { deps, rpc } = makeDeps({ data: [row('g1', 'Naqeeb Jones')], error: null });
    const page = await searchGravesRemote('  naqeeb   jones ', 'names', 40, deps);
    expect(rpc).toHaveBeenCalledWith('search_graves', { p_query: 'naqeeb jones', p_kind: 'names', p_limit: SEARCH_PAGE_SIZE, p_offset: 40 });
    expect(page.source).toBe('cloud');
    expect(page.hasMore).toBe(false);
    expect(page.graves[0]).toMatchObject({ id: 'g1', createdBy: 'user-1' });
    expect(page.graves[0].person?.fullName).toBe('Naqeeb Jones');
  });

  it('expects another page after a full one', async () => {
    const { deps } = makeDeps({ data: Array.from({ length: SEARCH_PAGE_SIZE }, (_, i) => row(`g${i}`, `Person ${i}`)), error: null });
    expect((await searchGravesRemote('person', 'all', 0, deps)).hasMore).toBe(true);
  });

  it('throws on a database error so the caller can search the phone instead', async () => {
    const { deps } = makeDeps({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(searchGravesRemote('jones', 'all', 0, deps)).rejects.toMatchObject({ code: 'PGRST202' });
  });

  it('ignores rows it cannot read', async () => {
    const { deps } = makeDeps({ data: [{ grave: null }, {}, row('g1', 'Naqeeb Jones')], error: null });
    expect((await searchGravesRemote('jones', 'all', 0, deps)).graves.map((g) => g.id)).toEqual(['g1']);
  });
});

describe('Recent Grave Tests', () => {
  it('puts the newest first without repeats, and caps the list', () => {
    expect(addRecentGrave(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    const full = Array.from({ length: RECENT_GRAVES_LIMIT }, (_, i) => `g${i}`);
    const next = addRecentGrave(full, 'new');
    expect(next).toHaveLength(RECENT_GRAVES_LIMIT);
    expect(next[0]).toBe('new');
    expect(next).not.toContain(`g${RECENT_GRAVES_LIMIT - 1}`);
  });

  it('puts fetched graves back in the order they were asked for, skipping ones that are gone', () => {
    expect(inOrderOf(['g5', 'gone', 'g1'], GRAVES).map((g) => g.id)).toEqual(['g5', 'g1']);
  });
});
