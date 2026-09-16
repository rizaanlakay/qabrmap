import type { DeviceTelemetry, MapPin } from '@/types';
import { calculateDistanceMeters, toDeg, toRad } from '../geospatial';
import { MAX_MAP_ZOOM } from '../map/googleMapTiles';

// A pin placed by eye on satellite imagery. Google's imagery over a cemetery is a few centimetres per pixel and
// sits within a metre or two of the ground truth, so a careful pin beats the best a phone's GPS can do.
// Mirrors v_pin_accuracy in the map_pinned_position migration.
export const MAP_PIN_ACCURACY_M = 1.5;
// Further than this from the phone's fix, the pin is more likely on the wrong grave than the GPS is wrong
export const MAX_PIN_DISTANCE_M = 50;
// The map opens at its deepest zoom so one screen shows a handful of graves, each big enough to pin
export const PIN_MAP_ZOOM = MAX_MAP_ZOOM;
export const PIN_MAP_MIN_ZOOM = 17;

export interface PinCheck {
  distanceMeters: number;
  // Past MAX_PIN_DISTANCE_M the pin can't be accepted
  tooFar: boolean;
  message: string;
}

type Fix = Pick<DeviceTelemetry, 'latitude' | 'longitude' | 'gpsAccuracy'>;

// How the pin relates to the phone's fix, for the label under the map
export function checkPin(fix: Fix, pin: MapPin): PinCheck {
  const distanceMeters = calculateDistanceMeters(fix.latitude, fix.longitude, pin.latitude, pin.longitude);
  const rounded = Math.round(distanceMeters);
  if (distanceMeters > MAX_PIN_DISTANCE_M) {
    return { distanceMeters, tooFar: true, message: `${rounded} m from your GPS fix. Move the map closer to where you are.` };
  }
  if (distanceMeters <= fix.gpsAccuracy) {
    return { distanceMeters, tooFar: false, message: 'Inside your GPS accuracy circle' };
  }
  return { distanceMeters, tooFar: false, message: `${rounded} m from your GPS fix` };
}

export interface GravePosition {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  pinned: boolean;
}

// Where the grave is saved: the pin when the user placed one, otherwise the phone's fix
export function gravePosition(telemetry: Pick<DeviceTelemetry, 'latitude' | 'longitude' | 'gpsAccuracy' | 'mapPin'>): GravePosition {
  if (telemetry.mapPin) {
    return { latitude: telemetry.mapPin.latitude, longitude: telemetry.mapPin.longitude, accuracyMeters: MAP_PIN_ACCURACY_M, pinned: true };
  }
  return { latitude: telemetry.latitude, longitude: telemetry.longitude, accuracyMeters: telemetry.gpsAccuracy, pinned: false };
}

// A closed ring of [lng, lat] points on the circle of `radiusMeters` around a fix, for drawing the GPS accuracy
// circle in real metres (a MapLibre circle layer is sized in screen pixels)
export function accuracyRing(latitude: number, longitude: number, radiusMeters: number, points = 48): [number, number][] {
  const angular = radiusMeters / 6371000;
  const lat = toRad(latitude);
  const lng = toRad(longitude);
  const ring: [number, number][] = [];
  for (let i = 0; i < points; i += 1) {
    const bearing = (2 * Math.PI * i) / points;
    const pointLat = Math.asin(Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(bearing));
    const pointLng =
      lng + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat), Math.cos(angular) - Math.sin(lat) * Math.sin(pointLat));
    ring.push([toDeg(pointLng), toDeg(pointLat)]);
  }
  ring.push(ring[0]);
  return ring;
}
