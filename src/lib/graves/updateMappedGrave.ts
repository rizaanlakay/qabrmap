import type { SupabaseClient } from '@supabase/supabase-js';
import type { Grave } from '@/types';
import type { GraveEditForm } from './graveEditForm';

export type UpdateGraveErrorCode = 'offline' | 'signed-out' | 'not-allowed' | 'not-found' | 'invalid' | 'not-set-up' | 'unknown';

export const UPDATE_OFFLINE_MESSAGE = "You're offline. Connect to the internet to save your changes.";
export const UPDATE_SIGNED_OUT_MESSAGE = 'Your session has ended. Sign in again to edit this grave.';
export const UPDATE_NOT_SET_UP_MESSAGE = "Editing graves isn't set up in the database yet.";
export const UPDATE_UNKNOWN_MESSAGE = "Your changes couldn't be saved. Please try again.";

export class UpdateGraveError extends Error {
  readonly code: UpdateGraveErrorCode;

  constructor(code: UpdateGraveErrorCode, message: string) {
    super(message);
    this.name = 'UpdateGraveError';
    this.code = code;
  }
}

// supabase-js reports a dropped connection as an error whose message still contains the fetch failure
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed|network request failed/i;

export function mapUpdateGraveError(error: unknown): UpdateGraveError {
  if (error instanceof UpdateGraveError) return error;

  const details = error && typeof error === 'object' ? (error as { code?: unknown; message?: unknown }) : {};
  const code = typeof details.code === 'string' ? details.code : '';
  const message = typeof details.message === 'string' ? details.message : '';

  if (NETWORK_FAILURE.test(message)) return new UpdateGraveError('offline', UPDATE_OFFLINE_MESSAGE);

  switch (code) {
    case '42501':
      return new UpdateGraveError('signed-out', UPDATE_SIGNED_OUT_MESSAGE);
    // Not the person who mapped it (P0001), or the person record is shared (55000): the database says why
    case 'P0001':
    case '55000':
      return new UpdateGraveError('not-allowed', message || UPDATE_UNKNOWN_MESSAGE);
    case 'P0002':
      return new UpdateGraveError('not-found', message || 'This grave no longer exists.');
    // A missing name or dates the wrong way round; a date the database cannot read is 22007 or 22008
    case '22023':
      return new UpdateGraveError('invalid', message || UPDATE_UNKNOWN_MESSAGE);
    case '22007':
    case '22008':
      return new UpdateGraveError('invalid', 'One of the dates is not a real date.');
    case 'PGRST202':
      return new UpdateGraveError('not-set-up', UPDATE_NOT_SET_UP_MESSAGE);
    default:
      return new UpdateGraveError('unknown', UPDATE_UNKNOWN_MESSAGE);
  }
}

// Passed in so the update can be tested without Supabase
export interface UpdateMappedGraveDeps {
  client: Pick<SupabaseClient, 'rpc' | 'auth'>;
  isOnline: () => boolean;
}

// Saves corrected details for a grave the signed-in user mapped
export async function updateMappedGrave(graveId: string, form: GraveEditForm, deps: UpdateMappedGraveDeps): Promise<void> {
  if (!deps.isOnline()) throw new UpdateGraveError('offline', UPDATE_OFFLINE_MESSAGE);

  try {
    const { data: auth } = await deps.client.auth.getUser();
    if (!auth?.user) throw new UpdateGraveError('signed-out', UPDATE_SIGNED_OUT_MESSAGE);

    const { error } = await deps.client.rpc('update_mapped_grave', {
      p_grave_id: graveId,
      p_first_name: form.firstName.trim(),
      p_middle_names: form.middleNames.trim() || null,
      p_surname: form.surname.trim(),
      p_nickname: form.nickname.trim() || null,
      p_grave_number: form.graveNumber.trim(),
      p_birth_date: form.birthDate || null,
      p_death_date: form.deathDate || null,
    });
    if (error) throw mapUpdateGraveError(error);
  } catch (err) {
    throw mapUpdateGraveError(err);
  }
}

// The grave as it reads after the edit, for when it cannot be read back from the cloud on a weak connection
export function applyGraveEdit(grave: Grave, form: GraveEditForm, now: string): Grave {
  const firstName = form.firstName.trim();
  const middleNames = form.middleNames.trim();
  const surname = form.surname.trim();
  return {
    ...grave,
    graveNumber: form.graveNumber.trim(),
    updatedAt: now,
    person: {
      ...grave.person,
      id: grave.person?.id ?? grave.personId ?? '',
      firstName,
      middleNames,
      surname,
      fullName: [firstName, middleNames, surname].filter(Boolean).join(' '),
      nickname: form.nickname.trim() || undefined,
      birthDate: form.birthDate || undefined,
      deathDate: form.deathDate || undefined,
    },
  };
}
