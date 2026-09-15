// Exponential smoothing: alpha 1 follows the new value at once, smaller values settle more slowly
export function smoothValue(prev: number | null, next: number, alpha: number): number {
  return prev === null ? next : prev + (next - prev) * alpha;
}

function normaliseDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

// Same, for a heading in degrees: 350 to 10 moves through north, not back through 180
export function smoothAngle(prev: number | null, next: number, alpha: number): number {
  if (prev === null) return normaliseDegrees(next);
  const delta = ((next - prev + 540) % 360) - 180;
  return normaliseDegrees(prev + delta * alpha);
}
