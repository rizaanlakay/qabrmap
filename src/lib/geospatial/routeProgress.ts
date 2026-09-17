// Live progress along a driving route: where the driver is on the route line, which step they're on,
// and how far to the next turn, so guidance counts down continuously like Google Maps or a Garmin.

import { calculateBearing, calculateDistanceMeters, RouteStep } from './index';

// Ask for new directions once the driver is this far from the route line...
export const REROUTE_OFF_ROUTE_METERS = 50;
// ...but no more often than this, so a poor GPS fix can't flood the directions service
export const REROUTE_MIN_INTERVAL_MS = 10 * 1000;
// Move on to the next step this close to its turn, as the driver starts making it
export const MANEUVER_PASSED_METERS = 8;

export interface RouteProjection {
  alongMeters: number;
  offRouteMeters: number;
  lat: number;
  lng: number;
}

export interface RouteProgress {
  stepIndex: number;
  distanceToNextManeuverMeters: number;
  remainingMeters: number;
  remainingSeconds: number | null;
  offRouteMeters: number;
}

// Running distance from the route start to each route point
export function cumulativeRouteDistances(route: [number, number][]): number[] {
  const totals = [0];
  for (let i = 1; i < route.length; i++) {
    totals.push(totals[i - 1] + calculateDistanceMeters(route[i - 1][1], route[i - 1][0], route[i][1], route[i][0]));
  }
  return totals;
}

// Nearest point on the route line, using a flat local approximation that is accurate at street scale
export function projectOntoRoute(
  point: { lat: number; lng: number },
  route: [number, number][],
  cumulative: number[] = cumulativeRouteDistances(route)
): RouteProjection {
  if (route.length === 0) return { alongMeters: 0, offRouteMeters: Infinity, lat: point.lat, lng: point.lng };
  if (route.length === 1) {
    const distance = calculateDistanceMeters(point.lat, point.lng, route[0][1], route[0][0]);
    return { alongMeters: 0, offRouteMeters: distance, lat: route[0][1], lng: route[0][0] };
  }

  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos((point.lat * Math.PI) / 180);
  let best: RouteProjection = { alongMeters: 0, offRouteMeters: Infinity, lat: point.lat, lng: point.lng };
  let bestDistanceSq = Infinity;

  for (let i = 0; i < route.length - 1; i++) {
    const ax = (route[i][0] - point.lng) * metersPerDegLng;
    const ay = (route[i][1] - point.lat) * metersPerDegLat;
    const dx = (route[i + 1][0] - point.lng) * metersPerDegLng - ax;
    const dy = (route[i + 1][1] - point.lat) * metersPerDegLat - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq)) : 0;
    const px = ax + t * dx;
    const py = ay + t * dy;
    const distanceSq = px * px + py * py;

    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      best = {
        alongMeters: cumulative[i] + t * (cumulative[i + 1] - cumulative[i]),
        offRouteMeters: Math.sqrt(distanceSq),
        lat: point.lat + py / metersPerDegLat,
        lng: point.lng + px / metersPerDegLng,
      };
    }
  }
  return best;
}

export function computeRouteProgress({
  route,
  steps,
  position,
  totalDurationSeconds,
}: {
  route: [number, number][];
  steps: RouteStep[];
  position: { lat: number; lng: number };
  totalDurationSeconds: number | null;
}): RouteProgress | null {
  if (route.length < 2) return null;

  const cumulative = cumulativeRouteDistances(route);
  const totalMeters = cumulative[cumulative.length - 1];
  const here = projectOntoRoute(position, route, cumulative);

  // Where each step's turn sits along the route, kept in order in case two project onto the same spot
  let furthest = 0;
  const turnAlong = steps.map((step) => {
    const hasLocation = step.location && !(step.location[0] === 0 && step.location[1] === 0);
    const along = hasLocation
      ? projectOntoRoute({ lat: step.location[1], lng: step.location[0] }, route, cumulative).alongMeters
      : furthest;
    furthest = Math.max(furthest, along);
    return furthest;
  });

  let stepIndex = 0;
  for (let i = 1; i < turnAlong.length; i++) {
    if (here.alongMeters >= turnAlong[i] - MANEUVER_PASSED_METERS) stepIndex = i;
  }

  const nextTurnAlong = stepIndex + 1 < turnAlong.length ? turnAlong[stepIndex + 1] : totalMeters;
  const remainingMeters = Math.max(0, totalMeters - here.alongMeters);

  return {
    stepIndex,
    distanceToNextManeuverMeters: Math.max(0, nextTurnAlong - here.alongMeters),
    remainingMeters,
    remainingSeconds:
      totalDurationSeconds != null && totalMeters > 0 ? (totalDurationSeconds * remainingMeters) / totalMeters : null,
    offRouteMeters: here.offRouteMeters,
  };
}

// Devices and emulators with no real position sometimes report 0,0 ("Null Island") or non-numbers
export function isUsableGpsFix(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return !(lat === 0 && lng === 0);
}

export function shouldReroute({
  hasRoute,
  offRouteMeters,
  msSinceLastFetch,
}: {
  hasRoute: boolean;
  offRouteMeters: number;
  msSinceLastFetch: number;
}): boolean {
  if (!hasRoute) return true;
  return offRouteMeters > REROUTE_OFF_ROUTE_METERS && msSinceLastFetch >= REROUTE_MIN_INTERVAL_MS;
}

// The driver must move this far before their direction of travel is re-read, so GPS jitter can't spin it
export const TRAVEL_BEARING_MIN_METERS = 12;

export interface TravelBearingState {
  // The fix the next bearing is measured from
  anchor: { lat: number; lng: number };
  bearing: number | null;
}

// Direction of travel from successive GPS fixes. Browsers rarely report a heading of their own, and the
// compass gives the way the phone points, not the way the car moves.
export function nextTravelBearing(
  previous: TravelBearingState | null,
  fix: { lat: number; lng: number }
): TravelBearingState {
  if (!previous) return { anchor: fix, bearing: null };
  const moved = calculateDistanceMeters(previous.anchor.lat, previous.anchor.lng, fix.lat, fix.lng);
  if (moved < TRAVEL_BEARING_MIN_METERS) return previous;
  return { anchor: fix, bearing: calculateBearing(previous.anchor.lat, previous.anchor.lng, fix.lat, fix.lng) };
}

// Rounded like in-car navigation: 10 m steps close to the turn, 50 m further out, kilometres from 1 km
export function formatManeuverDistance(meters: number): string {
  const safe = Math.max(0, meters);
  const rounded = safe >= 200 ? Math.round(safe / 50) * 50 : Math.round(safe / 10) * 10;
  if (rounded >= 1000) return `${(safe / 1000).toFixed(1)} km`;
  return `${rounded} m`;
}
