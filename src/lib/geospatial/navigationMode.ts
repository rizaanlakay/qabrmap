// When navigation shows the driving view and when it hands over to the top-down walking view.
// Driving guidance must not drop away on the approach roads, so distance alone never ends it:
// the driver is either seen inside the cemetery boundary or says they have arrived.

export type NavigationMode = 'driving' | 'walking';
export type ManualNavigationMode = 'auto' | NavigationMode;

// Offer "I have arrived" once the driver is this close to the entrance or the grave
export const ARRIVAL_PROMPT_METERS = 350;

export function resolveNavigationMode({
  manualMode,
  hasArrived,
}: {
  manualMode: ManualNavigationMode;
  hasArrived: boolean;
}): NavigationMode {
  if (manualMode !== 'auto') return manualMode;
  return hasArrived ? 'walking' : 'driving';
}

// Only a real GPS fix counts: the default start position can sit inside a boundary the driver is nowhere near
export function hasArrivedAtCemetery({
  isInsideBoundary,
  hasLiveFix,
}: {
  isInsideBoundary: boolean;
  hasLiveFix: boolean;
}): boolean {
  return isInsideBoundary && hasLiveFix;
}

export function shouldOfferArrival({
  mode,
  distToEntranceMeters,
  distToGraveMeters,
}: {
  mode: NavigationMode;
  distToEntranceMeters: number;
  distToGraveMeters: number;
}): boolean {
  if (mode !== 'driving') return false;
  return Math.min(distToEntranceMeters, distToGraveMeters) <= ARRIVAL_PROMPT_METERS;
}
