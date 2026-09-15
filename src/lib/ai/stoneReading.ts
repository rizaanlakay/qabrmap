import type { AIStructuredExtraction } from '@/types';

// Reading grave photos: the model, what it must return, and how its answer fills the Confirm screen.
// Shared by the server route and the browser, so nothing here imports the OpenAI SDK.

export const STONE_READING_MODEL = 'gpt-5.6-luna';

// A photo shrunk to 1600 px is well under 1 MB; this only stops an oversized upload reaching the model
export const MAX_STONE_PHOTO_CHARS = 8_000_000;

export interface StoneReading {
  hasGraveDetails: boolean;
  firstName: string | null;
  middleNames: string[];
  surname: string | null;
  nickname: string | null;
  graveNumber: string | null;
  birthDate: string | null;
  deathDate: string | null;
  datesAsWritten: string | null;
  transcript: string;
  confidence: { name: number; graveNumber: number; dates: number };
  notes: string[];
}

const nullableText = (description: string) => ({ type: ['string', 'null'], description });

export const STONE_READING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'hasGraveDetails',
    'firstName',
    'middleNames',
    'surname',
    'nickname',
    'graveNumber',
    'birthDate',
    'deathDate',
    'datesAsWritten',
    'transcript',
    'confidence',
    'notes',
  ],
  properties: {
    hasGraveDetails: {
      type: 'boolean',
      description: 'True when the photo shows written details of a grave: a gravestone, plaque, board or a handwritten note.',
    },
    firstName: nullableText('Given name as written, without titles.'),
    middleNames: {
      type: 'array',
      items: { type: 'string' },
      description: 'Names between the first name and the surname, in order.',
    },
    surname: nullableText('Family name as written.'),
    nickname: nullableText('Only a name written as a nickname or after "known as".'),
    graveNumber: nullableText('Grave, plot or row number written on the marker. Never 786.'),
    birthDate: nullableText('Gregorian date of birth as YYYY-MM-DD, only when day, month and year are all written.'),
    deathDate: nullableText('Gregorian date of death as YYYY-MM-DD, only when day, month and year are all written.'),
    datesAsWritten: nullableText('Every date exactly as written, including Hijri dates.'),
    transcript: {
      type: 'string',
      description: 'Every line of text as written, top to bottom. Arabic in Arabic script.',
    },
    confidence: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'graveNumber', 'dates'],
      description: 'How sure you are of each group, from 0 to 1. Use 0 for a group you left empty.',
      properties: {
        name: { type: 'number' },
        graveNumber: { type: 'number' },
        dates: { type: 'number' },
      },
    },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Titles such as Hajji or Moulana, relationships such as "beloved father", and anything you could not place.',
    },
  },
} as const;

export const STONE_READING_INSTRUCTIONS = [
  'You read photos of grave markers from Muslim cemeteries in Cape Town, South Africa, and fill in the grave details.',
  'The photo may show an engraved or painted gravestone, a plaque, a wooden board, or a handwritten note of the details. Stones are often weathered and may mix English, Afrikaans and Arabic.',
  'Only record what is written. Leave a field null, or a list empty, when you cannot read it. Never guess or invent a name, number or date.',
  '786 at the top of a marker is the abjad number for Bismillah. It is not a grave number and not part of a date.',
  "Arabic phrases such as Bismillah, Inna lillahi wa inna ilayhi raji'un or Allah yarhamhu are not names. Keep them in the transcript only.",
  'Dates may follow Born or Died, Gebore or Oorlede, Wafaat or Intiqaal, or appear as two dates joined by TO or a dash, with months as numbers or names such as FEB or Februarie. When two dates are joined like that, the first is the date of birth and the second the date of death.',
  'Write birthDate and deathDate as YYYY-MM-DD only for Gregorian dates with a day, month and year. Keep Hijri dates and partial dates in datesAsWritten.',
  'Keep titles such as Hajji, Hajjah, Moulana, Imam and Sheikh out of the name fields and put them in notes.',
  'The surname is the family name. Names between the first name and the surname are middle names. Keep the spelling exactly as written, in normal capitalisation.',
].join('\n');

const text = (value: string | null) => value?.trim() ?? '';

const clamp = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

// A YYYY-MM-DD string that is a real calendar date, or undefined
function calendarDate(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? value
    : undefined;
}

export function stoneReadingToExtraction(reading: StoneReading): AIStructuredExtraction {
  const firstName = text(reading.firstName);
  const surname = text(reading.surname);
  const middleNames = reading.middleNames.map((name) => name.trim()).filter(Boolean);
  const graveNumber = text(reading.graveNumber);
  const birthDate = calendarDate(reading.birthDate);
  const deathDate = calendarDate(reading.deathDate);

  // A field that ended up empty scores 0, whatever the model said
  const fieldConfidences = {
    graveNumber: graveNumber ? clamp(reading.confidence.graveNumber) : 0,
    fullName: firstName || surname ? clamp(reading.confidence.name) : 0,
    dates: birthDate || deathDate ? clamp(reading.confidence.dates) : 0,
  };

  const otherText = reading.notes.map((note) => note.trim()).filter(Boolean);
  const datesAsWritten = text(reading.datesAsWritten);
  if (datesAsWritten && !(birthDate && deathDate)) otherText.push(`Dates as written: ${datesAsWritten}`);

  return {
    graveNumber,
    firstName,
    middleNames,
    surname,
    nickname: text(reading.nickname),
    fullName: [firstName, ...middleNames, surname].filter(Boolean).join(' '),
    birthDate,
    deathDate,
    confidence: (fieldConfidences.graveNumber + fieldConfidences.fullName + fieldConfidences.dates) / 3,
    rawOcrText: reading.transcript,
    otherText,
    fieldConfidences,
  };
}

const isNullableString = (value: unknown) => value === null || typeof value === 'string';
const isStringList = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === 'string');

// Checks a parsed answer really has the reading's shape before anything uses it
export function isStoneReading(value: unknown): value is StoneReading {
  if (!value || typeof value !== 'object') return false;
  const reading = value as Record<string, unknown>;
  const confidence = reading.confidence;
  return (
    typeof reading.hasGraveDetails === 'boolean' &&
    isNullableString(reading.firstName) &&
    isStringList(reading.middleNames) &&
    isNullableString(reading.surname) &&
    isNullableString(reading.nickname) &&
    isNullableString(reading.graveNumber) &&
    isNullableString(reading.birthDate) &&
    isNullableString(reading.deathDate) &&
    isNullableString(reading.datesAsWritten) &&
    typeof reading.transcript === 'string' &&
    Boolean(confidence) &&
    typeof confidence === 'object' &&
    ['name', 'graveNumber', 'dates'].every(
      (key) => typeof (confidence as Record<string, unknown>)[key] === 'number'
    ) &&
    isStringList(reading.notes)
  );
}

export function bearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

const PHOTO_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export type StonePhotoResult = { ok: true; dataUrl: string } | { ok: false; error: string };

export function parseStonePhoto(body: unknown): StonePhotoResult {
  const image = body && typeof body === 'object' ? (body as { image?: unknown }).image : undefined;
  if (typeof image !== 'string') return { ok: false, error: 'Send the photo as a data URL.' };
  if (image.length > MAX_STONE_PHOTO_CHARS) return { ok: false, error: 'The photo is too large.' };
  if (!PHOTO_DATA_URL.test(image)) return { ok: false, error: 'Send a JPEG, PNG or WebP photo.' };
  return { ok: true, dataUrl: image };
}
