import { describe, it, expect, vi } from 'vitest';
import type { AIStructuredExtraction, Survey, SurveyCapture, SurveyQueueState } from '../src/types';
import type { ReadResult, SaveResult } from '../src/lib/surveys/queueAdapters';
import { isEligible } from '../src/lib/surveys/queueRules';
import { QueueStorage, createExclusiveRunner, createQueueWorker } from '../src/lib/surveys/queueWorker';

const USER = 'user-1';
const UPLOAD = { publicUrl: 'https://x.supabase.co/grave-photos/cem_athlone/grave_a.jpg', path: 'cem_athlone/grave_a.jpg' };

const survey: Survey = {
  id: 'survey_1',
  userId: USER,
  cemeteryId: 'cem_athlone',
  cemeteryName: 'Athlone Muslim Cemetery',
  sectionNote: '',
  startedAt: '2026-09-15T10:00:00.000Z',
  status: 'ACTIVE',
};

const clearReading: AIStructuredExtraction = {
  graveNumber: '',
  firstName: 'Yusuf',
  middleNames: [],
  surname: 'Kamish',
  nickname: '',
  fullName: 'Yusuf Kamish',
  birthDate: '1952-02-02',
  deathDate: '2018-06-16',
  confidence: 0.95,
  rawOcrText: 'YUSUF KAMISH',
  otherText: [],
  fieldConfidences: { graveNumber: 0, fullName: 0.95, dates: 0.95 },
};

const candidate = { graveId: 'grave_existing', fullName: 'Yusuf Kamish', graveNumber: '', distanceMeters: 3, match: 'possible' as const };

function capture(n: number, overrides: Partial<SurveyCapture> = {}): SurveyCapture {
  return {
    id: `capture_${n}`,
    surveyId: survey.id,
    userId: USER,
    cemeteryId: 'cem_athlone',
    createdAt: `2026-09-15T10:00:0${n}.000Z`,
    photo: new Blob([new Uint8Array([n])], { type: 'image/jpeg' }),
    thumbnail: 'data:image/jpeg;base64,/9j/',
    telemetry: { latitude: -33.968, longitude: 18.503, gpsAccuracy: 4, headingDegrees: 62, timestamp: '2026-09-15T10:00:00.000Z' },
    insideBoundary: true,
    status: 'queued',
    readAttempts: 0,
    saveFailures: 0,
    manualRetries: 0,
    nextAttemptAt: 0,
    attempt: { graveId: `grave_${n}`, personId: `person_${n}` },
    ...overrides,
  };
}

function setup(captures: SurveyCapture[]) {
  const rows = new Map(captures.map((c) => [c.id, { ...c } as SurveyCapture]));
  let queueState: SurveyQueueState | undefined;
  let now = 1_000_000;
  let online = true;
  let userId: string | null = USER;
  const timers: Array<{ callback: () => void; ms: number }> = [];
  let updateCalls = 0;
  let failUpdateOnCall: number | null = null;

  const storage: QueueStorage = {
    async eligibleCaptures(user, at) {
      return Array.from(rows.values())
        .filter((c) => isEligible(c, user, at))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((c) => ({ ...c, attempt: { ...c.attempt } }));
    },
    async earliestNextAttempt(user) {
      const waiting = Array.from(rows.values()).filter((c) => c.userId === user && (c.status === 'queued' || c.status === 'saving'));
      return waiting.length ? Math.min(...waiting.map((c) => c.nextAttemptAt)) : null;
    },
    async resetInterruptedReads(user) {
      const reading = Array.from(rows.values()).filter((c) => c.userId === user && c.status === 'reading');
      reading.forEach((c) => (c.status = 'queued'));
      return reading.length;
    },
    async updateCapture(id, changes) {
      updateCalls += 1;
      if (updateCalls === failUpdateOnCall) {
        failUpdateOnCall = null;
        throw new Error('storage write failed');
      }
      const row = rows.get(id) as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) delete row[key];
        else row[key] = value;
      }
    },
    async getSurvey(id) {
      return id === survey.id ? survey : undefined;
    },
    async getQueueState(user) {
      return queueState ?? { userId: user, consecutiveFailures: 0, pausedForErrors: false };
    },
    async setQueueState(state) {
      queueState = state;
    },
  };

  const readPhoto = vi.fn(async (_c: SurveyCapture): Promise<ReadResult> => ({ kind: 'reading', reading: clearReading }));
  const saveCapture = vi.fn(async (c: SurveyCapture, _s: Survey): Promise<SaveResult> => {
    c.attempt.upload = UPLOAD;
    return { kind: 'created', graveId: c.attempt.graveId };
  });

  const worker = createQueueWorker({
    storage,
    readPhoto,
    saveCapture,
    getUserId: async () => userId,
    isOnline: () => online,
    now: () => now,
    setTimer: (callback, ms) => {
      const timer = { callback, ms };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      const index = timers.indexOf(handle as (typeof timers)[number]);
      if (index >= 0) timers.splice(index, 1);
    },
    runExclusive: (task) => task(),
  });

  // Runs the only pending timer after moving the clock on by its delay
  async function fireTimer() {
    expect(timers).toHaveLength(1);
    const timer = timers.shift()!;
    now += timer.ms;
    timer.callback();
    await vi.waitFor(() => expect(worker.activity()).not.toBe('working'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    worker,
    rows,
    timers,
    readPhoto,
    saveCapture,
    row: (id: string) => rows.get(id)!,
    state: () => queueState,
    setOnline: (value: boolean) => (online = value),
    setUser: (value: string | null) => (userId = value),
    advance: (ms: number) => (now += ms),
    failUpdateOnCall: (n: number) => (failUpdateOnCall = n),
    fireTimer,
  };
}

describe('Survey Queue Worker Tests', () => {
  it('reads a clear photo, saves it in auto mode and removes the full photo', async () => {
    const q = setup([capture(1)]);
    await q.worker.wake();
    expect(q.readPhoto).toHaveBeenCalledTimes(1);
    expect(q.saveCapture).toHaveBeenCalledTimes(1);
    expect(q.row('capture_1')).toMatchObject({ status: 'saved', outcome: 'created', graveId: 'grave_1', readAttempts: 1, attempt: { upload: UPLOAD } });
    expect('photo' in q.row('capture_1')).toBe(false);
    expect(q.worker.activity()).toBe('idle');
    expect(q.timers).toHaveLength(0);
  });

  it('keeps captures on the phone while offline without reading them', async () => {
    const q = setup([capture(1)]);
    q.setOnline(false);
    await q.worker.wake();
    expect(q.readPhoto).not.toHaveBeenCalled();
    expect(q.worker.activity()).toBe('offline');
    expect(q.row('capture_1').status).toBe('queued');
  });

  it('does not count a read whose connection was already lost, and sets no retry timer', async () => {
    const q = setup([capture(1)]);
    q.readPhoto.mockImplementationOnce(async () => {
      // The signal drops while the request is in flight, so the phone reports offline by the time the answer is lost
      q.setOnline(false);
      return { kind: 'offline' };
    });
    await q.worker.wake();
    expect(q.row('capture_1')).toMatchObject({ status: 'queued', readAttempts: 0 });
    expect(q.worker.activity()).toBe('offline');
    expect(q.timers).toHaveLength(0);
    q.setOnline(true);
    await q.worker.wake();
    expect(q.row('capture_1').status).toBe('saved');
  });

  it('saves the incremented read attempt before calling readPhoto, even one that never resolves', async () => {
    const q = setup([capture(1)]);
    q.readPhoto.mockImplementationOnce(async () => {
      expect(q.row('capture_1')).toMatchObject({ status: 'reading', readAttempts: 1 });
      return { kind: 'reading', reading: clearReading };
    });
    await q.worker.wake();
    expect(q.readPhoto).toHaveBeenCalledTimes(1);
    expect(q.row('capture_1').status).toBe('saved');
  });

  it('counts an offline read result as a failed attempt when the phone still reports a connection', async () => {
    const q = setup([capture(1)]);
    q.readPhoto.mockResolvedValue({ kind: 'offline' });
    await q.worker.wake();
    expect(q.row('capture_1')).toMatchObject({
      status: 'queued',
      readAttempts: 1,
      nextAttemptAt: 1_030_000,
      lastError: "The photo couldn't be sent. Check the signal and try again.",
    });
    expect(q.timers.map((t) => t.ms)).toEqual([30_000]);
    await q.fireTimer();
    expect(q.row('capture_1').readAttempts).toBe(2);
    expect(q.timers.map((t) => t.ms)).toEqual([120_000]);
    await q.fireTimer();
    expect(q.row('capture_1')).toMatchObject({
      status: 'failed',
      readAttempts: 3,
      lastError: "The photo couldn't be sent. Check the signal and try again.",
    });
    expect(q.readPhoto).toHaveBeenCalledTimes(3);
    expect(q.timers).toHaveLength(0);
  });

  it('counts a thrown readPhoto error like any other failed read', async () => {
    const q = setup([capture(1)]);
    q.readPhoto.mockRejectedValueOnce(new Error('network trouble'));
    await q.worker.wake();
    expect(q.row('capture_1')).toMatchObject({ status: 'queued', readAttempts: 1, lastError: "The photo couldn't be read." });
    expect(q.timers.map((t) => t.ms)).toEqual([30_000]);
  });

  it('counts a thrown saveCapture error like any other failed save', async () => {
    const q = setup([capture(1)]);
    q.saveCapture.mockRejectedValueOnce(new Error('network trouble'));
    await q.worker.wake();
    expect(q.row('capture_1')).toMatchObject({ status: 'saving', saveFailures: 1, lastError: "The grave couldn't be saved." });
    expect(q.timers.map((t) => t.ms)).toEqual([30_000]);
  });

  it('backs off after save errors and fails after 3 save failures without reading the photo again', async () => {
    const q = setup([capture(1)]);
    q.saveCapture.mockResolvedValue({ kind: 'error', message: 'boom' });
    await q.worker.wake();
    expect(q.row('capture_1')).toMatchObject({ status: 'saving', saveFailures: 1 });
    expect(q.timers.map((t) => t.ms)).toEqual([30_000]);
    await q.fireTimer();
    expect(q.row('capture_1').saveFailures).toBe(2);
    expect(q.timers.map((t) => t.ms)).toEqual([120_000]);
    await q.fireTimer();
    expect(q.row('capture_1')).toMatchObject({ status: 'failed', saveFailures: 3, lastError: 'boom' });
    expect(q.readPhoto).toHaveBeenCalledTimes(1);
    expect(q.timers).toHaveLength(0);
  });

  it('recovers from a storage failure that leaves a capture stuck reading, instead of going silent', async () => {
    const q = setup([capture(1)]);
    // The 2nd updateCapture call is the one that would move the capture off "reading" once the read comes back
    q.failUpdateOnCall(2);
    await q.worker.wake();
    expect(q.row('capture_1')).toMatchObject({ status: 'reading', readAttempts: 1 });
    expect(q.timers.map((t) => t.ms)).toEqual([30_000]);
    await q.fireTimer();
    expect(q.row('capture_1').status).toBe('saved');
  });

  it('sends a low confidence reading, a reading outside the cemetery, and an unreadable stone to review', async () => {
    const q = setup([capture(1), capture(2, { insideBoundary: false }), capture(3)]);
    q.readPhoto
      .mockResolvedValueOnce({ kind: 'reading', reading: { ...clearReading, fieldConfidences: { ...clearReading.fieldConfidences, fullName: 0.7 } } })
      .mockResolvedValueOnce({ kind: 'reading', reading: clearReading })
      .mockResolvedValueOnce({ kind: 'unreadable', message: 'No grave details were found in this photo.' });
    await q.worker.wake();
    expect(q.row('capture_1')).toMatchObject({ status: 'review', reviewReason: 'low-confidence' });
    expect(q.row('capture_2')).toMatchObject({ status: 'review', reviewReason: 'outside-cemetery' });
    expect(q.row('capture_3')).toMatchObject({ status: 'review', reviewReason: 'unreadable', readAttempts: 1 });
    expect(q.saveCapture).not.toHaveBeenCalled();
  });

  it('records a photo added to a strong match, and sends a possible match to review', async () => {
    const q = setup([capture(1), capture(2)]);
    q.saveCapture
      .mockResolvedValueOnce({ kind: 'added-photo', graveId: 'grave_existing' })
      .mockResolvedValueOnce({ kind: 'match-found', candidate });
    await q.worker.wake();
    expect(q.row('capture_1')).toMatchObject({ status: 'saved', outcome: 'added-photo', graveId: 'grave_existing' });
    expect(q.row('capture_2')).toMatchObject({ status: 'review', reviewReason: 'possible-duplicate', matchCandidate: candidate });
    expect(q.row('capture_2').photo).toBeInstanceOf(Blob);
  });

  it('retries a save whose answer was lost with the same ids and uploaded photo', async () => {
    const q = setup([capture(1)]);
    q.saveCapture.mockImplementationOnce(async (c) => {
      c.attempt.upload = UPLOAD;
      return { kind: 'offline' };
    });
    await q.worker.wake();
    expect(q.row('capture_1')).toMatchObject({ status: 'saving', attempt: { graveId: 'grave_1', upload: UPLOAD } });
    await q.fireTimer();
    expect(q.saveCapture).toHaveBeenCalledTimes(2);
    const retried = q.saveCapture.mock.calls[1][0];
    expect(retried.attempt).toEqual({ graveId: 'grave_1', personId: 'person_1', upload: UPLOAD });
    expect(q.readPhoto).toHaveBeenCalledTimes(1);
    expect(q.row('capture_1').status).toBe('saved');
  });

  it('backs off after read errors and stops after 3 counted reads', async () => {
    const q = setup([capture(1)]);
    q.readPhoto.mockResolvedValue({ kind: 'error', message: "The photo couldn't be read." });
    await q.worker.wake();
    expect(q.row('capture_1')).toMatchObject({ status: 'queued', readAttempts: 1 });
    expect(q.timers.map((t) => t.ms)).toEqual([30_000]);
    await q.fireTimer();
    expect(q.row('capture_1').readAttempts).toBe(2);
    expect(q.timers.map((t) => t.ms)).toEqual([120_000]);
    await q.fireTimer();
    expect(q.row('capture_1')).toMatchObject({ status: 'failed', readAttempts: 3, lastError: "The photo couldn't be read." });
    expect(q.readPhoto).toHaveBeenCalledTimes(3);
    expect(q.timers).toHaveLength(0);
    expect(q.worker.activity()).toBe('idle');
  });

  it('holds the whole queue for a minute on a rate limit without counting the read', async () => {
    const q = setup([capture(1), capture(2)]);
    q.readPhoto.mockResolvedValueOnce({ kind: 'rate-limited', waitMs: 60_000 });
    await q.worker.wake();
    expect(q.readPhoto).toHaveBeenCalledTimes(1);
    expect(q.row('capture_1')).toMatchObject({ status: 'queued', readAttempts: 0 });
    expect(q.worker.activity()).toBe('waiting');
    expect(q.timers.map((t) => t.ms)).toEqual([60_000]);
    await q.fireTimer();
    expect(q.row('capture_1').status).toBe('saved');
    expect(q.row('capture_2').status).toBe('saved');
  });

  it('holds the whole queue for 10 minutes when the daily read limit is hit, with no second read before it fires', async () => {
    const q = setup([capture(1), capture(2)]);
    q.readPhoto.mockResolvedValueOnce({ kind: 'rate-limited', waitMs: 600_000 });
    await q.worker.wake();
    expect(q.readPhoto).toHaveBeenCalledTimes(1);
    expect(q.row('capture_1')).toMatchObject({ status: 'queued', readAttempts: 0 });
    expect(q.worker.activity()).toBe('waiting');
    expect(q.timers.map((t) => t.ms)).toEqual([600_000]);
    await q.fireTimer();
    expect(q.readPhoto).toHaveBeenCalledTimes(3);
    expect(q.row('capture_1').status).toBe('saved');
    expect(q.row('capture_2').status).toBe('saved');
  });

  it('pauses when the session has ended until the surveyor signs in again', async () => {
    const q = setup([capture(1)]);
    q.readPhoto.mockResolvedValueOnce({ kind: 'signed-out' });
    await q.worker.wake();
    expect(q.worker.activity()).toBe('signed-out');
    expect(q.row('capture_1')).toMatchObject({ status: 'queued', readAttempts: 0 });
    await q.worker.wake();
    expect(q.readPhoto).toHaveBeenCalledTimes(1);
    await q.worker.signedIn();
    expect(q.row('capture_1').status).toBe('saved');
  });

  it('does nothing when nobody is signed in', async () => {
    const q = setup([capture(1)]);
    q.setUser(null);
    await q.worker.wake();
    expect(q.readPhoto).not.toHaveBeenCalled();
    expect(q.worker.activity()).toBe('signed-out');
  });

  it("only processes the signed-in surveyor's captures", async () => {
    const q = setup([capture(1, { userId: 'user-2' })]);
    await q.worker.wake();
    expect(q.readPhoto).not.toHaveBeenCalled();
    expect(q.row('capture_1').status).toBe('queued');
  });

  it('pauses after 5 failures in a row until Resume, and keeps the pause stored', async () => {
    const q = setup([1, 2, 3, 4, 5, 6].map((n) => capture(n)));
    q.readPhoto.mockResolvedValue({ kind: 'error', message: 'boom' });
    await q.worker.wake();
    expect(q.readPhoto).toHaveBeenCalledTimes(5);
    expect(q.state()).toMatchObject({ consecutiveFailures: 5, pausedForErrors: true });
    expect(q.worker.activity()).toBe('paused');
    expect(q.row('capture_6').readAttempts).toBe(0);

    q.advance(600_000);
    await q.worker.wake();
    expect(q.readPhoto).toHaveBeenCalledTimes(5);

    q.readPhoto.mockResolvedValue({ kind: 'reading', reading: clearReading });
    await q.worker.resume();
    expect(q.state()).toMatchObject({ consecutiveFailures: 0, pausedForErrors: false });
    expect([1, 2, 3, 4, 5, 6].map((n) => q.row(`capture_${n}`).status)).toEqual(Array(6).fill('saved'));
  });

  it('fails a capture that already used its reads, even when the app closed mid-read', async () => {
    const q = setup([capture(1, { status: 'reading', readAttempts: 3, lastError: 'boom' })]);
    await q.worker.wake();
    expect(q.readPhoto).not.toHaveBeenCalled();
    expect(q.row('capture_1')).toMatchObject({ status: 'failed', readAttempts: 3 });
  });

  it('allows one more read after a manual retry', async () => {
    const q = setup([capture(1, { status: 'queued', readAttempts: 3, manualRetries: 1 })]);
    q.readPhoto.mockResolvedValueOnce({ kind: 'error', message: 'boom' });
    await q.worker.wake();
    expect(q.readPhoto).toHaveBeenCalledTimes(1);
    expect(q.row('capture_1')).toMatchObject({ status: 'failed', readAttempts: 4 });
  });

  it('runs once for overlapping wakes, then picks up what arrived during the run', async () => {
    const q = setup([capture(1)]);
    let release: () => void = () => {};
    q.readPhoto.mockImplementationOnce(
      () => new Promise<ReadResult>((resolve) => (release = () => resolve({ kind: 'reading', reading: clearReading })))
    );
    const first = q.worker.wake();
    await vi.waitFor(() => expect(q.readPhoto).toHaveBeenCalledTimes(1));
    q.rows.set('capture_2', capture(2));
    const second = q.worker.wake();
    release();
    await Promise.all([first, second]);
    expect(q.readPhoto).toHaveBeenCalledTimes(2);
    expect(q.row('capture_2').status).toBe('saved');
  });

  it('stops for good when stopped', async () => {
    const q = setup([capture(1)]);
    q.worker.stop();
    await q.worker.wake();
    expect(q.readPhoto).not.toHaveBeenCalled();
  });
});

describe('Exclusive Runner Tests', () => {
  it('skips a run while another tab holds the lock', async () => {
    const task = vi.fn(async () => {});
    const held = { request: vi.fn(async (_name: string, _options: unknown, callback: (lock: unknown) => Promise<void>) => callback(null)) };
    await createExclusiveRunner(held as never)(task);
    expect(task).not.toHaveBeenCalled();
    expect(held.request).toHaveBeenCalledWith('qabrmap-survey-queue', { ifAvailable: true }, expect.any(Function));

    const free = { request: vi.fn(async (_name: string, _options: unknown, callback: (lock: unknown) => Promise<void>) => callback({})) };
    await createExclusiveRunner(free as never)(task);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('falls back to one run at a time without Web Locks', async () => {
    const run = createExclusiveRunner(undefined);
    let finish: () => void = () => {};
    const slow = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const quick = vi.fn(async () => {});
    const first = run(slow);
    await run(quick);
    expect(quick).not.toHaveBeenCalled();
    finish();
    await first;
    await run(quick);
    expect(quick).toHaveBeenCalledTimes(1);
  });
});
