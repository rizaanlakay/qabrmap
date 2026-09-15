import type { SupabaseClient } from '@supabase/supabase-js';
import type { DeviceTelemetry } from '@/types';
import type { NewGraveForm } from '../capture/newGrave';

export type MatchStrength = 'strong' | 'possible';

// A grave already mapped that may be the person being saved
export interface MatchCandidate {
  graveId: string;
  fullName: string;
  birthDate?: string;
  deathDate?: string;
  graveNumber: string;
  distanceMeters: number;
  match: MatchStrength;
}

// The parameters of find_matching_graves
export interface MatchCheckParams {
  p_cemetery_id: string;
  p_latitude: number;
  p_longitude: number;
  p_accuracy_meters: number;
  p_first_name: string;
  p_surname: string;
  p_birth_date: string | null;
  p_death_date: string | null;
  p_grave_number: string;
}

// Null until there is something to compare: a cemetery, a first name and a surname
export function matchCheckParams(form: NewGraveForm, telemetry: DeviceTelemetry): MatchCheckParams | null {
  const firstName = form.firstName.trim();
  const surname = form.surname.trim();
  if (!form.cemeteryId || !firstName || !surname) return null;
  return {
    p_cemetery_id: form.cemeteryId,
    p_latitude: telemetry.latitude,
    p_longitude: telemetry.longitude,
    p_accuracy_meters: telemetry.gpsAccuracy,
    p_first_name: firstName,
    p_surname: surname,
    p_birth_date: form.birthDate || null,
    p_death_date: form.deathDate || null,
    p_grave_number: form.graveNumber.trim(),
  };
}

const optionalText = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

// Accepts a find_matching_graves row or the candidate returned by save_or_add_grave
export function mapMatchCandidate(row: unknown): MatchCandidate | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.grave_id !== 'string' || typeof r.full_name !== 'string') return null;
  const distance = Number(r.distance_meters);
  return {
    graveId: r.grave_id,
    fullName: r.full_name,
    birthDate: optionalText(r.birth_date),
    deathDate: optionalText(r.death_date),
    graveNumber: typeof r.grave_number === 'string' ? r.grave_number : '',
    distanceMeters: Number.isFinite(distance) ? distance : 0,
    match: r.match === 'strong' ? 'strong' : 'possible',
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "1952-02-02" as "2 Feb 1952", without depending on the phone's locale or time zone
export function formatShortDate(isoDate: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  const month = parts ? MONTHS[Number(parts[2]) - 1] : undefined;
  if (!parts || !month) return isoDate;
  return `${Number(parts[3])} ${month} ${parts[1]}`;
}

// Both dates are always shown, so a person can tell a father and son with the same name apart
export function describeMatchCandidate(candidate: MatchCandidate): string {
  const parts = [candidate.fullName];
  if (candidate.birthDate) parts.push(`born ${formatShortDate(candidate.birthDate)}`);
  if (candidate.deathDate) parts.push(`died ${formatShortDate(candidate.deathDate)}`);
  if (candidate.graveNumber) parts.push(`grave ${candidate.graveNumber}`);
  parts.push(`${Math.round(candidate.distanceMeters)} m away`);
  return parts.join(', ');
}

// A possible match had no dates to compare, so it is worded as a question
export function matchHeading(candidate: MatchCandidate): string {
  return candidate.match === 'strong' ? 'Already mapped nearby' : 'This person may already be mapped nearby';
}

// Only a hint for the Confirm screen: save_or_add_grave checks again, so a failed check shows no card
export async function findMatchingGraves(
  client: Pick<SupabaseClient, 'rpc'>,
  params: MatchCheckParams
): Promise<MatchCandidate[]> {
  try {
    const { data, error } = await client.rpc('find_matching_graves', params);
    if (error || !Array.isArray(data)) return [];
    return data.map(mapMatchCandidate).filter((candidate): candidate is MatchCandidate => candidate !== null);
  } catch {
    return [];
  }
}
