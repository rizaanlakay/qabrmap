import type { Cemetery } from '@/types';
import { isPointInPolygon } from '../geospatial';

// The cemetery a capture location falls inside. Cemeteries without a boundary are skipped; if boundaries
// overlap, the first one in the list wins.
export function findCemeteryForLocation(cemeteries: Cemetery[], lat: number, lng: number): Cemetery | undefined {
  return cemeteries.find((cemetery) => {
    const ring = cemetery.boundary?.coordinates?.[0];
    return Array.isArray(ring) && ring.length >= 3 && isPointInPolygon([lng, lat], ring as [number, number][]);
  });
}
