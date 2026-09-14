import { describe, it, expect } from 'vitest';
import { cemeteryCoveragePercent, formatGravesMapped } from '../src/lib/data/cemeteryStats';

describe('Cemetery Stats Tests', () => {
  it('works out coverage only when the cemetery has a real total', () => {
    expect(cemeteryCoveragePercent(100, 1000)).toBe(10);
    expect(cemeteryCoveragePercent(1, 3)).toBe(33);
    expect(cemeteryCoveragePercent(0, 14300)).toBe(0);
    expect(cemeteryCoveragePercent(50, 0)).toBeNull();
    expect(cemeteryCoveragePercent(50, Number.NaN)).toBeNull();
  });

  it('never reports more than full coverage', () => {
    expect(cemeteryCoveragePercent(1200, 1000)).toBe(100);
  });

  it('describes how many graves are mapped', () => {
    expect(formatGravesMapped(0)).toBe('0 graves mapped');
    expect(formatGravesMapped(1)).toBe('1 grave mapped');
    expect(formatGravesMapped(12450)).toBe('12,450 graves mapped');
  });
});
