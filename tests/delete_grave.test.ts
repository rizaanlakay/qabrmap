import { describe, it, expect, vi } from 'vitest';
import {
  DELETE_OFFLINE_MESSAGE,
  DELETE_SIGNED_OUT_MESSAGE,
  DELETE_NOT_SET_UP_MESSAGE,
  DELETE_UNKNOWN_MESSAGE,
  DeleteMappedGraveDeps,
  deleteMappedGrave,
  mapDeleteGraveError,
  staleGraveIds,
} from '../src/lib/graves/deleteMappedGrave';
import { mapDbGrave } from '../src/lib/supabase/mappers';

const PHOTO_PATH = 'cem_mowbray/grave_1_1789465382106.jpg';

type RpcResult = { data: unknown; error: unknown };
type GetUserResult = { data: { user: { id: string } | null }; error: unknown };

function makeDeps(overrides: Partial<DeleteMappedGraveDeps> = {}) {
  // Loosely typed so tests can swap in failures with mockResolvedValueOnce
  const rpc = vi.fn(async (..._args: unknown[]): Promise<RpcResult> => ({ data: [PHOTO_PATH], error: null }));
  const getUser = vi.fn(async (): Promise<GetUserResult> => ({ data: { user: { id: 'user-1' } }, error: null }));
  const deletePhotos = vi.fn(async (_paths: string[]) => {});
  const deps: DeleteMappedGraveDeps = {
    client: { rpc, auth: { getUser } } as unknown as DeleteMappedGraveDeps['client'],
    isOnline: () => true,
    deletePhotos,
    ...overrides,
  };
  return { deps, rpc, getUser, deletePhotos };
}

describe('Delete Grave Error Tests', () => {
  it('treats network failures as offline', () => {
    expect(mapDeleteGraveError(new TypeError('Failed to fetch'))).toMatchObject({ code: 'offline', message: DELETE_OFFLINE_MESSAGE });
  });

  it('asks the user to sign in when there is no session', () => {
    expect(mapDeleteGraveError({ code: '42501', message: 'Sign in to delete a grave.' })).toMatchObject({
      code: 'signed-out',
      message: DELETE_SIGNED_OUT_MESSAGE,
    });
  });

  it("shows the database's reason when the delete isn't allowed", () => {
    expect(mapDeleteGraveError({ code: 'P0001', message: 'Only the person who mapped this grave can delete it.' })).toMatchObject({
      code: 'not-allowed',
      message: 'Only the person who mapped this grave can delete it.',
    });
    expect(
      mapDeleteGraveError({ code: '55000', message: "Other people have added to this grave, so it can't be deleted." })
    ).toMatchObject({ code: 'not-allowed', message: "Other people have added to this grave, so it can't be deleted." });
    expect(mapDeleteGraveError({ code: 'P0002', message: 'This grave no longer exists.' })).toMatchObject({
      code: 'not-found',
      message: 'This grave no longer exists.',
    });
  });

  it('explains when the migration has not been applied, and falls back to a general message', () => {
    expect(mapDeleteGraveError({ code: 'PGRST202' })).toMatchObject({ code: 'not-set-up', message: DELETE_NOT_SET_UP_MESSAGE });
    expect(mapDeleteGraveError({ code: 'XX000', message: 'boom' })).toMatchObject({ code: 'unknown', message: DELETE_UNKNOWN_MESSAGE });
  });
});

describe('Delete Mapped Grave Tests', () => {
  it('deletes the grave, then removes its photo files', async () => {
    const { deps, rpc, deletePhotos } = makeDeps();
    await expect(deleteMappedGrave('grave_1', deps)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('delete_mapped_grave', { p_grave_id: 'grave_1' });
    expect(deletePhotos).toHaveBeenCalledWith([PHOTO_PATH]);
  });

  it('skips the storage call when the grave had no photo files', async () => {
    const { deps, rpc, deletePhotos } = makeDeps();
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await deleteMappedGrave('grave_1', deps);
    expect(deletePhotos).not.toHaveBeenCalled();
  });

  it('still succeeds when a photo file could not be removed', async () => {
    const { deps } = makeDeps({ deletePhotos: vi.fn(async () => { throw new Error('storage down'); }) });
    await expect(deleteMappedGrave('grave_1', deps)).resolves.toBeUndefined();
  });

  it('stops before deleting when offline or signed out', async () => {
    const offline = makeDeps({ isOnline: () => false });
    await expect(deleteMappedGrave('grave_1', offline.deps)).rejects.toMatchObject({ code: 'offline' });
    expect(offline.rpc).not.toHaveBeenCalled();

    const signedOut = makeDeps();
    signedOut.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(deleteMappedGrave('grave_1', signedOut.deps)).rejects.toMatchObject({ code: 'signed-out' });
    expect(signedOut.rpc).not.toHaveBeenCalled();
  });

  it('keeps the photos when the database refuses the delete', async () => {
    const { deps, rpc, deletePhotos } = makeDeps();
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '55000', message: "Other people have added to this grave, so it can't be deleted." },
    });
    await expect(deleteMappedGrave('grave_1', deps)).rejects.toMatchObject({ code: 'not-allowed' });
    expect(deletePhotos).not.toHaveBeenCalled();
  });
});

describe('Grave Cache Tests', () => {
  it('finds cached graves that the cloud no longer has', () => {
    expect(staleGraveIds(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
    expect(staleGraveIds(['a'], ['a', 'z'])).toEqual([]);
  });

  it('keeps who mapped a grave', () => {
    const row = { id: 'grave_1', cemetery_id: 'cem_mowbray', grave_number: '', latitude: -33.9, longitude: 18.5 };
    expect(mapDbGrave({ ...row, created_by: 'user-1' }).createdBy).toBe('user-1');
    expect(mapDbGrave({ ...row, created_by: null }).createdBy).toBeUndefined();
  });
});
