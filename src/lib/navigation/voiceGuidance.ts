// Deciding when the driving screen speaks and what it says. Pure: no audio, no GPS, no React, so a whole
// drive is a list of numbers in and sentences out.

// A leg longer than this earns a "continue on X for Y" when the driver joins it
export const HEADS_UP_MIN_STEP_M = 1500;
// The warning lands this long before the turn, held between a floor and a ceiling
export const WARNING_SECONDS = 30;
export const WARNING_MIN_M = 200;
export const WARNING_MAX_M = 800;
// The turn itself is called this long before the driver reaches it
export const TURN_SECONDS = 4;
export const TURN_MIN_M = 30;
export const TURN_MAX_M = 120;
export const ARRIVAL_M = 40;
// 50 km/h, used when the device reports no speed
export const DEFAULT_SPEED_MPS = 13.9;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const speedOr = (speedMps: number | null) =>
  speedMps !== null && Number.isFinite(speedMps) && speedMps > 0 ? speedMps : DEFAULT_SPEED_MPS;

export function warningDistanceMeters(speedMps: number | null): number {
  return clamp(speedOr(speedMps) * WARNING_SECONDS, WARNING_MIN_M, WARNING_MAX_M);
}

export function turnDistanceMeters(speedMps: number | null): number {
  return clamp(speedOr(speedMps) * TURN_SECONDS, TURN_MIN_M, TURN_MAX_M);
}

// Spoken distances round to numbers a driver can hear, not the 10 m steps the screen shows
export function speakDistance(meters: number): string {
  const safe = Math.max(0, meters);
  if (safe >= 1000) {
    const km = (Math.round(safe / 500) * 500) / 1000;
    return km === 1 ? '1 kilometre' : `${km} kilometres`;
  }
  if (safe >= 100) return `${Math.round(safe / 100) * 100} metres`;
  return `${Math.max(50, Math.round(safe / 50) * 50)} metres`;
}

const ABBREVIATIONS: Record<string, string> = {
  rd: 'Road',
  ave: 'Avenue',
  av: 'Avenue',
  dr: 'Drive',
  ln: 'Lane',
  cres: 'Crescent',
  blvd: 'Boulevard',
  hwy: 'Highway',
  pl: 'Place',
  sq: 'Square',
};

export function expandStreetName(text: string): string {
  const expanded = text.replace(/\b(Rd|Ave|Av|Dr|Ln|Cres|Blvd|Hwy|Pl|Sq)\b\.?/gi, (_match, word: string) =>
    ABBREVIATIONS[word.toLowerCase()]
  );
  // "St" is Street only at the end of a name; "St James Road" is a saint
  return expanded.replace(/\bSt\b\.?\s*$/i, 'Street');
}

import type { RouteStep } from '@/lib/geospatial';

export interface VoiceInput {
  steps: RouteStep[];
  // The leg being driven now. The maneuver being announced is the one after it.
  stepIndex: number;
  distanceToNextManeuverMeters: number;
  remainingMeters: number;
  speedMps: number | null;
  entranceName: string;
  // True while the driver is scrubbing turns with the pager, which must stay silent
  isPreviewing: boolean;
  hasArrived: boolean;
  // Bumped by the screen each time a new route replaces one the driver left. 0 for a drive's first route.
  rerouteCount: number;
}

export interface VoiceMemory {
  // Keys of what has already been spoken, as `${index}:${tier}`
  said: string[];
  rerouteCount: number;
}

export interface VoiceResult {
  phrase: string | null;
  memory: VoiceMemory;
}

export const emptyVoiceMemory = (): VoiceMemory => ({ said: [], rerouteCount: 0 });

const sentence = (text: string) => {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

// "Turn right onto X" reads as "..., then turn right onto X" when chained, but "N2" must keep its capitals
const lowerFirst = (text: string) => {
  const trimmed = text.trim();
  const firstWord = trimmed.split(' ')[0] ?? '';
  if (firstWord.length > 1 && firstWord === firstWord.toUpperCase()) return trimmed;
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
};

export function nextAnnouncement(input: VoiceInput, memory: VoiceMemory): VoiceResult {
  const { steps, stepIndex, distanceToNextManeuverMeters: toTurn, speedMps, isPreviewing, rerouteCount } = input;

  if (isPreviewing || steps.length === 0) return { phrase: null, memory };

  const said = new Set(memory.said);
  const finish = (phrase: string | null): VoiceResult => ({
    phrase,
    memory: { said: Array.from(said), rerouteCount },
  });

  const parts: string[] = [];
  if (!said.has('depart')) {
    said.add('depart');
    parts.push(sentence(expandStreetName(steps[0].instruction)));
  }

  const turnIndex = stepIndex + 1;
  const upcoming = steps[turnIndex];
  if (!upcoming) return finish(parts.length > 0 ? parts.join(' ') : null);

  const warnAt = warningDistanceMeters(speedMps);
  const turnAt = turnDistanceMeters(speedMps);
  const warnKey = `${turnIndex}:warning`;
  const turnKey = `${turnIndex}:turn`;

  const headsUpKey = `${stepIndex}:headsUp`;

  if (toTurn <= turnAt && !said.has(turnKey)) {
    // A tier that is already behind us is marked said rather than spoken late
    said.add(turnKey);
    said.add(warnKey);
    said.add(headsUpKey);
    parts.push(sentence(chainedTurn(steps, turnIndex, warnAt, said)));
  } else if (toTurn <= warnAt && !said.has(warnKey)) {
    said.add(warnKey);
    said.add(headsUpKey);
    parts.push(sentence(`In ${speakDistance(toTurn)}, ${lowerFirst(expandStreetName(upcoming.instruction))}`));
  } else if (
    !said.has(headsUpKey) &&
    toTurn > warnAt &&
    (steps[stepIndex]?.distanceMeters ?? 0) > HEADS_UP_MIN_STEP_M
  ) {
    said.add(headsUpKey);
    const road = expandStreetName(steps[stepIndex].streetName || '');
    parts.push(sentence(road ? `Continue on ${road} for ${speakDistance(toTurn)}` : `Continue for ${speakDistance(toTurn)}`));
  }

  return finish(parts.length > 0 ? parts.join(' ') : null);
}

// Two turns closer together than the warning distance are spoken as one sentence, and the second one's
// warning is marked said so it is not announced again from a standing start. Arrival is never chained onto,
// because the arrival line follows seconds later.
function chainedTurn(steps: RouteStep[], turnIndex: number, warnAt: number, said: Set<string>): string {
  const instruction = expandStreetName(steps[turnIndex].instruction);
  const following = steps[turnIndex + 1];
  const legAfter = steps[turnIndex].distanceMeters;
  if (!following || following.type === 'arrive' || legAfter >= warnAt) return instruction;
  said.add(`${turnIndex + 1}:warning`);
  return `${instruction}, then ${lowerFirst(expandStreetName(following.instruction))}`;
}
