// Gesture maths for pulling a scrolled-to-top list down to refresh it

// Finger travel before a touch turns into a pull, so taps and tiny wobbles are ignored
export const PULL_START_THRESHOLD_PX = 8;
// Damped pull distance at which letting go triggers a refresh
export const PULL_REFRESH_THRESHOLD_PX = 64;
// The indicator never travels further than this, however far the finger goes
export const PULL_MAX_PX = 96;
// Height the indicator settles at while the refresh runs
export const PULL_REFRESHING_PX = 56;
export const PULL_SNAP_MS = 250;

export function shouldBeginPull({ scrollTop, deltaY }: { scrollTop: number; deltaY: number }): boolean {
  return scrollTop <= 0 && deltaY >= PULL_START_THRESHOLD_PX;
}

// Rubber-band damping: the list follows the finger closely at first and resists more the further it goes
export function dampPull(fingerDeltaY: number): number {
  if (fingerDeltaY <= 0) return 0;
  const damped = PULL_MAX_PX * (1 - Math.exp(-fingerDeltaY / PULL_MAX_PX));
  return Math.min(PULL_MAX_PX, damped);
}

export function shouldRefresh(pullPx: number): boolean {
  return pullPx >= PULL_REFRESH_THRESHOLD_PX;
}

export function pullProgress(pullPx: number): number {
  return Math.min(1, Math.max(0, pullPx / PULL_REFRESH_THRESHOLD_PX));
}
