import { describe, it, expect } from 'vitest';
import {
  ARRIVAL_PROMPT_METERS,
  hasArrivedAtCemetery,
  resolveNavigationMode,
  shouldOfferArrival,
} from '../src/lib/geospatial/navigationMode';

describe('Navigation Mode Tests', () => {
  it('stays in driving mode however close the gate is, until the driver has arrived', () => {
    expect(resolveNavigationMode({ manualMode: 'auto', hasArrived: false })).toBe('driving');
  });

  it('switches to walking once the driver has arrived', () => {
    expect(resolveNavigationMode({ manualMode: 'auto', hasArrived: true })).toBe('walking');
  });

  it('lets the Drive and Walk buttons override the automatic mode', () => {
    expect(resolveNavigationMode({ manualMode: 'walking', hasArrived: false })).toBe('walking');
    expect(resolveNavigationMode({ manualMode: 'driving', hasArrived: true })).toBe('driving');
  });

  it('counts a real GPS fix inside the boundary as arrived', () => {
    expect(hasArrivedAtCemetery({ isInsideBoundary: true, hasLiveFix: true })).toBe(true);
  });

  it('does not count the default start position as arrived, even inside a boundary', () => {
    expect(hasArrivedAtCemetery({ isInsideBoundary: true, hasLiveFix: false })).toBe(false);
  });

  it('is not arrived outside the boundary', () => {
    expect(hasArrivedAtCemetery({ isInsideBoundary: false, hasLiveFix: true })).toBe(false);
  });

  it('offers the arrived button close to the entrance or the grave', () => {
    const near = ARRIVAL_PROMPT_METERS - 1;
    const far = ARRIVAL_PROMPT_METERS + 1;
    expect(shouldOfferArrival({ mode: 'driving', distToEntranceMeters: near, distToGraveMeters: far })).toBe(true);
    expect(shouldOfferArrival({ mode: 'driving', distToEntranceMeters: far, distToGraveMeters: near })).toBe(true);
  });

  it('does not offer the arrived button while still far away, or once walking', () => {
    const near = ARRIVAL_PROMPT_METERS - 1;
    const far = ARRIVAL_PROMPT_METERS + 1;
    expect(shouldOfferArrival({ mode: 'driving', distToEntranceMeters: far, distToGraveMeters: far })).toBe(false);
    expect(shouldOfferArrival({ mode: 'walking', distToEntranceMeters: near, distToGraveMeters: near })).toBe(false);
  });
});
