import { describe, it, expect } from 'vitest';
import type { Cemetery } from '../src/types';
import {
  NEARBY_LIMIT,
  formatDistance,
  matchesCemeterySearch,
  nearestCemeteries,
  sortCemeteries,
  withDistances,
} from '../src/lib/cemeteries/nearby';
import { cemeteryTags } from '../src/lib/cemeteries/tags';

function cemetery(id: string, lat: number, lng: number, extra: Partial<Cemetery> = {}): Cemetery {
  return {
    id,
    name: id,
    slug: id,
    description: '',
    country: 'South Africa',
    province: 'Western Cape',
    city: 'Cape Town',
    denomination: 'Muslim',
    originLat: lat,
    originLng: lng,
    totalGravesEstimate: 0,
    mappedGravesCount: 0,
    coveragePercentage: 0,
    siteType: 'muslim_cemetery',
    siteStatus: 'active',
    aliases: [],
    ...extra,
  };
}

// Athlone gate; each site below is a known distance north of it
const here = { lat: -33.967, lng: 18.5265 };
const sites = [
  cemetery('far', -33.867, 18.5265), // about 11.1 km
  cemetery('mid', -33.947, 18.5265), // about 2.2 km
  cemetery('near', -33.9675, 18.5265), // about 56 m
  cemetery('c4', -33.937, 18.5265),
  cemetery('c5', -33.927, 18.5265),
  cemetery('c6', -33.917, 18.5265),
  cemetery('c7', -33.907, 18.5265),
];

describe('withDistances', () => {
  it('adds a straight-line distance in metres without touching the input', () => {
    const result = withDistances(sites, here);
    expect(result.find((c) => c.id === 'near')?.distanceMeters).toBeCloseTo(55.6, 0);
    expect(result.find((c) => c.id === 'mid')?.distanceMeters).toBeCloseTo(2224, -1);
    expect(sites[0].distanceMeters).toBeUndefined();
  });
});

describe('nearestCemeteries', () => {
  it('returns the five closest, closest first', () => {
    const ids = nearestCemeteries(sites, here).map((c) => c.id);
    expect(ids).toEqual(['near', 'mid', 'c4', 'c5', 'c6']);
    expect(NEARBY_LIMIT).toBe(5);
  });

  it('returns everything when there are fewer than five', () => {
    expect(nearestCemeteries(sites.slice(0, 3), here).map((c) => c.id)).toEqual(['near', 'mid', 'far']);
  });

  it('carries the distance on each result', () => {
    expect(nearestCemeteries(sites, here)[0].distanceMeters).toBeDefined();
  });
});

describe('formatDistance', () => {
  it('uses metres under a kilometre, one decimal to ten, whole kilometres beyond', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(849.6)).toBe('850 m');
    expect(formatDistance(999.4)).toBe('999 m');
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(2440)).toBe('2.4 km');
    expect(formatDistance(9949)).toBe('9.9 km');
    expect(formatDistance(10_000)).toBe('10 km');
    expect(formatDistance(38_400)).toBe('38 km');
  });
});

describe('matchesCemeterySearch', () => {
  const athlone = cemetery('cem_athlone', 0, 0, {
    name: 'Vygiekraal / Johnson Road Muslim Cemetery',
    aliases: ['Athlone Muslim Cemetery', 'Johnson Road Maqbara'],
    city: 'Cape Town',
    province: 'Western Cape',
  });

  it('matches the name, any alias, the city and the province, ignoring case', () => {
    expect(matchesCemeterySearch(athlone, 'vygiekraal')).toBe(true);
    expect(matchesCemeterySearch(athlone, 'ATHLONE')).toBe(true);
    expect(matchesCemeterySearch(athlone, 'maqbara')).toBe(true);
    expect(matchesCemeterySearch(athlone, 'cape town')).toBe(true);
    expect(matchesCemeterySearch(athlone, 'western')).toBe(true);
    expect(matchesCemeterySearch(athlone, 'durban')).toBe(false);
  });

  it('matches everything on a blank query', () => {
    expect(matchesCemeterySearch(athlone, '   ')).toBe(true);
  });

  it('survives a cemetery cached before aliases existed', () => {
    const old = { ...cemetery('old', 0, 0, { name: 'Old Cemetery' }) } as Cemetery;
    delete (old as Partial<Cemetery>).aliases;
    expect(() => matchesCemeterySearch(old, 'old')).not.toThrow();
    expect(matchesCemeterySearch(old, 'old')).toBe(true);
  });
});

describe('sortCemeteries', () => {
  it('sorts by distance when a position is known', () => {
    expect(sortCemeteries(sites, here).map((c) => c.id).slice(0, 3)).toEqual(['near', 'mid', 'c4']);
  });

  it('sorts by name when there is no position and shows no distance', () => {
    const sorted = sortCemeteries([cemetery('b', 0, 0, { name: 'Zeerust' }), cemetery('a', 0, 0, { name: 'Atlantis' })]);
    expect(sorted.map((c) => c.name)).toEqual(['Atlantis', 'Zeerust']);
    expect(sorted[0].distanceMeters).toBeUndefined();
  });
});

describe('cemeteryTags', () => {
  it('names the section, historic and shared types and a closed status', () => {
    expect(cemeteryTags({ siteType: 'muslim_cemetery', siteStatus: 'active' })).toEqual([]);
    expect(cemeteryTags({ siteType: 'muslim_section', siteStatus: 'active' })).toEqual(['Muslim section']);
    expect(cemeteryTags({ siteType: 'shared_cemetery', siteStatus: 'unknown' })).toEqual(['Shared cemetery']);
    expect(cemeteryTags({ siteType: 'historic_cemetery', siteStatus: 'closed' })).toEqual(['Historic', 'Closed']);
    expect(cemeteryTags({ siteType: 'muslim_cemetery', siteStatus: 'closed' })).toEqual(['Closed']);
  });
});
