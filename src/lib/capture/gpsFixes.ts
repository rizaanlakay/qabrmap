import { calculateDistanceMeters } from '../geospatial';

export interface TimedFix {
  lat: number;
  lng: number;
  accuracy: number;
  // Epoch milliseconds when the browser reported it
  at: number;
}

export interface SmoothedFix {
  lat: number;
  lng: number;
  accuracy: number;
  // When the reported accuracy was measured, so a consumer can pair the fix with its own moment
  at: number;
}

// Browser fixes jitter from one second to the next; the best one in this window is what the phone can really do
export const FIX_WINDOW_MS = 10_000;
// Fixes this close together mean the phone hasn't moved, so averaging them removes noise, not movement
export const STILL_RADIUS_M = 3;

export function pruneFixes(fixes: TimedFix[], now: number): TimedFix[] {
  return fixes.filter((fix) => now - fix.at <= FIX_WINDOW_MS);
}

// Where the phone is now: the fixes taken standing in the same spot as the newest one, averaged, reported with
// the best single accuracy among them. Averaging removes jitter but not the shared GPS bias. Clustering around
// the newest fix (not the most accurate one) keeps the position current while walking.
export function smoothFixes(fixes: TimedFix[], now: number): SmoothedFix | null {
  const recent = pruneFixes(fixes, now);
  if (recent.length === 0) return null;

  const latest = recent.reduce((newest, fix) => (fix.at >= newest.at ? fix : newest));
  const still = recent.filter(
    (fix) => calculateDistanceMeters(latest.lat, latest.lng, fix.lat, fix.lng) <= STILL_RADIUS_M
  );

  let best = still[0];
  for (const fix of still) {
    if (fix.accuracy < best.accuracy || (fix.accuracy === best.accuracy && fix.at >= best.at)) best = fix;
  }

  let sumWeights = 0;
  let lat = 0;
  let lng = 0;
  for (const fix of still) {
    const weight = 1 / Math.max(0.25, fix.accuracy * fix.accuracy);
    sumWeights += weight;
    lat += fix.lat * weight;
    lng += fix.lng * weight;
  }

  return { lat: lat / sumWeights, lng: lng / sumWeights, accuracy: best.accuracy, at: best.at };
}
