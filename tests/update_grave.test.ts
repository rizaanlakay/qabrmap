import { describe, it, expect, vi } from 'vitest';
import {
  UPDATE_NOT_SET_UP_MESSAGE,
  UPDATE_OFFLINE_MESSAGE,
  UPDATE_SIGNED_OUT_MESSAGE,
  UPDATE_UNKNOWN_MESSAGE,
  UpdateMappedGraveDeps,
  applyGraveEdit,
  mapUpdateGraveError,
  updateMappedGrave,
} from '../src/lib/graves/updateMappedGrave';
import { GraveEditForm, graveEditFormFrom, hasGraveEditChanges, validateGraveEditForm } from '../src/lib/graves/graveEditForm';
import type { Grave } from '../src/types';

type RpcResult = { data: unknown; error: unknown };
type GetUserResult = { data: { user: { id: string } | null }; error: unknown };

function makeDeps(overrides: Partial<UpdateMappedGraveDeps> = {}) {
  // Loosely typed so tests can swap in failures with mockResolvedValueOnce
  const rpc = vi.fn(async (..._args: unknown[]): Promise<RpcResult> => ({ data: null, error: null }));
  const getUser = vi.fn(async (): Promise<GetUserResult> => ({ data: { user: { id: 'user-1' } }, error: null }));
  const deps: UpdateMappedGraveDeps = {
    client: { rpc, auth: { getUser } } as unknown as UpdateMappedGraveDeps['client'],
    isOnline: () => true,
    ...overrides,
  };
  return { deps, rpc, getUser };
}

const GRAVE: Grave = {
  id: 'grave_1',
  cemeteryId: 'cem_johnson_road',
  personId: 'person_1',
  person: { id: 'person_1', firstName: 'Farieda', middleNames: '', surname: 'Fieldf', fullName: 'Farieda Fieldf', birthDate: '1951-03-02', deathDate: '2007-08-19T00:00:00+00:00' },
  graveNumber: '',
  latitude: -33.98,
  longitude: 18.5,
  positionAccuracyMeters: 3,
  positionConfidence: 'HIGH',
  status: 'MAPPED',
  photoCount: 1,
  createdBy: 'user-1',
  createdAt: '2026-09-15T10:00:00Z',
  updatedAt: '2026-09-15T10:00:00Z',
};

const form = (changes: Partial<GraveEditForm> = {}): GraveEditForm => ({ ...graveEditFormFrom(GRAVE), ...changes });

describe('Grave Edit Form Tests', () => {
  it("starts from the grave's current details, with dates cut to the day", () => {
    expect(graveEditFormFrom(GRAVE)).toEqual({
      firstName: 'Farieda', middleNames: '', surname: 'Fieldf', nickname: '', graveNumber: '', birthDate: '1951-03-02', deathDate: '2007-08-19',
    });
  });

  it('starts empty for a grave with no person', () => {
    expect(graveEditFormFrom({ ...GRAVE, person: undefined, graveNumber: '1402' })).toMatchObject({ firstName: '', surname: '', graveNumber: '1402' });
  });

  it('requires a first name and surname and nothing else', () => {
    expect(validateGraveEditForm(form())).toEqual({ valid: true, errors: {} });
    expect(validateGraveEditForm(form({ firstName: '  ', surname: '' })).errors).toEqual({ firstName: 'Enter a first name', surname: 'Enter a surname' });
    expect(validateGraveEditForm(form({ birthDate: '', deathDate: '' })).valid).toBe(true);
  });

  it('refuses a death before the birth', () => {
    const result = validateGraveEditForm(form({ birthDate: '2007-08-19', deathDate: '1951-03-02' }));
    expect(result.valid).toBe(false);
    expect(result.errors.deathDate).toBe('The date of death is before the date of birth');
  });

  it('only counts real differences as changes', () => {
    expect(hasGraveEditChanges(form(), GRAVE)).toBe(false);
    expect(hasGraveEditChanges(form({ surname: ' Fieldf ' }), GRAVE)).toBe(false);
    expect(hasGraveEditChanges(form({ surname: 'Field' }), GRAVE)).toBe(true);
    expect(hasGraveEditChanges(form({ graveNumber: '6567' }), GRAVE)).toBe(true);
  });
});

describe('Update Grave Error Tests', () => {
  it('treats network failures as offline', () => {
    expect(mapUpdateGraveError(new TypeError('Failed to fetch'))).toMatchObject({ code: 'offline', message: UPDATE_OFFLINE_MESSAGE });
  });

  it('asks the user to sign in when there is no session', () => {
    expect(mapUpdateGraveError({ code: '42501', message: 'Sign in to edit a grave.' })).toMatchObject({ code: 'signed-out', message: UPDATE_SIGNED_OUT_MESSAGE });
  });

  it("shows the database's reason when the edit isn't allowed, is invalid, or the grave is gone", () => {
    expect(mapUpdateGraveError({ code: 'P0001', message: 'Only the person who mapped this grave can edit it.' })).toMatchObject({
      code: 'not-allowed',
      message: 'Only the person who mapped this grave can edit it.',
    });
    expect(mapUpdateGraveError({ code: '55000', message: "This person's record is shared." })).toMatchObject({ code: 'not-allowed', message: "This person's record is shared." });
    expect(mapUpdateGraveError({ code: '22023', message: 'The date of death is before the date of birth.' })).toMatchObject({
      code: 'invalid',
      message: 'The date of death is before the date of birth.',
    });
    expect(mapUpdateGraveError({ code: '22008', message: 'date/time field value out of range' })).toMatchObject({ code: 'invalid', message: 'One of the dates is not a real date.' });
    expect(mapUpdateGraveError({ code: 'P0002', message: 'This grave no longer exists.' })).toMatchObject({ code: 'not-found' });
  });

  it('explains when the migration has not been applied, and falls back to a general message', () => {
    expect(mapUpdateGraveError({ code: 'PGRST202' })).toMatchObject({ code: 'not-set-up', message: UPDATE_NOT_SET_UP_MESSAGE });
    expect(mapUpdateGraveError({ code: 'XX000', message: 'boom' })).toMatchObject({ code: 'unknown', message: UPDATE_UNKNOWN_MESSAGE });
  });
});

describe('Update Mapped Grave Tests', () => {
  it('sends the trimmed details, with blanks as nulls', async () => {
    const { deps, rpc } = makeDeps();
    await expect(
      updateMappedGrave('grave_1', form({ firstName: ' Farieda ', surname: 'Field', nickname: ' ', graveNumber: ' 6567 ', birthDate: '' }), deps)
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('update_mapped_grave', {
      p_grave_id: 'grave_1',
      p_first_name: 'Farieda',
      p_middle_names: null,
      p_surname: 'Field',
      p_nickname: null,
      p_grave_number: '6567',
      p_birth_date: null,
      p_death_date: '2007-08-19',
    });
  });

  it('stops before saving when offline or signed out', async () => {
    const offline = makeDeps({ isOnline: () => false });
    await expect(updateMappedGrave('grave_1', form(), offline.deps)).rejects.toMatchObject({ code: 'offline' });
    expect(offline.rpc).not.toHaveBeenCalled();

    const signedOut = makeDeps();
    signedOut.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(updateMappedGrave('grave_1', form(), signedOut.deps)).rejects.toMatchObject({ code: 'signed-out' });
    expect(signedOut.rpc).not.toHaveBeenCalled();
  });

  it("passes on the database's refusal", async () => {
    const { deps, rpc } = makeDeps();
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'Only the person who mapped this grave can edit it.' } });
    await expect(updateMappedGrave('grave_1', form(), deps)).rejects.toMatchObject({ code: 'not-allowed' });
  });
});

describe('Apply Grave Edit Tests', () => {
  it('rebuilds the grave as it reads after the edit, leaving everything else alone', () => {
    const edited = applyGraveEdit(GRAVE, form({ surname: ' Field ', middleNames: 'Ann', nickname: 'Fari', graveNumber: '6567', birthDate: '' }), '2026-09-17T12:00:00Z');
    expect(edited.person).toMatchObject({ id: 'person_1', firstName: 'Farieda', middleNames: 'Ann', surname: 'Field', fullName: 'Farieda Ann Field', nickname: 'Fari', deathDate: '2007-08-19' });
    expect(edited.person?.birthDate).toBeUndefined();
    expect(edited.graveNumber).toBe('6567');
    expect(edited.updatedAt).toBe('2026-09-17T12:00:00Z');
    expect(edited).toMatchObject({ id: 'grave_1', latitude: -33.98, createdBy: 'user-1', status: 'MAPPED' });
  });
});
