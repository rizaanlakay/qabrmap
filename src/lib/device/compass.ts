// waiting: listening but no reading yet; needs-permission: iOS, must ask from a tap
export type CompassStatus = 'waiting' | 'needs-permission' | 'active' | 'denied' | 'unsupported';

// deviceorientationabsolute events are measured from north; plain deviceorientation events usually are not
export type CompassSource = 'absolute' | 'relative';

export interface OrientationReading {
  alpha?: number | null;
  webkitCompassHeading?: number | null;
}

// Heading in whole degrees clockwise from north, or null when the reading isn't tied to north
export function readCompassHeading(reading: OrientationReading, source: CompassSource): number | null {
  const iosHeading = reading.webkitCompassHeading;
  if (typeof iosHeading === 'number' && Number.isFinite(iosHeading)) {
    return wholeDegrees(iosHeading);
  }
  if (source === 'absolute' && typeof reading.alpha === 'number' && Number.isFinite(reading.alpha)) {
    return wholeDegrees(360 - reading.alpha);
  }
  return null;
}

function wholeDegrees(deg: number): number {
  return ((Math.round(deg) % 360) + 360) % 360;
}
