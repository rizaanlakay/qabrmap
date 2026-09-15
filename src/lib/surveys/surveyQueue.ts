import type { CaptureSaveAttempt, Cemetery, DeviceTelemetry, Survey, SurveyCapture } from '@/types';
import { supabase, isSupabaseConfigured } from '../supabase/client';
import { deleteGravePhoto, uploadGravePhoto } from '../supabase/storage';
import { NOT_SET_UP_MESSAGE } from '../supabase/saveGraveErrors';
import { saveMappedGrave } from '../capture/saveMappedGrave';
import { findCemeteryForLocation } from '../capture/cemeteryForLocation';
import { StartSurveyInput, surveyStore } from './surveyStore';
import { createExclusiveRunner, createQueueWorker } from './queueWorker';
import { countCaptures, formFromReading, retryChanges, canRetry } from './queueRules';
import {
  CloudSurveySummary,
  ReadResult,
  SaveResult,
  cloudSyncDelayMs,
  mapCloudSurveyRow,
  readResultFromResponse,
  saveResultFromError,
  saveResultFromOutcome,
  surveySessionRow,
} from './queueAdapters';
import { blobToDataUrl, prepareCapturePhoto } from './capturePhoto';

// The app's survey queue: the worker from queueWorker.ts with the real network, storage and browser events

const PHOTO_MISSING = 'The photo is no longer stored on this phone.';

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine;

// Read from the stored session, so it works without signal
async function currentSession() {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

async function readPhoto(capture: SurveyCapture): Promise<ReadResult> {
  const session = await currentSession();
  if (!session?.access_token) return { kind: 'signed-out' };
  if (!capture.photo) return { kind: 'error', message: PHOTO_MISSING };

  let response: Response;
  try {
    response = await fetch('/api/graves/read-stone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ image: await blobToDataUrl(capture.photo) }),
    });
  } catch {
    return readResultFromResponse(0, null);
  }
  return readResultFromResponse(response.status, await response.json().catch(() => null));
}

async function saveCapture(capture: SurveyCapture, survey: Survey): Promise<SaveResult> {
  if (!isSupabaseConfigured || !supabase) return { kind: 'error', message: NOT_SET_UP_MESSAGE };
  if (!capture.photo || !capture.reading) return { kind: 'error', message: PHOTO_MISSING };
  try {
    const result = await saveMappedGrave(
      {
        form: formFromReading(capture.reading, survey.cemeteryId),
        cemeteryName: survey.cemeteryName,
        photoDataUrl: await blobToDataUrl(capture.photo),
        telemetry: capture.telemetry,
        attempt: capture.attempt,
        matchMode: 'auto',
      },
      { client: supabase, isOnline, uploadPhoto: uploadGravePhoto, deletePhoto: deleteGravePhoto }
    );
    return saveResultFromOutcome(result);
  } catch (err) {
    return saveResultFromError(err);
  }
}

let cloudSyncTimer: ReturnType<typeof setTimeout> | null = null;

export const surveyQueue = createQueueWorker({
  storage: surveyStore,
  readPhoto,
  saveCapture,
  getUserId: async () => (await currentSession())?.user.id ?? null,
  isOnline,
  now: () => Date.now(),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  runExclusive: createExclusiveRunner(typeof navigator !== 'undefined' ? navigator.locks : undefined),
  onChange: () => {
    // Counts change with every step, so the cloud copy is refreshed shortly after the steps settle
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(() => {
      cloudSyncTimer = null;
      void syncSurveysToCloud();
    }, 2000);
  },
  onError: (err) => console.warn('Survey queue stopped:', err),
});

let started = false;

// Called once the app has mounted. Each trigger only wakes the worker; the worker decides whether there is work.
export function startSurveyQueue(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => void surveyQueue.wake());
  window.addEventListener('offline', () => void surveyQueue.wake());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void surveyQueue.wake();
  });
  navigator.serviceWorker?.addEventListener('message', (event) => {
    if (event.data?.type === 'TRIGGER_BACKGROUND_SYNC') void surveyQueue.wake();
  });
  void surveyQueue.wake();
  void syncSurveysToCloud();
}

export async function isStoragePersisted(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}

// Asks the browser not to clear stored photos when space runs low
export async function beginSurvey(input: StartSurveyInput): Promise<{ survey: Survey; persisted: boolean }> {
  const survey = await surveyStore.startSurvey(input);
  let persisted = false;
  try {
    persisted = (await navigator.storage?.persist?.()) ?? false;
  } catch {
    persisted = false;
  }
  void syncSurveysToCloud();
  return { survey, persisted };
}

export async function endSurvey(surveyId: string): Promise<void> {
  await surveyStore.finishSurvey(surveyId);
  void syncSurveysToCloud();
}

export async function queueSurveyCapture(
  survey: Survey,
  photoDataUrl: string,
  telemetry: DeviceTelemetry,
  cemeteries: Cemetery[]
): Promise<SurveyCapture> {
  const { photo, thumbnail } = await prepareCapturePhoto(photoDataUrl);
  const insideBoundary = findCemeteryForLocation(cemeteries, telemetry.latitude, telemetry.longitude)?.id === survey.cemeteryId;
  const capture = await surveyStore.addCapture({ survey, photo, thumbnail, telemetry, insideBoundary });
  void surveyQueue.wake();
  return capture;
}

export async function retrySurveyCapture(capture: SurveyCapture): Promise<void> {
  if (!canRetry(capture)) return;
  await surveyStore.updateCapture(capture.id, retryChanges(capture));
  void surveyQueue.wake();
}

export async function discardSurveyCapture(captureId: string): Promise<void> {
  await surveyStore.deleteCapture(captureId);
}

// A capture saved from the Confirm screen during review
export async function markCaptureSaved(
  captureId: string,
  graveId: string,
  outcome: 'created' | 'added-photo',
  attempt: CaptureSaveAttempt
): Promise<void> {
  await surveyStore.updateCapture(captureId, {
    status: 'saved',
    graveId,
    outcome,
    attempt,
    photo: undefined,
    reviewReason: undefined,
    matchCandidate: undefined,
    lastError: undefined,
  });
  void syncSurveysToCloud();
}

// Keeps an uploaded photo on the capture after a failed review save, so the next try reuses it
export async function rememberCaptureAttempt(captureId: string, attempt: CaptureSaveAttempt): Promise<void> {
  await surveyStore.updateCapture(captureId, { attempt });
}

let pendingCloudSync: ReturnType<typeof setTimeout> | null = null;

// Writes each of the surveyor's surveys to survey_sessions when it is new, finished, or its counts changed
export async function syncSurveysToCloud(): Promise<void> {
  if (!isSupabaseConfigured || !supabase || !isOnline()) return;
  const session = await currentSession();
  if (!session) return;

  let soonest: number | null = null;
  for (const survey of await surveyStore.listSurveys(session.user.id)) {
    const counts = countCaptures(await surveyStore.listCaptures(survey.id));
    const delay = cloudSyncDelayMs(survey, counts, Date.now());
    if (delay === null) continue;
    if (delay > 0) {
      soonest = soonest === null ? delay : Math.min(soonest, delay);
      continue;
    }
    const { error } = await supabase.from('survey_sessions').upsert(surveySessionRow(survey, counts));
    if (!error) await surveyStore.updateSurvey(survey.id, { cloudSyncedAt: new Date().toISOString(), cloudCounts: counts });
  }

  if (soonest !== null && !pendingCloudSync) {
    pendingCloudSync = setTimeout(() => {
      pendingCloudSync = null;
      void syncSurveysToCloud();
    }, soonest);
  }
}

// Surveys recorded in the cloud, including those made on another phone
export async function listCloudSurveys(userId: string): Promise<CloudSurveySummary[]> {
  if (!isSupabaseConfigured || !supabase || !isOnline()) return [];
  const { data, error } = await supabase
    .from('survey_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(50);
  if (error || !Array.isArray(data)) return [];
  return data.map(mapCloudSurveyRow).filter((row): row is CloudSurveySummary => row !== null);
}
