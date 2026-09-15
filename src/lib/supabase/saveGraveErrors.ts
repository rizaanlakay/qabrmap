export type SaveGraveErrorCode =
  | 'offline'
  | 'signed-out'
  | 'duplicate'
  | 'invalid'
  | 'not-set-up'
  | 'upload-failed'
  | 'unknown';

export const OFFLINE_MESSAGE = "You're offline. Connect to the internet and tap Save again.";
export const SIGNED_OUT_MESSAGE = 'Your session has ended. Sign in and tap Save again.';
export const NOT_SET_UP_MESSAGE = "Saving graves isn't set up in the database yet.";
export const UPLOAD_FAILED_MESSAGE = "The photo couldn't be uploaded. Please try again.";
export const UNKNOWN_SAVE_MESSAGE = "The grave couldn't be saved. Please try again.";

export class SaveGraveError extends Error {
  readonly code: SaveGraveErrorCode;

  constructor(code: SaveGraveErrorCode, message: string) {
    super(message);
    this.name = 'SaveGraveError';
    this.code = code;
  }
}

export interface SaveGraveErrorContext {
  graveNumber?: string;
  cemeteryName?: string;
}

// supabase-js reports a dropped connection as an error whose message still contains the fetch failure
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed|network request failed/i;

// Turns a Postgres, PostgREST or network error from saving a grave into something the user can act on
export function mapSaveGraveError(error: unknown, context: SaveGraveErrorContext = {}): SaveGraveError {
  if (error instanceof SaveGraveError) return error;

  const details = error && typeof error === 'object' ? (error as { code?: unknown; message?: unknown }) : {};
  const code = typeof details.code === 'string' ? details.code : '';
  const message = typeof details.message === 'string' ? details.message : '';

  if (NETWORK_FAILURE.test(message)) return new SaveGraveError('offline', OFFLINE_MESSAGE);

  switch (code) {
    case '42501':
      return new SaveGraveError('signed-out', SIGNED_OUT_MESSAGE);
    case '23505':
      return new SaveGraveError(
        'duplicate',
        context.graveNumber && context.cemeteryName
          ? `Grave ${context.graveNumber} is already mapped at ${context.cemeteryName}.`
          : 'This grave is already mapped.'
      );
    case '22023':
      return new SaveGraveError('invalid', message || UNKNOWN_SAVE_MESSAGE);
    case 'PGRST202':
      return new SaveGraveError('not-set-up', NOT_SET_UP_MESSAGE);
    default:
      return new SaveGraveError('unknown', UNKNOWN_SAVE_MESSAGE);
  }
}
