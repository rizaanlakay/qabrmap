import { StoneReading, bearerToken, isStoneReading, parseStonePhoto } from './stoneReading';
import { StoneReadingError } from './readStone';
import { photoHash } from './photoHash';

// What /api/graves/read-stone does, with Supabase and OpenAI passed in so it can be tested.
// Server only, because photoHash uses node:crypto.

export const SIGN_IN_TO_READ_MESSAGE = 'Sign in to read a photo.';
export const READING_NOT_SET_UP_MESSAGE = "Reading photos isn't set up yet.";
export const READ_FAILED_MESSAGE = "The photo couldn't be read.";
export const NO_GRAVE_DETAILS_MESSAGE = 'No grave details were found in this photo.';
export const MODEL_BUSY_MESSAGE = 'Too many photos are being read right now.';
export const TOO_MANY_READS_MESSAGE = 'Too many photos read. Try again later.';

export interface BeginReadResponse {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

export interface ReadStoneDeps {
  isConfigured: boolean;
  readBody: () => Promise<unknown>;
  getUserId: (token: string) => Promise<string | null>;
  beginRead: (token: string, hash: string) => Promise<BeginReadResponse>;
  finishRead: (token: string, readId: string, reading: StoneReading) => Promise<void>;
  readPhoto: (dataUrl: string) => Promise<StoneReading>;
  isRateLimitError: (err: unknown) => boolean;
  logError: (message: string, err: unknown) => void;
}

export interface ReadStoneResult {
  status: number;
  body: { reading: StoneReading } | { error: string };
}

const failure = (status: number, error: string): ReadStoneResult => ({ status, body: { error } });

const answer = (reading: StoneReading): ReadStoneResult =>
  reading.hasGraveDetails ? { status: 200, body: { reading } } : failure(422, NO_GRAVE_DETAILS_MESSAGE);

export async function handleReadStone(authorization: string | null, deps: ReadStoneDeps): Promise<ReadStoneResult> {
  const token = bearerToken(authorization);
  if (!token) return failure(401, SIGN_IN_TO_READ_MESSAGE);
  if (!deps.isConfigured) return failure(503, READING_NOT_SET_UP_MESSAGE);
  if (!(await deps.getUserId(token))) return failure(401, SIGN_IN_TO_READ_MESSAGE);

  const photo = parseStonePhoto(await deps.readBody());
  if (!photo.ok) return failure(400, photo.error);

  // The database checks the limits and records the read before anything is paid for. If it can't, nothing is read.
  let begun: BeginReadResponse;
  try {
    begun = await deps.beginRead(token, photoHash(photo.dataUrl));
  } catch (err) {
    deps.logError('Starting a photo read failed:', err);
    return failure(502, READ_FAILED_MESSAGE);
  }
  if (begun.error) {
    if (begun.error.code === '53400') return failure(429, TOO_MANY_READS_MESSAGE);
    if (begun.error.code === '42501') return failure(401, SIGN_IN_TO_READ_MESSAGE);
    if (begun.error.code === 'PGRST202') return failure(503, READING_NOT_SET_UP_MESSAGE);
    deps.logError('Starting a photo read failed:', begun.error);
    return failure(502, READ_FAILED_MESSAGE);
  }

  const started = (begun.data && typeof begun.data === 'object' ? begun.data : {}) as { cached?: unknown; read_id?: unknown };
  if (started.cached !== undefined) {
    return isStoneReading(started.cached) ? answer(started.cached) : failure(502, READ_FAILED_MESSAGE);
  }
  if (typeof started.read_id !== 'string') {
    deps.logError('Starting a photo read returned no id:', begun.data);
    return failure(502, READ_FAILED_MESSAGE);
  }

  let reading: StoneReading;
  try {
    reading = await deps.readPhoto(photo.dataUrl);
  } catch (err) {
    if (err instanceof StoneReadingError) return failure(422, err.message);
    if (deps.isRateLimitError(err)) return failure(429, MODEL_BUSY_MESSAGE);
    deps.logError('Reading a grave photo failed:', err);
    return failure(502, READ_FAILED_MESSAGE);
  }

  // Stored even when the stone has no details, so sending the same photo again costs nothing
  try {
    await deps.finishRead(token, started.read_id, reading);
  } catch (err) {
    deps.logError('Storing a photo reading failed:', err);
  }
  return answer(reading);
}
