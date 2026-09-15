import type { AIStructuredExtraction, Survey, SurveyCounts, SurveyStatus } from '@/types';
import type { SaveMappedGraveResult } from '../capture/saveMappedGrave';
import type { MatchCandidate } from '../graves/matchCandidate';
import { isStoneReading, stoneReadingToExtraction } from '../ai/stoneReading';
import { mapSaveGraveError } from '../supabase/saveGraveErrors';

// Turns network answers into the few results the survey queue acts on

export type ReadResult =
  | { kind: 'reading'; reading: AIStructuredExtraction }
  | { kind: 'offline' }
  | { kind: 'rate-limited' }
  | { kind: 'signed-out' }
  | { kind: 'unreadable'; message: string }
  | { kind: 'error'; message: string };

const READ_FAILED = "The photo couldn't be read.";

function errorText(body: unknown): string | undefined {
  const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  return typeof error === 'string' ? error : undefined;
}

// Status 0 means no answer arrived, so the read may never have reached the server
export function readResultFromResponse(status: number, body: unknown): ReadResult {
  if (status === 0) return { kind: 'offline' };
  if (status === 200) {
    const reading = body && typeof body === 'object' ? (body as { reading?: unknown }).reading : undefined;
    return isStoneReading(reading) ? { kind: 'reading', reading: stoneReadingToExtraction(reading) } : { kind: 'error', message: READ_FAILED };
  }
  if (status === 401) return { kind: 'signed-out' };
  if (status === 429) return { kind: 'rate-limited' };
  if (status === 422) return { kind: 'unreadable', message: errorText(body) ?? 'No grave details were found in this photo.' };
  return { kind: 'error', message: errorText(body) ?? READ_FAILED };
}

export type SaveResult =
  | { kind: 'created' | 'added-photo'; graveId: string }
  | { kind: 'match-found'; candidate: MatchCandidate }
  | { kind: 'offline' }
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string };

export function saveResultFromOutcome(result: SaveMappedGraveResult): SaveResult {
  if (result.outcome === 'match-found') return { kind: 'match-found', candidate: result.candidate };
  return { kind: result.outcome, graveId: result.graveId };
}

export function saveResultFromError(err: unknown): SaveResult {
  const mapped = mapSaveGraveError(err);
  if (mapped.code === 'offline') return { kind: 'offline' };
  if (mapped.code === 'signed-out') return { kind: 'signed-out' };
  return { kind: 'error', message: mapped.message };
}

export const CLOUD_SYNC_INTERVAL_MS = 60_000;

const sameCounts = (a: SurveyCounts | undefined, b: SurveyCounts) =>
  Boolean(a) && a!.captured === b.captured && a!.saved === b.saved && a!.pending === b.pending && a!.review === b.review;

// A new or finished survey is written at once; changing counts at most once a minute
export function cloudSyncDelayMs(survey: Survey, counts: SurveyCounts, now: number): number | null {
  if (!survey.cloudSyncedAt) return 0;
  if (survey.completedAt && survey.cloudSyncedAt < survey.completedAt) return 0;
  if (sameCounts(survey.cloudCounts, counts)) return null;
  return Math.max(0, Date.parse(survey.cloudSyncedAt) + CLOUD_SYNC_INTERVAL_MS - now);
}

export interface SurveySessionRow {
  id: string;
  user_id: string;
  cemetery_id: string;
  cemetery_name: string;
  section_code: string | null;
  started_at: string;
  completed_at: string | null;
  status: SurveyStatus;
  captured_count: number;
  processed_count: number;
  pending_count: number;
  review_count: number;
}

export function surveySessionRow(survey: Survey, counts: SurveyCounts): SurveySessionRow {
  return {
    id: survey.id,
    user_id: survey.userId,
    cemetery_id: survey.cemeteryId,
    cemetery_name: survey.cemeteryName,
    section_code: survey.sectionNote || null,
    started_at: survey.startedAt,
    completed_at: survey.completedAt ?? null,
    status: survey.status,
    captured_count: counts.captured,
    processed_count: counts.saved,
    pending_count: counts.pending,
    review_count: counts.review,
  };
}

// A survey recorded in the cloud, for listing surveys made on another phone
export interface CloudSurveySummary {
  id: string;
  cemeteryName: string;
  sectionNote: string;
  startedAt: string;
  completedAt?: string;
  status: SurveyStatus;
  counts: SurveyCounts;
}

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export function mapCloudSurveyRow(row: unknown): CloudSurveySummary | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.cemetery_name !== 'string' || typeof r.started_at !== 'string') return null;
  return {
    id: r.id,
    cemeteryName: r.cemetery_name,
    sectionNote: typeof r.section_code === 'string' ? r.section_code : '',
    startedAt: r.started_at,
    completedAt: typeof r.completed_at === 'string' ? r.completed_at : undefined,
    // PAUSED is an old status this app no longer writes; it reads as active
    status: r.status === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE',
    counts: {
      captured: count(r.captured_count),
      saved: count(r.processed_count),
      pending: count(r.pending_count),
      review: count(r.review_count),
    },
  };
}
