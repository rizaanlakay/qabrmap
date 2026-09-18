// tests/vision_matcher_client.test.ts
import { describe, it, expect } from 'vitest';
import { createMatcherClient, MatchResult, WorkerLike } from '../src/lib/ar/vision/matcherClient';
import { VISION_CONFIG } from '../src/lib/ar/vision/config';

interface Sent {
  message: { type: string; id?: number; [key: string]: unknown };
  transfer?: Transferable[];
}

function fakeWorker() {
  const sent: Sent[] = [];
  let terminated = false;
  const worker: WorkerLike = {
    postMessage: (message, transfer) => sent.push({ message: message as Sent['message'], transfer }),
    terminate: () => {
      terminated = true;
    },
    onmessage: null,
    onerror: null,
  };
  return { worker, sent, reply: (data: unknown) => worker.onmessage?.({ data }), isTerminated: () => terminated };
}

const frame = () => ({ pixels: new Uint8Array(6), width: 3, height: 2 });
const found: MatchResult = { quad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], inliers: 25, good: 30, frameFeatures: 900, points: [], ms: 480 };

describe('Vision Matcher Client Tests', () => {
  it('starts the worker with the OpenCV address and resolves ready when it answers', async () => {
    const fake = fakeWorker();
    const client = createMatcherClient(() => fake.worker, 'https://cdn.example/opencv.js', VISION_CONFIG);
    expect(fake.sent[0].message).toEqual({ type: 'init', cvUrl: 'https://cdn.example/opencv.js', akazeThreshold: VISION_CONFIG.akazeThreshold });
    fake.reply({ type: 'ready' });
    expect(await client.ready).toBe(true);
  });

  it('sends a frame with its buffer handed over and resolves with the answer', async () => {
    const fake = fakeWorker();
    const client = createMatcherClient(() => fake.worker, 'cv.js', VISION_CONFIG);
    const sentFrame = frame();
    const answer = client.match(sentFrame);
    expect(client.busy()).toBe(true);
    const { message, transfer } = fake.sent[1];
    expect(message).toMatchObject({ type: 'match', id: 1, ratio: VISION_CONFIG.ratioTest, potential: VISION_CONFIG.potentialInliers });
    expect(transfer).toEqual([sentFrame.pixels.buffer]);
    fake.reply({ type: 'result', id: 1, result: found });
    expect(await answer).toEqual(found);
    expect(client.busy()).toBe(false);
  });

  it('refuses a second frame while one is in flight', async () => {
    const fake = fakeWorker();
    const client = createMatcherClient(() => fake.worker, 'cv.js', VISION_CONFIG);
    void client.match(frame());
    expect(await client.match(frame())).toBeNull();
    expect(fake.sent.filter((s) => s.message.type === 'match')).toHaveLength(1);
  });

  it('ignores an answer to a frame it is no longer waiting for', async () => {
    const fake = fakeWorker();
    const client = createMatcherClient(() => fake.worker, 'cv.js', VISION_CONFIG);
    const answer = client.match(frame());
    fake.reply({ type: 'result', id: 99, result: found });
    expect(client.busy()).toBe(true);
    fake.reply({ type: 'result', id: 1, result: found });
    expect(await answer).toEqual(found);
  });

  it('resolves null when a match errors, and keeps working', async () => {
    const fake = fakeWorker();
    const client = createMatcherClient(() => fake.worker, 'cv.js', VISION_CONFIG);
    const answer = client.match(frame());
    fake.reply({ type: 'error', id: 1, for: 'match', message: 'boom' });
    expect(await answer).toBeNull();
    const again = client.match(frame());
    fake.reply({ type: 'result', id: 2, result: found });
    expect(await again).toEqual(found);
  });

  it('reports how many features the photo gave, or none when reading it fails', async () => {
    const fake = fakeWorker();
    const client = createMatcherClient(() => fake.worker, 'cv.js', VISION_CONFIG);
    const reference = { width: 480, height: 640, levels: [{ s: 1, image: { data: new ArrayBuffer(4), width: 1, height: 1 } }] };
    const first = client.setReference(reference);
    expect(fake.sent[1].message).toMatchObject({ type: 'reference', w: 480, h: 640 });
    fake.reply({ type: 'reference', count: 1040 });
    expect(await first).toBe(1040);

    const second = client.setReference({ ...reference, levels: [{ s: 1, image: { data: new ArrayBuffer(4), width: 1, height: 1 } }] });
    fake.reply({ type: 'error', for: 'reference', message: 'bad image' });
    expect(await second).toBe(0);
  });

  it('gives up cleanly when OpenCV cannot start', async () => {
    const fake = fakeWorker();
    const client = createMatcherClient(() => fake.worker, 'cv.js', VISION_CONFIG);
    const answer = client.match(frame());
    fake.reply({ type: 'fatal', message: 'OpenCV.js could not be downloaded' });
    expect(await client.ready).toBe(false);
    expect(await answer).toBeNull();
    expect(fake.isTerminated()).toBe(true);
    expect(await client.match(frame())).toBeNull();
  });

  it('gives up cleanly when the worker cannot even be created', async () => {
    const client = createMatcherClient(() => {
      throw new Error('no workers here');
    }, 'cv.js', VISION_CONFIG);
    expect(await client.ready).toBe(false);
    expect(await client.setReference({ width: 1, height: 1, levels: [] })).toBe(0);
  });

  it('terminates the worker and settles what was pending on dispose', async () => {
    const fake = fakeWorker();
    const client = createMatcherClient(() => fake.worker, 'cv.js', VISION_CONFIG);
    const answer = client.match(frame());
    client.dispose();
    expect(await answer).toBeNull();
    expect(fake.isTerminated()).toBe(true);
  });
});
