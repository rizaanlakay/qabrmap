import type { Cemetery } from '@/types';
import { calculateDistanceMeters } from '../geospatial';

export interface UserPoint {
  lat: number;
  lng: number;
}

// The Nearby chip shows this many sites, closest first
export const NEARBY_LIMIT = 5;

export function withDistances(cemeteries: Cemetery[], position: UserPoint): Cemetery[] {
  return cemeteries.map((cemetery) => ({
    ...cemetery,
    distanceMeters: calculateDistanceMeters(position.lat, position.lng, cemetery.originLat, cemetery.originLng),
  }));
}

function byDistance(a: Cemetery, b: Cemetery): number {
  return (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity);
}

function byName(a: Cemetery, b: Cemetery): number {
  return a.name.localeCompare(b.name);
}

export function nearestCemeteries(cemeteries: Cemetery[], position: UserPoint, limit = NEARBY_LIMIT): Cemetery[] {
  return withDistances(cemeteries, position).sort(byDistance).slice(0, limit);
}

// Under a kilometre people think in metres; past ten kilometres a decimal is noise
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

export function matchesCemeterySearch(cemetery: Cemetery, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const haystack = [cemetery.name, ...(cemetery.aliases ?? []), cemetery.city, cemetery.province];
  return haystack.some((text) => text.toLowerCase().includes(q));
}

// With a position the list is closest first; without one, alphabetical and no distances shown
export function sortCemeteries(cemeteries: Cemetery[], position?: UserPoint): Cemetery[] {
  if (position) return withDistances(cemeteries, position).sort(byDistance);
  return cemeteries.map((cemetery) => ({ ...cemetery, distanceMeters: undefined })).sort(byName);
}
