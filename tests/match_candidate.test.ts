import { describe, it, expect, vi } from 'vitest';
import type { DeviceTelemetry } from '../src/types';
import type { NewGraveForm } from '../src/lib/capture/newGrave';
import {
  MatchCandidate,
  describeMatchCandidate,
  findMatchingGraves,
  formatShortDate,
  mapMatchCandidate,
  matchCheckParams,
  matchHeading,
} from '../src/lib/graves/matchCandidate';

const form: NewGraveForm = {
  firstName: ' Yusuf ',
  middleNames: 'Ahmed',
  surname: 'Kamish ',
  nickname: '',
  graveNumber: ' 1402 ',
  birthDate: '1952-02-02',
  deathDate: '',
  cemeteryId: 'cem_athlone',
};

const telemetry: DeviceTelemetry = {
  latitude: -33.968,
  longitude: 18.503,
  gpsAccuracy: 4.2,
  headingDegrees: 62,
  timestamp: '2026-09-15T10:00:00.000Z',
};

const row = {
  grave_id: 'grave_yusuf',
  full_name: 'Yusuf Kamish',
  birth_date: '1952-02-02',
  death_date: '2018-06-16',
  grave_number: '',
  distance_meters: 4.2,
  match: 'strong',
};

const yusuf: MatchCandidate = {
  graveId: 'grave_yusuf',
  fullName: 'Yusuf Kamish',
  birthDate: '1952-02-02',
  deathDate: '2018-06-16',
  graveNumber: '',
  distanceMeters: 4.2,
  match: 'strong',
};

describe('Match Check Params Tests', () => {
  it('sends the trimmed details the database compares', () => {
    expect(matchCheckParams(form, telemetry)).toEqual({
      p_cemetery_id: 'cem_athlone',
      p_latitude: -33.968,
      p_longitude: 18.503,
      p_accuracy_meters: 4.2,
      p_first_name: 'Yusuf',
      p_surname: 'Kamish',
      p_birth_date: '1952-02-02',
      p_death_date: null,
      p_grave_number: '1402',
    });
  });

  it('skips the check until there is a cemetery, a first name and a surname', () => {
    expect(matchCheckParams({ ...form, cemeteryId: '' }, telemetry)).toBeNull();
    expect(matchCheckParams({ ...form, firstName: '  ' }, telemetry)).toBeNull();
    expect(matchCheckParams({ ...form, surname: '' }, telemetry)).toBeNull();
  });
});

describe('Match Candidate Tests', () => {
  it('maps a database row', () => {
    expect(mapMatchCandidate(row)).toEqual(yusuf);
    expect(mapMatchCandidate({ ...row, birth_date: null, death_date: null, grave_number: null, match: 'possible' })).toEqual({
      ...yusuf,
      birthDate: undefined,
      deathDate: undefined,
      graveNumber: '',
      match: 'possible',
    });
  });

  it('rejects anything without a grave id and name', () => {
    expect(mapMatchCandidate(null)).toBeNull();
    expect(mapMatchCandidate({ full_name: 'Yusuf Kamish' })).toBeNull();
    expect(mapMatchCandidate({ grave_id: 'grave_yusuf' })).toBeNull();
  });

  it('formats dates the same on every phone', () => {
    expect(formatShortDate('1952-02-02')).toBe('2 Feb 1952');
    expect(formatShortDate('2018-12-16')).toBe('16 Dec 2018');
    expect(formatShortDate('2018-13-01')).toBe('2018-13-01');
    expect(formatShortDate('1952')).toBe('1952');
  });

  it('describes the grave with both dates, so a father and son can be told apart', () => {
    expect(describeMatchCandidate(yusuf)).toBe('Yusuf Kamish, born 2 Feb 1952, died 16 Jun 2018, 4 m away');
    expect(describeMatchCandidate({ ...yusuf, birthDate: undefined, graveNumber: '1402', distanceMeters: 0.4 })).toBe(
      'Yusuf Kamish, died 16 Jun 2018, grave 1402, 0 m away'
    );
  });

  it('is sure only about a strong match', () => {
    expect(matchHeading(yusuf)).toBe('Already mapped nearby');
    expect(matchHeading({ ...yusuf, match: 'possible' })).toBe('This person may already be mapped nearby');
  });
});

describe('Find Matching Graves Tests', () => {
  it('calls the database and maps the rows', async () => {
    const rpc = vi.fn(async (..._args: unknown[]) => ({ data: [row], error: null }));
    const params = matchCheckParams(form, telemetry)!;
    await expect(findMatchingGraves({ rpc } as never, params)).resolves.toEqual([yusuf]);
    expect(rpc).toHaveBeenCalledWith('find_matching_graves', params);
  });

  it('treats a failed check as no match, because the save checks again', async () => {
    const params = matchCheckParams(form, telemetry)!;
    const failing = vi.fn(async () => ({ data: null, error: { code: 'PGRST202' } }));
    await expect(findMatchingGraves({ rpc: failing } as never, params)).resolves.toEqual([]);
    const throwing = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(findMatchingGraves({ rpc: throwing } as never, params)).resolves.toEqual([]);
  });
});
