import type { ConfidenceLevel, Grave, GraveStatus } from '@/types';

export interface VisitFix {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface VisitResult {
  latitude: number;
  longitude: number;
  positionAccuracyMeters: number;
  positionConfidence: ConfidenceLevel;
  status: GraveStatus;
  observationCount: number;
}

export const VISIT_FAILED_MESSAGE = "Your visit couldn't be recorded. Please try again.";
// Same limit as record_grave_visit in the database
export const MAX_VISIT_ACCURACY_M = 25;

const CONFIDENCE: ConfidenceLevel[] = ['HIGH', 'MEDIUM', 'LOW'];
const STATUSES: GraveStatus[] = ['MAPPED', 'LOW_CONFIDENCE', 'UNMAPPED', 'VERIFIED', 'DISPUTED'];

export function parseVisitResult(data: unknown): VisitResult | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  const accuracy = Number(row.position_accuracy_meters);
  const count = Number(row.observation_count);
  if (![latitude, longitude, accuracy, count].every(Number.isFinite)) return null;
  const confidence = CONFIDENCE.find((level) => level === row.position_confidence);
  const status = STATUSES.find((value) => value === row.status);
  if (!confidence || !status) return null;
  return { latitude, longitude, positionAccuracyMeters: accuracy, positionConfidence: confidence, status, observationCount: count };
}

export function applyVisitResult(grave: Grave, result: VisitResult): Grave {
  return {
    ...grave,
    latitude: result.latitude,
    longitude: result.longitude,
    positionAccuracyMeters: result.positionAccuracyMeters,
    positionConfidence: result.positionConfidence,
    status: result.status,
    observationCount: result.observationCount,
    updatedAt: new Date().toISOString(),
  };
}

export function describeVisit(grave: Grave): string {
  const visits = grave.observationCount ?? 1;
  return `Thanks. Position now ± ${grave.positionAccuracyMeters} m from ${visits} ${visits === 1 ? 'visit' : 'visits'}.`;
}

export function canConfirmVisit(fix: VisitFix | null): boolean {
  return fix !== null && fix.accuracy <= MAX_VISIT_ACCURACY_M;
}
