import { describe, it, expect, vi } from 'vitest';
import type { DeviceTelemetry } from '../src/types';
import type { NewGraveForm } from '../src/lib/capture/newGrave';
import {
  mapSaveGraveError,
  SaveGraveError,
  GRAVE_MISSING_MESSAGE,
  OFFLINE_MESSAGE,
  SIGNED_OUT_MESSAGE,
  NOT_SET_UP_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
  UNKNOWN_SAVE_MESSAGE,
} from '../src/lib/supabase/saveGraveErrors';
import {
  buildSavedGrave,
  createSaveAttempt,
  saveMappedGrave,
  SaveMappedGraveDeps,
  SaveMappedGraveInput,
} from '../src/lib/capture/saveMappedGrave';

const form: NewGraveForm = {
  firstName: ' Abdul ',
  middleNames: 'Wahab',
  surname: 'Narker ',
  nickname: 'Boeta Dul',
  graveNumber: ' 1402 ',
  birthDate: '1947-01-28',
  deathDate: '',
  cemeteryId: 'cem_athlone',
};

const telemetry: DeviceTelemetry = {
  latitude: -33.9675,
  longitude: 18.5033,
  gpsAccuracy: 4.2,
  headingDegrees: 62,
  timestamp: '2026-09-15T10:00:00.000Z',
};

const PHOTO = 'data:image/jpeg;base64,/9j/abc';
const UPLOADED = {
  publicUrl: 'https://x.supabase.co/grave-photos/cem_athlone/grave_id1.jpg',
  path: 'cem_athlone/grave_id1.jpg',
};

const CANDIDATE_ROW = {
  grave_id: 'grave_existing',
  full_name: 'Abdul Wahab Narker',
  birth_date: '1947-01-28',
  death_date: null,
  grave_number: '1402',
  distance_meters: 3.1,
  match: 'strong',
};

type RpcResult = { data: unknown; error: unknown };
type GetUserResult = { data: { user: { id: string } | null }; error: unknown };

function idsFrom(ids: string[]) {
  return () => ids.shift() ?? 'extra';
}

function newAttempt() {
  return createSaveAttempt(idsFrom(['id1', 'id2']));
}

function input(overrides: Partial<SaveMappedGraveInput> = {}): SaveMappedGraveInput {
  return { form, photoDataUrl: PHOTO, telemetry, attempt: newAttempt(), matchMode: 'ask', ...overrides };
}

function makeDeps(overrides: Partial<SaveMappedGraveDeps> = {}) {
  // Loosely typed so tests can swap in failures with mockResolvedValueOnce
  const rpc = vi.fn(async (..._args: unknown[]): Promise<RpcResult> => ({
    data: { outcome: 'created', grave_id: 'grave_id1' },
    error: null,
  }));
  const getUser = vi.fn(async (): Promise<GetUserResult> => ({ data: { user: { id: 'user-1' } }, error: null }));
  const deps: SaveMappedGraveDeps = {
    client: { rpc, auth: { getUser } } as unknown as SaveMappedGraveDeps['client'],
    isOnline: () => true,
    uploadPhoto: vi.fn(async () => ({ ...UPLOADED })),
    deletePhoto: vi.fn(async () => true),
    ...overrides,
  };
  return { deps, rpc, getUser };
}

const rpcParams = (rpc: ReturnType<typeof makeDeps>['rpc'], call = 0) => rpc.mock.calls[call][1] as Record<string, unknown>;

describe('Save Grave Error Tests', () => {
  it('treats network failures as offline', () => {
    expect(mapSaveGraveError(new TypeError('Failed to fetch'))).toMatchObject({ code: 'offline', message: OFFLINE_MESSAGE });
    expect(mapSaveGraveError({ code: '', message: 'TypeError: Failed to fetch' }).code).toBe('offline');
    expect(mapSaveGraveError({ message: 'Load failed' }).code).toBe('offline');
  });

  it('asks the user to sign in again when the database rejects the session', () => {
    expect(mapSaveGraveError({ code: '42501', message: 'Sign in to map a grave.' })).toMatchObject({
      code: 'signed-out',
      message: SIGNED_OUT_MESSAGE,
    });
  });

  it('names the duplicate grave and cemetery when it can', () => {
    expect(mapSaveGraveError({ code: '23505' }, { graveNumber: '1402', cemeteryName: 'Athlone Muslim Cemetery' }).message).toBe(
      'Grave 1402 is already mapped at Athlone Muslim Cemetery.'
    );
    expect(mapSaveGraveError({ code: '23505' }).message).toBe('This grave is already mapped.');
  });

  it("shows the database's own message for invalid input", () => {
    expect(mapSaveGraveError({ code: '22023', message: 'First name and surname are required.' })).toMatchObject({
      code: 'invalid',
      message: 'First name and surname are required.',
    });
  });

  it('explains when the grave a photo was being added to is gone', () => {
    expect(mapSaveGraveError({ code: 'P0002', message: 'That grave no longer exists.' })).toMatchObject({
      code: 'grave-missing',
      message: GRAVE_MISSING_MESSAGE,
    });
  });

  it('explains when the migration has not been applied yet', () => {
    expect(mapSaveGraveError({ code: 'PGRST202', message: 'Could not find the function' })).toMatchObject({
      code: 'not-set-up',
      message: NOT_SET_UP_MESSAGE,
    });
  });

  it('falls back to a general message and passes existing save errors through', () => {
    expect(mapSaveGraveError({ code: 'XX000', message: 'boom' })).toMatchObject({ code: 'unknown', message: UNKNOWN_SAVE_MESSAGE });
    const existing = new SaveGraveError('upload-failed', UPLOAD_FAILED_MESSAGE);
    expect(mapSaveGraveError(existing)).toBe(existing);
  });
});

describe('Save Mapped Grave Tests', () => {
  it('uploads the photo, then saves the grave with trimmed details in ask mode', async () => {
    const { deps, rpc } = makeDeps();
    await expect(saveMappedGrave(input({ cemeteryName: 'Athlone Muslim Cemetery' }), deps)).resolves.toEqual({
      outcome: 'created',
      graveId: 'grave_id1',
      personId: 'person_id2',
      photoUrl: UPLOADED.publicUrl,
    });

    expect(deps.uploadPhoto).toHaveBeenCalledWith({ file: PHOTO, cemeteryId: 'cem_athlone', graveId: 'grave_id1', upsert: false });
    expect(rpc).toHaveBeenCalledWith('save_or_add_grave', {
      p_grave_id: 'grave_id1',
      p_person_id: 'person_id2',
      p_cemetery_id: 'cem_athlone',
      p_grave_number: '1402',
      p_first_name: 'Abdul',
      p_middle_names: 'Wahab',
      p_surname: 'Narker',
      p_nickname: 'Boeta Dul',
      p_birth_date: '1947-01-28',
      p_death_date: null,
      p_latitude: -33.9675,
      p_longitude: 18.5033,
      p_accuracy_meters: 4.2,
      p_heading_degrees: 62,
      p_captured_at: '2026-09-15T10:00:00.000Z',
      p_photo_public_url: UPLOADED.publicUrl,
      p_photo_storage_path: UPLOADED.path,
      p_match_mode: 'ask',
      p_add_to_grave_id: null,
    });
    expect(deps.deletePhoto).not.toHaveBeenCalled();
  });

  it('passes the survey and different-person modes through', async () => {
    const { deps, rpc } = makeDeps();
    await saveMappedGrave(input({ matchMode: 'auto' }), deps);
    await saveMappedGrave(input({ matchMode: 'new' }), deps);
    expect(rpcParams(rpc, 0).p_match_mode).toBe('auto');
    expect(rpcParams(rpc, 1).p_match_mode).toBe('new');
  });

  it('adds the photo to the grave chosen on the duplicate card', async () => {
    const { deps, rpc } = makeDeps();
    rpc.mockResolvedValueOnce({ data: { outcome: 'added-photo', grave_id: 'grave_existing' }, error: null });
    await expect(saveMappedGrave(input({ addToGraveId: 'grave_existing' }), deps)).resolves.toMatchObject({
      outcome: 'added-photo',
      graveId: 'grave_existing',
      photoUrl: UPLOADED.publicUrl,
    });
    expect(rpcParams(rpc).p_add_to_grave_id).toBe('grave_existing');
  });

  it('returns a match without deleting the photo, so the next choice reuses it', async () => {
    const { deps, rpc } = makeDeps();
    const attempt = newAttempt();
    rpc.mockResolvedValueOnce({ data: { outcome: 'match-found', grave_id: null, candidate: CANDIDATE_ROW }, error: null });
    await expect(saveMappedGrave(input({ attempt }), deps)).resolves.toEqual({
      outcome: 'match-found',
      candidate: {
        graveId: 'grave_existing',
        fullName: 'Abdul Wahab Narker',
        birthDate: '1947-01-28',
        deathDate: undefined,
        graveNumber: '1402',
        distanceMeters: 3.1,
        match: 'strong',
      },
    });
    expect(deps.deletePhoto).not.toHaveBeenCalled();
    expect(attempt.upload).toEqual(UPLOADED);

    rpc.mockResolvedValueOnce({ data: { outcome: 'added-photo', grave_id: 'grave_existing' }, error: null });
    await saveMappedGrave(input({ attempt, addToGraveId: 'grave_existing' }), deps);
    expect(deps.uploadPhoto).toHaveBeenCalledTimes(1);
  });

  it('stops before uploading when offline', async () => {
    const { deps } = makeDeps({ isOnline: () => false });
    await expect(saveMappedGrave(input(), deps)).rejects.toMatchObject({ code: 'offline' });
    expect(deps.uploadPhoto).not.toHaveBeenCalled();
  });

  it('stops when nobody is signed in', async () => {
    const { deps, getUser } = makeDeps();
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(saveMappedGrave(input(), deps)).rejects.toMatchObject({ code: 'signed-out' });
    expect(deps.uploadPhoto).not.toHaveBeenCalled();
  });

  it('only accepts a photo from the camera with a heading', async () => {
    const { deps } = makeDeps();
    await expect(saveMappedGrave(input({ photoDataUrl: '/sample-gravestone.svg' }), deps)).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      saveMappedGrave(input({ telemetry: { ...telemetry, headingDegrees: undefined } }), deps)
    ).rejects.toMatchObject({ code: 'invalid' });
    expect(deps.uploadPhoto).not.toHaveBeenCalled();
  });

  it('reports an upload failure, or offline when the upload lost the connection', async () => {
    const failing = makeDeps({
      uploadPhoto: vi.fn(async () => {
        throw new Error('storage exploded');
      }),
    });
    await expect(saveMappedGrave(input(), failing.deps)).rejects.toMatchObject({ code: 'upload-failed', message: UPLOAD_FAILED_MESSAGE });
    expect(failing.rpc).not.toHaveBeenCalled();

    const dropped = makeDeps({
      uploadPhoto: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    await expect(saveMappedGrave(input(), dropped.deps)).rejects.toMatchObject({ code: 'offline' });
  });

  it('removes the uploaded photo when the database rejects the grave', async () => {
    const { deps, rpc } = makeDeps();
    const attempt = newAttempt();
    rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'First name and surname are required.' } });
    await expect(saveMappedGrave(input({ attempt }), deps)).rejects.toMatchObject({
      code: 'invalid',
      message: 'First name and surname are required.',
    });
    expect(deps.deletePhoto).toHaveBeenCalledWith(UPLOADED.path);
    expect(attempt.upload).toBeUndefined();
  });

  it('removes the photo when the grave it was being added to is gone', async () => {
    const { deps, rpc } = makeDeps();
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0002', message: 'That grave no longer exists.' } });
    await expect(saveMappedGrave(input({ addToGraveId: 'grave_gone' }), deps)).rejects.toMatchObject({ code: 'grave-missing' });
    expect(deps.deletePhoto).toHaveBeenCalledWith(UPLOADED.path);
  });

  it('keeps the photo when the response is lost, and a retry reuses the same photo and ids', async () => {
    const { deps, rpc } = makeDeps();
    const attempt = newAttempt();
    // The database may have saved the grave before the connection dropped
    rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(saveMappedGrave(input({ attempt }), deps)).rejects.toMatchObject({ code: 'offline' });
    expect(deps.deletePhoto).not.toHaveBeenCalled();
    expect(attempt.upload).toEqual(UPLOADED);

    await expect(saveMappedGrave(input({ attempt }), deps)).resolves.toMatchObject({ graveId: 'grave_id1' });
    expect(deps.uploadPhoto).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map((call) => (call[1] as { p_grave_id: string }).p_grave_id)).toEqual(['grave_id1', 'grave_id1']);
  });

  it('keeps the photo when the failure has no database error code', async () => {
    const { deps, rpc } = makeDeps();
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Gateway Timeout' } });
    await expect(saveMappedGrave(input(), deps)).rejects.toMatchObject({ code: 'unknown' });
    expect(deps.deletePhoto).not.toHaveBeenCalled();
  });

  it('keeps the photo when the answer cannot be understood, because the grave may be saved', async () => {
    const { deps, rpc } = makeDeps();
    const attempt = newAttempt();
    rpc.mockResolvedValueOnce({ data: { outcome: 'something-else' }, error: null });
    await expect(saveMappedGrave(input({ attempt }), deps)).rejects.toMatchObject({ code: 'unknown' });
    expect(deps.deletePhoto).not.toHaveBeenCalled();
    expect(attempt.upload).toEqual(UPLOADED);
  });

  it('saves the whole-grave photo after the grave and reports it', async () => {
    const saveGravePhoto = vi.fn(async () => {});
    const { deps } = makeDeps({ saveGravePhoto });
    const result = await saveMappedGrave(input({ gravePhotoDataUrl: 'data:image/jpeg;base64,grave' }), deps);
    expect(result).toMatchObject({ outcome: 'created', graveId: 'grave_id1', gravePhotoSaved: true });
    expect(saveGravePhoto).toHaveBeenCalledWith('grave_id1', 'cem_athlone', 'data:image/jpeg;base64,grave');
  });

  it('keeps the saved grave when the whole-grave photo fails', async () => {
    const saveGravePhoto = vi.fn(async () => {
      throw new Error('storage down');
    });
    const result = await saveMappedGrave(input({ gravePhotoDataUrl: 'data:image/jpeg;base64,grave' }), makeDeps({ saveGravePhoto }).deps);
    expect(result).toMatchObject({ outcome: 'created', gravePhotoSaved: false });
  });

  it('does not touch the whole-grave photo when none was taken', async () => {
    const saveGravePhoto = vi.fn(async () => {});
    const result = await saveMappedGrave(input(), makeDeps({ saveGravePhoto }).deps);
    expect(saveGravePhoto).not.toHaveBeenCalled();
    expect((result as { gravePhotoSaved?: boolean }).gravePhotoSaved).toBeUndefined();
  });
});

describe('Saved Grave Fallback Tests', () => {
  const result = { graveId: 'grave_id1', personId: 'person_id2', photoUrl: UPLOADED.publicUrl };

  it('builds the saved grave from what was sent when it cannot be read back', () => {
    const grave = buildSavedGrave(input({ cemeteryName: 'Athlone Muslim Cemetery' }), result, '2026-09-15T10:00:05.000Z');
    expect(grave).toEqual({
      id: 'grave_id1',
      cemeteryId: 'cem_athlone',
      cemeteryName: 'Athlone Muslim Cemetery',
      personId: 'person_id2',
      graveNumber: '1402',
      latitude: -33.9675,
      longitude: 18.5033,
      positionAccuracyMeters: 4.2,
      positionConfidence: 'MEDIUM',
      orientationDegrees: 62,
      status: 'MAPPED',
      primaryPhotoUrl: UPLOADED.publicUrl,
      photoCount: 1,
      person: {
        id: 'person_id2',
        firstName: 'Abdul',
        middleNames: 'Wahab',
        surname: 'Narker',
        fullName: 'Abdul Wahab Narker',
        nickname: 'Boeta Dul',
        birthDate: '1947-01-28',
        deathDate: undefined,
      },
      createdAt: '2026-09-15T10:00:05.000Z',
      updatedAt: '2026-09-15T10:00:05.000Z',
    });
  });

  it('uses the same accuracy thresholds as the database', () => {
    const at = (gpsAccuracy: number) => buildSavedGrave(input({ telemetry: { ...telemetry, gpsAccuracy } }), result, 'now');
    expect(at(3.5)).toMatchObject({ status: 'MAPPED', positionConfidence: 'HIGH' });
    expect(at(5)).toMatchObject({ status: 'MAPPED', positionConfidence: 'MEDIUM' });
    expect(at(6)).toMatchObject({ status: 'LOW_CONFIDENCE', positionConfidence: 'MEDIUM' });
    expect(at(8)).toMatchObject({ status: 'LOW_CONFIDENCE', positionConfidence: 'LOW' });
  });
});
