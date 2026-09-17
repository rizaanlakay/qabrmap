// Request building for the OSRM directions service

// How far either side of the driver's direction of travel a road may point and still be used as the start
const START_BEARING_TOLERANCE_DEG = 45;

// Without the direction of travel OSRM starts on the nearest road facing either way, so a reroute for a
// driver who left the route often sets off behind them and the line never appears to change
export function buildOsrmRouteUrl({
  profile,
  startLng,
  startLat,
  endLng,
  endLat,
  bearing,
}: {
  profile: 'driving' | 'foot';
  startLng: number;
  startLat: number;
  endLng: number;
  endLat: number;
  bearing: number | null;
}): string {
  const url = new URL(`https://router.project-osrm.org/route/v1/${profile}/${startLng},${startLat};${endLng},${endLat}`);
  url.searchParams.set('overview', 'full');
  url.searchParams.set('geometries', 'geojson');
  url.searchParams.set('steps', 'true');
  // One entry per coordinate, the destination's left empty so it can be reached from any side
  if (bearing !== null) url.searchParams.set('bearings', `${bearing},${START_BEARING_TOLERANCE_DEG};`);
  return url.toString();
}

export function parseBearingParam(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const bearing = Number(value);
  if (!Number.isFinite(bearing) || bearing < 0 || bearing > 360) return null;
  return Math.round(bearing) % 360;
}
