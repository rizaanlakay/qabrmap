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
