import { NextRequest, NextResponse } from 'next/server';
import {
  RouteStep,
  DirectionsResult,
  formatManeuverInstruction,
  calculateDistanceMeters,
} from '@/lib/geospatial';
import { buildOsrmRouteUrl, parseBearingParam } from '@/lib/geospatial/osrm';

const OSRM_TIMEOUT_MS = 4000;

async function fetchOsrmRoute(url: string): Promise<any | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'QabrMap/1.0 (https://qabrmap.vercel.app)',
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.code === 'Ok' && data.routes && data.routes.length > 0 ? data.routes[0] : null;
  } catch (err) {
    console.warn('OSRM directions fetch error or timeout:', err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const startLng = parseFloat(searchParams.get('startLng') || '');
  const startLat = parseFloat(searchParams.get('startLat') || '');
  const endLng = parseFloat(searchParams.get('endLng') || '');
  const endLat = parseFloat(searchParams.get('endLat') || '');
  const mode = searchParams.get('mode') === 'walking' ? 'walking' : 'driving';
  // The driver's direction of travel, sent with reroutes so the new route sets off ahead of them
  const bearing = parseBearingParam(searchParams.get('bearing'));

  if (
    isNaN(startLng) ||
    isNaN(startLat) ||
    isNaN(endLng) ||
    isNaN(endLat)
  ) {
    return NextResponse.json(
      { error: 'Missing or invalid start/end coordinates' },
      { status: 400 }
    );
  }

  // Attempt OSRM Directions
  const profile = mode === 'walking' ? 'foot' : 'driving';
  const trip = { profile, startLng, startLat, endLng, endLat } as const;
  let route = await fetchOsrmRoute(buildOsrmRouteUrl({ ...trip, bearing }));
  // No road near the driver runs their way (a car park, a poor fix): any route beats none
  if (!route && bearing !== null) route = await fetchOsrmRoute(buildOsrmRouteUrl({ ...trip, bearing: null }));

  if (route) {
    const rawSteps = route.legs?.[0]?.steps || [];
    const parsedSteps: RouteStep[] = rawSteps.map((s: any) => ({
      instruction: formatManeuverInstruction(s),
      streetName: s.name || s.ref || '',
      distanceMeters: Math.round(s.distance || 0),
      durationSeconds: Math.round(s.duration || 0),
      type: s.maneuver?.type || '',
      modifier: s.maneuver?.type === 'depart' ? undefined : (s.maneuver?.modifier || undefined),
      location: s.maneuver?.location || [0, 0],
      bearingAfter: s.maneuver?.bearing_after !== undefined ? Math.round(s.maneuver.bearing_after) : undefined,
      bearingBefore: s.maneuver?.bearing_before !== undefined ? Math.round(s.maneuver.bearing_before) : undefined,
      exit: s.exits ? String(s.exits) : undefined,
      ref: s.ref || undefined,
      destinations: s.destinations || undefined,
    }));

    const result: DirectionsResult = {
      code: 'Ok',
      distanceMeters: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
      coordinates: route.geometry.coordinates,
      steps: parsedSteps,
      mode,
      summary: route.legs?.[0]?.summary || undefined,
    };

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
      },
    });
  }

  // Graceful fallback: Haversine distance with estimated speeds
  const directDistance = Math.round(calculateDistanceMeters(startLat, startLng, endLat, endLng));
  const speed = mode === 'walking' ? 1.25 : 12.5;
  const estimatedSeconds = Math.round(directDistance / speed);

  const fallbackResult: DirectionsResult = {
    code: 'Fallback',
    distanceMeters: directDistance,
    durationSeconds: estimatedSeconds,
    coordinates: [
      [startLng, startLat],
      [endLng, endLat],
    ],
    steps: [
      {
        instruction: mode === 'driving' ? 'Drive towards cemetery gate' : 'Walk towards grave plot',
        streetName: '',
        distanceMeters: directDistance,
        durationSeconds: estimatedSeconds,
        type: 'depart',
        location: [startLng, startLat],
      },
    ],
    mode,
  };

  return NextResponse.json(fallbackResult, {
    headers: {
      'Cache-Control': 'public, s-maxage=60',
    },
  });
}
