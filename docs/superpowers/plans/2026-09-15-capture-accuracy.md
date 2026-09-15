# Capture Accuracy, Position Observations and AR Marker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The capture shutter explains itself while GPS settles, offers "Capture anyway" after 15 s, asks for a whole-grave photo on a low-accuracy capture; every photo and every "I found it" becomes a position observation that the database averages into a better grave position; and the AR screen shows a bouncing marker on the camera with a ring for the accuracy.

**Architecture:** Pure modules (`gpsFixes`, `readiness`, `markerProjection`, `smoothing`, `visits`) hold the maths and rules and are unit tested. One migration adds the observation table, the trigger that turns photos into observations, the recompute function, `record_grave_visit`, the `kind` column on photos, and raises `save_or_add_grave` to 25 m. Screens only gather sensor input and render.

**Tech Stack:** Next.js 14 App Router (client components), React 18, TypeScript, Supabase (Postgres, PostgREST, supabase-js v2), Dexie, lucide-react, Vitest 2.

**Spec:** `docs/superpowers/specs/2026-09-15-capture-accuracy-design.md`

## Global Constraints

- Never use em dashes in code comments, UI copy, commit messages or docs. Use commas, colons, periods or parentheses.
- Runtime imports inside `src/lib/**` use relative paths (`../geospatial`), because Vitest has no `@/` alias. Type-only imports may use `@/types`. Components may use `@/`.
- Match the surrounding code: short comments that explain why, 2-space indent, single quotes, Tailwind classes in the existing style.
- Shutter limit 10 m. Capture anyway between 10 m and 25 m, offered after 15 s. Database limit 25 m. `MAPPED` at 5 m or better, otherwise `LOW_CONFIDENCE`. Confidence `HIGH` at 3.5 m or better, `MEDIUM` at 6 m or better, otherwise `LOW`. Fusion floor 1.5 m. Same-visit dedupe window 6 hours. Visit sanity check 30 m. AR arrived at 5 m. Field of view 65 degrees. Eye height 1.5 m.
- Migrations are applied by hand in the Supabase SQL Editor. Never try to run them from here. Every migration must be safe to run more than once.
- Always `git add` explicit paths, never `git add -A` or `git add .`.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  ```
- Run one test file: `npx vitest run tests/<file>.test.ts`. Run all tests: `npx vitest run`. Type check: `npx tsc --noEmit`. Baseline before this plan: 43 files, 311 tests passing, type check clean. If node crashes with "Fatal process out of memory", the machine is short of commit memory; wait a minute and run again.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/capture/gpsFixes.ts` | Create | `smoothFixes`, `pruneFixes`: best recent fix, averaged while still |
| `tests/gps_fixes.test.ts` | Create | Smoother tests |
| `src/lib/capture/readiness.ts` | Modify | Low-accuracy rows, `canCaptureAnyway`, `lowAccuracy` |
| `tests/capture_readiness.test.ts` | Modify | New readiness rows |
| `src/components/screens/CaptureScreen.tsx` | Modify | Smoother, lock icon, capture anyway, whole-grave step |
| `src/app/page.tsx` | Modify | Whole-grave photo state, visit handler, props |
| `supabase/migrations/20260915200000_position_observations.sql` | Create | Photo kind, observations, recompute, visits, 25 m limit, backfill |
| `tests/position_observations_migration.test.ts` | Create | Migration text checks |
| `src/types/index.ts` | Modify | `GravePhoto.kind`, `Grave.gravePhotoUrl`, `Grave.observationCount` |
| `src/lib/supabase/mappers.ts` | Modify | Map the new columns |
| `tests/grave_photos.test.ts` | Modify | Mapper `kind` |
| `src/lib/data/store.ts` | Modify | `addGravePhoto` kind, whole-grave upload, `recordGraveVisit` |
| `src/lib/capture/saveMappedGrave.ts` | Modify | Optional whole-grave photo after a save |
| `tests/save_mapped_grave.test.ts` | Modify | Whole-grave photo tests |
| `src/components/screens/ConfirmDetailsScreen.tsx` | Modify | Pass the whole-grave photo through |
| `src/components/screens/GraveDetailsScreen.tsx` | Modify | Notice prop, accuracy row with visits |
| `src/lib/graves/visits.ts` | Create | `parseVisitResult`, `applyVisitResult`, `describeVisit` |
| `tests/grave_visits.test.ts` | Create | Visit helper and mapper tests |
| `src/components/common/VisitConfirmButton.tsx` | Create | "I found it" button with saving, done and error states |
| `src/components/common/LookForThisGrave.tsx` | Create | Whole-grave photo thumbnail with its label |
| `src/components/screens/NavigationScreen.tsx` | Modify | Accuracy in the fix, visit button, whole-grave thumbnail |
| `src/lib/device/compass.ts` | Modify | `readDevicePitch` |
| `src/lib/device/useCompassHeading.ts` | Modify | Return `pitch` |
| `tests/compass.test.ts` | Modify | Pitch tests |
| `src/lib/ar/markerProjection.ts` | Create | `projectGroundTarget` |
| `src/lib/ar/smoothing.ts` | Create | `smoothValue`, `smoothAngle` |
| `tests/marker_projection.test.ts` | Create | Projection and smoothing tests |
| `src/app/globals.css` | Modify | Marker bounce keyframes |
| `src/components/screens/ARGuidanceScreen.tsx` | Modify | Own GPS watch, marker, ring, caption, edge arrow, visit button, whole-grave photo |

---

### Task 1: GPS fix smoother

**Files:**
- Create: `src/lib/capture/gpsFixes.ts`
- Test: `tests/gps_fixes.test.ts`

**Interfaces:**
- Consumes: `calculateDistanceMeters(lat1, lng1, lat2, lng2): number` from `src/lib/geospatial/index.ts`.
- Produces:
  ```ts
  export interface TimedFix { lat: number; lng: number; accuracy: number; at: number }
  export interface SmoothedFix { lat: number; lng: number; accuracy: number }
  export const FIX_WINDOW_MS = 10_000;
  export const STILL_RADIUS_M = 3;
  export function pruneFixes(fixes: TimedFix[], now: number): TimedFix[];
  export function smoothFixes(fixes: TimedFix[], now: number): SmoothedFix | null;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/gps_fixes.test.ts
import { describe, it, expect } from 'vitest';
import { FIX_WINDOW_MS, STILL_RADIUS_M, pruneFixes, smoothFixes } from '../src/lib/capture/gpsFixes';

// About 1 m of latitude near Cape Town
const ONE_METER_LAT = 0.000009;
const BASE = { lat: -33.9675, lng: 18.5033 };
const NOW = 1_000_000;

describe('GPS Fix Smoother Tests', () => {
  it('returns null when there are no fixes, or only stale ones', () => {
    expect(smoothFixes([], NOW)).toBeNull();
    expect(smoothFixes([{ ...BASE, accuracy: 4, at: NOW - FIX_WINDOW_MS - 1 }], NOW)).toBeNull();
  });

  it('drops fixes older than the window and keeps the rest', () => {
    const fresh = { ...BASE, accuracy: 4, at: NOW - 1000 };
    const stale = { ...BASE, accuracy: 2, at: NOW - FIX_WINDOW_MS - 1 };
    expect(pruneFixes([stale, fresh], NOW)).toEqual([fresh]);
  });

  it('uses the most accurate recent fix, and the latest one on a tie', () => {
    const fixes = [
      { lat: BASE.lat, lng: BASE.lng, accuracy: 12, at: NOW - 9000 },
      { lat: BASE.lat + 50 * ONE_METER_LAT, lng: BASE.lng, accuracy: 6, at: NOW - 5000 },
      { lat: BASE.lat + 100 * ONE_METER_LAT, lng: BASE.lng, accuracy: 6, at: NOW - 1000 },
    ];
    const fix = smoothFixes(fixes, NOW);
    expect(fix?.accuracy).toBe(6);
    expect(fix?.lat).toBeCloseTo(BASE.lat + 100 * ONE_METER_LAT, 7);
  });

  it('averages fixes within the stillness radius of the best one and ignores the others', () => {
    const fixes = [
      { lat: BASE.lat + 20 * ONE_METER_LAT, lng: BASE.lng, accuracy: 5, at: NOW - 8000 }, // 20 m away, walking
      { lat: BASE.lat + 2 * ONE_METER_LAT, lng: BASE.lng, accuracy: 8, at: NOW - 3000 },
      { lat: BASE.lat, lng: BASE.lng, accuracy: 4, at: NOW - 1000 },
    ];
    const fix = smoothFixes(fixes, NOW);
    expect(STILL_RADIUS_M).toBe(3);
    // Inverse-variance mean of the two still fixes: weights 1/64 and 1/16, so the 4 m fix pulls hardest
    const expectedLat = (BASE.lat + 2 * ONE_METER_LAT) * (1 / 64) / (1 / 64 + 1 / 16) + BASE.lat * (1 / 16) / (1 / 64 + 1 / 16);
    expect(fix?.lat).toBeCloseTo(expectedLat, 9);
    expect(fix?.lng).toBeCloseTo(BASE.lng, 9);
  });

  it('never reports better accuracy than the best single fix', () => {
    const fixes = Array.from({ length: 10 }, (_, i) => ({ ...BASE, accuracy: 7, at: NOW - i * 500 }));
    expect(smoothFixes(fixes, NOW)?.accuracy).toBe(7);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/gps_fixes.test.ts`
Expected: FAIL, cannot find module `../src/lib/capture/gpsFixes`.

- [ ] **Step 3: Write the smoother**

```ts
// src/lib/capture/gpsFixes.ts
import { calculateDistanceMeters } from '../geospatial';

export interface TimedFix {
  lat: number;
  lng: number;
  accuracy: number;
  // Epoch milliseconds when the browser reported it
  at: number;
}

export interface SmoothedFix {
  lat: number;
  lng: number;
  accuracy: number;
}

// Browser fixes jitter from one second to the next; the best one in this window is what the phone can really do
export const FIX_WINDOW_MS = 10_000;
// Fixes this close together mean the phone hasn't moved, so averaging them removes noise, not movement
export const STILL_RADIUS_M = 3;

export function pruneFixes(fixes: TimedFix[], now: number): TimedFix[] {
  return fixes.filter((fix) => now - fix.at <= FIX_WINDOW_MS);
}

// The most accurate recent fix, with its position averaged over the fixes taken standing in the same spot.
// The accuracy is the best single reading: averaging removes jitter but not the shared GPS bias.
export function smoothFixes(fixes: TimedFix[], now: number): SmoothedFix | null {
  const recent = pruneFixes(fixes, now);
  if (recent.length === 0) return null;

  let best = recent[0];
  for (const fix of recent) {
    if (fix.accuracy < best.accuracy || (fix.accuracy === best.accuracy && fix.at >= best.at)) best = fix;
  }

  const still = recent.filter(
    (fix) => calculateDistanceMeters(best.lat, best.lng, fix.lat, fix.lng) <= STILL_RADIUS_M
  );

  let sumWeights = 0;
  let lat = 0;
  let lng = 0;
  for (const fix of still) {
    const weight = 1 / Math.max(0.25, fix.accuracy * fix.accuracy);
    sumWeights += weight;
    lat += fix.lat * weight;
    lng += fix.lng * weight;
  }

  return { lat: lat / sumWeights, lng: lng / sumWeights, accuracy: best.accuracy };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/gps_fixes.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/capture/gpsFixes.ts tests/gps_fixes.test.ts
git commit -m "feat(capture): smooth GPS fixes over the last ten seconds

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Readiness with capture anyway

**Files:**
- Modify: `src/lib/capture/readiness.ts`
- Modify: `tests/capture_readiness.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MAX_CAPTURE_ACCURACY_M = 10;
  export const MAX_LOW_ACCURACY_CAPTURE_M = 25;
  export const LOW_ACCURACY_MESSAGE = 'Low accuracy. This grave will be marked for re-survey.';
  export interface CaptureReadinessInput {
    cameraLive: boolean; accuracyMeters: number | null; heading: number | null;
    compassStatus: CompassStatus; lowAccuracyAllowed?: boolean;
  }
  export interface CaptureReadiness {
    ready: boolean; blocker: CaptureBlocker; message: string;
    canCaptureAnyway: boolean; lowAccuracy: boolean;
  }
  ```

- [ ] **Step 1: Replace the test file**

```ts
// tests/capture_readiness.test.ts
import { describe, it, expect } from 'vitest';
import {
  getCaptureReadiness,
  LOW_ACCURACY_MESSAGE,
  MAX_CAPTURE_ACCURACY_M,
  MAX_LOW_ACCURACY_CAPTURE_M,
} from '../src/lib/capture/readiness';

const everythingReady = {
  cameraLive: true,
  accuracyMeters: 4,
  heading: 90,
  compassStatus: 'active' as const,
};

const notReady = { canCaptureAnyway: false, lowAccuracy: false };

describe('Capture Readiness Tests', () => {
  it('waits for the camera first', () => {
    expect(getCaptureReadiness({ ...everythingReady, cameraLive: false, accuracyMeters: null })).toEqual({
      ready: false,
      blocker: 'camera',
      message: 'Camera is not available',
      ...notReady,
    });
  });

  it('waits for a GPS fix', () => {
    expect(getCaptureReadiness({ ...everythingReady, accuracyMeters: null })).toEqual({
      ready: false,
      blocker: 'gps',
      message: 'Locating…',
      ...notReady,
    });
  });

  it('is ready at 10 m or better', () => {
    expect(MAX_CAPTURE_ACCURACY_M).toBe(10);
    expect(getCaptureReadiness({ ...everythingReady, accuracyMeters: 10 })).toEqual({
      ready: true,
      blocker: null,
      message: 'Position the gravestone in the frame',
      ...notReady,
    });
  });

  it('tells the user to hold still between 10 m and 25 m, and offers capture anyway', () => {
    expect(MAX_LOW_ACCURACY_CAPTURE_M).toBe(25);
    expect(getCaptureReadiness({ ...everythingReady, accuracyMeters: 13.2 })).toEqual({
      ready: false,
      blocker: 'gps-accuracy',
      message: 'Hold the phone still while GPS settles. 14 m now, needs 10 m.',
      canCaptureAnyway: true,
      lowAccuracy: false,
    });
  });

  it('does not offer capture anyway beyond 25 m, even when it was allowed', () => {
    expect(getCaptureReadiness({ ...everythingReady, accuracyMeters: 25.1, lowAccuracyAllowed: true })).toEqual({
      ready: false,
      blocker: 'gps-accuracy',
      message: 'Hold the phone still while GPS settles. 26 m now, needs 10 m.',
      canCaptureAnyway: false,
      lowAccuracy: false,
    });
  });

  it('is ready in low-accuracy mode once capture anyway is allowed', () => {
    expect(getCaptureReadiness({ ...everythingReady, accuracyMeters: 25, lowAccuracyAllowed: true })).toEqual({
      ready: true,
      blocker: null,
      message: LOW_ACCURACY_MESSAGE,
      canCaptureAnyway: false,
      lowAccuracy: true,
    });
  });

  it('is not in low-accuracy mode when the fix is good, even if capture anyway was allowed', () => {
    expect(getCaptureReadiness({ ...everythingReady, accuracyMeters: 6, lowAccuracyAllowed: true }).lowAccuracy).toBe(false);
  });

  it('still needs the compass in low-accuracy mode', () => {
    expect(
      getCaptureReadiness({ ...everythingReady, accuracyMeters: 18, lowAccuracyAllowed: true, heading: null, compassStatus: 'waiting' })
    ).toEqual({
      ready: false,
      blocker: 'compass',
      message: 'Waiting for compass…',
      canCaptureAnyway: false,
      lowAccuracy: true,
    });
  });

  it('asks for the compass permission tap before a heading', () => {
    expect(getCaptureReadiness({ ...everythingReady, heading: null, compassStatus: 'needs-permission' })).toEqual({
      ready: false,
      blocker: 'compass-permission',
      message: 'Tap the screen to start the compass',
      ...notReady,
    });
  });

  it('explains a missing heading by compass status', () => {
    expect(getCaptureReadiness({ ...everythingReady, heading: null, compassStatus: 'denied' }).message).toBe(
      'Allow motion access for this site in Settings to map a grave'
    );
    expect(getCaptureReadiness({ ...everythingReady, heading: null, compassStatus: 'unsupported' }).message).toBe(
      'Compass not available on this device'
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/capture_readiness.test.ts`
Expected: FAIL, `MAX_LOW_ACCURACY_CAPTURE_M` is not exported and objects lack `canCaptureAnyway`.

- [ ] **Step 3: Rewrite readiness.ts**

```ts
// src/lib/capture/readiness.ts
import type { CompassStatus } from '../device/compass';

// AR guides people back to where the photo was taken, so a new grave needs an accurate fix
export const MAX_CAPTURE_ACCURACY_M = 10;
// Under trees or by a wall a phone may never get under 10 m; up to this the grave can still be saved for re-survey
export const MAX_LOW_ACCURACY_CAPTURE_M = 25;
export const LOW_ACCURACY_MESSAGE = 'Low accuracy. This grave will be marked for re-survey.';

export type CaptureBlocker = 'camera' | 'gps' | 'gps-accuracy' | 'compass-permission' | 'compass' | null;

export interface CaptureReadinessInput {
  cameraLive: boolean;
  accuracyMeters: number | null;
  heading: number | null;
  compassStatus: CompassStatus;
  // The user tapped "Capture anyway", so 10 m to 25 m is accepted for this camera session
  lowAccuracyAllowed?: boolean;
}

export interface CaptureReadiness {
  ready: boolean;
  blocker: CaptureBlocker;
  message: string;
  // The accuracy blocker could be waived with "Capture anyway"
  canCaptureAnyway: boolean;
  // The fix is worse than 10 m and the user chose to go ahead
  lowAccuracy: boolean;
}

function settlingMessage(accuracyMeters: number): string {
  return `Hold the phone still while GPS settles. ${Math.ceil(accuracyMeters)} m now, needs ${MAX_CAPTURE_ACCURACY_M} m.`;
}

// The first thing stopping the shutter, in the order a user can fix them
export function getCaptureReadiness({
  cameraLive,
  accuracyMeters,
  heading,
  compassStatus,
  lowAccuracyAllowed = false,
}: CaptureReadinessInput): CaptureReadiness {
  const blocked = (blocker: CaptureBlocker, message: string, lowAccuracy = false): CaptureReadiness => ({
    ready: false,
    blocker,
    message,
    canCaptureAnyway: false,
    lowAccuracy,
  });

  if (!cameraLive) return blocked('camera', 'Camera is not available');
  if (accuracyMeters === null) return blocked('gps', 'Locating…');

  const withinLowLimit = accuracyMeters <= MAX_LOW_ACCURACY_CAPTURE_M;
  const lowAccuracy = accuracyMeters > MAX_CAPTURE_ACCURACY_M;
  if (lowAccuracy && !(lowAccuracyAllowed && withinLowLimit)) {
    return { ...blocked('gps-accuracy', settlingMessage(accuracyMeters)), canCaptureAnyway: withinLowLimit && !lowAccuracyAllowed };
  }

  if (compassStatus === 'needs-permission') {
    return blocked('compass-permission', 'Tap the screen to start the compass', lowAccuracy);
  }
  if (heading === null) {
    const message =
      compassStatus === 'waiting'
        ? 'Waiting for compass…'
        : compassStatus === 'denied'
          ? 'Allow motion access for this site in Settings to map a grave'
          : 'Compass not available on this device';
    return blocked('compass', message, lowAccuracy);
  }

  return {
    ready: true,
    blocker: null,
    message: lowAccuracy ? LOW_ACCURACY_MESSAGE : 'Position the gravestone in the frame',
    canCaptureAnyway: false,
    lowAccuracy,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/capture_readiness.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Type check and commit**

Run: `npx tsc --noEmit`
Expected: clean (the screen ignores the new fields for now).

```bash
git add src/lib/capture/readiness.ts tests/capture_readiness.test.ts
git commit -m "feat(capture): explain the GPS wait and allow capture anyway up to 25 m

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Capture screen: smoother, lock, capture anyway, whole-grave step

**Files:**
- Modify: `src/components/screens/CaptureScreen.tsx`
- Modify: `src/app/page.tsx` (`handleCaptureComplete` and capture state)

**Interfaces:**
- Consumes: `smoothFixes`, `pruneFixes`, `TimedFix` (Task 1); `getCaptureReadiness` (Task 2).
- Produces: `onCaptureComplete(imageDataUrl: string, telemetry: DeviceTelemetry, gravePhotoDataUrl?: string)`.

- [ ] **Step 1: Change the props and imports**

In `src/components/screens/CaptureScreen.tsx` replace the lucide import and the `onCaptureComplete` prop:

```ts
import { AlertTriangle, ArrowLeft, Check, Zap, ZapOff, Grid, MapPin, Compass, CameraOff, Loader2, Lock } from 'lucide-react';
```

```ts
import { getCaptureReadiness } from '@/lib/capture/readiness';
import { pruneFixes, smoothFixes, TimedFix } from '@/lib/capture/gpsFixes';
```

```ts
  // gravePhotoDataUrl: a second photo of the whole grave, only after a low-accuracy capture in single mode
  onCaptureComplete: (imageDataUrl: string, telemetry: DeviceTelemetry, gravePhotoDataUrl?: string) => void | Promise<void>;
```

Add under `type CameraStatus`:

```ts
// stone: the usual gravestone shot. grave: the follow-up whole-grave shot after a low-accuracy capture.
type CaptureStep = 'stone' | 'grave';

// How long the accuracy blocker must persist before "Capture anyway" is offered
const CAPTURE_ANYWAY_AFTER_MS = 15_000;
const GRAVE_STEP_MESSAGE = 'Step back so the whole grave is in the frame. It helps visitors find the spot.';
```

Remove the `PositionFix` interface (the smoother's `SmoothedFix` replaces it).

- [ ] **Step 2: Replace the GPS watch with the smoother**

Replace the `fix` state line and the "Keep the position current" effect:

```ts
  // Real device readings; null until the device reports one. The compass is always on here.
  const fixesRef = useRef<TimedFix[]>([]);
  const [fix, setFix] = useState<ReturnType<typeof smoothFixes>>(null);
  const [lowAccuracyAllowed, setLowAccuracyAllowed] = useState(false);
  const [offerCaptureAnyway, setOfferCaptureAnyway] = useState(false);
  const [step, setStep] = useState<CaptureStep>('stone');
  // The stone photo waiting for its whole-grave companion
  const pendingStoneRef = useRef<{ photo: string; telemetry: DeviceTelemetry } | null>(null);
  const { heading, status: compassStatus } = useCompassHeading();
```

```ts
  // Keep the position current while the gravestone is being framed. Fixes are smoothed over the last ten
  // seconds, so a single bad reading doesn't lock the shutter and standing still improves the position.
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!isUsableGpsFix(pos.coords.latitude, pos.coords.longitude)) return;
        const now = Date.now();
        fixesRef.current = pruneFixes(fixesRef.current, now);
        fixesRef.current.push({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: now });
        setFix(smoothFixes(fixesRef.current, now));
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);
```

- [ ] **Step 3: Readiness, the capture-anyway timer and the shutter**

Replace the `readiness` block and `handleTriggerShutter`:

```ts
  const cameraLive = cameraStatus === 'live';
  const stoneReadiness = getCaptureReadiness({
    cameraLive,
    accuracyMeters: fix?.accuracy ?? null,
    heading,
    compassStatus,
    lowAccuracyAllowed,
  });
  // The whole-grave shot only needs the camera: its position and heading come from the stone shot
  const readiness =
    step === 'grave'
      ? { ready: cameraLive, blocker: cameraLive ? null : ('camera' as const), message: GRAVE_STEP_MESSAGE, canCaptureAnyway: false, lowAccuracy: false }
      : stoneReadiness;

  // "Capture anyway" appears once the accuracy blocker has held for a while; a change of blocker restarts the wait
  useEffect(() => {
    if (readiness.blocker !== 'gps-accuracy') {
      setOfferCaptureAnyway(false);
      return;
    }
    const timer = window.setTimeout(() => setOfferCaptureAnyway(true), CAPTURE_ANYWAY_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [readiness.blocker]);

  const snapFrame = (): { photo: string; width: number; height: number } | null => {
    const video = videoRef.current;
    if (!video) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 960;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return { photo: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height };
  };

  const finishCapture = async (photo: string, telemetry: DeviceTelemetry, gravePhoto?: string) => {
    if (!isSurvey) {
      void onCaptureComplete(photo, telemetry, gravePhoto);
      return;
    }
    setShot('storing');
    try {
      await onCaptureComplete(photo, telemetry);
      setShot('queued');
    } catch {
      setShot('failed');
    }
  };

  const handleTriggerShutter = async () => {
    if (!readiness.ready || shot === 'storing') return;

    if (step === 'grave') {
      const pending = pendingStoneRef.current;
      const frame = snapFrame();
      if (!pending || !frame) return;
      pendingStoneRef.current = null;
      await finishCapture(pending.photo, pending.telemetry, frame.photo);
      return;
    }

    if (!fix || heading === null) return;
    const frame = snapFrame();
    if (!frame) return;
    const telemetry: DeviceTelemetry = {
      latitude: fix.lat,
      longitude: fix.lng,
      gpsAccuracy: Number(fix.accuracy.toFixed(1)),
      headingDegrees: heading,
      timestamp: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      imageDimensions: { width: frame.width, height: frame.height },
    };

    // A low-accuracy grave is harder to find again, so ask for a photo of the whole grave as a visual clue
    if (!isSurvey && readiness.lowAccuracy) {
      pendingStoneRef.current = { photo: frame.photo, telemetry };
      setStep('grave');
      return;
    }
    await finishCapture(frame.photo, telemetry);
  };

  const skipGravePhoto = () => {
    const pending = pendingStoneRef.current;
    if (!pending) return;
    pendingStoneRef.current = null;
    void finishCapture(pending.photo, pending.telemetry);
  };
```

- [ ] **Step 4: Header, reticle, guidance and shutter markup**

Header: replace the `{isSurvey ? (<button ... Done) : (<button ... Back)}` block with:

```tsx
        {step === 'grave' ? (
          <button
            onClick={skipGravePhoto}
            className="h-9 px-3.5 rounded-full bg-white/20 backdrop-blur-md text-xs font-semibold hover:bg-white/30 transition-colors"
          >
            Skip
          </button>
        ) : isSurvey ? (
          <button
            onClick={onBack}
            className="h-9 px-3.5 rounded-full bg-white/20 backdrop-blur-md text-xs font-semibold hover:bg-white/30 transition-colors"
          >
            Done
          </button>
        ) : (
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/30 transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
          </button>
        )}
```

Title: replace `{isSurvey ? 'Survey' : 'Capture Grave'}` with `{step === 'grave' ? 'Photograph the whole grave' : isSurvey ? 'Survey' : 'Capture Grave'}`.

Reticle: replace `className="w-full max-w-[280px] aspect-[3/4] border-2 ..."` with

```tsx
        <div
          className={`w-full border-2 border-emerald-400/90 rounded-3xl relative shadow-[0_0_20px_rgba(16,185,129,0.3)] ${
            step === 'grave' ? 'max-w-[340px] aspect-[4/3]' : 'max-w-[280px] aspect-[3/4]'
          }`}
        >
```

Guidance: directly after the guidance pill's closing `</div>` (the one with `role="status"`), add:

```tsx
        {offerCaptureAnyway && readiness.canCaptureAnyway && (
          <button
            onClick={() => setLowAccuracyAllowed(true)}
            className="mt-2 text-[11px] font-semibold text-amber-300 underline underline-offset-2 pointer-events-auto"
          >
            Capture anyway
          </button>
        )}
```

Shutter: replace the shutter `<button>` with

```tsx
        <button
          onClick={handleTriggerShutter}
          disabled={!readiness.ready || shot === 'storing'}
          className={`w-18 h-18 rounded-full border-4 flex items-center justify-center p-1 group active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100 ${
            readiness.lowAccuracy ? 'border-amber-400' : 'border-white'
          }`}
          aria-label="Take Photo"
          title={readiness.ready ? 'Take photo' : readiness.message}
        >
          <div className="w-14 h-14 rounded-full bg-white group-hover:bg-emerald-100 group-disabled:group-hover:bg-white transition-colors flex items-center justify-center">
            {readiness.blocker === 'gps-accuracy' && <Lock className="w-5 h-5 text-slate-500" aria-hidden="true" />}
          </div>
        </button>
```

- [ ] **Step 5: Page state for the whole-grave photo**

In `src/app/page.tsx`, next to `capturedTelemetry`:

```ts
  // Whole-grave photo taken after a low-accuracy capture; saved after the grave itself
  const [capturedGravePhoto, setCapturedGravePhoto] = useState<string | null>(null);
```

Replace `handleCaptureComplete`:

```ts
  const handleCaptureComplete = async (dataUrl: string, telemetry: DeviceTelemetry, gravePhotoDataUrl?: string) => {
    // Survey photos are stored and processed in the background; a failure here tells the camera to say so.
    // A survey-mode shot must never fall through to the paid ai-processing path below.
    if (captureMode === 'survey') {
      if (surveyForCamera) await queueSurveyCapture(surveyForCamera, dataUrl, telemetry, cemeteries);
      return;
    }
    setCapturedImage(dataUrl);
    setCapturedTelemetry(telemetry);
    setCapturedGravePhoto(gravePhotoDataUrl ?? null);
    // A photo for an existing grave skips the AI read and the new-grave form
    setCurrentScreen(photoTargetGrave ? 'add-photo' : 'ai-processing');
  };
```

In `handleReviewCapture` (survey review), after `setCapturedTelemetry(capture.telemetry);` add `setCapturedGravePhoto(null);`.

- [ ] **Step 6: Type check and run the tests**

Run: `npx tsc --noEmit` then `npx vitest run`
Expected: clean; 44 files, 320 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/screens/CaptureScreen.tsx src/app/page.tsx
git commit -m "feat(capture): hold-still guidance, capture anyway and a whole-grave photo step

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Migration: photo kind, observations, visits, 25 m limit

**Files:**
- Create: `supabase/migrations/20260915200000_position_observations.sql`
- Test: `tests/position_observations_migration.test.ts`

**Interfaces:**
- Produces (database): `grave_photos.kind`, `graves.grave_photo_url`, `graves.observation_count`, table `grave_position_observations`, functions `recompute_grave_position(text)`, `add_grave_position_observation(text, uuid, double precision, double precision, double precision, text, timestamptz)`, `record_photo_observation()` trigger, `record_grave_visit(text, double precision, double precision, double precision) returns jsonb` with keys `latitude, longitude, position_accuracy_meters, position_confidence, status, observation_count`.

- [ ] **Step 1: Write the failing migration test**

```ts
// tests/position_observations_migration.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20260915200000_position_observations.sql'),
  'utf8'
);

describe('Position Observations Migration Tests', () => {
  it('adds the photo kind and the whole-grave photo url', () => {
    expect(MIGRATION).toMatch(/alter table public\.grave_photos add column if not exists kind text not null default 'stone';/);
    expect(MIGRATION).toMatch(/check \(kind in \('stone', 'grave'\)\)/);
    expect(MIGRATION).toMatch(/alter table public\.graves add column if not exists grave_photo_url text;/);
    expect(MIGRATION).toMatch(/alter table public\.graves add column if not exists observation_count int not null default 0;/);
    expect(MIGRATION).toMatch(/where p\.grave_id = target_grave_id and p\.kind = 'grave'/);
    expect(MIGRATION).toMatch(/after insert or delete or update of is_primary, public_url, kind on public\.grave_photos/);
  });

  it('creates a locked-down observations table', () => {
    expect(MIGRATION).toMatch(/create table if not exists public\.grave_position_observations/);
    expect(MIGRATION).toMatch(/accuracy_meters double precision not null check \(accuracy_meters > 0 and accuracy_meters <= 25\)/);
    expect(MIGRATION).toMatch(/source text not null check \(source in \('photo', 'visit'\)\)/);
    expect(MIGRATION).toMatch(/alter table public\.grave_position_observations enable row level security;/);
    expect(MIGRATION).toMatch(/on public\.grave_position_observations for select/);
    expect(MIGRATION).not.toMatch(/on public\.grave_position_observations for (insert|update|delete)/);
  });

  it('recomputes the position with an inverse-variance mean, a 1.5 m floor and the save thresholds', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.recompute_grave_position\(p_grave_id text\)/);
    expect(MIGRATION).toMatch(/1 \/ greatest\(0\.25, accuracy_meters \* accuracy_meters\)/);
    expect(MIGRATION).toMatch(/greatest\(1\.5, sqrt\(1 \/ nullif\(sum\(w\), 0\)\)\)/);
    expect(MIGRATION).toMatch(/when v_accuracy <= 3\.5 then 'HIGH'/);
    expect(MIGRATION).toMatch(/when v_accuracy <= 6 then 'MEDIUM'/);
    expect(MIGRATION).toMatch(/when v_accuracy <= 5 then 'MAPPED' else 'LOW_CONFIDENCE'/);
    expect(MIGRATION).toMatch(/when status = 'VERIFIED' then latitude else v_lat/);
  });

  it('counts one observation per user per grave per six hours', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.add_grave_position_observation\(/);
    expect(MIGRATION).toMatch(/interval '6 hours'/);
    expect(MIGRATION).toMatch(/if p_accuracy_meters < v_existing\.accuracy_meters then/);
    expect(MIGRATION).toMatch(/pg_advisory_xact_lock\(hashtext\(p_grave_id\)\)/);
  });

  it('turns every photo with a position into an observation', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.record_photo_observation\(\)/);
    expect(MIGRATION).toMatch(/create trigger grave_photos_record_observation\s+after insert on public\.grave_photos/);
    expect(MIGRATION).toMatch(/coalesce\(new\.captured_at, now\(\)\)/);
  });

  it('records visits from signed-in users within 30 m', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.record_grave_visit\(/);
    expect(MIGRATION).toMatch(/if v_distance > 30 then/);
    expect(MIGRATION).toMatch(/'observation_count', v_grave\.observation_count/);
    expect(MIGRATION).toMatch(/revoke execute on function public\.record_grave_visit\([^)]*\) from public, anon;/);
    expect(MIGRATION).toMatch(/grant execute on function public\.record_grave_visit\([^)]*\) to authenticated;/);
  });

  it('keeps the internal functions away from app roles', () => {
    expect(MIGRATION).toMatch(/revoke execute on function public\.recompute_grave_position\(text\) from public, anon, authenticated;/);
    expect(MIGRATION).toMatch(/revoke execute on function public\.add_grave_position_observation\([^)]*\) from public, anon, authenticated;/);
  });

  it('accepts captures up to 25 m', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.save_or_add_grave\(/);
    expect(MIGRATION).toMatch(/p_accuracy_meters > 25 then\s+raise exception 'GPS accuracy must be 25 m or better\.'/);
    expect(MIGRATION).not.toMatch(/p_accuracy_meters > 10 then/);
  });

  it('backfills observations from existing photos', () => {
    expect(MIGRATION).toMatch(/for p in\s+select grave_id, uploaded_by, capture_latitude, capture_longitude, gps_accuracy_meters/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/position_observations_migration.test.ts`
Expected: FAIL, ENOENT for the migration file.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260915200000_position_observations.sql` with this content. The `save_or_add_grave` section is the function from `supabase/migrations/20260915180000_duplicate_graves.sql` lines 121 to 300 copied verbatim, with exactly one change, shown after the SQL block.

```sql
-- ============================================================
-- QabrMap: whole-grave photos, position observations and visits
-- Run in Supabase Dashboard > SQL Editor > New query. Safe to run more than once.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Whole-grave photos
-- ------------------------------------------------------------

-- stone: the gravestone. grave: a wider shot of the whole grave, taken after a low-accuracy capture
alter table public.grave_photos add column if not exists kind text not null default 'stone';
alter table public.grave_photos drop constraint if exists grave_photos_kind_check;
alter table public.grave_photos add constraint grave_photos_kind_check check (kind in ('stone', 'grave'));

-- The whole-grave photo, shown as "Look for this grave" when navigating
alter table public.graves add column if not exists grave_photo_url text;
-- How many independent position observations the grave's position is built from
alter table public.graves add column if not exists observation_count int not null default 0;

-- Keeps graves.photo_count, primary_photo_url and grave_photo_url in step with grave_photos. App users can't
-- update graves directly, so this runs as the function owner; it only touches the grave the photo belongs to.
create or replace function public.sync_grave_photo_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_grave_id text := coalesce(new.grave_id, old.grave_id);
begin
  update public.graves g
  set
    photo_count = (select count(*) from public.grave_photos p where p.grave_id = target_grave_id),
    primary_photo_url = coalesce(
      (
        select p.public_url
        from public.grave_photos p
        where p.grave_id = target_grave_id
        order by p.is_primary desc, (p.kind = 'stone') desc, p.created_at asc
        limit 1
      ),
      '/sample-gravestone.svg'
    ),
    grave_photo_url = (
      select p.public_url
      from public.grave_photos p
      where p.grave_id = target_grave_id and p.kind = 'grave'
      order by p.created_at asc
      limit 1
    ),
    updated_at = now()
  where g.id = target_grave_id;
  return null;
end;
$$;

revoke execute on function public.sync_grave_photo_summary() from public, anon, authenticated;

drop trigger if exists grave_photos_sync_summary on public.grave_photos;
create trigger grave_photos_sync_summary
  after insert or delete or update of is_primary, public_url, kind on public.grave_photos
  for each row execute function public.sync_grave_photo_summary();

-- ------------------------------------------------------------
-- 2. Position observations
-- ------------------------------------------------------------

-- Every GPS fix taken at a grave: from a photo, or from someone confirming they found it. Fixes on different
-- days have independent errors, so their weighted mean is better than any one of them.
create table if not exists public.grave_position_observations (
  id uuid primary key default gen_random_uuid(),
  grave_id text not null references public.graves (id) on delete cascade,
  observed_by uuid references auth.users (id) on delete set null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_meters double precision not null check (accuracy_meters > 0 and accuracy_meters <= 25),
  source text not null check (source in ('photo', 'visit')),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists grave_position_observations_grave_id_observed_at_idx
  on public.grave_position_observations (grave_id, observed_at);
create index if not exists grave_position_observations_observed_by_idx
  on public.grave_position_observations (observed_by);

alter table public.grave_position_observations enable row level security;

drop policy if exists "Grave observations are publicly readable" on public.grave_position_observations;
create policy "Grave observations are publicly readable"
  on public.grave_position_observations for select
  to anon, authenticated
  using (true);

-- Inverse-variance mean of a grave's observations. A verified grave keeps its position but still counts them.
create or replace function public.recompute_grave_position(p_grave_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
  v_lat double precision;
  v_lng double precision;
  v_accuracy numeric;
begin
  select
    count(*),
    sum(latitude * w) / nullif(sum(w), 0),
    sum(longitude * w) / nullif(sum(w), 0),
    greatest(1.5, sqrt(1 / nullif(sum(w), 0)))
  into v_count, v_lat, v_lng, v_accuracy
  from (
    select latitude, longitude, 1 / greatest(0.25, accuracy_meters * accuracy_meters) as w
    from public.grave_position_observations
    where grave_id = p_grave_id
  ) o;

  if v_count = 0 then
    update public.graves set observation_count = 0 where id = p_grave_id;
    return;
  end if;

  v_accuracy := round(v_accuracy, 2);

  -- In an UPDATE, columns on the right-hand side are the values before the update
  update public.graves
  set
    observation_count = v_count,
    latitude = case when status = 'VERIFIED' then latitude else v_lat end,
    longitude = case when status = 'VERIFIED' then longitude else v_lng end,
    position_accuracy_meters = case when status = 'VERIFIED' then position_accuracy_meters else v_accuracy end,
    position_confidence = case
      when status = 'VERIFIED' then position_confidence
      when v_accuracy <= 3.5 then 'HIGH'
      when v_accuracy <= 6 then 'MEDIUM'
      else 'LOW'
    end,
    status = case
      when status in ('MAPPED', 'LOW_CONFIDENCE') then (case when v_accuracy <= 5 then 'MAPPED' else 'LOW_CONFIDENCE' end)
      else status
    end,
    updated_at = case when status = 'VERIFIED' then updated_at else now() end
  where id = p_grave_id;
end;
$$;

revoke execute on function public.recompute_grave_position(text) from public, anon, authenticated;

-- Adds one observation and recomputes the grave. Fixes taken minutes apart share the same GPS error, so one
-- person's fixes within six hours count once, keeping the most accurate. Safe to call again with the same fix.
create or replace function public.add_grave_position_observation(
  p_grave_id text,
  p_user_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_source text,
  p_observed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_observed_at timestamptz := coalesce(p_observed_at, now());
  v_existing record;
begin
  if p_accuracy_meters is null or p_accuracy_meters <= 0 or p_accuracy_meters > 25 then return; end if;
  if p_latitude is null or p_longitude is null
    or p_latitude < -90 or p_latitude > 90
    or p_longitude < -180 or p_longitude > 180
    or (p_latitude = 0 and p_longitude = 0) then
    return;
  end if;
  if not exists (select 1 from public.graves where id = p_grave_id) then return; end if;

  -- Observations for one grave are added one at a time so two recomputes can't interleave
  perform pg_advisory_xact_lock(hashtext(p_grave_id));

  -- The same fix again (a re-run of the backfill) changes nothing
  if exists (
    select 1 from public.grave_position_observations
    where grave_id = p_grave_id and latitude = p_latitude and longitude = p_longitude
      and accuracy_meters = p_accuracy_meters and observed_at = v_observed_at
  ) then
    return;
  end if;

  if p_user_id is not null then
    select id, accuracy_meters into v_existing
      from public.grave_position_observations
      where grave_id = p_grave_id and observed_by = p_user_id
        and observed_at between v_observed_at - interval '6 hours' and v_observed_at + interval '6 hours'
      order by observed_at desc
      limit 1;
    if found then
      if p_accuracy_meters < v_existing.accuracy_meters then
        update public.grave_position_observations
        set latitude = p_latitude, longitude = p_longitude, accuracy_meters = p_accuracy_meters, observed_at = v_observed_at
        where id = v_existing.id;
        perform public.recompute_grave_position(p_grave_id);
      end if;
      return;
    end if;
  end if;

  insert into public.grave_position_observations (grave_id, observed_by, latitude, longitude, accuracy_meters, source, observed_at)
  values (p_grave_id, p_user_id, p_latitude, p_longitude, p_accuracy_meters, p_source, v_observed_at);
  perform public.recompute_grave_position(p_grave_id);
end;
$$;

revoke execute on function public.add_grave_position_observation(text, uuid, double precision, double precision, double precision, text, timestamptz) from public, anon, authenticated;

-- Every photo taken at the grave is an observation: a new grave, a photo added to a match, or a survey match
create or replace function public.record_photo_observation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.capture_latitude is not null and new.capture_longitude is not null and new.gps_accuracy_meters is not null then
    perform public.add_grave_position_observation(
      new.grave_id, new.uploaded_by, new.capture_latitude, new.capture_longitude, new.gps_accuracy_meters,
      'photo', coalesce(new.captured_at, now())
    );
  end if;
  return null;
end;
$$;

revoke execute on function public.record_photo_observation() from public, anon, authenticated;

drop trigger if exists grave_photos_record_observation on public.grave_photos;
create trigger grave_photos_record_observation
  after insert on public.grave_photos
  for each row execute function public.record_photo_observation();

-- "I found it" from navigation. Runs as the owner, so it checks the caller and the distance itself.
create or replace function public.record_grave_visit(
  p_grave_id text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_grave record;
  v_distance double precision;
begin
  if v_caller is null then
    raise exception 'Sign in to confirm a grave.' using errcode = '42501';
  end if;

  select latitude, longitude into v_grave from public.graves where id = p_grave_id;
  if not found then
    raise exception 'That grave no longer exists.' using errcode = 'P0002';
  end if;

  if p_accuracy_meters is null or p_accuracy_meters <= 0 or p_accuracy_meters > 25 then
    raise exception 'GPS accuracy must be 25 m or better.' using errcode = '22023';
  end if;

  if p_latitude is null or p_longitude is null
    or p_latitude < -90 or p_latitude > 90
    or p_longitude < -180 or p_longitude > 180
    or (p_latitude = 0 and p_longitude = 0) then
    raise exception 'The GPS position is not valid.' using errcode = '22023';
  end if;

  -- Haversine distance in metres between the visitor and the grave's current position
  v_distance := 2 * 6371000 * asin(sqrt(
    power(sin(radians(p_latitude - v_grave.latitude) / 2), 2)
    + cos(radians(v_grave.latitude)) * cos(radians(p_latitude)) * power(sin(radians(p_longitude - v_grave.longitude) / 2), 2)
  ));
  if v_distance > 30 then
    raise exception 'You''re too far from this grave to confirm it.' using errcode = '22023';
  end if;

  perform public.add_grave_position_observation(p_grave_id, v_caller, p_latitude, p_longitude, p_accuracy_meters, 'visit', now());

  select latitude, longitude, position_accuracy_meters, position_confidence, status, observation_count
    into v_grave
    from public.graves
    where id = p_grave_id;

  return jsonb_build_object(
    'latitude', v_grave.latitude,
    'longitude', v_grave.longitude,
    'position_accuracy_meters', v_grave.position_accuracy_meters,
    'position_confidence', v_grave.position_confidence,
    'status', v_grave.status,
    'observation_count', v_grave.observation_count
  );
end;
$$;

revoke execute on function public.record_grave_visit(text, double precision, double precision, double precision) from public, anon;
grant execute on function public.record_grave_visit(text, double precision, double precision, double precision) to authenticated;

-- ------------------------------------------------------------
-- 3. Captures up to 25 m
-- ------------------------------------------------------------

-- (save_or_add_grave from 20260915180000_duplicate_graves.sql, with the accuracy limit raised to 25 m)
```

Then append the function: open `supabase/migrations/20260915180000_duplicate_graves.sql`, copy from the line `-- Saves a captured grave. Depending on p_match_mode it creates the grave (new), reports a likely match` (line 118) through the `grant execute on function public.save_or_add_grave(...) to authenticated;` line (line 300) and paste it at the end of the new migration. Then change these two lines in the pasted copy:

```sql
  if p_accuracy_meters is null or p_accuracy_meters < 0 or p_accuracy_meters > 10 then
    raise exception 'GPS accuracy must be 10 m or better.' using errcode = '22023';
```

to

```sql
  if p_accuracy_meters is null or p_accuracy_meters < 0 or p_accuracy_meters > 25 then
    raise exception 'GPS accuracy must be 25 m or better.' using errcode = '22023';
```

Finally append the backfill:

```sql
-- ------------------------------------------------------------
-- 4. Backfill observations from the photos already taken
-- ------------------------------------------------------------

do $$
declare
  p record;
begin
  for p in
    select grave_id, uploaded_by, capture_latitude, capture_longitude, gps_accuracy_meters,
           coalesce(captured_at, created_at) as observed_at
    from public.grave_photos
    where capture_latitude is not null and capture_longitude is not null and gps_accuracy_meters is not null
    order by created_at
  loop
    perform public.add_grave_position_observation(
      p.grave_id, p.uploaded_by, p.capture_latitude, p.capture_longitude, p.gps_accuracy_meters, 'photo', p.observed_at
    );
  end loop;
end;
$$;
```

- [ ] **Step 4: Run the migration test and the older ones**

Run: `npx vitest run tests/position_observations_migration.test.ts tests/duplicate_graves_migration.test.ts`
Expected: PASS. The duplicate-graves test still reads its own file, so it is unaffected.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260915200000_position_observations.sql tests/position_observations_migration.test.ts
git commit -m "feat(db): position observations, grave visits, whole-grave photos and a 25 m capture limit

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Types and mappers for the new columns

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/supabase/mappers.ts`
- Modify: `src/lib/data/store.ts` (`addGravePhoto`)
- Modify: `tests/grave_photos.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type GravePhotoKind = 'stone' | 'grave';
  // Grave gains: gravePhotoUrl?: string; observationCount?: number
  // GravePhoto gains: kind: GravePhotoKind
  // dataStore.addGravePhoto(grave: Pick<Grave, 'id' | 'cemeteryId'>, imageDataUrl: string, telemetry?: DeviceTelemetry, kind: GravePhotoKind = 'stone'): Promise<GravePhoto>
  ```

- [ ] **Step 1: Extend the mapper test**

In `tests/grave_photos.test.ts`, in the first test (`maps a grave_photos row into the app photo shape`), add `kind: 'grave',` to the input row and `kind: 'grave',` to the expected object (after `isPrimary`). Then add a new test in the same `describe`:

```ts
  it('treats an older photo row without a kind as a stone photo', () => {
    expect(
      mapDbGravePhoto({ id: 'p2', grave_id: 'g', public_url: 'https://x/p2.jpg', is_primary: false, created_at: '2026-09-15T00:00:00Z' }).kind
    ).toBe('stone');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/grave_photos.test.ts`
Expected: FAIL, `kind` missing from the mapped object.

- [ ] **Step 3: Types**

In `src/types/index.ts`, in `Grave` after `photoCount: number;`:

```ts
  // Whole-grave photo shown as "Look for this grave" while navigating
  gravePhotoUrl?: string;
  // Independent GPS observations the position is averaged from; 0 or missing for seeded graves
  observationCount?: number;
```

Above `export interface GravePhoto`:

```ts
// stone: the gravestone. grave: the whole grave, a visual clue for visitors
export type GravePhotoKind = 'stone' | 'grave';
```

In `GravePhoto` after `isPrimary: boolean;`: `kind: GravePhotoKind;`

- [ ] **Step 4: Mappers**

In `mapDbGrave` after `photoCount: row.photo_count || 0,`:

```ts
    gravePhotoUrl: row.grave_photo_url || undefined,
    observationCount: row.observation_count || 0,
```

In `mapDbGravePhoto` after `isPrimary: Boolean(row.is_primary),`:

```ts
    kind: row.kind === 'grave' ? 'grave' : 'stone',
```

- [ ] **Step 5: addGravePhoto writes the kind**

In `src/lib/data/store.ts`, import `GravePhotoKind` from `@/types` alongside `GravePhoto`, and change the signature and insert:

```ts
  // Uploads a photo and attaches it to an existing grave. Needs a signed-in user and a connection.
  async addGravePhoto(
    grave: Pick<Grave, 'id' | 'cemeteryId'>,
    imageDataUrl: string,
    telemetry?: DeviceTelemetry,
    kind: GravePhotoKind = 'stone'
  ): Promise<GravePhoto> {
```

and in the `.insert({ ... })` object add `kind,` after `uploaded_by: auth.user.id,`.

- [ ] **Step 6: Run tests, type check, commit**

Run: `npx vitest run tests/grave_photos.test.ts` then `npx tsc --noEmit`
Expected: PASS; clean. If `tsc` complains that objects typed `GravePhoto` elsewhere lack `kind` (for example in `tests/photo_carousel.test.ts` or a mock), add `kind: 'stone'` to those objects.

```bash
git add src/types/index.ts src/lib/supabase/mappers.ts src/lib/data/store.ts tests/grave_photos.test.ts
git commit -m "feat(graves): photo kind, whole-grave photo url and observation count

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Save the whole-grave photo after the grave

**Files:**
- Modify: `src/lib/capture/saveMappedGrave.ts`
- Modify: `tests/save_mapped_grave.test.ts`
- Modify: `src/lib/data/store.ts` (`saveNewGrave`, `SaveNewGraveResult`)
- Modify: `src/components/screens/ConfirmDetailsScreen.tsx`
- Modify: `src/components/screens/GraveDetailsScreen.tsx` (notice prop)
- Modify: `src/app/page.tsx`

**Interfaces:**
- Produces:
  ```ts
  // SaveMappedGraveInput gains: gravePhotoDataUrl?: string
  // SaveMappedGraveDeps gains: saveGravePhoto?: (graveId: string, cemeteryId: string, dataUrl: string) => Promise<void>
  // SavedGraveResult gains: gravePhotoSaved?: boolean   (undefined when no whole-grave photo was given)
  // SaveNewGraveResult: { outcome: 'created' | 'added-photo'; grave: Grave; gravePhotoSaved?: boolean } | MatchFoundResult
  // ConfirmDetailsScreen prop: gravePhoto?: string; onSaved(grave, outcome, gravePhotoSaved?: boolean)
  // GraveDetailsScreen prop: notice?: string | null
  ```

- [ ] **Step 1: Write the failing tests**

Append to `tests/save_mapped_grave.test.ts` inside the main `describe`. The file already has `input(overrides)` (a full `SaveMappedGraveInput`) and `makeDeps(overrides)` (deps whose `rpc` answers `{ outcome: 'created', grave_id: 'grave_id1' }` and whose `auth.getUser` returns a user), so use those:

```ts
  it('saves the whole-grave photo after the grave and reports it', async () => {
    const saveGravePhoto = vi.fn(async () => {});
    const deps = makeDeps({ saveGravePhoto });
    const result = await saveMappedGrave(input({ gravePhotoDataUrl: 'data:image/jpeg;base64,grave' }), deps);
    expect(result).toMatchObject({ outcome: 'created', graveId: 'grave_id1', gravePhotoSaved: true });
    expect(saveGravePhoto).toHaveBeenCalledWith('grave_id1', 'cem_athlone', 'data:image/jpeg;base64,grave');
  });

  it('keeps the saved grave when the whole-grave photo fails', async () => {
    const saveGravePhoto = vi.fn(async () => {
      throw new Error('storage down');
    });
    const result = await saveMappedGrave(input({ gravePhotoDataUrl: 'data:image/jpeg;base64,grave' }), makeDeps({ saveGravePhoto }));
    expect(result).toMatchObject({ outcome: 'created', gravePhotoSaved: false });
  });

  it('does not touch the whole-grave photo when none was taken', async () => {
    const saveGravePhoto = vi.fn(async () => {});
    const result = await saveMappedGrave(input(), makeDeps({ saveGravePhoto }));
    expect(saveGravePhoto).not.toHaveBeenCalled();
    expect((result as { gravePhotoSaved?: boolean }).gravePhotoSaved).toBeUndefined();
  });
```

If `makeDeps` returns a type that does not yet allow `saveGravePhoto` in its overrides, widen its parameter to `Partial<SaveMappedGraveDeps>` (it already imports that type).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/save_mapped_grave.test.ts`
Expected: FAIL, `gravePhotoSaved` undefined and `saveGravePhoto` never called.

- [ ] **Step 3: saveMappedGrave**

In `src/lib/capture/saveMappedGrave.ts`:

```ts
export interface SaveMappedGraveInput {
  form: NewGraveForm;
  cemeteryName?: string;
  photoDataUrl: string;
  telemetry: DeviceTelemetry;
  attempt: SaveAttempt;
  matchMode: MatchMode;
  // Adds the photo to this grave instead of creating one
  addToGraveId?: string;
  // Whole-grave photo taken after a low-accuracy capture, saved once the grave exists
  gravePhotoDataUrl?: string;
}

// Passed in so the save can be tested without Supabase
export interface SaveMappedGraveDeps {
  client: Pick<SupabaseClient, 'rpc' | 'auth'>;
  isOnline: () => boolean;
  uploadPhoto: (options: UploadPhotoOptions) => Promise<UploadPhotoResult | null>;
  deletePhoto: (path: string) => Promise<boolean>;
  saveGravePhoto?: (graveId: string, cemeteryId: string, dataUrl: string) => Promise<void>;
}

export interface SavedGraveResult {
  outcome: 'created' | 'added-photo';
  graveId: string;
  personId: string;
  photoUrl: string;
  // Only set when a whole-grave photo was given: false means the grave saved but the extra photo didn't
  gravePhotoSaved?: boolean;
}
```

Replace the final `return` of `saveMappedGrave`:

```ts
  const saved: SavedGraveResult = { outcome: outcome.outcome, graveId: outcome.graveId, personId: attempt.personId, photoUrl: upload.publicUrl };
  // The grave is saved at this point; the whole-grave photo is a bonus, so its failure is reported, not thrown
  if (input.gravePhotoDataUrl && deps.saveGravePhoto) {
    try {
      await deps.saveGravePhoto(outcome.graveId, form.cemeteryId, input.gravePhotoDataUrl);
      saved.gravePhotoSaved = true;
    } catch {
      saved.gravePhotoSaved = false;
    }
  }
  return saved;
```

- [ ] **Step 4: Store**

In `src/lib/data/store.ts`:

```ts
export type SaveNewGraveResult =
  | { outcome: 'created' | 'added-photo'; grave: Grave; gravePhotoSaved?: boolean }
  | MatchFoundResult;
```

In `saveNewGrave`, add the dep and pass the flag through:

```ts
    const result = await saveMappedGrave(input, {
      client: supabase,
      isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
      uploadPhoto: uploadGravePhoto,
      deletePhoto: deleteGravePhoto,
      saveGravePhoto: async (graveId, cemeteryId, dataUrl) => {
        await this.addGravePhoto({ id: graveId, cemeteryId }, dataUrl, input.telemetry, 'grave');
      },
    });
```

and the last line becomes `return { outcome: result.outcome, grave: saved, gravePhotoSaved: result.gravePhotoSaved };`.

- [ ] **Step 5: Confirm screen passes it through**

In `src/components/screens/ConfirmDetailsScreen.tsx`:

- Props: add `gravePhoto?: string;` after `cemeteries: Cemetery[];` and change `onSaved` to `onSaved: (grave: Grave, outcome: 'created' | 'added-photo', gravePhotoSaved?: boolean) => void;`.
- Destructure `gravePhoto` in the component parameters.
- In `save`, add `gravePhotoDataUrl: gravePhoto,` to the `saveNewGrave` input and change `onSaved(result.grave, result.outcome);` to `onSaved(result.grave, result.outcome, result.gravePhotoSaved);`.

- [ ] **Step 6: Details screen notice**

In `src/components/screens/GraveDetailsScreen.tsx` props add:

```ts
  // One-off message from the screen that opened this one, such as a photo that couldn't be saved
  notice?: string | null;
```

Destructure `notice = null`. Directly after the `{shareNotice && (...)}` block add:

```tsx
        {!shareNotice && notice && (
          <div className="absolute top-full right-4 mt-2 flex items-center text-[11px] font-semibold text-white bg-slate-900/90 px-3 py-1.5 rounded-full shadow-lg">
            <AlertTriangle className="w-3.5 h-3.5 mr-1 text-amber-300" />
            {notice}
          </div>
        )}
```

- [ ] **Step 7: Page**

In `src/app/page.tsx`:

```ts
  // Shown once on the grave details page after a save, for example when the whole-grave photo failed
  const [detailsNotice, setDetailsNotice] = useState<string | null>(null);
```

Replace `handleGraveSaved`:

```ts
  // A saved grave opens on its own details page
  const handleGraveSaved = (saved: Grave, outcome: 'created' | 'added-photo', gravePhotoSaved?: boolean) => {
    setSelectedGrave(saved);
    // The photo went onto a grave that was already mapped, so its photo carousel must reload
    if (outcome === 'added-photo') setGravePhotosVersion((v) => v + 1);
    setDetailsNotice(gravePhotoSaved === false ? "The whole-grave photo couldn't be saved. You can add it from this page." : null);
    setCapturedGravePhoto(null);
    const cemetery = cemeteries.find((c) => c.id === saved.cemeteryId);
    if (cemetery) setSelectedCemetery(cemetery);
    dataStore.getGraves(saved.cemeteryId).then(setGraves);
    setPreviousScreen('home');
    setCurrentNavTab('home');
    setCurrentScreen('grave-details');
  };
```

Pass `gravePhoto={capturedGravePhoto ?? undefined}` to every `<ConfirmDetailsScreen` and `notice={detailsNotice}` to `<GraveDetailsScreen`. In `leaveGraveDetails` (or wherever the details screen is left; search for `const leaveGraveDetails`), add `setDetailsNotice(null);` as its first line.

- [ ] **Step 8: Run tests, type check, commit**

Run: `npx vitest run tests/save_mapped_grave.test.ts` then `npx tsc --noEmit`
Expected: PASS; clean.

```bash
git add src/lib/capture/saveMappedGrave.ts tests/save_mapped_grave.test.ts src/lib/data/store.ts src/components/screens/ConfirmDetailsScreen.tsx src/components/screens/GraveDetailsScreen.tsx src/app/page.tsx
git commit -m "feat(capture): save the whole-grave photo after a low-accuracy capture

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Visit helpers and `recordGraveVisit`

**Files:**
- Create: `src/lib/graves/visits.ts`
- Test: `tests/grave_visits.test.ts`
- Modify: `src/lib/data/store.ts`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface VisitFix { lat: number; lng: number; accuracy: number }
  export interface VisitResult { latitude: number; longitude: number; positionAccuracyMeters: number; positionConfidence: ConfidenceLevel; status: GraveStatus; observationCount: number }
  export const VISIT_FAILED_MESSAGE = "Your visit couldn't be recorded. Please try again.";
  export const MAX_VISIT_ACCURACY_M = 25;
  export function parseVisitResult(data: unknown): VisitResult | null;
  export function applyVisitResult(grave: Grave, result: VisitResult): Grave;
  export function describeVisit(grave: Grave): string;   // "Thanks. Position now ± 3.2 m from 4 visits."
  export function canConfirmVisit(fix: VisitFix | null): boolean;   // accuracy within 25 m
  // dataStore.recordGraveVisit(grave: Grave, fix: VisitFix): Promise<Grave>
  // page.tsx: onConfirmVisit?: (grave: Grave, fix: VisitFix) => Promise<Grave>
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/grave_visits.test.ts
import { describe, it, expect } from 'vitest';
import type { Grave } from '../src/types';
import { applyVisitResult, canConfirmVisit, describeVisit, parseVisitResult } from '../src/lib/graves/visits';
import { mapDbGrave } from '../src/lib/supabase/mappers';

const grave: Grave = {
  id: 'grave_1',
  cemeteryId: 'cem_athlone',
  graveNumber: '1402',
  latitude: -33.9675,
  longitude: 18.5033,
  positionAccuracyMeters: 12,
  positionConfidence: 'LOW',
  status: 'LOW_CONFIDENCE',
  photoCount: 1,
  observationCount: 1,
  createdAt: '2026-09-15T00:00:00Z',
  updatedAt: '2026-09-15T00:00:00Z',
};

const answer = {
  latitude: -33.96751,
  longitude: 18.50331,
  position_accuracy_meters: 3.2,
  position_confidence: 'HIGH',
  status: 'MAPPED',
  observation_count: 4,
};

describe('Grave Visit Tests', () => {
  it('reads the record_grave_visit answer', () => {
    expect(parseVisitResult(answer)).toEqual({
      latitude: -33.96751,
      longitude: 18.50331,
      positionAccuracyMeters: 3.2,
      positionConfidence: 'HIGH',
      status: 'MAPPED',
      observationCount: 4,
    });
    expect(parseVisitResult(null)).toBeNull();
    expect(parseVisitResult({ latitude: 'x' })).toBeNull();
  });

  it('applies the new position to the grave without touching anything else', () => {
    const updated = applyVisitResult(grave, parseVisitResult(answer)!);
    expect(updated).toMatchObject({ id: 'grave_1', graveNumber: '1402', latitude: -33.96751, positionAccuracyMeters: 3.2, status: 'MAPPED', observationCount: 4 });
    expect(grave.latitude).toBe(-33.9675);
  });

  it('describes the improved position', () => {
    expect(describeVisit({ ...grave, positionAccuracyMeters: 3.2, observationCount: 4 })).toBe('Thanks. Position now ± 3.2 m from 4 visits.');
    expect(describeVisit({ ...grave, positionAccuracyMeters: 8, observationCount: 1 })).toBe('Thanks. Position now ± 8 m from 1 visit.');
  });

  it('only confirms with a usable fix', () => {
    expect(canConfirmVisit(null)).toBe(false);
    expect(canConfirmVisit({ lat: 1, lng: 1, accuracy: 25 })).toBe(true);
    expect(canConfirmVisit({ lat: 1, lng: 1, accuracy: 25.1 })).toBe(false);
  });

  it('maps the observation count and whole-grave photo from the graves row', () => {
    const mapped = mapDbGrave({
      id: 'g', cemetery_id: 'c', grave_number: '', latitude: 1, longitude: 2,
      grave_photo_url: 'https://x/grave.jpg', observation_count: 3, created_at: 't', updated_at: 't',
    });
    expect(mapped.gravePhotoUrl).toBe('https://x/grave.jpg');
    expect(mapped.observationCount).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/grave_visits.test.ts`
Expected: FAIL, cannot find module `../src/lib/graves/visits`.

- [ ] **Step 3: Write visits.ts**

```ts
// src/lib/graves/visits.ts
import type { ConfidenceLevel, Grave, GraveStatus } from '@/types';

export interface VisitFix {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface VisitResult {
  latitude: number;
  longitude: number;
  positionAccuracyMeters: number;
  positionConfidence: ConfidenceLevel;
  status: GraveStatus;
  observationCount: number;
}

export const VISIT_FAILED_MESSAGE = "Your visit couldn't be recorded. Please try again.";
// Same limit as record_grave_visit in the database
export const MAX_VISIT_ACCURACY_M = 25;

const CONFIDENCE: ConfidenceLevel[] = ['HIGH', 'MEDIUM', 'LOW'];
const STATUSES: GraveStatus[] = ['MAPPED', 'LOW_CONFIDENCE', 'UNMAPPED', 'VERIFIED', 'DISPUTED'];

export function parseVisitResult(data: unknown): VisitResult | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  const accuracy = Number(row.position_accuracy_meters);
  const count = Number(row.observation_count);
  if (![latitude, longitude, accuracy, count].every(Number.isFinite)) return null;
  const confidence = CONFIDENCE.find((level) => level === row.position_confidence);
  const status = STATUSES.find((value) => value === row.status);
  if (!confidence || !status) return null;
  return { latitude, longitude, positionAccuracyMeters: accuracy, positionConfidence: confidence, status, observationCount: count };
}

export function applyVisitResult(grave: Grave, result: VisitResult): Grave {
  return {
    ...grave,
    latitude: result.latitude,
    longitude: result.longitude,
    positionAccuracyMeters: result.positionAccuracyMeters,
    positionConfidence: result.positionConfidence,
    status: result.status,
    observationCount: result.observationCount,
    updatedAt: new Date().toISOString(),
  };
}

export function describeVisit(grave: Grave): string {
  const visits = grave.observationCount ?? 1;
  return `Thanks. Position now ± ${grave.positionAccuracyMeters} m from ${visits} ${visits === 1 ? 'visit' : 'visits'}.`;
}

export function canConfirmVisit(fix: VisitFix | null): boolean {
  return fix !== null && fix.accuracy <= MAX_VISIT_ACCURACY_M;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/grave_visits.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Store method**

In `src/lib/data/store.ts` import:

```ts
import { applyVisitResult, parseVisitResult, VISIT_FAILED_MESSAGE, VisitFix } from '../graves/visits';
import { SaveGraveError, NOT_SET_UP_MESSAGE, OFFLINE_MESSAGE, mapSaveGraveError } from '../supabase/saveGraveErrors';
```

(merge with the existing `saveGraveErrors` import). Add after `findMatchingGraves`:

```ts
  // "I found it" at the grave. The database averages the fix into the grave's position and answers with the result.
  async recordGraveVisit(grave: Grave, fix: VisitFix): Promise<Grave> {
    if (!isSupabaseConfigured || !supabase) throw new SaveGraveError('not-set-up', NOT_SET_UP_MESSAGE);
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new SaveGraveError('offline', OFFLINE_MESSAGE);

    const { data, error } = await supabase.rpc('record_grave_visit', {
      p_grave_id: grave.id,
      p_latitude: fix.lat,
      p_longitude: fix.lng,
      p_accuracy_meters: Number(fix.accuracy.toFixed(1)),
    });
    if (error) throw mapSaveGraveError(error);
    const result = parseVisitResult(data);
    if (!result) throw new SaveGraveError('unknown', VISIT_FAILED_MESSAGE);

    const updated = applyVisitResult(grave, result);
    if (typeof window !== 'undefined') offlineDb.graves.put(updated).catch(() => {});
    return updated;
  }
```

- [ ] **Step 6: Page handler**

In `src/app/page.tsx`, import `VisitFix` from `@/lib/graves/visits`, and add after `handleGraveSaved`:

```ts
  // Only signed-in visitors can confirm a grave, so the screens get no handler otherwise
  const handleConfirmVisit = user
    ? async (grave: Grave, fix: VisitFix) => {
        const updated = await dataStore.recordGraveVisit(grave, fix);
        setSelectedGrave(updated);
        setGraves((list) => list.map((item) => (item.id === updated.id ? updated : item)));
        return updated;
      }
    : undefined;
```

The screens receive it in Tasks 8 and 12.

- [ ] **Step 7: Type check and commit**

Run: `npx tsc --noEmit`
Expected: clean (an unused `handleConfirmVisit` is not an error under this project's config; if ESLint complains later, Tasks 8 and 12 use it).

```bash
git add src/lib/graves/visits.ts tests/grave_visits.test.ts src/lib/data/store.ts src/app/page.tsx
git commit -m "feat(graves): record a visit and apply the refined position

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: "I found it" and "Look for this grave" in navigation

**Files:**
- Create: `src/components/common/VisitConfirmButton.tsx`
- Create: `src/components/common/LookForThisGrave.tsx`
- Modify: `src/components/screens/NavigationScreen.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `VisitFix`, `canConfirmVisit`, `describeVisit`, `VISIT_FAILED_MESSAGE` (Task 7); `SaveGraveError` from `@/lib/supabase/saveGraveErrors`.
- Produces:
  ```tsx
  <VisitConfirmButton grave={Grave} fix={VisitFix | null} onConfirm={(grave, fix) => Promise<Grave>} tone="light" | "dark" />
  <LookForThisGrave url={string} tone="light" | "dark" />
  // NavigationScreen prop: onConfirmVisit?: (grave: Grave, fix: VisitFix) => Promise<Grave>
  ```

- [ ] **Step 1: The shared button**

```tsx
// src/components/common/VisitConfirmButton.tsx
'use client';

import React, { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import type { Grave } from '@/types';
import { canConfirmVisit, describeVisit, VISIT_FAILED_MESSAGE, VisitFix } from '@/lib/graves/visits';
import { SaveGraveError } from '@/lib/supabase/saveGraveErrors';

interface VisitConfirmButtonProps {
  grave: Grave;
  fix: VisitFix | null;
  onConfirm: (grave: Grave, fix: VisitFix) => Promise<Grave>;
  // light: on a white sheet. dark: over the camera.
  tone?: 'light' | 'dark';
}

type VisitState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'done'; message: string } | { kind: 'error'; message: string };

// "I found it": records the visitor's fix as an observation so the grave's position improves with every visit
export const VisitConfirmButton: React.FC<VisitConfirmButtonProps> = ({ grave, fix, onConfirm, tone = 'light' }) => {
  const [state, setState] = useState<VisitState>({ kind: 'idle' });
  const dark = tone === 'dark';

  const confirm = async () => {
    if (!fix || state.kind === 'saving') return;
    setState({ kind: 'saving' });
    try {
      const updated = await onConfirm(grave, fix);
      setState({ kind: 'done', message: describeVisit(updated) });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof SaveGraveError ? err.message : VISIT_FAILED_MESSAGE });
    }
  };

  if (state.kind === 'done') {
    return (
      <div className={`mt-2 flex items-start text-[11px] font-semibold ${dark ? 'text-emerald-200' : 'text-emerald-800'}`} role="status">
        <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 mt-px shrink-0" />
        <span>{state.message}</span>
      </div>
    );
  }

  const usable = canConfirmVisit(fix);
  return (
    <div className="mt-2">
      <button
        onClick={confirm}
        disabled={!usable || state.kind === 'saving'}
        title={usable ? undefined : 'Waiting for a GPS fix within 25 m'}
        className={`w-full rounded-xl py-2.5 px-4 text-xs font-bold flex items-center justify-center space-x-2 active:scale-[0.99] transition-all disabled:opacity-50 ${
          dark ? 'bg-emerald-500 text-white' : 'bg-emerald-600 text-white'
        }`}
      >
        {state.kind === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        <span>{state.kind === 'saving' ? 'Saving…' : 'I found it'}</span>
      </button>
      {state.kind === 'error' && (
        <p className={`mt-1.5 text-[11px] font-semibold ${dark ? 'text-rose-200' : 'text-rose-700'}`} role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
};
```

- [ ] **Step 2: The whole-grave thumbnail**

```tsx
// src/components/common/LookForThisGrave.tsx
'use client';

import React from 'react';
import Image from 'next/image';

interface LookForThisGraveProps {
  url: string;
  tone?: 'light' | 'dark';
}

// The whole-grave photo taken at capture, so a visitor can match what they see to the pin
export const LookForThisGrave: React.FC<LookForThisGraveProps> = ({ url, tone = 'light' }) => {
  const dark = tone === 'dark';
  return (
    <div className="mt-2 flex items-center space-x-2.5">
      <div className={`w-16 h-12 rounded-lg overflow-hidden relative shrink-0 border ${dark ? 'border-white/30 bg-black/40' : 'border-slate-200 bg-slate-100'}`}>
        <Image src={url} alt="The whole grave" fill className="object-cover" />
      </div>
      <span className={`text-[11px] font-semibold ${dark ? 'text-white/80' : 'text-slate-600'}`}>Look for this grave</span>
    </div>
  );
};
```

If `next.config.*` restricts image hosts and the Supabase host is not listed, `Image` throws at runtime; the grave details carousel already renders these URLs, so copy whatever it does (an `unoptimized` prop or a plain `img`) if it differs.

- [ ] **Step 3: NavigationScreen**

Imports:

```ts
import { VisitConfirmButton } from '@/components/common/VisitConfirmButton';
import { LookForThisGrave } from '@/components/common/LookForThisGrave';
import type { VisitFix } from '@/lib/graves/visits';
```

Props: add after `onOpenARGuidance: () => void;`:

```ts
  // Present only for signed-in users; records "I found it" as a position observation
  onConfirmVisit?: (grave: Grave, fix: VisitFix) => Promise<Grave>;
```

and destructure it. Add state next to the other GPS state (search for `setGpsStatus` declaration):

```ts
  // Accuracy of the latest fix, for "I found it"
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
```

In the `watchPosition` callback, after `setGpsStatus('live');` add `setGpsAccuracy(pos.coords.accuracy);` (before the "stationary device" early return, so the accuracy updates even when the position repeats).

Replace the `isAtGrave` block:

```tsx
            {isAtGrave ? (
              <div className="mt-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold">
                <div className="flex items-center space-x-2 animate-pulse">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    You have arrived! {graveNumberLabel(targetGrave) ?? targetGrave.person?.fullName ?? 'The grave'} is right here (±
                    {targetGrave.positionAccuracyMeters}m).
                  </span>
                </div>
                {targetGrave.gravePhotoUrl && <LookForThisGrave url={targetGrave.gravePhotoUrl} />}
                {onConfirmVisit && (
                  <VisitConfirmButton
                    grave={targetGrave}
                    fix={gpsAccuracy === null ? null : { lat: currentLoc.lat, lng: currentLoc.lng, accuracy: gpsAccuracy }}
                    onConfirm={onConfirmVisit}
                  />
                )}
              </div>
            ) : isNearby ? (
```

`currentLoc` is the screen's existing live position state (search for `setCurrentLoc`); use its actual name if it differs.

- [ ] **Step 4: Page**

In `src/app/page.tsx` pass `onConfirmVisit={handleConfirmVisit}` to `<NavigationScreen`.

- [ ] **Step 5: Type check, run all tests, commit**

Run: `npx tsc --noEmit` then `npx vitest run`
Expected: clean; all pass.

```bash
git add src/components/common/VisitConfirmButton.tsx src/components/common/LookForThisGrave.tsx src/components/screens/NavigationScreen.tsx src/app/page.tsx
git commit -m "feat(navigation): confirm a found grave and show the whole-grave photo on arrival

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Grave details accuracy row

**Files:**
- Modify: `src/components/screens/GraveDetailsScreen.tsx`

- [ ] **Step 1: Replace the accuracy row**

Replace the `Location Accuracy` row's value span:

```tsx
              <span className="flex items-center font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-[11px]">
                <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" />
                ± {grave.positionAccuracyMeters}m, {confidenceLabel(grave.positionConfidence)}
                {(grave.observationCount ?? 0) > 1 ? `, ${grave.observationCount} visits` : ''}
              </span>
```

Add above the component:

```ts
function confidenceLabel(level: Grave['positionConfidence']): string {
  if (level === 'HIGH') return 'High confidence';
  if (level === 'MEDIUM') return 'Medium confidence';
  return 'Low confidence';
}
```

- [ ] **Step 2: Type check and commit**

Run: `npx tsc --noEmit`

```bash
git add src/components/screens/GraveDetailsScreen.tsx
git commit -m "feat(graves): show visit count and low confidence on the details page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Device pitch from the compass hook

**Files:**
- Modify: `src/lib/device/compass.ts`
- Modify: `src/lib/device/useCompassHeading.ts`
- Modify: `tests/compass.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // OrientationReading gains beta?: number | null
  export function readDevicePitch(reading: OrientationReading): number | null;
  // useCompassHeading(): { heading: number | null; pitch: number | null; status: CompassStatus }
  ```

- [ ] **Step 1: Write the failing tests**

Add to `tests/compass.test.ts`, importing `readDevicePitch` alongside `readCompassHeading`:

```ts
describe('Device Pitch Tests', () => {
  it('reads the camera pitch for a phone held upright', () => {
    expect(readDevicePitch({ beta: 90 })).toBe(0);
  });

  it('is negative when the camera points at the ground', () => {
    expect(readDevicePitch({ beta: 45 })).toBe(-45);
    expect(readDevicePitch({ beta: 0 })).toBe(-90);
  });

  it('is positive when the camera points up, and clamps', () => {
    expect(readDevicePitch({ beta: 120 })).toBe(30);
    expect(readDevicePitch({ beta: -100 })).toBe(-90);
  });

  it('returns null without a reading', () => {
    expect(readDevicePitch({})).toBeNull();
    expect(readDevicePitch({ beta: null })).toBeNull();
    expect(readDevicePitch({ beta: Number.NaN })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/compass.test.ts`
Expected: FAIL, `readDevicePitch` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/device/compass.ts`:

```ts
export interface OrientationReading {
  alpha?: number | null;
  // Front-to-back tilt: 90 when the phone stands upright, 0 lying flat with the screen up
  beta?: number | null;
  webkitCompassHeading?: number | null;
}

// Pitch of the rear camera in degrees above horizontal for a phone held upright in portrait, -90 to 90
export function readDevicePitch(reading: OrientationReading): number | null {
  const beta = reading.beta;
  if (typeof beta !== 'number' || !Number.isFinite(beta)) return null;
  return Math.max(-90, Math.min(90, beta - 90));
}
```

In `src/lib/device/useCompassHeading.ts` import `readDevicePitch`, add `const [pitch, setPitch] = useState<number | null>(null);`, and in the event handler:

```ts
    const handle = (source: 'absolute' | 'relative') => (event: Event) => {
      const reading = event as unknown as OrientationReading;
      const next = readCompassHeading(reading, source);
      if (next !== null) setHeading(next);
      // Both event kinds carry the tilt, so pitch works even where only relative events are sent
      const nextPitch = readDevicePitch(reading);
      if (nextPitch !== null) setPitch(nextPitch);
    };
```

Return `{ heading, pitch, status }` and update the function's return type to `{ heading: number | null; pitch: number | null; status: CompassStatus }`.

- [ ] **Step 4: Run tests, type check, commit**

Run: `npx vitest run tests/compass.test.ts` then `npx tsc --noEmit`

```bash
git add src/lib/device/compass.ts src/lib/device/useCompassHeading.ts tests/compass.test.ts
git commit -m "feat(device): read the camera pitch from the orientation events

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Marker projection and smoothing

**Files:**
- Create: `src/lib/ar/markerProjection.ts`
- Create: `src/lib/ar/smoothing.ts`
- Test: `tests/marker_projection.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const AR_CAMERA_HFOV_DEG = 65;
  export const AR_EYE_HEIGHT_M = 1.5;
  export interface ProjectionInput { bearingDiffDeg: number; pitchDeg: number; distanceM: number; viewportWidth: number; viewportHeight: number; hFovDeg?: number; eyeHeightM?: number }
  export interface MarkerProjection { x: number; y: number; scale: number; onScreen: boolean; edgeAngleDeg: number; pxPerMeter: number }
  export function projectGroundTarget(input: ProjectionInput): MarkerProjection;
  export function smoothValue(prev: number | null, next: number, alpha: number): number;
  export function smoothAngle(prev: number | null, next: number, alpha: number): number;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/marker_projection.test.ts
import { describe, it, expect } from 'vitest';
import { AR_CAMERA_HFOV_DEG, AR_EYE_HEIGHT_M, projectGroundTarget } from '../src/lib/ar/markerProjection';
import { smoothAngle, smoothValue } from '../src/lib/ar/smoothing';

const view = { viewportWidth: 400, viewportHeight: 800 };
// Looking straight at a ground point 10 m away means tilting the camera down by this much
const lookAt10m = -(Math.atan2(AR_EYE_HEIGHT_M, 10) * 180) / Math.PI;

describe('AR Marker Projection Tests', () => {
  it('puts a target straight ahead in the centre of the screen', () => {
    const p = projectGroundTarget({ bearingDiffDeg: 0, pitchDeg: lookAt10m, distanceM: 10, ...view });
    expect(p.x).toBeCloseTo(200, 6);
    expect(p.y).toBeCloseTo(400, 6);
    expect(p.onScreen).toBe(true);
  });

  it('moves right for a target to the right and left for one to the left', () => {
    const right = projectGroundTarget({ bearingDiffDeg: 20, pitchDeg: lookAt10m, distanceM: 10, ...view });
    const left = projectGroundTarget({ bearingDiffDeg: -20, pitchDeg: lookAt10m, distanceM: 10, ...view });
    expect(right.x).toBeGreaterThan(200);
    expect(left.x).toBeLessThan(200);
    expect(right.x - 200).toBeCloseTo(200 - left.x, 6);
  });

  it('sits below the centre when the camera is level, and above it when tilted well down', () => {
    expect(projectGroundTarget({ bearingDiffDeg: 0, pitchDeg: 0, distanceM: 10, ...view }).y).toBeGreaterThan(400);
    expect(projectGroundTarget({ bearingDiffDeg: 0, pitchDeg: -40, distanceM: 10, ...view }).y).toBeLessThan(400);
  });

  it('is off screen beyond half the field of view, with an edge angle pointing that way', () => {
    expect(AR_CAMERA_HFOV_DEG).toBe(65);
    const p = projectGroundTarget({ bearingDiffDeg: 60, pitchDeg: lookAt10m, distanceM: 10, ...view });
    expect(p.onScreen).toBe(false);
    expect(p.x).toBeGreaterThan(400);
    expect(Math.abs(p.edgeAngleDeg)).toBeLessThan(10);
    const behind = projectGroundTarget({ bearingDiffDeg: -150, pitchDeg: lookAt10m, distanceM: 10, ...view });
    expect(behind.onScreen).toBe(false);
    expect(behind.x).toBeLessThan(0);
  });

  it('grows as the grave gets closer, within limits', () => {
    const at = (distanceM: number) => projectGroundTarget({ bearingDiffDeg: 0, pitchDeg: 0, distanceM, ...view }).scale;
    expect(at(1)).toBe(1.6);
    expect(at(8)).toBe(1);
    expect(at(40)).toBe(0.5);
  });

  it('reports pixels per metre at the target distance for the accuracy ring', () => {
    const p = projectGroundTarget({ bearingDiffDeg: 0, pitchDeg: 0, distanceM: 10, ...view });
    expect(p.pxPerMeter).toBeCloseTo(200 / (Math.tan((32.5 * Math.PI) / 180) * 10), 6);
  });
});

describe('AR Smoothing Tests', () => {
  it('starts at the first value and eases toward later ones', () => {
    expect(smoothValue(null, 10, 0.25)).toBe(10);
    expect(smoothValue(10, 20, 0.25)).toBe(12.5);
  });

  it('takes the short way round the compass', () => {
    expect(smoothAngle(null, 350, 0.25)).toBe(350);
    expect(smoothAngle(350, 10, 0.5)).toBe(0);
    expect(smoothAngle(10, 350, 0.5)).toBe(0);
    // An exact half turn has no short way; it goes anticlockwise
    expect(smoothAngle(0, 180, 0.5)).toBe(270);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/marker_projection.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/ar/smoothing.ts
// Exponential smoothing: alpha 1 follows the new value at once, smaller values settle more slowly
export function smoothValue(prev: number | null, next: number, alpha: number): number {
  return prev === null ? next : prev + (next - prev) * alpha;
}

function normaliseDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

// Same, for a heading in degrees: 350 to 10 moves through north, not back through 180
export function smoothAngle(prev: number | null, next: number, alpha: number): number {
  if (prev === null) return normaliseDegrees(next);
  const delta = ((next - prev + 540) % 360) - 180;
  return normaliseDegrees(prev + delta * alpha);
}
```

```ts
// src/lib/ar/markerProjection.ts
// Where a point on the ground appears on the camera view, from the compass, the phone's tilt and the distance.
// The browser can't track the phone through the camera, so this is what places the AR marker.

// Rear cameras on phones cover roughly this much side to side; tuned on a real phone
export const AR_CAMERA_HFOV_DEG = 65;
// The grave is on the ground, about this far below the phone
export const AR_EYE_HEIGHT_M = 1.5;

export interface ProjectionInput {
  // Bearing to the target minus the phone heading, -180 to 180
  bearingDiffDeg: number;
  // Camera pitch, positive when it points above the horizon
  pitchDeg: number;
  distanceM: number;
  viewportWidth: number;
  viewportHeight: number;
  hFovDeg?: number;
  eyeHeightM?: number;
}

export interface MarkerProjection {
  x: number;
  y: number;
  // Marker size relative to its natural size
  scale: number;
  onScreen: boolean;
  // Direction from the screen centre to the target in screen degrees: 0 right, 90 down, -90 up, 180 left
  edgeAngleDeg: number;
  // Screen pixels per metre on the ground at the target's distance
  pxPerMeter: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function projectGroundTarget(input: ProjectionInput): MarkerProjection {
  const hFov = input.hFovDeg ?? AR_CAMERA_HFOV_DEG;
  const eyeHeight = input.eyeHeightM ?? AR_EYE_HEIGHT_M;
  const halfWidth = input.viewportWidth / 2;
  const halfHeight = input.viewportHeight / 2;
  const tanHalfH = Math.tan(toRad(hFov / 2));
  const tanHalfV = tanHalfH * (input.viewportHeight / input.viewportWidth);
  const distance = Math.max(0.5, input.distanceM);

  // Angle from the view centre down to the target: the camera's tilt plus the drop to the ground
  const depression = Math.atan2(eyeHeight, distance);
  const vertical = toRad(input.pitchDeg) + depression;
  const inFront = Math.abs(input.bearingDiffDeg) < 89 && Math.abs(toDeg(vertical)) < 89;

  // Beyond the camera's half-plane the tangent flips sign, so pin those far off the matching edge instead
  const xNorm = inFront ? Math.tan(toRad(input.bearingDiffDeg)) / tanHalfH : Math.sign(input.bearingDiffDeg || 1) * 2;
  const yNorm = inFront ? Math.tan(vertical) / tanHalfV : 2;
  const onScreen = inFront && Math.abs(xNorm) <= 1 && Math.abs(yNorm) <= 1;

  return {
    x: halfWidth + xNorm * halfWidth,
    y: halfHeight + yNorm * halfHeight,
    scale: clamp(8 / Math.max(1, input.distanceM), 0.5, 1.6),
    onScreen,
    edgeAngleDeg: toDeg(Math.atan2(yNorm, xNorm)),
    pxPerMeter: halfWidth / (tanHalfH * distance),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/marker_projection.test.ts`
Expected: PASS, 8 tests. If the "behind" case fails on `edgeAngleDeg`, the test only checks `x`, so look at `xNorm` for bearing -150 (must be -2).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ar/markerProjection.ts src/lib/ar/smoothing.ts tests/marker_projection.test.ts
git commit -m "feat(ar): project a ground target onto the camera view

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: AR screen: marker, ring, caption, edge arrow, visit, whole-grave photo

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/screens/ARGuidanceScreen.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `smoothFixes`, `pruneFixes`, `TimedFix` (Task 1); `useCompassHeading` with `pitch` (Task 10); `projectGroundTarget`, `smoothAngle`, `smoothValue` (Task 11); `VisitConfirmButton`, `LookForThisGrave` (Task 8); `VisitFix` (Task 7).
- Produces: `ARGuidanceScreen` prop `onConfirmVisit?: (grave: Grave, fix: VisitFix) => Promise<Grave>`.

- [ ] **Step 1: Bounce keyframes**

Append to `src/app/globals.css`, after the `ar-chevron-flow` rules:

```css
/* AR grave marker: a slow bob so it reads as a pin standing on the ground */
@keyframes ar-marker-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-14%); }
}
.animate-ar-marker {
  animation: ar-marker-bounce 1.6s infinite ease-in-out;
}
```

- [ ] **Step 2: Imports, props and constants**

In `src/components/screens/ARGuidanceScreen.tsx` replace the imports:

```ts
'use client';

import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import Image from 'next/image';
import { X, MapPin, ArrowUp } from 'lucide-react';
import { Grave } from '@/types';
import { calculateDistanceMeters, calculateBearing } from '@/lib/geospatial';
import { isUsableGpsFix } from '@/lib/geospatial/routeProgress';
import { useWakeLock } from '@/lib/device/useWakeLock';
import { useCompassHeading } from '@/lib/device/useCompassHeading';
import type { CompassStatus } from '@/lib/device/compass';
import { graveNumberLabel } from '@/lib/ui/graveLabels';
import { pruneFixes, smoothFixes, TimedFix } from '@/lib/capture/gpsFixes';
import { projectGroundTarget } from '@/lib/ar/markerProjection';
import { smoothAngle, smoothValue } from '@/lib/ar/smoothing';
import type { VisitFix } from '@/lib/graves/visits';
import { VisitConfirmButton } from '@/components/common/VisitConfirmButton';
import { LookForThisGrave } from '@/components/common/LookForThisGrave';
```

Props:

```ts
interface ARGuidanceScreenProps {
  targetGrave: Grave;
  userLocation?: { lat: number; lng: number };
  distanceMeters?: number;
  onClose: () => void;
  // Present only for signed-in users; records "I found it" as a position observation
  onConfirmVisit?: (grave: Grave, fix: VisitFix) => Promise<Grave>;
}
```

Constants, after `MAX_PATH_TURN_DEG`:

```ts
// Within this the marker is treated as reached: GPS can't place it more finely than that
const ARRIVED_M = 5;
// The caption switches from "head toward" to "look around" inside this
const NEARBY_M = 12;
// Sensor smoothing: quick while walking, slower when close so the marker settles instead of dancing
const ALPHA_ORIENTATION = 0.25;
const ALPHA_POSITION = 0.3;
const ALPHA_SETTLED = 0.1;
```

- [ ] **Step 3: Sensors and smoothing inside the component**

Replace from `const { heading: phoneHeading, status: compassStatus } = useCompassHeading();` through the line `const pathTurn = ...;` with:

```ts
  const { heading: phoneHeading, pitch: phonePitch, status: compassStatus } = useCompassHeading();

  // Own GPS watch: the navigation screen's watch stops while this screen is open
  const fixesRef = useRef<TimedFix[]>([]);
  const [fix, setFix] = useState<VisitFix | null>(null);
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!isUsableGpsFix(pos.coords.latitude, pos.coords.longitude)) return;
        const now = Date.now();
        fixesRef.current = pruneFixes(fixesRef.current, now);
        fixesRef.current.push({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: now });
        setFix(smoothFixes(fixesRef.current, now));
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const here = fix ?? userLocation;
  const rawDistance = here ? calculateDistanceMeters(here.lat, here.lng, targetGrave.latitude, targetGrave.longitude) : initialDistance;
  const rawBearing = here ? calculateBearing(here.lat, here.lng, targetGrave.latitude, targetGrave.longitude) : 62;

  // Smoothed readings. Orientation arrives many times a second, GPS about once, so each eases at its own rate.
  const [liveDistance, setLiveDistance] = useState<number | null>(null);
  const [targetBearing, setTargetBearing] = useState<number | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [pitch, setPitch] = useState<number | null>(null);
  const settled = (liveDistance ?? rawDistance) <= ARRIVED_M;
  const alphaPosition = settled ? ALPHA_SETTLED : ALPHA_POSITION;
  const alphaOrientation = settled ? ALPHA_SETTLED : ALPHA_ORIENTATION;

  useEffect(() => {
    setLiveDistance((prev) => smoothValue(prev, rawDistance, alphaPosition));
    setTargetBearing((prev) => smoothAngle(prev, rawBearing, alphaPosition));
  }, [rawDistance, rawBearing, alphaPosition]);

  useEffect(() => {
    if (phoneHeading !== null) setHeading((prev) => smoothAngle(prev, phoneHeading, alphaOrientation));
  }, [phoneHeading, alphaOrientation]);

  useEffect(() => {
    if (phonePitch !== null) setPitch((prev) => smoothValue(prev, phonePitch, alphaOrientation));
  }, [phonePitch, alphaOrientation]);

  const distance = liveDistance ?? rawDistance;
  const bearing = targetBearing ?? rawBearing;

  // Relative angle between where the phone points and the grave; the path stays straight until the compass reports
  const diffAngle = heading === null ? 0 : ((bearing - heading + 540) % 360) - 180; // -180 to +180
  const arrived = distance <= ARRIVED_M;

  let guidanceText = 'Keep straight';
  if (arrived) {
    guidanceText = 'You are at the grave';
  } else if (heading === null) {
    guidanceText = describeMissingHeading(compassStatus);
  } else if (Math.abs(diffAngle) > 120) {
    guidanceText = 'Turn Around';
  } else if (diffAngle > 35) {
    guidanceText = `Turn Right (${Math.round(diffAngle)}°)`;
  } else if (diffAngle < -35) {
    guidanceText = `Turn Left (${Math.abs(Math.round(diffAngle))}°)`;
  }

  const pathTurn = Math.max(-MAX_PATH_TURN_DEG, Math.min(MAX_PATH_TURN_DEG, diffAngle));

  // Viewport size for the projection; the container fills the screen
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 390, height: 780 });
  useLayoutEffect(() => {
    const measure = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) setViewport({ width: rect.width, height: rect.height });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Without a compass the marker sits straight ahead, which is what the chevron path shows too
  const marker = projectGroundTarget({
    bearingDiffDeg: diffAngle,
    pitchDeg: pitch ?? 0,
    distanceM: distance,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  });
  const accuracy = Math.max(1, targetGrave.positionAccuracyMeters || 1);
  const ringWidth = Math.min(viewport.width * 1.5, 2 * accuracy * marker.pxPerMeter);
  const caption =
    distance <= NEARBY_M
      ? `± ${targetGrave.positionAccuracyMeters} m. Not the right name? Look around this spot.`
      : 'Head toward the marker';
```

Also change the destructured props to include `onConfirmVisit`, and note `initialDistance` is still read from `distanceMeters`. Remove the old `const liveDistance = userLocation ? ... : initialDistance;` and `const targetBearing = ...` blocks (they are replaced above). Every later use of `liveDistance` in the JSX becomes `distance`.

- [ ] **Step 4: Markup**

Add `ref={containerRef}` to the outermost `<div className="flex-1 flex flex-col relative bg-black overflow-hidden select-none">`.

In the ground-path block, replace `{arrived ? (<div className="absolute left-1/2 bottom-32 -ml-14 w-28 h-28 rounded-full border-4 border-emerald-300 bg-emerald-400/30 animate-radar" />) : (<>...chevrons...</>)}` with just the chevrons wrapped so they disappear on arrival:

```tsx
          {!arrived && (
            <>
              <div className="absolute inset-x-6 inset-y-0 rounded-t-full bg-gradient-to-t from-emerald-400/35 via-emerald-400/10 to-transparent" />
              {Array.from({ length: CHEVRON_COUNT }, (_, i) => (
                ...existing chevron svg unchanged...
              ))}
            </>
          )}
```

After the ground-path `</div>` (the one with `perspective`), add the marker layer:

```tsx
      {/* Grave marker on the camera view. Placed from compass, tilt and distance, so it can be a few metres out. */}
      <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden" aria-hidden="true">
        {marker.onScreen ? (
          <div
            className="absolute flex flex-col items-center transition-[left,top] duration-150 ease-out"
            style={{ left: marker.x, top: marker.y, transform: 'translate(-50%, -100%)' }}
          >
            <div className="animate-ar-marker" style={{ transform: `scale(${marker.scale})`, transformOrigin: '50% 100%' }}>
              <MapPin className="w-14 h-14 text-emerald-400 fill-emerald-500/60 drop-shadow-[0_4px_10px_rgba(0,0,0,0.6)]" strokeWidth={1.75} />
            </div>
            <div
              className="rounded-full border-2 border-emerald-300/70 bg-emerald-400/20 -mt-2"
              style={{ width: ringWidth, height: ringWidth * 0.35 }}
            />
            <div className="mt-2 max-w-[240px] text-center text-[11px] font-semibold text-white bg-black/60 backdrop-blur-md rounded-full px-3 py-1">
              {caption}
            </div>
          </div>
        ) : (
          <div
            className="absolute left-1/2 top-1/2 w-36 h-36 -ml-18 -mt-18 flex items-start justify-center"
            style={{ transform: `rotate(${marker.edgeAngleDeg + 90}deg)` }}
          >
            <ArrowUp className="w-10 h-10 text-emerald-400 drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)]" strokeWidth={2.5} />
          </div>
        )}
      </div>
```

Replace `{Math.round(liveDistance)} m` in the distance badge with `{Math.round(distance)} m`.

Bottom card: replace the thumbnail block and add the visit button. The whole `<div className="absolute bottom-6 inset-x-5 z-30 pointer-events-auto">` becomes:

```tsx
      <div className="absolute bottom-6 inset-x-5 z-30 pointer-events-auto">
        <div className="bg-white/95 backdrop-blur-md rounded-2xl p-3 shadow-2xl border border-white/40">
          <div className="flex items-center space-x-3.5">
            <div className="w-14 h-14 rounded-xl overflow-hidden relative shrink-0 bg-slate-100 border border-slate-200">
              <Image
                src={targetGrave.primaryPhotoUrl || '/sample-gravestone.svg'}
                alt={targetGrave.person?.fullName || 'Target Grave'}
                fill
                className="object-cover"
              />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xs font-bold text-slate-900 truncate">
                {targetGrave.person?.fullName || numberLabel || 'Grave'}
              </h2>
              {numberLabel && (
                <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">{numberLabel}</div>
              )}
              <div className="text-[10px] text-slate-500 truncate mt-0.5">
                {targetGrave.cemeteryName || 'Athlone Muslim Cemetery'}
              </div>
            </div>
          </div>
          {targetGrave.gravePhotoUrl && <LookForThisGrave url={targetGrave.gravePhotoUrl} />}
          {arrived && onConfirmVisit && <VisitConfirmButton grave={targetGrave} fix={fix} onConfirm={onConfirmVisit} />}
        </div>
      </div>
```

- [ ] **Step 5: Page**

In `src/app/page.tsx` pass `onConfirmVisit={handleConfirmVisit}` to `<ARGuidanceScreen`.

- [ ] **Step 6: Type check, lint, all tests**

Run: `npx tsc --noEmit`, `npx next lint` (if the project has it configured; otherwise skip), `npx vitest run`
Expected: clean; all pass. Tailwind may not know `-ml-18`/`-mt-18`; if the arrow container is off-centre, use `style={{ marginLeft: -72, marginTop: -72 }}` instead.

- [ ] **Step 7: Commit**

```bash
git add src/app/globals.css src/components/screens/ARGuidanceScreen.tsx src/app/page.tsx
git commit -m "feat(ar): bouncing grave marker with an accuracy ring, edge arrow and visit confirmation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Final verification

- [ ] **Step 1: Full suite and type check**

Run: `npx vitest run` and `npx tsc --noEmit`
Expected: all files pass (47 files, about 350 tests); type check clean.

- [ ] **Step 2: Em dash scan on everything touched**

Run (Git Bash): `git diff main --name-only | xargs grep -l $'\xe2\x80\x94' || echo "no em dashes"`
Expected: `no em dashes`.

- [ ] **Step 3: Update the spec status**

Change `Status: approved design, not yet implemented` in `docs/superpowers/specs/2026-09-15-capture-accuracy-design.md` to `Status: implemented on feature/my-surveys; migration 20260915200000_position_observations.sql must be run in the Supabase SQL Editor`, and commit:

```bash
git add docs/superpowers/specs/2026-09-15-capture-accuracy-design.md
git commit -m "docs(capture): mark the capture accuracy design as implemented

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: Hand over**

Tell the user: the migration to run by hand, that production is deployed with `vercel --prod` from a clean worktree, and which flows need a walk with a phone (capture wait and capture anyway, whole-grave photo, "I found it" on both screens, AR marker placement and the 65 degree field of view constant).
