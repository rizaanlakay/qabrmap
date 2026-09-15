import type { SupabaseClient } from '@supabase/supabase-js';
import type { DeviceTelemetry } from '@/types';
import type { NewGraveForm } from './newGrave';
import type { UploadPhotoOptions, UploadPhotoResult } from '../supabase/storage';
import {
  mapSaveGraveError,
  SaveGraveError,
  OFFLINE_MESSAGE,
  SIGNED_OUT_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
} from '../supabase/saveGraveErrors';

export interface SaveMappedGraveInput {
  form: NewGraveForm;
  cemeteryName?: string;
  photoDataUrl: string;
  telemetry: DeviceTelemetry;
}

// Passed in so the save can be tested without Supabase
export interface SaveMappedGraveDeps {
  client: Pick<SupabaseClient, 'rpc' | 'auth'>;
  isOnline: () => boolean;
  uploadPhoto: (options: UploadPhotoOptions) => Promise<UploadPhotoResult | null>;
  deletePhoto: (path: string) => Promise<boolean>;
  newId: () => string;
}

// Uploads the photo, then saves the person, grave and photo together. Resolves to the new grave's id.
export async function saveMappedGrave(input: SaveMappedGraveInput, deps: SaveMappedGraveDeps): Promise<string> {
  const { form, telemetry, photoDataUrl } = input;
  const context = { graveNumber: form.graveNumber.trim(), cemeteryName: input.cemeteryName };

  if (!deps.isOnline()) throw new SaveGraveError('offline', OFFLINE_MESSAGE);
  if (!photoDataUrl.startsWith('data:image/')) {
    throw new SaveGraveError('invalid', 'Take a photo of the grave with the camera.');
  }
  if (typeof telemetry.headingDegrees !== 'number') {
    throw new SaveGraveError('invalid', 'A compass heading is required.');
  }

  try {
    const { data } = await deps.client.auth.getUser();
    if (!data?.user) throw new SaveGraveError('signed-out', SIGNED_OUT_MESSAGE);
  } catch (err) {
    throw err instanceof SaveGraveError ? err : mapSaveGraveError(err, context);
  }

  const graveId = `grave_${deps.newId()}`;
  const personId = `person_${deps.newId()}`;

  let upload: UploadPhotoResult | null;
  try {
    upload = await deps.uploadPhoto({ file: photoDataUrl, cemeteryId: form.cemeteryId, graveId, upsert: false });
  } catch (err) {
    const mapped = mapSaveGraveError(err, context);
    throw mapped.code === 'offline' ? mapped : new SaveGraveError('upload-failed', UPLOAD_FAILED_MESSAGE);
  }
  if (!upload?.publicUrl || !upload.path) throw new SaveGraveError('upload-failed', UPLOAD_FAILED_MESSAGE);

  let saveError: unknown = null;
  try {
    const { error } = await deps.client.rpc('create_mapped_grave', {
      p_grave_id: graveId,
      p_person_id: personId,
      p_cemetery_id: form.cemeteryId,
      p_grave_number: form.graveNumber.trim(),
      p_first_name: form.firstName.trim(),
      p_middle_names: form.middleNames.trim() || null,
      p_surname: form.surname.trim(),
      p_nickname: form.nickname.trim() || null,
      p_birth_date: form.birthDate || null,
      p_death_date: form.deathDate || null,
      p_latitude: telemetry.latitude,
      p_longitude: telemetry.longitude,
      p_accuracy_meters: telemetry.gpsAccuracy,
      p_heading_degrees: telemetry.headingDegrees,
      p_captured_at: telemetry.timestamp,
      p_photo_public_url: upload.publicUrl,
      p_photo_storage_path: upload.path,
    });
    saveError = error;
  } catch (err) {
    saveError = err;
  }

  if (saveError) {
    // Don't leave a photo in storage that no grave points to
    const path = upload.path;
    await deps.deletePhoto(path).catch(() => false);
    throw mapSaveGraveError(saveError, context);
  }

  return graveId;
}
