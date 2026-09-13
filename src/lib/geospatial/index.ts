// Layered Geospatial Engine for QabrMap
// Solves Level 1 through Level 6 positioning, projections, bearings, and triangulations.

import { ConfidenceLevel, DeviceTelemetry, GravestoneBoundingBox } from '@/types';

export const EARTH_RADIUS_METERS = 6371000; // Mean Earth Radius in meters
export const DEFAULT_CAMERA_FOV_V_DEG = 60.0; // Typical smartphone camera vertical FOV
export const DEFAULT_CAMERA_FOV_H_DEG = 72.0; // Typical smartphone camera horizontal FOV
export const STANDARD_GRAVESTONE_HEIGHT_M = 0.70; // 70cm typical height of upright Muslim gravestone
export const STANDARD_GRAVESTONE_WIDTH_M = 0.40;  // 40cm typical width

/**
 * Degrees to Radians
 */
export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Radians to Degrees
 */
export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Normalizes an angle to 0 - 360 degrees
 */
export function normalizeDegrees(deg: number): number {
  const result = deg % 360;
  return result < 0 ? result + 360 : result;
}

/**
 * Calculates Great-Circle distance between two coordinates in meters (Haversine formula)
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lon2 - lon1);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_METERS * c * 10) / 10;
}

/**
 * Calculates initial forward compass bearing from point 1 to point 2 in degrees (0 - 360)
 */
export function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaLambda = toRad(lon2 - lon1);

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const theta = Math.atan2(y, x);
  return Math.round(normalizeDegrees(toDeg(theta)));
}

/**
 * Converts a bearing angle into a human-readable compass cardinal string (e.g. 42° -> "42° NE")
 */
export function formatBearingToCardinal(bearingDeg: number): string {
  const normalized = normalizeDegrees(bearingDeg);
  const directions = [
    'N', 'NNE', 'NE', 'ENE',
    'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW',
    'W', 'WNW', 'NW', 'NNW'
  ];
  const index = Math.round(normalized / 22.5) % 16;
  return `${Math.round(normalized)}° ${directions[index]}`;
}

/**
 * Level 2: Estimate distance from camera to gravestone using pinhole camera model
 * @param box Normalized bounding box [0..1]
 * @param physicalHeightM Real physical gravestone height in meters
 * @param fovVerticalDeg Vertical FOV in degrees
 */
export function estimateMonocularDistance(
  box: GravestoneBoundingBox,
  physicalHeightM: number = STANDARD_GRAVESTONE_HEIGHT_M,
  fovVerticalDeg: number = DEFAULT_CAMERA_FOV_V_DEG
): number {
  // Ensure normalized box height is clamped within valid camera bounds
  const clampedHeight = Math.max(0.05, Math.min(1.0, box.height));
  const halfFovRad = toRad(fovVerticalDeg / 2);
  
  // Pinhole projection equation: distance = H / (2 * h_norm * tan(fov_v / 2))
  const distance = physicalHeightM / (2 * clampedHeight * Math.tan(halfFovRad));
  
  // Clamp realistic walking photography distance between 0.8m and 15m
  return Math.max(0.8, Math.min(15.0, Math.round(distance * 10) / 10));
}

/**
 * Level 3: Estimate camera-to-stone bearing by combining compass heading with bounding box offset
 */
export function estimateTargetBearing(
  deviceHeading: number,
  box: GravestoneBoundingBox,
  fovHorizontalDeg: number = DEFAULT_CAMERA_FOV_H_DEG
): number {
  // Horizontal center of the stone in normalized image space (0.0 = left, 0.5 = center, 1.0 = right)
  const centerX = box.x + box.width / 2;
  const offsetFromCenter = centerX - 0.5; // -0.5 to +0.5
  
  // Angular deviation from optical axis
  const angularOffset = offsetFromCenter * fovHorizontalDeg;
  
  return normalizeDegrees(deviceHeading + angularOffset);
}

/**
 * Level 4: Project target coordinates forward along bearing by distance d
 * Solves the Direct Geodetic Problem on a spherical Earth
 */
export function projectForwardGeodesic(
  lat: number,
  lon: number,
  distanceMeters: number,
  bearingDegrees: number
): { latitude: number; longitude: number } {
  const phi1 = toRad(lat);
  const lambda1 = toRad(lon);
  const alpha = toRad(bearingDegrees);
  const sigma = distanceMeters / EARTH_RADIUS_METERS;

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const sinSigma = Math.sin(sigma);
  const cosSigma = Math.cos(sigma);

  const phi2 = Math.asin(sinPhi1 * cosSigma + cosPhi1 * sinSigma * Math.cos(alpha));
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(alpha) * sinSigma * cosPhi1,
      cosSigma - sinPhi1 * Math.sin(phi2)
    );

  return {
    latitude: Number(toDeg(phi2).toFixed(7)),
    longitude: Number(toDeg(lambda2).toFixed(7)),
  };
}

/**
 * Level 5: Multi-Observation Spatial Triangulation & Reconciliation
 * Combines multiple observations using inverse-variance weighting
 */
export interface ObservationPoint {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

export function reconcileMultiObservations(
  observations: ObservationPoint[]
): {
  latitude: number;
  longitude: number;
  positionAccuracyMeters: number;
  confidence: ConfidenceLevel;
} {
  if (!observations || observations.length === 0) {
    throw new Error('Cannot reconcile empty observations list');
  }

  if (observations.length === 1) {
    const single = observations[0];
    const acc = Math.max(1.0, single.accuracyMeters);
    return {
      latitude: single.latitude,
      longitude: single.longitude,
      positionAccuracyMeters: acc,
      confidence: acc <= 3.5 ? 'HIGH' : acc <= 6.0 ? 'MEDIUM' : 'LOW',
    };
  }

  // Inverse-variance weighting
  let sumWeights = 0;
  let weightedLat = 0;
  let weightedLon = 0;

  for (const obs of observations) {
    // Avoid division by zero with minimum 0.5m variance floor
    const variance = Math.max(0.25, Math.pow(obs.accuracyMeters, 2));
    const weight = 1 / variance;

    sumWeights += weight;
    weightedLat += obs.latitude * weight;
    weightedLon += obs.longitude * weight;
  }

  const reconciledLat = Number((weightedLat / sumWeights).toFixed(7));
  const reconciledLon = Number((weightedLon / sumWeights).toFixed(7));
  
  // Reconciled standard error
  const combinedError = Math.sqrt(1 / sumWeights);
  const clampedAccuracy = Number(Math.max(0.5, combinedError).toFixed(2));

  let confidence: ConfidenceLevel = 'LOW';
  if (clampedAccuracy <= 3.0 && observations.length >= 2) {
    confidence = 'HIGH';
  } else if (clampedAccuracy <= 5.5) {
    confidence = 'MEDIUM';
  }

  return {
    latitude: reconciledLat,
    longitude: reconciledLon,
    positionAccuracyMeters: clampedAccuracy,
    confidence,
  };
}

/**
 * Level 6: Local Cemetery Coordinate System (East-North-Up Tangent Plane)
 */
export function toLocalCemeteryCoordinates(
  lat: number,
  lon: number,
  alt: number = 0,
  originLat: number,
  originLng: number,
  originAlt: number = 0
): { x: number; y: number; z: number } {
  const phi0 = toRad(originLat);
  const deltaPhi = toRad(lat - originLat);
  const deltaLambda = toRad(lon - originLng);

  // Local Easting (x) and Northing (y) in meters
  const x = Number((EARTH_RADIUS_METERS * deltaLambda * Math.cos(phi0)).toFixed(2));
  const y = Number((EARTH_RADIUS_METERS * deltaPhi).toFixed(2));
  const z = Number((alt - originAlt).toFixed(2));

  return { x, y, z };
}

/**
 * Inverse Local Cemetery Coordinates back to Latitude and Longitude
 */
export function fromLocalCemeteryCoordinates(
  x: number,
  y: number,
  originLat: number,
  originLng: number
): { latitude: number; longitude: number } {
  const phi0 = toRad(originLat);
  const deltaPhi = y / EARTH_RADIUS_METERS;
  const deltaLambda = x / (EARTH_RADIUS_METERS * Math.cos(phi0));

  return {
    latitude: Number((originLat + toDeg(deltaPhi)).toFixed(7)),
    longitude: Number((originLng + toDeg(deltaLambda)).toFixed(7)),
  };
}

/**
 * Full Pipeline: Computes projected grave position from photo telemetry and stone detection
 */
export function processPhotoToGravePosition(
  telemetry: DeviceTelemetry,
  box: GravestoneBoundingBox,
  cemeteryOrigin?: { lat: number; lng: number }
): {
  estimatedLat: number;
  estimatedLng: number;
  distanceMeters: number;
  bearingDegrees: number;
  accuracyMeters: number;
  confidence: ConfidenceLevel;
  localX?: number;
  localY?: number;
} {
  // 1. Distance
  const distance = estimateMonocularDistance(box);

  // 2. Bearing
  const bearing = estimateTargetBearing(telemetry.headingDegrees ?? 0, box);

  // 3. Forward Projection
  const projected = projectForwardGeodesic(
    telemetry.latitude,
    telemetry.longitude,
    distance,
    bearing
  );

  // 4. Accuracy assessment: GPS error + distance estimation error (~15%)
  const distanceErrorEst = distance * 0.15;
  const totalAccuracy = Number(
    Math.sqrt(Math.pow(telemetry.gpsAccuracy, 2) + Math.pow(distanceErrorEst, 2)).toFixed(1)
  );

  let confidence: ConfidenceLevel = 'LOW';
  if (totalAccuracy <= 3.5) {
    confidence = 'HIGH';
  } else if (totalAccuracy <= 6.0) {
    confidence = 'MEDIUM';
  }

  // 5. Local coordinates if cemetery origin provided
  let localX: number | undefined;
  let localY: number | undefined;
  if (cemeteryOrigin) {
    const local = toLocalCemeteryCoordinates(
      projected.latitude,
      projected.longitude,
      telemetry.altitude || 0,
      cemeteryOrigin.lat,
      cemeteryOrigin.lng
    );
    localX = local.x;
    localY = local.y;
  }

  return {
    estimatedLat: projected.latitude,
    estimatedLng: projected.longitude,
    distanceMeters: distance,
    bearingDegrees: bearing,
    accuracyMeters: totalAccuracy,
    confidence,
    localX,
    localY,
  };
}

/**
 * Checks if a [lng, lat] point is inside a GeoJSON Polygon coordinates ring using ray casting.
 */
export function isPointInPolygon(point: [number, number], polygonRing: [number, number][]): boolean {
  if (!polygonRing || polygonRing.length < 3) return false;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygonRing.length - 1; i < polygonRing.length; j = i++) {
    const [xi, yi] = polygonRing[i];
    const [xj, yj] = polygonRing[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Snaps a GPS coordinate { lat, lng } to the closest point along a polyline route [lng, lat][].
 * Uses equirectangular projection onto line segments for millimeter-accurate road snapping.
 */
export function snapToRoute(
  point: { lat: number; lng: number },
  route: [number, number][],
  maxSnapDistanceMeters: number = 75
): { lat: number; lng: number; snapped: boolean; distanceToRouteMeters: number } {
  if (!route || route.length === 0) {
    return { lat: point.lat, lng: point.lng, snapped: false, distanceToRouteMeters: 0 };
  }

  if (route.length === 1) {
    const dist = calculateDistanceMeters(point.lat, point.lng, route[0][1], route[0][0]);
    if (dist <= maxSnapDistanceMeters) {
      return { lat: route[0][1], lng: route[0][0], snapped: true, distanceToRouteMeters: dist };
    }
    return { lat: point.lat, lng: point.lng, snapped: false, distanceToRouteMeters: dist };
  }

  const phi0 = toRad(point.lat);
  const cosPhi0 = Math.cos(phi0);

  // Convert (lng, lat) to local tangent meters (x, y) relative to point
  const toLocalMeters = (lng: number, lat: number) => ({
    x: EARTH_RADIUS_METERS * toRad(lng - point.lng) * cosPhi0,
    y: EARTH_RADIUS_METERS * toRad(lat - point.lat),
  });

  const fromLocalMeters = (x: number, y: number) => ({
    lng: point.lng + toDeg(x / (EARTH_RADIUS_METERS * cosPhi0)),
    lat: point.lat + toDeg(y / EARTH_RADIUS_METERS),
  });

  let minDistanceSq = Infinity;
  let bestPoint = { lat: point.lat, lng: point.lng };

  for (let i = 0; i < route.length - 1; i++) {
    const p1 = toLocalMeters(route[i][0], route[i][1]);
    const p2 = toLocalMeters(route[i + 1][0], route[i + 1][1]);

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const segLengthSq = dx * dx + dy * dy;

    let t = 0;
    if (segLengthSq > 0) {
      t = (-p1.x * dx + -p1.y * dy) / segLengthSq;
      t = Math.max(0, Math.min(1, t));
    }

    const projX = p1.x + t * dx;
    const projY = p1.y + t * dy;
    const distSq = projX * projX + projY * projY;

    if (distSq < minDistanceSq) {
      minDistanceSq = distSq;
      bestPoint = fromLocalMeters(projX, projY);
    }
  }

  const minDistanceMeters = Math.sqrt(minDistanceSq);
  if (minDistanceMeters <= maxSnapDistanceMeters) {
    return {
      lat: Number(bestPoint.lat.toFixed(7)),
      lng: Number(bestPoint.lng.toFixed(7)),
      snapped: true,
      distanceToRouteMeters: minDistanceMeters,
    };
  }

  return {
    lat: point.lat,
    lng: point.lng,
    snapped: false,
    distanceToRouteMeters: minDistanceMeters,
  };
}

export interface RouteStep {
  instruction: string;
  streetName: string;
  distanceMeters: number;
  durationSeconds: number;
  type: string;
  modifier?: string;
  location: [number, number]; // [lng, lat]
  bearingAfter?: number;
  bearingBefore?: number;
  exit?: string;
  ref?: string;
  destinations?: string;
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

export function formatManeuverInstruction(step: any): string {
  const mType = step.maneuver?.type || 'turn';
  const mMod = step.maneuver?.modifier || '';
  const roadName = step.name ? step.name.trim() : '';
  const target = roadName || step.destinations || step.ref || '';

  if (mType === 'depart') {
    return target ? `Head out onto ${target}` : 'Head towards destination';
  }
  if (mType === 'arrive') {
    return target ? `Arrive at ${target}` : 'Arrive at destination';
  }
  if (mType === 'off ramp') {
    let exitStr = '';
    if (step.exits) {
      const rawExit = String(step.exits).trim();
      exitStr = rawExit.toLowerCase().startsWith('exit')
        ? rawExit
        : `exit ${rawExit}`;
    }

    const rawDest = (step.destinations || step.ref || roadName || '').trim();

    if (exitStr) {
      if (rawDest && !exitStr.toLowerCase().includes(rawDest.toLowerCase())) {
        return `Take ${exitStr} towards ${rawDest}`;
      }
      return `Take ${exitStr}`;
    }

    if (rawDest) {
      if (rawDest.toLowerCase().startsWith('exit')) {
        return `Take ${rawDest}`;
      }
      return `Take exit towards ${rawDest}`;
    }

    return 'Take exit';
  }
  if (mType === 'on ramp') {
    return target ? `Take ramp onto ${target}` : 'Take highway ramp';
  }
  if (mType === 'merge') {
    return target ? `Merge onto ${target}` : 'Merge ahead';
  }
  if (mType === 'turn') {
    const modStr = mMod ? `${mMod.replace('_', ' ')} ` : '';
    return target ? `Turn ${modStr}onto ${target}` : `Turn ${modStr}`;
  }
  if (mType === 'new name' || mType === 'continue') {
    return target ? `Continue onto ${target}` : 'Continue straight';
  }
  if (mType === 'roundabout') {
    return target ? `Enter roundabout towards ${target}` : 'Enter roundabout';
  }
  if (mType === 'fork') {
    const modStr = mMod ? `keep ${mMod.replace('_', ' ')} ` : '';
    return target ? `At fork, ${modStr}onto ${target}` : `At fork, ${modStr}`;
  }
  if (mType === 'end of road') {
    const modStr = mMod ? `${mMod.replace('_', ' ')} ` : '';
    return target ? `Turn ${modStr}onto ${target}` : `Turn ${modStr}`;
  }

  const modStr = mMod ? ` ${mMod.replace('_', ' ')}` : '';
  return target ? `${mType}${modStr} onto ${target}` : `${mType}${modStr}`;
}

