import { describe, it, expect } from 'vitest';
import type { Cemetery } from '../src/types';
import { findCemeteryForLocation } from '../src/lib/capture/cemeteryForLocation';
import { NewGraveForm, validateNewGraveForm } from '../src/lib/capture/newGrave';

function cemetery(id: string, ring?: [number, number][]): Cemetery {
  return {
    id,
    name: id,
    slug: id,
    description: '',
    country: 'South Africa',
    province: 'Western Cape',
    city: 'Cape Town',
    denomination: 'Muslim',
    originLat: -33.9675,
    originLng: 18.5033,
    boundary: ring ? { type: 'Polygon', coordinates: [ring] } : undefined,
    totalGravesEstimate: 0,
    mappedGravesCount: 0,
    coveragePercentage: 0,
  };
}

// [lng, lat] squares
const ATHLONE_RING: [number, number][] = [
  [18.5, -33.97], [18.51, -33.97], [18.51, -33.96], [18.5, -33.96], [18.5, -33.97],
];
const MOWBRAY_RING: [number, number][] = [
  [18.47, -33.95], [18.48, -33.95], [18.48, -33.94], [18.47, -33.94], [18.47, -33.95],
];

const validForm: NewGraveForm = {
  firstName: 'Abdul',
  middleNames: '',
  surname: 'Narker',
  nickname: '',
  graveNumber: '',
  birthDate: '',
  deathDate: '',
  cemeteryId: 'cem_athlone',
};

describe('New Grave Form Tests', () => {
  it('finds the cemetery whose boundary contains the location', () => {
    const list = [cemetery('cem_mowbray', MOWBRAY_RING), cemetery('cem_athlone', ATHLONE_RING)];
    expect(findCemeteryForLocation(list, -33.965, 18.505)?.id).toBe('cem_athlone');
  });

  it('finds nothing outside every boundary', () => {
    expect(findCemeteryForLocation([cemetery('cem_athlone', ATHLONE_RING)], -33.9, 18.6)).toBeUndefined();
  });

  it('skips cemeteries without a boundary and uses the first match when boundaries overlap', () => {
    const list = [cemetery('cem_no_boundary'), cemetery('cem_first', ATHLONE_RING), cemetery('cem_second', ATHLONE_RING)];
    expect(findCemeteryForLocation(list, -33.965, 18.505)?.id).toBe('cem_first');
  });

  it('accepts a grave with only a first name, surname and cemetery', () => {
    expect(validateNewGraveForm(validForm)).toEqual({ valid: true, errors: {} });
  });

  it('requires a first name and surname, ignoring spaces', () => {
    expect(validateNewGraveForm({ ...validForm, firstName: '  ', surname: '' })).toEqual({
      valid: false,
      errors: { firstName: 'Enter a first name', surname: 'Enter a surname' },
    });
  });

  it('requires a cemetery', () => {
    expect(validateNewGraveForm({ ...validForm, cemeteryId: '' })).toEqual({
      valid: false,
      errors: { cemeteryId: 'Choose a cemetery' },
    });
  });
});
