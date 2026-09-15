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
}

// Browser fixes jitter from one second to the next; the best one in this window is what the phone can really do
export const FIX_WINDOW_MS = 10_000;
// Fixes this close together mean the phone hasn't moved, so averaging them removes noise, not movement
export const STILL_RADIUS_M = 3;

export function pruneFixes(fixes: TimedFix[], now: number): TimedFix[] {
  return fixes.filter((fix) => now - fix.at <= FIX_WINDOW_MS);
}

// The most accurate recent fix, with its position averaged over the fixes taken standing in the same spot.
// The accuracy is the best single reading: averaging removes jitter but not the shared GPS bias.
export function smoothFixes(fixes: TimedFix[], now: number): SmoothedFix | null {
  const recent = pruneFixes(fixes, now);
  if (recent.length === 0) return null;

  let best = recent[0];
  for (const fix of recent) {
    if (fix.accuracy < best.accuracy || (fix.accuracy === best.accuracy && fix.at >= best.at)) best = fix;
  }

  const still = recent.filter(
    (fix) => calculateDistanceMeters(best.lat, best.lng, fix.lat, fix.lng) <= STILL_RADIUS_M
  );

  let sumWeights = 0;
  let lat = 0;
  let lng = 0;
  for (const fix of still) {
    const weight = 1 / Math.max(0.25, fix.accuracy * fix.accuracy);
    sumWeights += weight;
    lat += fix.lat * weight;
    lng += fix.lng * weight;
  }

  return { lat: lat / sumWeights, lng: lng / sumWeights, accuracy: best.accuracy };
}
