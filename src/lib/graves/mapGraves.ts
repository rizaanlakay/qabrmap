import type { SupabaseClient } from '@supabase/supabase-js';
import type { Grave, MapGrave } from '@/types';

// The cemetery map draws every grave of a cemetery, which can be thousands. It loads a slim row per grave,
// a page at a time, because the database returns at most 1000 rows per request and says nothing about the rest.

export const MAP_GRAVES_PAGE_SIZE = 1000;
// Pages after the first are requested this many at a time
const PAGES_IN_FLIGHT = 4;

export const MAP_GRAVE_COLUMNS =
  'id, cemetery_id, latitude, longitude, status, grave_number, position_confidence, person:persons(full_name)';

export interface PageResult<Row> {
  rows: Row[];
  // How many rows exist in all; only asked for on the first page
  total: number | null;
}

// Rows `from` to `to`, both included
export type FetchPage<Row> = (from: number, to: number, withCount: boolean) => Promise<PageResult<Row>>;

// Every row, however many pages that takes. Throws if any page fails, so half a cemetery never passes for all of it.
export async function fetchAllPages<Row>(fetchPage: FetchPage<Row>, pageSize: number = MAP_GRAVES_PAGE_SIZE): Promise<Row[]> {
  const first = await fetchPage(0, pageSize - 1, true);
  const rows = [...first.rows];
  // The server may allow fewer rows per request than were asked for; later pages follow what it actually gave
  const step = first.rows.length;
  if (step === 0) return rows;

  if (first.total === null) {
    for (;;) {
      const page = await fetchPage(rows.length, rows.length + step - 1, false);
      if (page.rows.length === 0) return rows;
      rows.push(...page.rows);
    }
  }

  const starts: number[] = [];
  for (let from = step; from < first.total; from += step) starts.push(from);
  for (let i = 0; i < starts.length; i += PAGES_IN_FLIGHT) {
    const pages = await Promise.all(starts.slice(i, i + PAGES_IN_FLIGHT).map((from) => fetchPage(from, from + step - 1, false)));
    for (const page of pages) rows.push(...page.rows);
  }
  return rows;
}

// A grave added or removed while the pages load can shift a row into two pages
export function uniqueById<Item extends { id: string }>(items: Item[]): Item[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

export function mapDbMapGrave(row: any): MapGrave {
  return {
    id: row.id,
    cemeteryId: row.cemetery_id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    status: row.status || 'UNMAPPED',
    graveNumber: row.grave_number || '',
    positionConfidence: row.position_confidence || 'MEDIUM',
    fullName: row.person?.full_name || undefined,
  };
}

export function toMapGrave(grave: Grave): MapGrave {
  return {
    id: grave.id,
    cemeteryId: grave.cemeteryId,
    latitude: grave.latitude,
    longitude: grave.longitude,
    status: grave.status,
    graveNumber: grave.graveNumber,
    positionConfidence: grave.positionConfidence,
    fullName: grave.person?.fullName || undefined,
  };
}

// Passed in so the loading can be tested without Supabase
export interface MapGravesDeps {
  client: Pick<SupabaseClient, 'from'>;
}

// Every grave of a cemetery, slim, from the database. Throws on any failure; the caller falls back to this phone's copy.
export async function fetchMapGraves(cemeteryId: string, deps: MapGravesDeps): Promise<MapGrave[]> {
  const rows = await fetchAllPages<any>(async (from, to, withCount) => {
    const { data, error, count } = await deps.client
      .from('graves')
      .select(MAP_GRAVE_COLUMNS, withCount ? { count: 'exact' } : undefined)
      .eq('cemetery_id', cemeteryId)
      .order('id')
      .range(from, to);
    if (error || !data) throw error ?? new Error('No answer');
    return { rows: data, total: withCount ? count ?? null : null };
  });
  return uniqueById(rows.map(mapDbMapGrave));
}
