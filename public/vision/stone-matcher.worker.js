// Finds a grave's reference photo in one greyscale camera frame. A classic worker, so OpenCV.js (about 10 MB)
// loads with importScripts and never touches the page's thread. Plain JavaScript on purpose: it is served as
// is from /public and talks to src/lib/ar/vision/matcherClient.ts, which documents the messages.
//
// In:  { type: 'init', cvUrl, akazeThreshold }
//      { type: 'reference', levels: [{ s, image: { data: ArrayBuffer (RGBA), width, height } }], w, h }
//      { type: 'match', id, image: { data: ArrayBuffer (grey), width, height }, ratio, potential }
//      { type: 'reset' }
// Out: { type: 'ready' } | { type: 'fatal', message }
//      { type: 'reference', count }
//      { type: 'result', id, result: { quad, inliers, good, frameFeatures, points, ms } }
//      { type: 'error', id, for, message }   (for: the type of the message that failed)

'use strict';

const RANSAC_REPROJ_PX = 4;
// The photo also shows ground and neighbours, so the outline is drawn around the part of the photo that has
// actually been matching over the last few frames instead of around the whole photo
const EVIDENCE_FRAMES = 12;
const EVIDENCE_MIN_POINTS = 8;
const EVIDENCE_PAD = 0.15;

let cv = null;
let detector = null;
let matcher = null;
let reference = null; // { desc, pts, w, h }
// Reference coordinates of the inliers from recent matched frames, newest last
let evidence = [];

function start(msg) {
  try {
    importScripts(msg.cvUrl);
  } catch (err) {
    postMessage({ type: 'fatal', message: 'OpenCV.js could not be downloaded' });
    return;
  }
  // The OpenCV.js builds differ in how they announce readiness (callback, promise, or thenable module), so
  // poll for the one thing that matters: cv.Mat exists
  const startedAt = Date.now();
  let hooked = false;
  const timer = setInterval(() => {
    const c = self.cv;
    if (c && c.Mat) {
      clearInterval(timer);
      cv = c;
      if (typeof cv.AKAZE !== 'function') {
        postMessage({ type: 'fatal', message: 'This OpenCV.js build has no AKAZE' });
        return;
      }
      detector = new cv.AKAZE();
      if (detector.setThreshold) detector.setThreshold(msg.akazeThreshold || 0.001);
      matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
      postMessage({ type: 'ready' });
    } else if (c && c instanceof Promise && !hooked) {
      hooked = true;
      c.then((m) => { self.cv = m; });
    } else if (Date.now() - startedAt > 90000) {
      clearInterval(timer);
      postMessage({ type: 'fatal', message: 'OpenCV.js did not start' });
    }
  }, 100);
}

function buildReference(msg) {
  if (reference) { reference.desc.delete(); reference = null; }
  evidence = [];
  const chunks = [];
  const pts = [];
  for (const level of msg.levels) {
    const src = cv.matFromImageData(new ImageData(new Uint8ClampedArray(level.image.data), level.image.width, level.image.height));
    const gray = new cv.Mat(), none = new cv.Mat(), kps = new cv.KeyPointVector(), desc = new cv.Mat();
    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      detector.detectAndCompute(gray, none, kps, desc);
      if (desc.rows > 0) {
        // Keypoints go back to full-scale reference coordinates so every copy shares one outline
        for (let i = 0; i < kps.size(); i++) { const p = kps.get(i).pt; pts.push(p.x / level.s, p.y / level.s); }
        chunks.push(desc.clone());
      }
    } finally { src.delete(); gray.delete(); none.delete(); kps.delete(); desc.delete(); }
  }
  const total = chunks.reduce((n, c) => n + c.rows, 0);
  if (total > 0) {
    const merged = new cv.Mat(total, chunks[0].cols, chunks[0].type());
    let offset = 0;
    for (const c of chunks) { merged.data.set(c.data, offset); offset += c.data.length; c.delete(); }
    reference = { desc: merged, pts: Float32Array.from(pts), w: msg.w, h: msg.h };
  }
  postMessage({ type: 'reference', count: total });
}

function quadArea(q) {
  let a = 0;
  for (let i = 0; i < 4; i++) { const p = q[i], n = q[(i + 1) % 4]; a += p.x * n.y - n.x * p.y; }
  return Math.abs(a) / 2;
}

function isSaneQuad(q, frameW, frameH) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) return false;
    if (sign === 0) sign = Math.sign(cross); else if (Math.sign(cross) !== sign) return false;
  }
  const area = quadArea(q);
  if (area < frameW * frameH * 0.0005 || area > frameW * frameH * 0.95) return false;
  const side = (i) => Math.hypot(q[(i + 1) % 4].x - q[i].x, q[(i + 1) % 4].y - q[i].y);
  const r1 = side(0) / side(2), r2 = side(1) / side(3);
  return r1 > 1 / 3 && r1 < 3 && r2 > 1 / 3 && r2 < 3;
}

// The part of the reference to outline: the box that holds the middle 90% of recently matched points, padded
function outlineRect(current) {
  const full = { x0: 0, y0: 0, x1: reference.w, y1: reference.h };
  const xs = [], ys = [];
  for (const pts of [...evidence, current]) for (const p of pts) { xs.push(p.x); ys.push(p.y); }
  if (xs.length < EVIDENCE_MIN_POINTS) return full;
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const at = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
  const x0 = at(xs, 0.05), x1 = at(xs, 0.95), y0 = at(ys, 0.05), y1 = at(ys, 0.95);
  if (x1 - x0 < 8 || y1 - y0 < 8) return full;
  const px = (x1 - x0) * EVIDENCE_PAD, py = (y1 - y0) * EVIDENCE_PAD;
  return { x0: Math.max(0, x0 - px), y0: Math.max(0, y0 - py), x1: Math.min(reference.w, x1 + px), y1: Math.min(reference.h, y1 + py) };
}

// Returns the outline in frame pixels, or quad: null with the counts that explain why
function matchFrame(msg) {
  const started = performance.now();
  const out = { quad: null, inliers: 0, good: 0, frameFeatures: 0, points: [], ms: 0 };
  if (!reference) return out;
  const width = msg.image.width, height = msg.image.height;
  const gray = new cv.Mat(height, width, cv.CV_8UC1);
  const none = new cv.Mat(), kps = new cv.KeyPointVector(), desc = new cv.Mat();
  const matches = new cv.DMatchVectorVector();
  let srcMat = null, dstMat = null, mask = null, H = null, corners = null, projected = null;
  try {
    gray.data.set(new Uint8Array(msg.image.data));
    detector.detectAndCompute(gray, none, kps, desc);
    out.frameFeatures = desc.rows;
    if (desc.rows < 2) return out;

    // Reference to frame, so the same reference point seen at several sizes never competes with itself in
    // the ratio test. Several reference features can land on one frame point; keep the closest.
    matcher.knnMatch(reference.desc, desc, matches, 2);
    const bestByFramePoint = new Map();
    for (let i = 0; i < matches.size(); i++) {
      const pair = matches.get(i);
      if (pair.size() >= 2) {
        const m = pair.get(0), n = pair.get(1);
        if (m.distance < msg.ratio * n.distance) {
          const prev = bestByFramePoint.get(m.trainIdx);
          if (!prev || m.distance < prev.distance) bestByFramePoint.set(m.trainIdx, m);
        }
      }
      pair.delete();
    }
    out.good = bestByFramePoint.size;
    if (out.good < 4) return out;

    const from = [], to = [];
    for (const m of bestByFramePoint.values()) {
      from.push(reference.pts[m.queryIdx * 2], reference.pts[m.queryIdx * 2 + 1]);
      const p = kps.get(m.trainIdx).pt;
      to.push(p.x, p.y);
    }
    srcMat = cv.matFromArray(out.good, 1, cv.CV_32FC2, from);
    dstMat = cv.matFromArray(out.good, 1, cv.CV_32FC2, to);
    mask = new cv.Mat();
    H = cv.findHomography(srcMat, dstMat, cv.RANSAC, RANSAC_REPROJ_PX, mask);
    if (!H || H.rows !== 3) return out;

    const refPoints = [];
    for (let i = 0; i < mask.rows; i++) {
      if (mask.data[i]) {
        out.inliers++;
        out.points.push({ x: to[i * 2], y: to[i * 2 + 1] });
        refPoints.push({ x: from[i * 2], y: from[i * 2 + 1] });
      }
    }
    const r = outlineRect(refPoints);
    corners = cv.matFromArray(4, 1, cv.CV_32FC2, [r.x0, r.y0, r.x1, r.y0, r.x1, r.y1, r.x0, r.y1]);
    projected = new cv.Mat();
    cv.perspectiveTransform(corners, projected, H);
    const d = projected.data32F;
    const quad = [0, 1, 2, 3].map((i) => ({ x: d[i * 2], y: d[i * 2 + 1] }));
    if (quad.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) && isSaneQuad(quad, width, height)) {
      out.quad = quad;
      if (out.inliers >= msg.potential) {
        evidence.push(refPoints);
        if (evidence.length > EVIDENCE_FRAMES) evidence.shift();
      }
    }
    return out;
  } finally {
    for (const m of [gray, none, kps, desc, matches, srcMat, dstMat, mask, H, corners, projected]) if (m) m.delete();
    out.ms = performance.now() - started;
  }
}

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') start(msg);
    else if (!cv) postMessage({ type: 'error', id: msg.id, for: msg.type, message: 'The matcher is not ready' });
    else if (msg.type === 'reference') buildReference(msg);
    else if (msg.type === 'reset') evidence = [];
    else if (msg.type === 'match') postMessage({ type: 'result', id: msg.id, result: matchFrame(msg) });
  } catch (err) {
    postMessage({ type: 'error', id: msg.id, for: msg.type, message: String(err && err.message ? err.message : err) });
  }
};
