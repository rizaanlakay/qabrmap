import { NextRequest, NextResponse } from 'next/server';
import {
  RouteStep,
  DirectionsResult,
  formatManeuverInstruction,
  calculateDistanceMeters,
} from '@/lib/geospatial';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const startLng = parseFloat(searchParams.get('startLng') || '');
  const startLat = parseFloat(searchParams.get('startLat') || '');
  const endLng = parseFloat(searchParams.get('endLng') || '');
  const endLat = parseFloat(searchParams.get('endLat') || '');
  const mode = searchParams.get('mode') === 'walking' ? 'walking' : 'driving';

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
  try {
    const profile = mode === 'walking' ? 'foot' : 'driving';
    const osrmUrl = `https://router.project-osrm.org/route/v1/${profile}/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson&steps=true`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(osrmUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'QabrMap/1.0 (https://qabrmap.vercel.app)',
      },
    });

    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
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
    }
  } catch (err) {
    console.warn('OSRM directions fetch error or timeout, applying fallback:', err);
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
