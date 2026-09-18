import type { SupabaseClient } from '@supabase/supabase-js';
import type { Grave } from '@/types';
import { mapDbGrave } from '../supabase/mappers';

// Grave search runs in the database a page at a time (search_graves). The phone never holds every grave, so
// the list it can search on its own is only what it has already seen, which is what offline search uses.

export type SearchKind = 'all' | 'names' | 'numbers';

// One letter matches nearly everyone, so nothing is searched until there are two
export const MIN_SEARCH_CHARS = 2;
export const SEARCH_PAGE_SIZE = 20;
// Typing pauses this long before a search goes out
export const SEARCH_DEBOUNCE_MS = 300;

export interface SearchPage {
  graves: Grave[];
  // A full page came back, so there may be another
  hasMore: boolean;
  // 'device' when the cloud could not be reached and only graves already on this phone were searched
  source: 'cloud' | 'device';
}

export function normaliseSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

export function isSearchable(query: string): boolean {
  return normaliseSearchQuery(query).length >= MIN_SEARCH_CHARS;
}

// The same rules as search_graves, for graves already on this phone: every word typed appears in the name or
// nickname in any order, or the grave number contains the whole text
export function filterGravesLocally(graves: Grave[], query: string, kind: SearchKind): Grave[] {
  const q = normaliseSearchQuery(query).toLowerCase();
  if (!q) return graves;
  const words = q.split(' ');
  return graves.filter((grave) => {
    const name = `${grave.person?.fullName ?? ''} ${grave.person?.nickname ?? ''}`.toLowerCase();
    const nameMatch = grave.person !== undefined && words.every((word) => name.includes(word));
    const numberMatch = grave.graveNumber !== '' && grave.graveNumber.toLowerCase().includes(q);
    if (kind === 'names') return nameMatch;
    if (kind === 'numbers') return numberMatch;
    return nameMatch || numberMatch;
  });
}

export function pageOf(graves: Grave[], offset: number, source: SearchPage['source']): SearchPage {
  const page = graves.slice(offset, offset + SEARCH_PAGE_SIZE);
  return { graves: page, hasMore: offset + SEARCH_PAGE_SIZE < graves.length, source };
}

// Passed in so the search can be tested without Supabase
export interface SearchGravesDeps {
  client: Pick<SupabaseClient, 'rpc'>;
}

// One page from the database. Throws on any failure; the caller falls back to the graves on this phone.
export async function searchGravesRemote(query: string, kind: SearchKind, offset: number, deps: SearchGravesDeps): Promise<SearchPage> {
  const { data, error } = await deps.client.rpc('search_graves', {
    p_query: normaliseSearchQuery(query),
    p_kind: kind,
    p_limit: SEARCH_PAGE_SIZE,
    p_offset: offset,
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? (data as Array<{ grave?: unknown }>) : [];
  const graves = rows.filter((row) => row && typeof row.grave === 'object' && row.grave !== null).map((row) => mapDbGrave(row.grave));
  return { graves, hasMore: rows.length === SEARCH_PAGE_SIZE, source: 'cloud' };
}

// Most recent first, no repeats, capped
export const RECENT_GRAVES_LIMIT = 8;
export function addRecentGrave(recent: string[], graveId: string): string[] {
  return [graveId, ...recent.filter((id) => id !== graveId)].slice(0, RECENT_GRAVES_LIMIT);
}

// Graves come back from the database in any order; put them back in the order they were asked for
export function inOrderOf(ids: string[], graves: Grave[]): Grave[] {
  const byId = new Map(graves.map((grave) => [grave.id, grave]));
  return ids.map((id) => byId.get(id)).filter((grave): grave is Grave => grave !== undefined);
}
