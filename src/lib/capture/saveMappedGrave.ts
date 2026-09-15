import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConfidenceLevel, DeviceTelemetry, Grave, GraveStatus } from '@/types';
import type { NewGraveForm } from './newGrave';
import type { UploadPhotoOptions, UploadPhotoResult } from '../supabase/storage';
import { MatchCandidate, mapMatchCandidate } from '../graves/matchCandidate';
import {
  mapSaveGraveError,
  SaveGraveError,
  OFFLINE_MESSAGE,
  SIGNED_OUT_MESSAGE,
  UNKNOWN_SAVE_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
} from '../supabase/saveGraveErrors';

// One capture's ids and uploaded photo, kept across Save retries. If a response is lost after the database
// saved the grave, the retry sends the same ids (which the database treats as already saved) and reuses the photo.
export interface SaveAttempt {
  graveId: string;
  personId: string;
  upload?: UploadPhotoResult;
}

export function createSaveAttempt(newId: () => string = () => crypto.randomUUID()): SaveAttempt {
  return { graveId: `grave_${newId()}`, personId: `person_${newId()}` };
}

// ask: report a likely match instead of saving (Capture). auto: add the photo to a strong match (surveys).
// new: always create a grave, for example a son buried in his father's grave.
export type MatchMode = 'ask' | 'auto' | 'new';

export interface SaveMappedGraveInput {
  form: NewGraveForm;
  cemeteryName?: string;
  photoDataUrl: string;
  telemetry: DeviceTelemetry;
  attempt: SaveAttempt;
  matchMode: MatchMode;
  // Adds the photo to this grave instead of creating one
  addToGraveId?: string;
}

// Passed in so the save can be tested without Supabase
export interface SaveMappedGraveDeps {
  client: Pick<SupabaseClient, 'rpc' | 'auth'>;
  isOnline: () => boolean;
  uploadPhoto: (options: UploadPhotoOptions) => Promise<UploadPhotoResult | null>;
  deletePhoto: (path: string) => Promise<boolean>;
}

export interface SavedGraveResult {
  outcome: 'created' | 'added-photo';
  graveId: string;
  personId: string;
  photoUrl: string;
}

export interface MatchFoundResult {
  outcome: 'match-found';
  candidate: MatchCandidate;
}

export type SaveMappedGraveResult = SavedGraveResult | MatchFoundResult;

// Only an error the database itself returned proves nothing was saved. A dropped connection or a gateway
// timeout may have happened after the save committed.
function wasRejectedByDatabase(error: unknown, mapped: SaveGraveError): boolean {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && code !== '' && mapped.code !== 'offline';
}

type SaveOutcome = { outcome: 'created' | 'added-photo'; graveId: string } | MatchFoundResult;

function parseSaveOutcome(data: unknown): SaveOutcome | null {
  if (!data || typeof data !== 'object') return null;
  const answer = data as Record<string, unknown>;
  if (answer.outcome === 'match-found') {
    const candidate = mapMatchCandidate(answer.candidate);
    return candidate ? { outcome: 'match-found', candidate } : null;
  }
  if ((answer.outcome === 'created' || answer.outcome === 'added-photo') && typeof answer.grave_id === 'string') {
    return { outcome: answer.outcome, graveId: answer.grave_id };
  }
  return null;
}

// Uploads the photo, then saves the person, grave and photo together, or adds the photo to an existing grave
export async function saveMappedGrave(input: SaveMappedGraveInput, deps: SaveMappedGraveDeps): Promise<SaveMappedGraveResult> {
  const { form, telemetry, photoDataUrl, attempt } = input;
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

  if (!attempt.upload) {
    let upload: UploadPhotoResult | null;
    try {
      upload = await deps.uploadPhoto({ file: photoDataUrl, cemeteryId: form.cemeteryId, graveId: attempt.graveId, upsert: false });
    } catch (err) {
      const mapped = mapSaveGraveError(err, context);
      throw mapped.code === 'offline' ? mapped : new SaveGraveError('upload-failed', UPLOAD_FAILED_MESSAGE);
    }
    if (!upload?.publicUrl || !upload.path) throw new SaveGraveError('upload-failed', UPLOAD_FAILED_MESSAGE);
    attempt.upload = upload;
  }
  const upload = attempt.upload;

  let saveError: unknown = null;
  let answer: unknown = null;
  try {
    const { data, error } = await deps.client.rpc('save_or_add_grave', {
      p_grave_id: attempt.graveId,
      p_person_id: attempt.personId,
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
      p_match_mode: input.matchMode,
      p_add_to_grave_id: input.addToGraveId ?? null,
    });
    answer = data;
    saveError = error;
  } catch (err) {
    saveError = err;
  }

  if (saveError) {
    const mapped = mapSaveGraveError(saveError, context);
    if (wasRejectedByDatabase(saveError, mapped)) {
      // Nothing was saved, so don't leave a photo in storage that no grave points to
      attempt.upload = undefined;
      await deps.deletePhoto(upload.path).catch(() => false);
    }
    throw mapped;
  }

  const outcome = parseSaveOutcome(answer);
  // An answer that can't be read may still mean the grave was saved, so the photo is kept for a retry
  if (!outcome) throw new SaveGraveError('unknown', UNKNOWN_SAVE_MESSAGE);
  // Nothing was written; the uploaded photo stays on the attempt for whichever choice the user makes next
  if (outcome.outcome === 'match-found') return outcome;
  return { outcome: outcome.outcome, graveId: outcome.graveId, personId: attempt.personId, photoUrl: upload.publicUrl };
}

// The grave as the database stored it, for when it can't be read back straight after saving.
// Status and confidence use the same thresholds as save_or_add_grave.
export function buildSavedGrave(
  input: SaveMappedGraveInput,
  result: Pick<SavedGraveResult, 'graveId' | 'personId' | 'photoUrl'>,
  now: string
): Grave {
  const { form, telemetry } = input;
  const accuracy = telemetry.gpsAccuracy;
  const firstName = form.firstName.trim();
  const middleNames = form.middleNames.trim();
  const surname = form.surname.trim();
  const positionConfidence: ConfidenceLevel = accuracy <= 3.5 ? 'HIGH' : accuracy <= 6 ? 'MEDIUM' : 'LOW';
  const status: GraveStatus = accuracy <= 5 ? 'MAPPED' : 'LOW_CONFIDENCE';

  return {
    id: result.graveId,
    cemeteryId: form.cemeteryId,
    cemeteryName: input.cemeteryName,
    personId: result.personId,
    graveNumber: form.graveNumber.trim(),
    latitude: telemetry.latitude,
    longitude: telemetry.longitude,
    positionAccuracyMeters: accuracy,
    positionConfidence,
    orientationDegrees: telemetry.headingDegrees,
    status,
    primaryPhotoUrl: result.photoUrl,
    photoCount: 1,
    person: {
      id: result.personId,
      firstName,
      middleNames: middleNames || undefined,
      surname,
      fullName: [firstName, middleNames, surname].filter(Boolean).join(' '),
      nickname: form.nickname.trim() || undefined,
      birthDate: form.birthDate || undefined,
      deathDate: form.deathDate || undefined,
    },
    createdAt: now,
    updatedAt: now,
  };
}
