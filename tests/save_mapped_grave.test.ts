import { describe, it, expect, vi } from 'vitest';
import type { DeviceTelemetry } from '../src/types';
import type { NewGraveForm } from '../src/lib/capture/newGrave';
import {
  mapSaveGraveError,
  SaveGraveError,
  OFFLINE_MESSAGE,
  SIGNED_OUT_MESSAGE,
  NOT_SET_UP_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
  UNKNOWN_SAVE_MESSAGE,
} from '../src/lib/supabase/saveGraveErrors';
import { saveMappedGrave, SaveMappedGraveDeps } from '../src/lib/capture/saveMappedGrave';

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

type RpcResult = { data: unknown; error: unknown };
type GetUserResult = { data: { user: { id: string } | null }; error: unknown };

function makeDeps(overrides: Partial<SaveMappedGraveDeps> = {}) {
  const ids = ['id1', 'id2'];
  // Loosely typed so tests can swap in failures with mockResolvedValueOnce
  const rpc = vi.fn(async (..._args: unknown[]): Promise<RpcResult> => ({ data: 'grave_id1', error: null }));
  const getUser = vi.fn(async (): Promise<GetUserResult> => ({ data: { user: { id: 'user-1' } }, error: null }));
  const deps: SaveMappedGraveDeps = {
    client: { rpc, auth: { getUser } } as unknown as SaveMappedGraveDeps['client'],
    isOnline: () => true,
    uploadPhoto: vi.fn(async () => ({
      publicUrl: 'https://x.supabase.co/grave-photos/cem_athlone/grave_id1.jpg',
      path: 'cem_athlone/grave_id1.jpg',
    })),
    deletePhoto: vi.fn(async () => true),
    newId: () => ids.shift() ?? 'extra',
    ...overrides,
  };
  return { deps, rpc, getUser };
}

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
  it('uploads the photo, then saves the grave with trimmed details', async () => {
    const { deps, rpc } = makeDeps();
    await expect(
      saveMappedGrave({ form, cemeteryName: 'Athlone Muslim Cemetery', photoDataUrl: PHOTO, telemetry }, deps)
    ).resolves.toBe('grave_id1');

    expect(deps.uploadPhoto).toHaveBeenCalledWith({ file: PHOTO, cemeteryId: 'cem_athlone', graveId: 'grave_id1', upsert: false });
    expect(rpc).toHaveBeenCalledWith('create_mapped_grave', {
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
      p_photo_public_url: 'https://x.supabase.co/grave-photos/cem_athlone/grave_id1.jpg',
      p_photo_storage_path: 'cem_athlone/grave_id1.jpg',
    });
    expect(deps.deletePhoto).not.toHaveBeenCalled();
  });

  it('stops before uploading when offline', async () => {
    const { deps } = makeDeps({ isOnline: () => false });
    await expect(saveMappedGrave({ form, photoDataUrl: PHOTO, telemetry }, deps)).rejects.toMatchObject({ code: 'offline' });
    expect(deps.uploadPhoto).not.toHaveBeenCalled();
  });

  it('stops when nobody is signed in', async () => {
    const { deps, getUser } = makeDeps();
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(saveMappedGrave({ form, photoDataUrl: PHOTO, telemetry }, deps)).rejects.toMatchObject({ code: 'signed-out' });
    expect(deps.uploadPhoto).not.toHaveBeenCalled();
  });

  it('only accepts a photo from the camera with a heading', async () => {
    const { deps } = makeDeps();
    await expect(saveMappedGrave({ form, photoDataUrl: '/sample-gravestone.svg', telemetry }, deps)).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(
      saveMappedGrave({ form, photoDataUrl: PHOTO, telemetry: { ...telemetry, headingDegrees: undefined } }, deps)
    ).rejects.toMatchObject({ code: 'invalid' });
    expect(deps.uploadPhoto).not.toHaveBeenCalled();
  });

  it('reports an upload failure, or offline when the upload lost the connection', async () => {
    const failing = makeDeps({
      uploadPhoto: vi.fn(async () => {
        throw new Error('storage exploded');
      }),
    });
    await expect(saveMappedGrave({ form, photoDataUrl: PHOTO, telemetry }, failing.deps)).rejects.toMatchObject({
      code: 'upload-failed',
      message: UPLOAD_FAILED_MESSAGE,
    });
    expect(failing.rpc).not.toHaveBeenCalled();

    const dropped = makeDeps({
      uploadPhoto: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    await expect(saveMappedGrave({ form, photoDataUrl: PHOTO, telemetry }, dropped.deps)).rejects.toMatchObject({ code: 'offline' });
  });

  it('removes the uploaded photo when the grave cannot be saved', async () => {
    const { deps, rpc } = makeDeps();
    rpc.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key' } });
    await expect(
      saveMappedGrave({ form, cemeteryName: 'Athlone Muslim Cemetery', photoDataUrl: PHOTO, telemetry }, deps)
    ).rejects.toMatchObject({ code: 'duplicate', message: 'Grave 1402 is already mapped at Athlone Muslim Cemetery.' });
    expect(deps.deletePhoto).toHaveBeenCalledWith('cem_athlone/grave_id1.jpg');
  });
});
