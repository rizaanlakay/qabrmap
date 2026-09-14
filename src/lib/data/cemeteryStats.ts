// Figures shown on cemetery cards, worked out from real graves rather than stored numbers

// Mapped graves as a share of the cemetery's total; null when no real total has been recorded
export function cemeteryCoveragePercent(mappedGraves: number, totalGravesEstimate: number): number | null {
  if (!Number.isFinite(totalGravesEstimate) || totalGravesEstimate <= 0) return null;
  return Math.min(100, Math.round((Math.max(0, mappedGraves) / totalGravesEstimate) * 100));
}

export function formatGravesMapped(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'grave' : 'graves'} mapped`;
}
