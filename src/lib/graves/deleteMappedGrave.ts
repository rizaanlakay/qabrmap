import type { SupabaseClient } from '@supabase/supabase-js';

export type DeleteGraveErrorCode = 'offline' | 'signed-out' | 'not-allowed' | 'not-found' | 'not-set-up' | 'unknown';

export const DELETE_OFFLINE_MESSAGE = "You're offline. Connect to the internet to delete this grave.";
export const DELETE_SIGNED_OUT_MESSAGE = 'Your session has ended. Sign in again to delete this grave.';
export const DELETE_NOT_SET_UP_MESSAGE = "Deleting graves isn't set up in the database yet.";
export const DELETE_UNKNOWN_MESSAGE = "The grave couldn't be deleted. Please try again.";

export class DeleteGraveError extends Error {
  readonly code: DeleteGraveErrorCode;

  constructor(code: DeleteGraveErrorCode, message: string) {
    super(message);
    this.name = 'DeleteGraveError';
    this.code = code;
  }
}

// supabase-js reports a dropped connection as an error whose message still contains the fetch failure
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed|network request failed/i;

export function mapDeleteGraveError(error: unknown): DeleteGraveError {
  if (error instanceof DeleteGraveError) return error;

  const details = error && typeof error === 'object' ? (error as { code?: unknown; message?: unknown }) : {};
  const code = typeof details.code === 'string' ? details.code : '';
  const message = typeof details.message === 'string' ? details.message : '';

  if (NETWORK_FAILURE.test(message)) return new DeleteGraveError('offline', DELETE_OFFLINE_MESSAGE);

  switch (code) {
    case '42501':
      return new DeleteGraveError('signed-out', DELETE_SIGNED_OUT_MESSAGE);
    // Not the creator (P0001), or other people have added to the grave (55000): the database says why
    case 'P0001':
    case '55000':
      return new DeleteGraveError('not-allowed', message || DELETE_UNKNOWN_MESSAGE);
    case 'P0002':
      return new DeleteGraveError('not-found', message || 'This grave no longer exists.');
    case 'PGRST202':
      return new DeleteGraveError('not-set-up', DELETE_NOT_SET_UP_MESSAGE);
    default:
      return new DeleteGraveError('unknown', DELETE_UNKNOWN_MESSAGE);
  }
}

// Passed in so the delete can be tested without Supabase
export interface DeleteMappedGraveDeps {
  client: Pick<SupabaseClient, 'rpc' | 'auth'>;
  isOnline: () => boolean;
  deletePhotos: (paths: string[]) => Promise<void>;
}

// Deletes a grave the signed-in user mapped, then removes its photo files from storage
export async function deleteMappedGrave(graveId: string, deps: DeleteMappedGraveDeps): Promise<void> {
  if (!deps.isOnline()) throw new DeleteGraveError('offline', DELETE_OFFLINE_MESSAGE);

  let paths: unknown;
  try {
    const { data: auth } = await deps.client.auth.getUser();
    if (!auth?.user) throw new DeleteGraveError('signed-out', DELETE_SIGNED_OUT_MESSAGE);

    const { data, error } = await deps.client.rpc('delete_mapped_grave', { p_grave_id: graveId });
    if (error) throw mapDeleteGraveError(error);
    paths = data;
  } catch (err) {
    throw mapDeleteGraveError(err);
  }

  const files = Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string' && path !== '') : [];
  // The grave is already gone, so a file left behind in storage isn't worth reporting as a failed delete
  if (files.length > 0) await deps.deletePhotos(files).catch(() => {});
}

// Graves still cached on this device that the cloud no longer has, for example after someone deleted them
export function staleGraveIds(cachedIds: string[], freshIds: string[]): string[] {
  const fresh = new Set(freshIds);
  return cachedIds.filter((id) => !fresh.has(id));
}
