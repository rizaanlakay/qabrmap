import { describe, it, expect, vi } from 'vitest';
import {
  MAP_GRAVE_COLUMNS,
  fetchAllPages,
  fetchMapGraves,
  mapDbMapGrave,
  toMapGrave,
  type PageResult,
} from '../src/lib/graves/mapGraves';
import type { Grave } from '../src/types';

const rowsOf = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ id: `g${from + i}` }));

// A database of `total` rows that never returns more than `cap` rows per request, like PostgREST's max-rows
function fakeTable(total: number, cap: number) {
  return vi.fn(async (from: number, to: number, withCount: boolean): Promise<PageResult<{ id: string }>> => {
    const last = Math.min(to, from + cap - 1, total - 1);
    return { rows: last >= from ? rowsOf(from, last) : [], total: withCount ? total : null };
  });
}

describe('fetchAllPages', () => {
  it('makes one request when everything fits in the first page', async () => {
    const fetchPage = fakeTable(8, 1000);
    const rows = await fetchAllPages(fetchPage, 1000);
    expect(rows).toHaveLength(8);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(0, 999, true);
  });

  it('loads every row of a cemetery larger than one page', async () => {
    const fetchPage = fakeTable(10000, 1000);
    const rows = await fetchAllPages(fetchPage, 1000);
    expect(rows).toHaveLength(10000);
    expect(new Set(rows.map((row) => row.id)).size).toBe(10000);
    expect(fetchPage).toHaveBeenCalledTimes(10);
    // Only the first request pays for the count
    expect(fetchPage.mock.calls.filter((call) => call[2])).toHaveLength(1);
  });

  it('leaves no gaps when the server returns fewer rows per request than were asked for', async () => {
    const fetchPage = fakeTable(1700, 500);
    const rows = await fetchAllPages(fetchPage, 1000);
    expect(rows.map((row) => row.id)).toEqual(rowsOf(0, 1699).map((row) => row.id));
  });

  it('keeps asking until a page comes back empty when the server gives no count', async () => {
    const fetchPage = vi.fn(async (from: number, to: number): Promise<PageResult<{ id: string }>> => {
      const last = Math.min(to, 2499);
      return { rows: last >= from ? rowsOf(from, last) : [], total: null };
    });
    const rows = await fetchAllPages(fetchPage, 1000);
    expect(rows).toHaveLength(2500);
  });

  it('returns nothing for an empty cemetery', async () => {
    await expect(fetchAllPages(fakeTable(0, 1000), 1000)).resolves.toEqual([]);
  });

  it('fails as a whole when any page fails, so a partial cemetery is never shown as complete', async () => {
    const fetchPage = vi.fn(async (from: number, to: number, withCount: boolean): Promise<PageResult<{ id: string }>> => {
      if (from >= 2000) throw new Error('network dropped');
      return { rows: rowsOf(from, to), total: withCount ? 5000 : null };
    });
    await expect(fetchAllPages(fetchPage, 1000)).rejects.toThrow('network dropped');
  });
});

describe('mapDbMapGrave', () => {
  it('maps a slim database row', () => {
    expect(
      mapDbMapGrave({
        id: 'g1',
        cemetery_id: 'cem_1',
        latitude: '-33.9675',
        longitude: '18.5032',
        status: 'LOW_CONFIDENCE',
        grave_number: 'A-12',
        position_confidence: 'HIGH',
        person: { full_name: 'Abdulmoe Taliep Petersen' },
      })
    ).toEqual({
      id: 'g1',
      cemeteryId: 'cem_1',
      latitude: -33.9675,
      longitude: 18.5032,
      status: 'LOW_CONFIDENCE',
      graveNumber: 'A-12',
      positionConfidence: 'HIGH',
      fullName: 'Abdulmoe Taliep Petersen',
    });
  });

  it('copes with a grave that has no person or number yet', () => {
    const grave = mapDbMapGrave({ id: 'g2', cemetery_id: 'cem_1', latitude: 1, longitude: 2, person: null });
    expect(grave.fullName).toBeUndefined();
    expect(grave.graveNumber).toBe('');
    expect(grave.status).toBe('UNMAPPED');
    expect(grave.positionConfidence).toBe('MEDIUM');
  });
});

describe('toMapGrave', () => {
  it('keeps only what the map draws', () => {
    const grave = {
      id: 'g1',
      cemeteryId: 'cem_1',
      latitude: -33.9,
      longitude: 18.5,
      status: 'MAPPED',
      graveNumber: '1402',
      positionConfidence: 'HIGH',
      positionAccuracyMeters: 3,
      photoCount: 2,
      person: { id: 'p1', firstName: 'Abdulmoe', surname: 'Petersen', fullName: 'Abdulmoe Petersen' },
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
    } as Grave;
    expect(toMapGrave(grave)).toEqual({
      id: 'g1',
      cemeteryId: 'cem_1',
      latitude: -33.9,
      longitude: 18.5,
      status: 'MAPPED',
      graveNumber: '1402',
      positionConfidence: 'HIGH',
      fullName: 'Abdulmoe Petersen',
    });
  });
});

describe('fetchMapGraves', () => {
  it('asks for the slim columns of one cemetery in a stable order, a page at a time', async () => {
    const calls: Array<{ columns: string; options: unknown; cemeteryId: string; orderBy: string; from: number; to: number }> = [];
    const client = {
      from: (table: string) => {
        expect(table).toBe('graves');
        return {
          select: (columns: string, options?: unknown) => ({
            eq: (_column: string, cemeteryId: string) => ({
              order: (orderBy: string) => ({
                range: async (from: number, to: number) => {
                  calls.push({ columns, options, cemeteryId, orderBy, from, to });
                  const rows = from === 0 ? [{ id: 'g1', cemetery_id: 'cem_1', latitude: 1, longitude: 2 }] : [];
                  return { data: rows, error: null, count: from === 0 ? 1 : null };
                },
              }),
            }),
          }),
        };
      },
    };

    const graves = await fetchMapGraves('cem_1', { client: client as never });
    expect(graves.map((grave) => grave.id)).toEqual(['g1']);
    expect(calls).toEqual([
      { columns: MAP_GRAVE_COLUMNS, options: { count: 'exact' }, cemeteryId: 'cem_1', orderBy: 'id', from: 0, to: 999 },
    ]);
    expect(MAP_GRAVE_COLUMNS).not.toContain('*');
  });

  it('throws when the database reports an error', async () => {
    const client = {
      from: () => ({
        select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: 'denied' }, count: null }) }) }) }),
      }),
    };
    await expect(fetchMapGraves('cem_1', { client: client as never })).rejects.toBeTruthy();
  });
});
