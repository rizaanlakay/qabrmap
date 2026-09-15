import { haversineMeters } from './score.mjs';

// Two records of the same cemetery are never further apart than this
export const MATCH_RADIUS_METERS = 300;

export function matchExisting(existing, resolved) {
  if (resolved.placeId) {
    const byPlace = existing.find((row) => row.google_place_id && row.google_place_id === resolved.placeId);
    if (byPlace) return byPlace;
  }
  if (typeof resolved.lat !== 'number' || typeof resolved.lng !== 'number') return undefined;
  return existing.find(
    (row) => haversineMeters(resolved.lat, resolved.lng, Number(row.origin_lat), Number(row.origin_lng)) <= MATCH_RADIUS_METERS
  );
}
