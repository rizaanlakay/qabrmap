import { calculateBearing } from '../geospatial';

export const STREET_VIEW_ENDPOINT = 'https://maps.googleapis.com/maps/api/streetview';

export interface Point {
  lat: number;
  lng: number;
}

export interface StreetViewReference {
  streetViewPanoId?: string;
  streetViewHeading?: number;
}

// Google's camera stands on the road, so an unaimed panorama usually shows the street rather than the
// burial ground. This is the bearing from the camera to the cemetery, which turns the view towards it.
export function headingToCemetery(camera: Point, cemetery: Point): number {
  if (camera.lat === cemetery.lat && camera.lng === cemetery.lng) return 0;
  return calculateBearing(camera.lat, camera.lng, cemetery.lat, cemetery.lng);
}

// The imagery is never stored: Google's terms allow displaying it live, so the card requests it each time.
// Returns null whenever a thumbnail cannot be requested, and the caller keeps its placeholder.
export function streetViewThumbnailUrl(
  cemetery: StreetViewReference,
  apiKey: string,
  size: number
): string | null {
  if (!cemetery.streetViewPanoId || cemetery.streetViewHeading === undefined) return null;
  if (!apiKey) return null;
  const params = new URLSearchParams({
    pano: cemetery.streetViewPanoId,
    size: `${size}x${size}`,
    heading: String(cemetery.streetViewHeading),
    pitch: '0',
    fov: '80',
    key: apiKey,
  });
  return `${STREET_VIEW_ENDPOINT}?${params.toString()}`;
}
