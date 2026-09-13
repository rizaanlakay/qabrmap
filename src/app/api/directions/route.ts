import { NextRequest, NextResponse } from 'next/server';

export interface RouteStep {
  instruction: string;
  streetName: string;
  distanceMeters: number;
  durationSeconds: number;
  type: string;
  modifier?: string;
  location: [number, number]; // [lng, lat]
}

export interface DirectionsResult {
  code: 'Ok' | 'Fallback' | 'Error';
  distanceMeters: number;
  durationSeconds: number;
  coordinates: [number, number][]; // [lng, lat][]
  steps?: RouteStep[];
  mode: 'driving' | 'walking';
  summary?: string;
}

// Haversine distance in meters
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function formatManeuverInstruction(step: any): string {
  const mType = step.maneuver?.type || 'turn';
  const mMod = step.maneuver?.modifier || '';
  const roadName = step.name ? step.name : '';

  if (mType === 'depart') {
    return roadName ? `Head out onto ${roadName}` : 'Head towards destination';
  }
  if (mType === 'arrive') {
    return roadName ? `Arrive at ${roadName}` : 'Arrive at destination';
  }
  if (mType === 'turn') {
    const modStr = mMod ? `${mMod.replace('_', ' ')} ` : '';
    return roadName ? `Turn ${modStr}onto ${roadName}` : `Turn ${modStr}`;
  }
  if (mType === 'new name' || mType === 'continue') {
    return roadName ? `Continue onto ${roadName}` : 'Continue straight';
  }
  if (mType === 'merge') {
    return roadName ? `Merge onto ${roadName}` : 'Merge ahead';
  }
  if (mType === 'on ramp') {
    return roadName ? `Take ramp onto ${roadName}` : 'Take highway ramp';
  }
  if (mType === 'off ramp') {
    return roadName ? `Take exit towards ${roadName}` : 'Take exit';
  }
  if (mType === 'roundabout') {
    return roadName ? `Enter roundabout towards ${roadName}` : 'Enter roundabout';
  }
  if (mType === 'fork') {
    const modStr = mMod ? `keep ${mMod.replace('_', ' ')} ` : '';
    return roadName ? `At fork, ${modStr}onto ${roadName}` : `At fork, ${modStr}`;
  }

  const modStr = mMod ? ` ${mMod.replace('_', ' ')}` : '';
  return roadName ? `${mType}${modStr} onto ${roadName}` : `${mType}${modStr}`;
}

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
          streetName: s.name || '',
          distanceMeters: Math.round(s.distance || 0),
          durationSeconds: Math.round(s.duration || 0),
          type: s.maneuver?.type || '',
          modifier: s.maneuver?.modifier || undefined,
          location: s.maneuver?.location || [0, 0],
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
  const directDistance = haversineMeters(startLat, startLng, endLat, endLng);
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
