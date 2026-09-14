// Text engraved on the drawn gravestone shown while a grave has no photo yet

// Default photo value stored on graves that have never been photographed
export const PLACEHOLDER_PHOTO_PATH = '/sample-gravestone.svg';

// Room across the face of the drawn stone (viewBox units)
const STONE_TEXT_WIDTH = 280;
const MAX_NAME_LINES = 4;
const MAX_LINE_CHARS = 12;

export interface GravestoneInscription {
  graveNumber: string;
  nameLines: string[];
  nameFontSize: number;
  bornLine: string | null;
  diedLine: string | null;
}

export function hasRealGravePhoto(url: string | null | undefined): boolean {
  if (!url) return false;
  return !url.split('?')[0].endsWith(PLACEHOLDER_PHOTO_PATH);
}

// "1947-01-28" becomes "28-01-1947"; anything else is shown as given
export function formatStoneDate(date?: string | null): string | null {
  if (!date) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : date;
}

// Stack the name one or two words per line, the way names are carved, within the stone's four lines
export function wrapNameLines(fullName: string): string[] {
  const words = fullName.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last && `${last} ${word}`.length <= MAX_LINE_CHARS) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else {
      lines.push(word);
    }
  }
  if (lines.length <= MAX_NAME_LINES) return lines;
  return [...lines.slice(0, MAX_NAME_LINES - 1), lines.slice(MAX_NAME_LINES - 1).join(' ')];
}

// Shrink long names so the longest line still fits across the stone
export function nameFontSize(lines: string[]): number {
  const longest = Math.max(1, ...lines.map((line) => line.length));
  // Bold uppercase Inter with the stone's letter spacing takes roughly 0.72em per character
  return Math.max(18, Math.min(38, Math.floor(STONE_TEXT_WIDTH / (longest * 0.72))));
}

export function buildGravestoneInscription({
  graveNumber,
  fullName,
  birthDate,
  deathDate,
}: {
  graveNumber?: string | null;
  fullName?: string | null;
  birthDate?: string | null;
  deathDate?: string | null;
}): GravestoneInscription {
  const nameLines = fullName ? wrapNameLines(fullName) : [];
  const born = formatStoneDate(birthDate);
  const died = formatStoneDate(deathDate);
  return {
    graveNumber: graveNumber?.trim() || '',
    nameLines,
    nameFontSize: nameFontSize(nameLines),
    bornLine: born ? `B. ${born}` : null,
    diedLine: died ? `D. ${died}` : null,
  };
}

// Text baselines (viewBox units) for each part of the inscription
export interface InscriptionLayout {
  bismillahY: number;
  graveNumberY: number | null;
  nameYs: number[];
  dateYs: number[];
}

const STONE_CENTER_Y = 400;
const FIRST_BASELINE_MIN_Y = 225;
const LAST_BASELINE_MAX_Y = 705;
// Lets the visual middle of the lettering, rather than its baselines, sit on the centre line
const BASELINE_CENTERING_OFFSET = 12;

// Stack the inscription as one block centred on the stone. Photo frames are often wider than the drawing, which
// crops its top and bottom, so a centred block keeps the number, name and dates in view.
export function layoutInscription(inscription: GravestoneInscription): InscriptionLayout {
  let cursor = 0;
  let graveNumberY: number | null = null;
  if (inscription.graveNumber) {
    cursor += 55;
    graveNumberY = cursor;
  }
  const nameYs = inscription.nameLines.map((_, i) => {
    cursor += i === 0 ? 62 : Math.round(inscription.nameFontSize * 1.35);
    return cursor;
  });
  const dateCount = [inscription.bornLine, inscription.diedLine].filter(Boolean).length;
  const dateYs = Array.from({ length: dateCount }, (_, i) => {
    cursor += i === 0 ? 58 : 40;
    return cursor;
  });

  const centred = STONE_CENTER_Y - cursor / 2 + BASELINE_CENTERING_OFFSET;
  const offset = Math.min(Math.max(centred, FIRST_BASELINE_MIN_Y), LAST_BASELINE_MAX_Y - cursor);
  return {
    bismillahY: offset,
    graveNumberY: graveNumberY === null ? null : graveNumberY + offset,
    nameYs: nameYs.map((y) => y + offset),
    dateYs: dateYs.map((y) => y + offset),
  };
}
