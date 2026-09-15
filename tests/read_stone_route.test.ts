import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { StoneReading } from '../src/lib/ai/stoneReading';
import { StoneReadingError } from '../src/lib/ai/readStone';
import { photoHash } from '../src/lib/ai/photoHash';
import {
  BeginReadResponse,
  MODEL_BUSY_MESSAGE,
  NO_GRAVE_DETAILS_MESSAGE,
  READ_FAILED_MESSAGE,
  READING_NOT_SET_UP_MESSAGE,
  SIGN_IN_TO_READ_MESSAGE,
  TOO_MANY_READS_MESSAGE,
  handleReadStone,
} from '../src/lib/ai/readStoneRequest';

const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PHOTO = `data:image/jpeg;base64,${BYTES.toString('base64')}`;
const HASH = createHash('sha256').update(BYTES).digest('hex');
const AUTH = 'Bearer token-1';

const yusuf: StoneReading = {
  hasGraveDetails: true,
  firstName: 'Yusuf',
  middleNames: [],
  surname: 'Kamish',
  nickname: null,
  graveNumber: null,
  birthDate: '1952-02-02',
  deathDate: '2018-06-16',
  datesAsWritten: '02-FEB-1952 TO 16-JUN-2018',
  transcript: 'YUSUF KAMISH',
  confidence: { name: 0.95, graveNumber: 0, dates: 0.95 },
  notes: [],
};

class FakeRateLimitError extends Error {}

function makeDeps() {
  return {
    isConfigured: true,
    readBody: vi.fn(async (): Promise<unknown> => ({ image: PHOTO })),
    getUserId: vi.fn(async (_token: string): Promise<string | null> => 'user-1'),
    beginRead: vi.fn(async (_token: string, _hash: string): Promise<BeginReadResponse> => ({ data: { read_id: 'read-1' }, error: null })),
    finishRead: vi.fn(async (_token: string, _readId: string, _reading: StoneReading): Promise<void> => {}),
    readPhoto: vi.fn(async (_dataUrl: string): Promise<StoneReading> => yusuf),
    isRateLimitError: (err: unknown) => err instanceof FakeRateLimitError,
    logError: vi.fn(),
  };
}

describe('Photo Hash Tests', () => {
  it('hashes the image bytes, so the same photo is recognised whatever its data URL header says', () => {
    expect(photoHash(PHOTO)).toBe(HASH);
    expect(photoHash(`data:image/png;base64,${BYTES.toString('base64')}`)).toBe(HASH);
    expect(photoHash(PHOTO)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Read Stone Route Tests', () => {
  it('asks for sign-in without a bearer token and does nothing else', async () => {
    const deps = makeDeps();
    await expect(handleReadStone(null, deps)).resolves.toEqual({ status: 401, body: { error: SIGN_IN_TO_READ_MESSAGE } });
    expect(deps.getUserId).not.toHaveBeenCalled();
    expect(deps.readBody).not.toHaveBeenCalled();
  });

  it('reports when reading is not set up', async () => {
    const deps = { ...makeDeps(), isConfigured: false };
    await expect(handleReadStone(AUTH, deps)).resolves.toEqual({ status: 503, body: { error: READING_NOT_SET_UP_MESSAGE } });
  });

  it('refuses an invalid session before reading the body', async () => {
    const deps = makeDeps();
    deps.getUserId.mockResolvedValueOnce(null);
    await expect(handleReadStone(AUTH, deps)).resolves.toMatchObject({ status: 401 });
    expect(deps.readBody).not.toHaveBeenCalled();
    expect(deps.beginRead).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a photo', async () => {
    const deps = makeDeps();
    deps.readBody.mockResolvedValueOnce({ image: 'https://example.com/stone.jpg' });
    await expect(handleReadStone(AUTH, deps)).resolves.toMatchObject({ status: 400 });
    expect(deps.beginRead).not.toHaveBeenCalled();
  });

  it('records the read, reads the photo and stores the reading', async () => {
    const deps = makeDeps();
    await expect(handleReadStone(AUTH, deps)).resolves.toEqual({ status: 200, body: { reading: yusuf } });
    expect(deps.getUserId).toHaveBeenCalledWith('token-1');
    expect(deps.beginRead).toHaveBeenCalledWith('token-1', HASH);
    expect(deps.readPhoto).toHaveBeenCalledWith(PHOTO);
    expect(deps.finishRead).toHaveBeenCalledWith('token-1', 'read-1', yusuf);
  });

  it('answers a photo read before from the cache without calling the model', async () => {
    const deps = makeDeps();
    deps.beginRead.mockResolvedValueOnce({ data: { cached: yusuf }, error: null });
    await expect(handleReadStone(AUTH, deps)).resolves.toEqual({ status: 200, body: { reading: yusuf } });
    expect(deps.readPhoto).not.toHaveBeenCalled();
    expect(deps.finishRead).not.toHaveBeenCalled();

    deps.beginRead.mockResolvedValueOnce({ data: { cached: { ...yusuf, hasGraveDetails: false } }, error: null });
    await expect(handleReadStone(AUTH, deps)).resolves.toEqual({ status: 422, body: { error: NO_GRAVE_DETAILS_MESSAGE } });

    deps.beginRead.mockResolvedValueOnce({ data: { cached: { name: 'broken' } }, error: null });
    await expect(handleReadStone(AUTH, deps)).resolves.toEqual({ status: 502, body: { error: READ_FAILED_MESSAGE } });
    expect(deps.readPhoto).not.toHaveBeenCalled();
  });

  it('turns the database limit into 429 without calling the model', async () => {
    const deps = makeDeps();
    deps.beginRead.mockResolvedValueOnce({ data: null, error: { code: '53400', message: 'Too many photos read. Try again later.' } });
    await expect(handleReadStone(AUTH, deps)).resolves.toEqual({ status: 429, body: { error: TOO_MANY_READS_MESSAGE } });
    expect(deps.readPhoto).not.toHaveBeenCalled();
  });

  it('never calls the model when the limits cannot be checked', async () => {
    const deps = makeDeps();
    deps.beginRead.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(handleReadStone(AUTH, deps)).resolves.toEqual({ status: 503, body: { error: READING_NOT_SET_UP_MESSAGE } });

    deps.beginRead.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Sign in to read a photo.' } });
    await expect(handleReadStone(AUTH, deps)).resolves.toMatchObject({ status: 401 });

    deps.beginRead.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'boom' } });
    await expect(handleReadStone(AUTH, deps)).resolves.toMatchObject({ status: 502 });

    deps.beginRead.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(handleReadStone(AUTH, deps)).resolves.toMatchObject({ status: 502 });

    deps.beginRead.mockResolvedValueOnce({ data: {}, error: null });
    await expect(handleReadStone(AUTH, deps)).resolves.toMatchObject({ status: 502 });

    expect(deps.readPhoto).not.toHaveBeenCalled();
  });

  it('stores a reading with no grave details too, so the same photo is free next time', async () => {
    const deps = makeDeps();
    const blank = { ...yusuf, hasGraveDetails: false };
    deps.readPhoto.mockResolvedValueOnce(blank);
    await expect(handleReadStone(AUTH, deps)).resolves.toEqual({ status: 422, body: { error: NO_GRAVE_DETAILS_MESSAGE } });
    expect(deps.finishRead).toHaveBeenCalledWith('token-1', 'read-1', blank);
  });

  it('maps model failures and keeps them counted', async () => {
    const refused = makeDeps();
    refused.readPhoto.mockRejectedValueOnce(new StoneReadingError('refused', "This photo couldn't be read."));
    await expect(handleReadStone(AUTH, refused)).resolves.toEqual({ status: 422, body: { error: "This photo couldn't be read." } });
    expect(refused.finishRead).not.toHaveBeenCalled();

    const busy = makeDeps();
    busy.readPhoto.mockRejectedValueOnce(new FakeRateLimitError('rate limited'));
    await expect(handleReadStone(AUTH, busy)).resolves.toEqual({ status: 429, body: { error: MODEL_BUSY_MESSAGE } });

    const broken = makeDeps();
    broken.readPhoto.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(handleReadStone(AUTH, broken)).resolves.toEqual({ status: 502, body: { error: READ_FAILED_MESSAGE } });
    expect(broken.logError).toHaveBeenCalled();
  });

  it('still returns the reading when storing it fails', async () => {
    const deps = makeDeps();
    deps.finishRead.mockRejectedValueOnce(new Error('db down'));
    await expect(handleReadStone(AUTH, deps)).resolves.toEqual({ status: 200, body: { reading: yusuf } });
    expect(deps.logError).toHaveBeenCalled();
  });
});
