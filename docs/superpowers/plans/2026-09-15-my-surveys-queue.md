# My Surveys Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** My Surveys becomes real: a surveyor starts a survey of a cemetery, photographs graves one after another with GPS and compass heading, and the photos are stored on the phone, read and saved in the background (also after signal returns), with anything uncertain waiting for review and hard limits so a fault can never burn AI tokens in a loop.

**Architecture:** Dexie version 2 stores surveys, captures (with the photo Blob) and a per-user queue state. A dependency-injected worker (`queueWorker.ts`) processes eligible captures one at a time under a Web Lock: it reads each photo through the rate-limited route, decides with pure rules (`queueRules.ts`), and saves through `save_or_add_grave` in `auto` mode. A browser module (`surveyQueue.ts`) wires the worker to fetch, Supabase and wake events, and keeps `survey_sessions` in the cloud up to date. The screens read IndexedDB through Dexie `liveQuery`, so counts and lists update as the queue works.

**Tech Stack:** Next.js 14 App Router (client components), React 18, TypeScript, Dexie 4 (`liveQuery`), Supabase (supabase-js v2), Web Locks API, Vitest 2 with fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-09-15-my-surveys-design.md` (sections 1, 2, 3, the phone part of 4, and 6). **Plan 1, `docs/superpowers/plans/2026-09-15-duplicates-and-read-limits.md`, must be fully implemented first**: this plan uses `save_or_add_grave`, `MatchMode`, `MatchCandidate`, the read limits and `DuplicateMatchCard`.

## Global Constraints

- Never use em dashes in code comments, UI copy, commit messages or docs. Use commas, colons, periods or parentheses.
- Runtime imports inside `src/lib/**` use relative paths, because Vitest has no `@/` alias. Type-only imports may use `@/types`. Components may use `@/`.
- Match the surrounding code: short comments that explain why, 2-space indent, single quotes, Tailwind classes in the existing style. Filter chips use `flex flex-wrap items-center justify-center gap-2` like Search.
- Auto-save (verbatim from the spec): only when first name and surname are read, name confidence is 0.90 or higher, and the photo's GPS is inside the survey cemetery's boundary. Everything else waits in Needs review.
- At most one active survey per surveyor per phone.
- Counts are derived, never stored on the device. Captured = all captures. Saved = `saved`. Pending = `queued` + `reading` + `saving`. Review = `review` + `failed`.
- AI budget limits (verbatim): at most 3 counted reads per capture before it becomes `failed`; Retry allowed while `manualRetries` is below 2, each Retry allowing one more read (at most 5 reads); 5 consecutive read or save failures (offline doesn't count) pause the whole queue until the surveyor taps Resume, stored per user; retries always wait out their backoff (30 s, 2 min, 10 min); 429 waits 60 s; the worker stops when nothing is eligible and never schedules a wake sooner than 30 s.
- The survey camera keeps the Capture rules: live camera only, GPS within 10 m, always-on compass, sign-in required.
- Do not push, deploy, or run SQL against the live Supabase project.
- Always `git add` explicit paths, never `git add -A` or `git add .`.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
- Run one test file: `npx vitest run tests/<file>.test.ts`. Run all tests: `npx vitest run`. Type check: `npx tsc --noEmit` (if it fails on stale `.next/types`, run `rm -rf .next/types` and retry). Never run `npm run build` while `next dev` is running.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/types/index.ts` | Modify | `Survey`, `SurveyCapture`, `SurveyCounts`, `CaptureStatus`, `ReviewReason`, `CaptureSaveAttempt`, `SurveyQueueState`; remove `OfflineUploadQueueItem`, `SurveySession` |
| `src/lib/offline/db.ts` | Modify | Dexie version 2 tables |
| `src/lib/offline/sync.ts` | Modify | Offline cache and search only; old upload queue removed |
| `tests/survey_db.test.ts` | Create | Upgrade from version 1, Blob storage |
| `tests/offline_sync.test.ts`, `tests/storage.test.ts` | Modify | Drop tests of the removed queue |
| `src/lib/surveys/queueRules.ts` | Create | Pure rules: auto-save decision, limits, backoff, counts, circuit breaker, status text, labels |
| `tests/survey_queue_rules.test.ts` | Create | Rule tests |
| `src/lib/surveys/surveyStore.ts` | Create | Surveys, captures and queue state in IndexedDB |
| `tests/survey_store.test.ts` | Create | Store tests with fake-indexeddb |
| `src/lib/surveys/queueAdapters.ts` | Create | Read and save answers to queue results; `survey_sessions` rows and sync timing |
| `tests/survey_queue_adapters.test.ts` | Create | Adapter tests |
| `src/lib/surveys/queueWorker.ts` | Create | The worker and the Web Locks runner |
| `tests/survey_queue_worker.test.ts` | Create | Worker tests with fakes |
| `src/lib/surveys/capturePhoto.ts` | Create | Photo and thumbnail preparation, Blob to data URL |
| `src/lib/surveys/surveyQueue.ts` | Create | Browser wiring, survey actions, cloud sync |
| `src/lib/surveys/useSurveyData.ts` | Create | `useLiveValue`, `useQueueActivity` |
| `tests/survey_capture_photo.test.ts` | Create | Blob to data URL round trip |
| `src/components/screens/CaptureScreen.tsx` | Modify | `mode: 'single' \| 'survey'` |
| `src/components/surveys/StartSurveyCard.tsx` | Create | Start a survey |
| `src/components/surveys/SurveySummaryCard.tsx` | Create | Survey card, counters, status line, Continue and Finish |
| `src/components/surveys/SurveyCaptureList.tsx` | Create | Filter chips and capture rows |
| `src/components/screens/SurveySessionScreen.tsx` | Modify | The My Surveys screen |
| `src/components/screens/ConfirmDetailsScreen.tsx` | Modify | Review props |
| `src/app/page.tsx` | Modify | Queue start, survey camera, review, counts |
| `src/components/screens/ProfileScreen.tsx`, `OfflineStatusScreen.tsx` | Modify | Real counts |
| `src/lib/data/store.ts`, `src/lib/data/mockData.ts` | Modify | Remove the mock survey |

---

### Task 1: Survey storage on the phone, and removing the old upload queue

**Files:**
- Modify: `src/types/index.ts` (add survey types, remove `OfflineUploadQueueItem`)
- Modify: `src/lib/offline/db.ts` (whole file)
- Modify: `src/lib/offline/sync.ts` (whole file)
- Modify: `src/lib/data/store.ts` (init and `updateSurveySession`)
- Modify: `src/app/page.tsx` (imports, sync subscription, `pendingUploads`, `handleTriggerSync`)
- Test: `tests/survey_db.test.ts` (create), `tests/offline_sync.test.ts`, `tests/storage.test.ts`

**Interfaces:**
- Consumes: `MatchCandidate` from `src/lib/graves/matchCandidate.ts` (Plan 1).
- Produces (every later task uses these exact names, all exported from `src/types/index.ts`):

```ts
export type SurveyStatus = 'ACTIVE' | 'COMPLETED';
export interface SurveyCounts { captured: number; saved: number; pending: number; review: number }
export interface Survey {
  id: string; userId: string; cemeteryId: string; cemeteryName: string; sectionNote: string;
  startedAt: string; completedAt?: string; status: SurveyStatus;
  cloudSyncedAt?: string; cloudCounts?: SurveyCounts;
}
export type CaptureStatus = 'queued' | 'reading' | 'saving' | 'review' | 'saved' | 'failed';
export type ReviewReason = 'no-name' | 'low-confidence' | 'outside-cemetery' | 'possible-duplicate' | 'unreadable';
export interface CaptureSaveAttempt { graveId: string; personId: string; upload?: { publicUrl: string; path: string } }
export interface SurveyCapture {
  id: string; surveyId: string; userId: string; cemeteryId: string; createdAt: string;
  photo?: Blob; thumbnail: string; telemetry: DeviceTelemetry; insideBoundary: boolean;
  status: CaptureStatus; reviewReason?: ReviewReason; reading?: AIStructuredExtraction;
  readAttempts: number; saveFailures: number; manualRetries: number;
  nextAttemptAt: number; lastError?: string; attempt: CaptureSaveAttempt;
  graveId?: string; outcome?: 'created' | 'added-photo'; matchCandidate?: MatchCandidate;
}
export interface SurveyQueueState { userId: string; consecutiveFailures: number; pausedForErrors: boolean }
```

- `new QabrMapDatabase(name = 'QabrMapDB')` with tables `cemeteries`, `graves`, `surveys`, `surveyCaptures`, `surveyQueueState` (Dexie version 2). `offlineDb` is unchanged as the app instance.
- `SyncManager` keeps only `isOnline`, `cacheCemeteryForOffline`, `getCachedCemetery`, `getCachedGraves`, `searchOfflineGraves`.

Notes for this task:
- `nextAttemptAt` is epoch milliseconds; `0` means "as soon as possible".
- `saveFailures` is not in the spec's table but is needed for "3 failures make it failed" on saves.
- `CaptureSaveAttempt` has the same shape as `SaveAttempt` in `src/lib/capture/saveMappedGrave.ts`, so either can be passed where the other is expected.
- `SurveySession` stays in the types, and `dataStore.getActiveSurveySession()` keeps returning the in-memory mock, until Task 9 replaces the screens that use them.

- [ ] **Step 1: Write the failing test**

Create `tests/survey_db.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import { QabrMapDatabase } from '../src/lib/offline/db';

describe('Survey Database Tests', () => {
  it('opens a version 1 database as version 2, keeping cached graves and dropping the old queue', async () => {
    const name = 'QabrMapDB_upgrade_test';
    const v1 = new Dexie(name);
    v1.version(1).stores({
      cemeteries: 'id, slug, name, city',
      graves: 'id, cemeteryId, graveNumber, status, positionConfidence, [cemeteryId+graveNumber]',
      surveySessions: 'id, cemeteryId, status',
      offlineUploadQueue: 'id, cemeteryId, status, createdAt',
    });
    await v1.table('graves').put({ id: 'grave_1', cemeteryId: 'cem_athlone', graveNumber: '1402', status: 'MAPPED', positionConfidence: 'HIGH' });
    await v1.table('offlineUploadQueue').put({ id: 'queue_1', cemeteryId: 'cem_athlone', status: 'queued', createdAt: '2026-09-15' });
    v1.close();

    const db = new QabrMapDatabase(name);
    await db.open();
    expect(db.verno).toBe(2);
    expect(db.tables.map((table) => table.name).sort()).toEqual(['cemeteries', 'graves', 'surveyCaptures', 'surveyQueueState', 'surveys']);
    await expect(db.graves.get('grave_1')).resolves.toMatchObject({ graveNumber: '1402' });
    db.close();
  });

  it('stores a capture with its photo and finds captures by survey and user', async () => {
    const db = new QabrMapDatabase('QabrMapDB_capture_test');
    await db.surveyCaptures.put({
      id: 'capture_1',
      surveyId: 'survey_1',
      userId: 'user-1',
      cemeteryId: 'cem_athlone',
      createdAt: '2026-09-15T10:00:00.000Z',
      photo: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
      thumbnail: 'data:image/jpeg;base64,/9j/',
      telemetry: { latitude: -33.968, longitude: 18.503, gpsAccuracy: 4, headingDegrees: 62, timestamp: '2026-09-15T10:00:00.000Z' },
      insideBoundary: true,
      status: 'queued',
      readAttempts: 0,
      saveFailures: 0,
      manualRetries: 0,
      nextAttemptAt: 0,
      attempt: { graveId: 'grave_a', personId: 'person_a' },
    });

    const stored = await db.surveyCaptures.get('capture_1');
    expect(stored?.photo).toBeInstanceOf(Blob);
    expect(stored?.photo?.size).toBe(3);
    await expect(db.surveyCaptures.where('surveyId').equals('survey_1').count()).resolves.toBe(1);
    await expect(db.surveyCaptures.where('userId').equals('user-1').count()).resolves.toBe(1);

    // Removing the photo once saved must drop the Blob, not keep an empty field
    await db.surveyCaptures.update('capture_1', { photo: undefined });
    expect('photo' in ((await db.surveyCaptures.get('capture_1')) ?? {})).toBe(false);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/survey_db.test.ts`
Expected: FAIL. `QabrMapDatabase` takes no name and has no `surveyCaptures` table (TypeScript errors are not reported by Vitest, so the failure is `verno` 1 or `Cannot read properties of undefined (reading 'put')`).

- [ ] **Step 3: Add the types**

In `src/types/index.ts`, add as the first line after the header comment:

```ts
import type { MatchCandidate } from '../lib/graves/matchCandidate';
```

Replace the whole `OfflineUploadQueueItem` interface with:

```ts
// A survey of one cemetery on this phone. Its captures live on the phone until they become graves.
export type SurveyStatus = 'ACTIVE' | 'COMPLETED';

export interface SurveyCounts {
  captured: number;
  saved: number;
  pending: number;
  review: number;
}

export interface Survey {
  id: string;
  userId: string;
  cemeteryId: string;
  cemeteryName: string;
  sectionNote: string;
  startedAt: string;
  completedAt?: string;
  status: SurveyStatus;
  // Last successful write to survey_sessions, and the counts it wrote
  cloudSyncedAt?: string;
  cloudCounts?: SurveyCounts;
}

export type CaptureStatus = 'queued' | 'reading' | 'saving' | 'review' | 'saved' | 'failed';

export type ReviewReason = 'no-name' | 'low-confidence' | 'outside-cemetery' | 'possible-duplicate' | 'unreadable';

// Same shape as SaveAttempt, stored so a retried save reuses its ids and uploaded photo
export interface CaptureSaveAttempt {
  graveId: string;
  personId: string;
  upload?: { publicUrl: string; path: string };
}

export interface SurveyCapture {
  id: string;
  surveyId: string;
  userId: string;
  cemeteryId: string;
  createdAt: string;
  // JPEG, long edge 1600 px; removed once the capture is saved
  photo?: Blob;
  // JPEG data URL, long edge 160 px; kept for the list
  thumbnail: string;
  telemetry: DeviceTelemetry;
  insideBoundary: boolean;
  status: CaptureStatus;
  reviewReason?: ReviewReason;
  reading?: AIStructuredExtraction;
  readAttempts: number;
  saveFailures: number;
  manualRetries: number;
  // Epoch milliseconds; 0 means as soon as possible
  nextAttemptAt: number;
  lastError?: string;
  attempt: CaptureSaveAttempt;
  graveId?: string;
  outcome?: 'created' | 'added-photo';
  matchCandidate?: MatchCandidate;
}

// Stored per surveyor, so a queue paused after repeated errors stays paused until they tap Resume
export interface SurveyQueueState {
  userId: string;
  consecutiveFailures: number;
  pausedForErrors: boolean;
}
```

- [ ] **Step 4: Upgrade the database**

Replace the whole of `src/lib/offline/db.ts` with:

```ts
// Dexie IndexedDB Database for QabrMap
// Stores cemeteries and graves for offline use, and survey captures waiting to be read and saved.

import Dexie, { type EntityTable } from 'dexie';
import { Cemetery, Grave, Survey, SurveyCapture, SurveyQueueState } from '@/types';

export class QabrMapDatabase extends Dexie {
  cemeteries!: EntityTable<Cemetery, 'id'>;
  graves!: EntityTable<Grave, 'id'>;
  surveys!: EntityTable<Survey, 'id'>;
  surveyCaptures!: EntityTable<SurveyCapture, 'id'>;
  surveyQueueState!: EntityTable<SurveyQueueState, 'userId'>;

  // The name is only changed by tests, which need a database of their own
  constructor(name = 'QabrMapDB') {
    super(name);
    this.version(1).stores({
      cemeteries: 'id, slug, name, city',
      graves: 'id, cemeteryId, graveNumber, status, positionConfidence, [cemeteryId+graveNumber]',
      surveySessions: 'id, cemeteryId, status',
      offlineUploadQueue: 'id, cemeteryId, status, createdAt',
    });
    // Surveys now keep their captures on the phone. The old upload queue and the sample survey table are dropped.
    this.version(2).stores({
      surveySessions: null,
      offlineUploadQueue: null,
      surveys: 'id, userId, status, startedAt',
      surveyCaptures: 'id, surveyId, userId, status, createdAt, nextAttemptAt',
      surveyQueueState: 'userId',
    });
  }
}

export const offlineDb = new QabrMapDatabase();
```

- [ ] **Step 5: Remove the old queue from SyncManager**

Replace the whole of `src/lib/offline/sync.ts` with:

```ts
// Offline cache for QabrMap: cemeteries and graves kept on the phone for search and maps without signal.
// Survey captures are processed by src/lib/surveys, not here.

import { offlineDb } from './db';
import { Cemetery, Grave } from '@/types';

export class SyncManager {
  public isOnline(): boolean {
    if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
      return navigator.onLine;
    }
    return true;
  }

  /**
   * Downloads and caches cemetery boundary, graves, and search index for offline use
   */
  public async cacheCemeteryForOffline(cemetery: Cemetery, graves: Grave[]): Promise<void> {
    await offlineDb.transaction('rw', [offlineDb.cemeteries, offlineDb.graves], async () => {
      await offlineDb.cemeteries.put(cemetery);
      await offlineDb.graves.bulkPut(graves);
    });
  }

  /**
   * Retrieves offline cached cemetery
   */
  public async getCachedCemetery(cemeteryId: string): Promise<Cemetery | undefined> {
    return await offlineDb.cemeteries.get(cemeteryId);
  }

  /**
   * Retrieves offline cached graves for cemetery
   */
  public async getCachedGraves(cemeteryId: string): Promise<Grave[]> {
    return await offlineDb.graves.where('cemeteryId').equals(cemeteryId).toArray();
  }

  /**
   * Searches offline cached graves
   */
  public async searchOfflineGraves(query: string, cemeteryId?: string): Promise<Grave[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    let collection = offlineDb.graves.toCollection();
    if (cemeteryId) {
      collection = offlineDb.graves.where('cemeteryId').equals(cemeteryId);
    }

    return await collection
      .filter((grave) => {
        const numMatch = grave.graveNumber.toLowerCase().includes(q);
        const nameMatch = grave.person?.fullName.toLowerCase().includes(q) ?? false;
        const surnameMatch = grave.person?.surname.toLowerCase().includes(q) ?? false;
        const nicknameMatch = grave.person?.nickname?.toLowerCase().includes(q) ?? false;
        return numMatch || nameMatch || surnameMatch || nicknameMatch;
      })
      .toArray();
  }
}

export const syncManager = new SyncManager();
```

- [ ] **Step 6: Update the tests that used the old queue**

In `tests/offline_sync.test.ts`, delete the whole `it('enqueues offline capture and queries pending count', ...)` block (from that line to its closing `});`), and change the import line `import { SyncManager } from '../src/lib/offline/sync';` to nothing (delete it), since only `offlineDb` is used.

In `tests/storage.test.ts`:
- Delete the line `import { syncManager } from '../src/lib/offline/sync';`.
- Replace
  ```ts
  beforeEach(async () => {
    await offlineDb.offlineUploadQueue.clear();
    await offlineDb.graves.clear();
  });
  ```
  with
  ```ts
  beforeEach(async () => {
    await offlineDb.graves.clear();
  });
  ```
- Delete the whole `it('enqueues photo into offline queue and syncPendingUploads completes successfully', ...)` block, from that line to its closing `});`, leaving the `describe` block's closing `});` in place.

- [ ] **Step 7: Stop using the dropped tables in the store and page**

In `src/lib/data/store.ts`, inside `init()`, delete:

```ts
      const sessCount = await offlineDb.surveySessions.count();
      if (sessCount === 0) {
        await offlineDb.surveySessions.put(this.activeSurvey);
      }
```

and replace the `updateSurveySession` method:

```ts
  async updateSurveySession(session: SurveySession): Promise<void> {
    this.activeSurvey = session;
    if (typeof window !== 'undefined') {
      try {
        await offlineDb.surveySessions.put(session);
      } catch (e) {}
    }
  }
```

with nothing (delete it; nothing calls it).

In `src/app/page.tsx`:
- Delete `import { syncManager } from '@/lib/offline/sync';`.
- Replace `const [pendingUploads, setPendingUploads] = useState(3);` with `const [pendingUploads, setPendingUploads] = useState(0);`.
- Replace
  ```tsx
    // Subscribe to SyncManager
    const unsub = syncManager.subscribe((status) => {
      setIsOffline(!status.isOnline);
      setPendingUploads(status.pendingCount || 3);
    });

    return () => unsub();
  ```
  with
  ```tsx
    // Track the connection for the offline screen
    const updateOnline = () => setIsOffline(!navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  ```
- Replace
  ```tsx
  // Trigger Sync
  const handleTriggerSync = async () => {
    await syncManager.syncPendingUploads();
    setPendingUploads(0);
  };
  ```
  with
  ```tsx
  // Survey captures are processed by the survey queue; Task 9 wires it in here
  const handleTriggerSync = async () => {
    setPendingUploads(0);
  };
  ```

- [ ] **Step 8: Run the tests and type check**

Run: `npx vitest run tests/survey_db.test.ts tests/offline_sync.test.ts tests/storage.test.ts tests/nickname.test.ts`
Expected: PASS.

Run: `npx vitest run`
Expected: all files pass.

Run: `npx tsc --noEmit`
Expected: no errors. If `isOffline` or `setPendingUploads` is reported unused by lint later, leave it; Task 9 uses both.

- [ ] **Step 9: Commit**

```bash
git add src/types/index.ts src/lib/offline/db.ts src/lib/offline/sync.ts src/lib/data/store.ts src/app/page.tsx tests/survey_db.test.ts tests/offline_sync.test.ts tests/storage.test.ts
git commit -m "feat(surveys): store surveys and captures on the phone, drop the old upload queue

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Queue rules

**Files:**
- Create: `src/lib/surveys/queueRules.ts`
- Test: `tests/survey_queue_rules.test.ts`

**Interfaces:**
- Consumes: types from Task 1; `NewGraveForm` from `src/lib/capture/newGrave.ts`.
- Produces (pure, no I/O):
  - Constants: `AUTO_SAVE_NAME_CONFIDENCE = 0.9`, `MAX_READ_ATTEMPTS = 3`, `MAX_SAVE_FAILURES = 3`, `MAX_MANUAL_RETRIES = 2`, `CIRCUIT_BREAKER_LIMIT = 5`, `RATE_LIMIT_WAIT_MS = 60_000`, `MIN_WAKE_DELAY_MS = 30_000`, `OFFLINE_RETRY_MS = 30_000`
  - `type AfterReading = { status: 'saving' } | { status: 'review'; reason: ReviewReason }`
  - `decideAfterReading(reading: AIStructuredExtraction, insideBoundary: boolean): AfterReading`
  - `backoffMs(failures: number): number`
  - `readLimit(capture: Pick<SurveyCapture, 'manualRetries'>): number`, `saveLimit(...)`: same signature
  - `isEligible(capture: SurveyCapture, userId: string, now: number): boolean`
  - `countCaptures(captures: Pick<SurveyCapture, 'status'>[]): SurveyCounts`
  - `canRetry(capture: Pick<SurveyCapture, 'status' | 'manualRetries'>): boolean`
  - `retryChanges(capture: SurveyCapture): Partial<SurveyCapture>`
  - `type StepResult = 'progress' | 'failure' | 'offline' | 'signed-out' | 'rate-limited'`
  - `nextQueueState(state: SurveyQueueState, step: StepResult): SurveyQueueState`
  - `wakeDelayMs(earliestNextAttemptAt: number | null, now: number): number | null`
  - `type QueueActivity = 'idle' | 'working' | 'waiting' | 'offline' | 'signed-out' | 'paused'`
  - `surveyStatusLine(activity: QueueActivity, counts: SurveyCounts): string | null`
  - `formFromReading(reading: AIStructuredExtraction, cemeteryId: string): NewGraveForm`
  - `type CaptureFilter = 'all' | 'review' | 'pending' | 'saved'`, `matchesFilter(capture: Pick<SurveyCapture, 'status'>, filter: CaptureFilter): boolean`
  - `captureStatusLabel(capture: Pick<SurveyCapture, 'status' | 'reviewReason' | 'outcome'>): string`

- [ ] **Step 1: Write the failing test**

Create `tests/survey_queue_rules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { AIStructuredExtraction, SurveyCapture, SurveyQueueState } from '../src/types';
import {
  CIRCUIT_BREAKER_LIMIT,
  backoffMs,
  canRetry,
  captureStatusLabel,
  countCaptures,
  decideAfterReading,
  formFromReading,
  isEligible,
  matchesFilter,
  nextQueueState,
  readLimit,
  retryChanges,
  saveLimit,
  surveyStatusLine,
  wakeDelayMs,
} from '../src/lib/surveys/queueRules';

const reading: AIStructuredExtraction = {
  graveNumber: '1402',
  firstName: 'Yusuf',
  middleNames: ['Ahmed'],
  surname: 'Kamish',
  nickname: 'Boeta',
  fullName: 'Yusuf Ahmed Kamish',
  birthDate: '1952-02-02',
  deathDate: undefined,
  confidence: 0.93,
  rawOcrText: 'YUSUF KAMISH',
  otherText: [],
  fieldConfidences: { graveNumber: 0.9, fullName: 0.95, dates: 0.9 },
};

function capture(overrides: Partial<SurveyCapture> = {}): SurveyCapture {
  return {
    id: 'capture_1',
    surveyId: 'survey_1',
    userId: 'user-1',
    cemeteryId: 'cem_athlone',
    createdAt: '2026-09-15T10:00:00.000Z',
    thumbnail: 'data:image/jpeg;base64,/9j/',
    telemetry: { latitude: -33.968, longitude: 18.503, gpsAccuracy: 4, headingDegrees: 62, timestamp: '2026-09-15T10:00:00.000Z' },
    insideBoundary: true,
    status: 'queued',
    readAttempts: 0,
    saveFailures: 0,
    manualRetries: 0,
    nextAttemptAt: 0,
    attempt: { graveId: 'grave_a', personId: 'person_a' },
    ...overrides,
  };
}

const state: SurveyQueueState = { userId: 'user-1', consecutiveFailures: 0, pausedForErrors: false };

describe('Auto Save Decision Tests', () => {
  it('saves a clear reading of a name inside the cemetery', () => {
    expect(decideAfterReading(reading, true)).toEqual({ status: 'saving' });
  });

  it('sends anything less certain to review, in order', () => {
    expect(decideAfterReading({ ...reading, firstName: ' ' }, false)).toEqual({ status: 'review', reason: 'no-name' });
    expect(decideAfterReading({ ...reading, surname: '' }, true)).toEqual({ status: 'review', reason: 'no-name' });
    expect(decideAfterReading({ ...reading, fieldConfidences: { ...reading.fieldConfidences, fullName: 0.89 } }, false)).toEqual({
      status: 'review',
      reason: 'low-confidence',
    });
    expect(decideAfterReading({ ...reading, fieldConfidences: { ...reading.fieldConfidences, fullName: 0.9 } }, true)).toEqual({
      status: 'saving',
    });
    expect(decideAfterReading(reading, false)).toEqual({ status: 'review', reason: 'outside-cemetery' });
  });
});

describe('Retry Limit Tests', () => {
  it('backs off 30 seconds, 2 minutes, then 10 minutes', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(3)).toBe(600_000);
    expect(backoffMs(9)).toBe(600_000);
  });

  it('allows 3 reads or saves, plus one per manual retry, and at most 2 manual retries', () => {
    expect(readLimit(capture())).toBe(3);
    expect(saveLimit(capture({ manualRetries: 2 }))).toBe(5);
    expect(canRetry(capture({ status: 'failed', manualRetries: 1 }))).toBe(true);
    expect(canRetry(capture({ status: 'failed', manualRetries: 2 }))).toBe(false);
    expect(canRetry(capture({ status: 'review', manualRetries: 0 }))).toBe(false);
  });

  it('retries a failed read by reading again, and a failed save by saving again', () => {
    expect(retryChanges(capture({ status: 'failed', readAttempts: 3, lastError: 'boom' }))).toEqual({
      status: 'queued',
      manualRetries: 1,
      nextAttemptAt: 0,
      lastError: undefined,
    });
    expect(retryChanges(capture({ status: 'failed', reading, saveFailures: 3, manualRetries: 1 }))).toEqual({
      status: 'saving',
      manualRetries: 2,
      nextAttemptAt: 0,
      lastError: undefined,
    });
  });
});

describe('Eligibility And Counts Tests', () => {
  it("only processes the signed-in surveyor's queued or saving captures whose wait is over", () => {
    expect(isEligible(capture(), 'user-1', 1000)).toBe(true);
    expect(isEligible(capture({ status: 'saving', nextAttemptAt: 1000 }), 'user-1', 1000)).toBe(true);
    expect(isEligible(capture({ nextAttemptAt: 1001 }), 'user-1', 1000)).toBe(false);
    expect(isEligible(capture(), 'user-2', 1000)).toBe(false);
    for (const status of ['reading', 'review', 'saved', 'failed'] as const) {
      expect(isEligible(capture({ status }), 'user-1', 1000)).toBe(false);
    }
  });

  it('derives the four counters from statuses', () => {
    const statuses = ['queued', 'reading', 'saving', 'review', 'failed', 'saved', 'saved'] as const;
    expect(countCaptures(statuses.map((status) => ({ status })))).toEqual({ captured: 7, saved: 2, pending: 3, review: 2 });
    expect(countCaptures([])).toEqual({ captured: 0, saved: 0, pending: 0, review: 0 });
  });

  it('filters the captures list', () => {
    expect(matchesFilter({ status: 'failed' }, 'review')).toBe(true);
    expect(matchesFilter({ status: 'reading' }, 'pending')).toBe(true);
    expect(matchesFilter({ status: 'saved' }, 'pending')).toBe(false);
    expect(matchesFilter({ status: 'saved' }, 'saved')).toBe(true);
    expect(matchesFilter({ status: 'queued' }, 'all')).toBe(true);
  });
});

describe('Circuit Breaker Tests', () => {
  it(`pauses after ${CIRCUIT_BREAKER_LIMIT} failures in a row`, () => {
    let current = state;
    for (let i = 0; i < CIRCUIT_BREAKER_LIMIT - 1; i++) current = nextQueueState(current, 'failure');
    expect(current).toEqual({ ...state, consecutiveFailures: 4, pausedForErrors: false });
    expect(nextQueueState(current, 'failure')).toEqual({ ...state, consecutiveFailures: 5, pausedForErrors: true });
  });

  it('resets on progress, and ignores offline, sign-in and rate limits', () => {
    const failing = { ...state, consecutiveFailures: 3 };
    expect(nextQueueState(failing, 'progress').consecutiveFailures).toBe(0);
    expect(nextQueueState(failing, 'offline')).toBe(failing);
    expect(nextQueueState(failing, 'signed-out')).toBe(failing);
    expect(nextQueueState(failing, 'rate-limited')).toBe(failing);
  });

  it('never wakes sooner than 30 seconds, and not at all with nothing waiting', () => {
    expect(wakeDelayMs(null, 1000)).toBeNull();
    expect(wakeDelayMs(5000, 1000)).toBe(30_000);
    expect(wakeDelayMs(601_000, 1000)).toBe(600_000);
  });
});

describe('Survey Status Text Tests', () => {
  const counts = { captured: 8, saved: 2, pending: 6, review: 0 };

  it('says what the queue is doing', () => {
    expect(surveyStatusLine('working', counts)).toBe('Reading 3 of 8…');
    expect(surveyStatusLine('offline', counts)).toBe('No signal: 6 photos stored on this phone');
    expect(surveyStatusLine('offline', { ...counts, pending: 1 })).toBe('No signal: 1 photo stored on this phone');
    expect(surveyStatusLine('signed-out', counts)).toBe('Paused: sign in to keep processing');
    expect(surveyStatusLine('paused', counts)).toBe('Reading paused after repeated errors');
    expect(surveyStatusLine('waiting', counts)).toBe('Retrying 6 photos shortly');
    expect(surveyStatusLine('idle', counts)).toBe('Retrying 6 photos shortly');
  });

  it('says nothing when nothing is waiting, unless the queue is paused', () => {
    const done = { captured: 8, saved: 8, pending: 0, review: 0 };
    expect(surveyStatusLine('idle', done)).toBeNull();
    expect(surveyStatusLine('offline', done)).toBeNull();
    expect(surveyStatusLine('paused', done)).toBe('Reading paused after repeated errors');
  });

  it('labels each capture', () => {
    expect(captureStatusLabel({ status: 'queued' })).toBe('Queued');
    expect(captureStatusLabel({ status: 'reading' })).toBe('Reading…');
    expect(captureStatusLabel({ status: 'saving' })).toBe('Saving…');
    expect(captureStatusLabel({ status: 'review', reviewReason: 'no-name' })).toBe("Name couldn't be read");
    expect(captureStatusLabel({ status: 'review', reviewReason: 'low-confidence' })).toBe('Check the name');
    expect(captureStatusLabel({ status: 'review', reviewReason: 'outside-cemetery' })).toBe('Outside the cemetery');
    expect(captureStatusLabel({ status: 'review', reviewReason: 'possible-duplicate' })).toBe('May already be mapped');
    expect(captureStatusLabel({ status: 'review', reviewReason: 'unreadable' })).toBe('No details found');
    expect(captureStatusLabel({ status: 'saved', outcome: 'created' })).toBe('Saved');
    expect(captureStatusLabel({ status: 'saved', outcome: 'added-photo' })).toBe('Photo added to a mapped grave');
    expect(captureStatusLabel({ status: 'failed' })).toBe("Couldn't be processed");
  });
});

describe('Form From Reading Tests', () => {
  it('fills the save form from a reading', () => {
    expect(formFromReading(reading, 'cem_athlone')).toEqual({
      firstName: 'Yusuf',
      middleNames: 'Ahmed',
      surname: 'Kamish',
      nickname: 'Boeta',
      graveNumber: '1402',
      birthDate: '1952-02-02',
      deathDate: '',
      cemeteryId: 'cem_athlone',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/survey_queue_rules.test.ts`
Expected: FAIL, cannot resolve `../src/lib/surveys/queueRules`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/surveys/queueRules.ts`:

```ts
import type {
  AIStructuredExtraction,
  CaptureStatus,
  ReviewReason,
  SurveyCapture,
  SurveyCounts,
  SurveyQueueState,
} from '@/types';
import type { NewGraveForm } from '../capture/newGrave';

// The rules the survey queue follows. Pure, so the limits that protect the AI budget are easy to test.

export const AUTO_SAVE_NAME_CONFIDENCE = 0.9;
export const MAX_READ_ATTEMPTS = 3;
export const MAX_SAVE_FAILURES = 3;
export const MAX_MANUAL_RETRIES = 2;
export const CIRCUIT_BREAKER_LIMIT = 5;
export const RATE_LIMIT_WAIT_MS = 60_000;
export const MIN_WAKE_DELAY_MS = 30_000;
export const OFFLINE_RETRY_MS = 30_000;

export type AfterReading = { status: 'saving' } | { status: 'review'; reason: ReviewReason };

// Only a clear name read inside the survey's cemetery is saved without a person checking it
export function decideAfterReading(reading: AIStructuredExtraction, insideBoundary: boolean): AfterReading {
  if (!reading.firstName.trim() || !reading.surname.trim()) return { status: 'review', reason: 'no-name' };
  if (reading.fieldConfidences.fullName < AUTO_SAVE_NAME_CONFIDENCE) return { status: 'review', reason: 'low-confidence' };
  if (!insideBoundary) return { status: 'review', reason: 'outside-cemetery' };
  return { status: 'saving' };
}

// 30 seconds, 2 minutes, then 10 minutes
export function backoffMs(failures: number): number {
  if (failures <= 1) return 30_000;
  if (failures === 2) return 120_000;
  return 600_000;
}

// Each manual Retry allows one more attempt
export function readLimit(capture: Pick<SurveyCapture, 'manualRetries'>): number {
  return MAX_READ_ATTEMPTS + capture.manualRetries;
}

export function saveLimit(capture: Pick<SurveyCapture, 'manualRetries'>): number {
  return MAX_SAVE_FAILURES + capture.manualRetries;
}

export function isEligible(capture: SurveyCapture, userId: string, now: number): boolean {
  return (
    capture.userId === userId &&
    (capture.status === 'queued' || capture.status === 'saving') &&
    capture.nextAttemptAt <= now
  );
}

const PENDING: CaptureStatus[] = ['queued', 'reading', 'saving'];
const NEEDS_REVIEW: CaptureStatus[] = ['review', 'failed'];

// Counts are always worked out from the captures, never stored, so they can't drift
export function countCaptures(captures: Pick<SurveyCapture, 'status'>[]): SurveyCounts {
  return {
    captured: captures.length,
    saved: captures.filter((capture) => capture.status === 'saved').length,
    pending: captures.filter((capture) => PENDING.includes(capture.status)).length,
    review: captures.filter((capture) => NEEDS_REVIEW.includes(capture.status)).length,
  };
}

export function canRetry(capture: Pick<SurveyCapture, 'status' | 'manualRetries'>): boolean {
  return capture.status === 'failed' && capture.manualRetries < MAX_MANUAL_RETRIES;
}

// A capture that was read failed while saving, so it goes straight back to saving without another paid read
export function retryChanges(capture: SurveyCapture): Partial<SurveyCapture> {
  return {
    status: capture.reading ? 'saving' : 'queued',
    manualRetries: capture.manualRetries + 1,
    nextAttemptAt: 0,
    lastError: undefined,
  };
}

export type StepResult = 'progress' | 'failure' | 'offline' | 'signed-out' | 'rate-limited';

// Repeated failures pause the whole queue until the surveyor taps Resume. Losing signal isn't a failure.
export function nextQueueState(state: SurveyQueueState, step: StepResult): SurveyQueueState {
  if (step === 'progress') return state.consecutiveFailures === 0 ? state : { ...state, consecutiveFailures: 0 };
  if (step !== 'failure') return state;
  const consecutiveFailures = state.consecutiveFailures + 1;
  return { ...state, consecutiveFailures, pausedForErrors: state.pausedForErrors || consecutiveFailures >= CIRCUIT_BREAKER_LIMIT };
}

export function wakeDelayMs(earliestNextAttemptAt: number | null, now: number): number | null {
  if (earliestNextAttemptAt === null) return null;
  return Math.max(MIN_WAKE_DELAY_MS, earliestNextAttemptAt - now);
}

export type QueueActivity = 'idle' | 'working' | 'waiting' | 'offline' | 'signed-out' | 'paused';

const photos = (count: number) => `${count} ${count === 1 ? 'photo' : 'photos'}`;

export function surveyStatusLine(activity: QueueActivity, counts: SurveyCounts): string | null {
  if (activity === 'paused') return 'Reading paused after repeated errors';
  if (!counts.pending) return null;
  switch (activity) {
    case 'working':
      return `Reading ${counts.captured - counts.pending + 1} of ${counts.captured}…`;
    case 'offline':
      return `No signal: ${photos(counts.pending)} stored on this phone`;
    case 'signed-out':
      return 'Paused: sign in to keep processing';
    default:
      return `Retrying ${photos(counts.pending)} shortly`;
  }
}

export function formFromReading(reading: AIStructuredExtraction, cemeteryId: string): NewGraveForm {
  return {
    firstName: reading.firstName,
    middleNames: reading.middleNames.join(' '),
    surname: reading.surname,
    nickname: reading.nickname ?? '',
    graveNumber: reading.graveNumber,
    birthDate: reading.birthDate ?? '',
    deathDate: reading.deathDate ?? '',
    cemeteryId,
  };
}

export type CaptureFilter = 'all' | 'review' | 'pending' | 'saved';

export function matchesFilter(capture: Pick<SurveyCapture, 'status'>, filter: CaptureFilter): boolean {
  if (filter === 'review') return NEEDS_REVIEW.includes(capture.status);
  if (filter === 'pending') return PENDING.includes(capture.status);
  if (filter === 'saved') return capture.status === 'saved';
  return true;
}

const REVIEW_LABELS: Record<ReviewReason, string> = {
  'no-name': "Name couldn't be read",
  'low-confidence': 'Check the name',
  'outside-cemetery': 'Outside the cemetery',
  'possible-duplicate': 'May already be mapped',
  unreadable: 'No details found',
};

export function captureStatusLabel(capture: Pick<SurveyCapture, 'status' | 'reviewReason' | 'outcome'>): string {
  switch (capture.status) {
    case 'queued':
      return 'Queued';
    case 'reading':
      return 'Reading…';
    case 'saving':
      return 'Saving…';
    case 'review':
      return capture.reviewReason ? REVIEW_LABELS[capture.reviewReason] : 'Needs review';
    case 'saved':
      return capture.outcome === 'added-photo' ? 'Photo added to a mapped grave' : 'Saved';
    default:
      return "Couldn't be processed";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/survey_queue_rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/surveys/queueRules.ts tests/survey_queue_rules.test.ts
git commit -m "feat(surveys): rules for auto-saving, retries, limits and survey status

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Survey store

**Files:**
- Create: `src/lib/surveys/surveyStore.ts`
- Test: `tests/survey_store.test.ts`

**Interfaces:**
- Consumes: `QabrMapDatabase`, `offlineDb` and types from Task 1; `isEligible` from Task 2; `createSaveAttempt` from `src/lib/capture/saveMappedGrave.ts`.
- Produces `class SurveyStore` (constructor `(db: QabrMapDatabase, newId: () => string = () => crypto.randomUUID(), clock: () => Date = () => new Date())`) and the app instance `surveyStore = new SurveyStore(offlineDb)`. Methods:
  - `startSurvey(input: StartSurveyInput): Promise<Survey>` where `StartSurveyInput = { userId: string; cemeteryId: string; cemeteryName: string; sectionNote: string }`. Returns the surveyor's existing active survey if there is one.
  - `finishSurvey(surveyId: string): Promise<Survey | undefined>`
  - `getSurvey(surveyId: string): Promise<Survey | undefined>`
  - `activeSurvey(userId: string): Promise<Survey | undefined>`
  - `listSurveys(userId: string): Promise<Survey[]>` (newest first)
  - `updateSurvey(surveyId: string, changes: Partial<Survey>): Promise<void>`
  - `addCapture(input: NewCaptureInput): Promise<SurveyCapture>` where `NewCaptureInput = { survey: Survey; photo: Blob; thumbnail: string; telemetry: DeviceTelemetry; insideBoundary: boolean }`
  - `getCapture(id: string): Promise<SurveyCapture | undefined>`
  - `listCaptures(surveyId: string): Promise<SurveyCapture[]>` (newest first)
  - `userCaptures(userId: string): Promise<SurveyCapture[]>` (newest first)
  - `updateCapture(id: string, changes: Partial<SurveyCapture>): Promise<void>`
  - `deleteCapture(id: string): Promise<void>`
  - `eligibleCaptures(userId: string, now: number): Promise<SurveyCapture[]>` (oldest first)
  - `earliestNextAttempt(userId: string): Promise<number | null>`
  - `resetInterruptedReads(userId: string): Promise<number>`
  - `getQueueState(userId: string): Promise<SurveyQueueState>`
  - `setQueueState(state: SurveyQueueState): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/survey_store.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import type { DeviceTelemetry, Survey } from '../src/types';
import { QabrMapDatabase } from '../src/lib/offline/db';
import { SurveyStore } from '../src/lib/surveys/surveyStore';

const telemetry: DeviceTelemetry = {
  latitude: -33.968,
  longitude: 18.503,
  gpsAccuracy: 4,
  headingDegrees: 62,
  timestamp: '2026-09-15T10:00:00.000Z',
};

let databaseNumber = 0;
let store: SurveyStore;
let clockMs: number;

function idsFrom(prefix: string) {
  let n = 0;
  return () => `${prefix}${++n}`;
}

beforeEach(() => {
  clockMs = Date.parse('2026-09-15T10:00:00.000Z');
  store = new SurveyStore(new QabrMapDatabase(`QabrMapDB_store_test_${++databaseNumber}`), idsFrom('id'), () => new Date(clockMs));
});

async function startAthlone(userId = 'user-1'): Promise<Survey> {
  return store.startSurvey({ userId, cemeteryId: 'cem_athlone', cemeteryName: 'Athlone Muslim Cemetery', sectionNote: 'Row 12' });
}

async function addCapture(survey: Survey) {
  clockMs += 1000;
  return store.addCapture({
    survey,
    photo: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
    thumbnail: 'data:image/jpeg;base64,/9j/',
    telemetry,
    insideBoundary: true,
  });
}

describe('Survey Store Tests', () => {
  it('starts one active survey per surveyor and finishes it', async () => {
    const survey = await startAthlone();
    expect(survey).toEqual({
      id: 'survey_id1',
      userId: 'user-1',
      cemeteryId: 'cem_athlone',
      cemeteryName: 'Athlone Muslim Cemetery',
      sectionNote: 'Row 12',
      startedAt: '2026-09-15T10:00:00.000Z',
      status: 'ACTIVE',
    });
    await expect(startAthlone()).resolves.toEqual(survey);
    await expect(store.activeSurvey('user-1')).resolves.toEqual(survey);
    await expect(store.activeSurvey('user-2')).resolves.toBeUndefined();

    clockMs += 60_000;
    await expect(store.finishSurvey(survey.id)).resolves.toMatchObject({ status: 'COMPLETED', completedAt: '2026-09-15T10:01:00.000Z' });
    await expect(store.activeSurvey('user-1')).resolves.toBeUndefined();

    const next = await startAthlone();
    expect(next.id).not.toBe(survey.id);
    await expect(store.listSurveys('user-1')).resolves.toMatchObject([{ id: next.id }, { id: survey.id }]);
  });

  it('queues a capture with fresh save ids', async () => {
    const survey = await startAthlone();
    const capture = await addCapture(survey);
    expect(capture).toMatchObject({
      id: 'capture_id2',
      surveyId: survey.id,
      userId: 'user-1',
      cemeteryId: 'cem_athlone',
      createdAt: '2026-09-15T10:00:01.000Z',
      status: 'queued',
      readAttempts: 0,
      saveFailures: 0,
      manualRetries: 0,
      nextAttemptAt: 0,
      insideBoundary: true,
      attempt: { graveId: 'grave_id3', personId: 'person_id4' },
    });
    expect((await store.getCapture(capture.id))?.photo).toBeInstanceOf(Blob);
  });

  it('lists captures newest first, per survey and per surveyor', async () => {
    const survey = await startAthlone();
    const first = await addCapture(survey);
    const second = await addCapture(survey);
    const other = await addCapture(await startAthlone('user-2'));
    expect((await store.listCaptures(survey.id)).map((c) => c.id)).toEqual([second.id, first.id]);
    expect((await store.userCaptures('user-2')).map((c) => c.id)).toEqual([other.id]);
  });

  it('finds eligible captures oldest first, and the next time to wake', async () => {
    const survey = await startAthlone();
    const first = await addCapture(survey);
    const second = await addCapture(survey);
    const third = await addCapture(survey);
    await store.updateCapture(second.id, { status: 'saving', nextAttemptAt: 5000 });
    await store.updateCapture(third.id, { status: 'review' });

    expect((await store.eligibleCaptures('user-1', 4000)).map((c) => c.id)).toEqual([first.id]);
    expect((await store.eligibleCaptures('user-1', 5000)).map((c) => c.id)).toEqual([first.id, second.id]);
    await expect(store.eligibleCaptures('user-2', 5000)).resolves.toEqual([]);

    await store.updateCapture(first.id, { status: 'saved' });
    await expect(store.earliestNextAttempt('user-1')).resolves.toBe(5000);
    await store.updateCapture(second.id, { status: 'failed' });
    await expect(store.earliestNextAttempt('user-1')).resolves.toBeNull();
  });

  it('returns captures left mid-read to the queue after a restart', async () => {
    const survey = await startAthlone();
    const capture = await addCapture(survey);
    await store.updateCapture(capture.id, { status: 'reading', readAttempts: 1 });
    await expect(store.resetInterruptedReads('user-1')).resolves.toBe(1);
    await expect(store.getCapture(capture.id)).resolves.toMatchObject({ status: 'queued', readAttempts: 1 });
  });

  it('removes the photo and deletes captures', async () => {
    const survey = await startAthlone();
    const capture = await addCapture(survey);
    await store.updateCapture(capture.id, { status: 'saved', photo: undefined, graveId: 'grave_id3' });
    expect('photo' in ((await store.getCapture(capture.id)) ?? {})).toBe(false);
    await store.deleteCapture(capture.id);
    await expect(store.getCapture(capture.id)).resolves.toBeUndefined();
  });

  it('keeps the paused state per surveyor', async () => {
    await expect(store.getQueueState('user-1')).resolves.toEqual({ userId: 'user-1', consecutiveFailures: 0, pausedForErrors: false });
    await store.setQueueState({ userId: 'user-1', consecutiveFailures: 5, pausedForErrors: true });
    await expect(store.getQueueState('user-1')).resolves.toEqual({ userId: 'user-1', consecutiveFailures: 5, pausedForErrors: true });
    await expect(store.getQueueState('user-2')).resolves.toMatchObject({ pausedForErrors: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/survey_store.test.ts`
Expected: FAIL, cannot resolve `../src/lib/surveys/surveyStore`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/surveys/surveyStore.ts`:

```ts
import type { DeviceTelemetry, Survey, SurveyCapture, SurveyQueueState } from '@/types';
import { offlineDb, QabrMapDatabase } from '../offline/db';
import { createSaveAttempt } from '../capture/saveMappedGrave';
import { isEligible } from './queueRules';

export interface StartSurveyInput {
  userId: string;
  cemeteryId: string;
  cemeteryName: string;
  sectionNote: string;
}

export interface NewCaptureInput {
  survey: Survey;
  photo: Blob;
  thumbnail: string;
  telemetry: DeviceTelemetry;
  insideBoundary: boolean;
}

const newestFirst = <T extends { startedAt?: string; createdAt?: string }>(a: T, b: T) =>
  (b.startedAt ?? b.createdAt ?? '').localeCompare(a.startedAt ?? a.createdAt ?? '');

// Surveys and their captures on this phone. The ids and clock are passed in so tests are repeatable.
export class SurveyStore {
  constructor(
    private readonly db: QabrMapDatabase,
    private readonly newId: () => string = () => crypto.randomUUID(),
    private readonly clock: () => Date = () => new Date()
  ) {}

  // At most one active survey per surveyor on a phone, so starting again returns the one already running
  async startSurvey(input: StartSurveyInput): Promise<Survey> {
    return this.db.transaction('rw', this.db.surveys, async () => {
      const active = await this.activeSurvey(input.userId);
      if (active) return active;
      const survey: Survey = {
        id: `survey_${this.newId()}`,
        userId: input.userId,
        cemeteryId: input.cemeteryId,
        cemeteryName: input.cemeteryName,
        sectionNote: input.sectionNote.trim(),
        startedAt: this.clock().toISOString(),
        status: 'ACTIVE',
      };
      await this.db.surveys.add(survey);
      return survey;
    });
  }

  async finishSurvey(surveyId: string): Promise<Survey | undefined> {
    await this.db.surveys.update(surveyId, { status: 'COMPLETED', completedAt: this.clock().toISOString() });
    return this.db.surveys.get(surveyId);
  }

  getSurvey(surveyId: string): Promise<Survey | undefined> {
    return this.db.surveys.get(surveyId);
  }

  activeSurvey(userId: string): Promise<Survey | undefined> {
    return this.db.surveys.where('userId').equals(userId).filter((survey) => survey.status === 'ACTIVE').first();
  }

  async listSurveys(userId: string): Promise<Survey[]> {
    return (await this.db.surveys.where('userId').equals(userId).toArray()).sort(newestFirst);
  }

  async updateSurvey(surveyId: string, changes: Partial<Survey>): Promise<void> {
    await this.db.surveys.update(surveyId, changes);
  }

  async addCapture(input: NewCaptureInput): Promise<SurveyCapture> {
    const capture: SurveyCapture = {
      id: `capture_${this.newId()}`,
      surveyId: input.survey.id,
      userId: input.survey.userId,
      cemeteryId: input.survey.cemeteryId,
      createdAt: this.clock().toISOString(),
      photo: input.photo,
      thumbnail: input.thumbnail,
      telemetry: input.telemetry,
      insideBoundary: input.insideBoundary,
      status: 'queued',
      readAttempts: 0,
      saveFailures: 0,
      manualRetries: 0,
      nextAttemptAt: 0,
      // Made now, so every retry of this capture's save uses the same grave and person ids
      attempt: createSaveAttempt(this.newId),
    };
    await this.db.surveyCaptures.add(capture);
    return capture;
  }

  getCapture(id: string): Promise<SurveyCapture | undefined> {
    return this.db.surveyCaptures.get(id);
  }

  async listCaptures(surveyId: string): Promise<SurveyCapture[]> {
    return (await this.db.surveyCaptures.where('surveyId').equals(surveyId).toArray()).sort(newestFirst);
  }

  async userCaptures(userId: string): Promise<SurveyCapture[]> {
    return (await this.db.surveyCaptures.where('userId').equals(userId).toArray()).sort(newestFirst);
  }

  async updateCapture(id: string, changes: Partial<SurveyCapture>): Promise<void> {
    await this.db.surveyCaptures.update(id, changes);
  }

  async deleteCapture(id: string): Promise<void> {
    await this.db.surveyCaptures.delete(id);
  }

  async eligibleCaptures(userId: string, now: number): Promise<SurveyCapture[]> {
    const captures = await this.db.surveyCaptures
      .where('userId')
      .equals(userId)
      .filter((capture) => isEligible(capture, userId, now))
      .toArray();
    return captures.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async earliestNextAttempt(userId: string): Promise<number | null> {
    const waiting = await this.db.surveyCaptures
      .where('userId')
      .equals(userId)
      .filter((capture) => capture.status === 'queued' || capture.status === 'saving')
      .toArray();
    return waiting.length ? Math.min(...waiting.map((capture) => capture.nextAttemptAt)) : null;
  }

  // A read cut off by the app closing is read again; its attempt was already counted
  async resetInterruptedReads(userId: string): Promise<number> {
    return this.db.surveyCaptures
      .where('userId')
      .equals(userId)
      .filter((capture) => capture.status === 'reading')
      .modify({ status: 'queued' });
  }

  async getQueueState(userId: string): Promise<SurveyQueueState> {
    return (await this.db.surveyQueueState.get(userId)) ?? { userId, consecutiveFailures: 0, pausedForErrors: false };
  }

  async setQueueState(state: SurveyQueueState): Promise<void> {
    await this.db.surveyQueueState.put(state);
  }
}

export const surveyStore = new SurveyStore(offlineDb);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/survey_store.test.ts`
Expected: PASS (7 tests).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/surveys/surveyStore.ts tests/survey_store.test.ts
git commit -m "feat(surveys): keep surveys, captures and the queue state in IndexedDB

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Queue adapters and cloud survey rows

**Files:**
- Create: `src/lib/surveys/queueAdapters.ts`
- Test: `tests/survey_queue_adapters.test.ts`

**Interfaces:**
- Consumes: `isStoneReading`, `stoneReadingToExtraction` (`src/lib/ai/stoneReading.ts`); `mapSaveGraveError` (`src/lib/supabase/saveGraveErrors.ts`); `SaveMappedGraveResult` (Plan 1); `MatchCandidate` (Plan 1); types from Task 1.
- Produces (pure):
  - `type ReadResult = { kind: 'reading'; reading: AIStructuredExtraction } | { kind: 'offline' } | { kind: 'rate-limited' } | { kind: 'signed-out' } | { kind: 'unreadable'; message: string } | { kind: 'error'; message: string }`
  - `readResultFromResponse(status: number, body: unknown): ReadResult` (status `0` means no answer arrived)
  - `type SaveResult = { kind: 'created' | 'added-photo'; graveId: string } | { kind: 'match-found'; candidate: MatchCandidate } | { kind: 'offline' } | { kind: 'signed-out' } | { kind: 'error'; message: string }`
  - `saveResultFromOutcome(result: SaveMappedGraveResult): SaveResult`
  - `saveResultFromError(err: unknown): SaveResult`
  - `CLOUD_SYNC_INTERVAL_MS = 60_000`
  - `cloudSyncDelayMs(survey: Survey, counts: SurveyCounts, now: number): number | null` (`0` sync now, a positive number to wait, `null` nothing to write)
  - `surveySessionRow(survey: Survey, counts: SurveyCounts): SurveySessionRow`
  - `interface CloudSurveySummary { id: string; cemeteryName: string; sectionNote: string; startedAt: string; completedAt?: string; status: SurveyStatus; counts: SurveyCounts }`
  - `mapCloudSurveyRow(row: unknown): CloudSurveySummary | null`

- [ ] **Step 1: Write the failing test**

Create `tests/survey_queue_adapters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Survey } from '../src/types';
import type { StoneReading } from '../src/lib/ai/stoneReading';
import { SaveGraveError, UNKNOWN_SAVE_MESSAGE } from '../src/lib/supabase/saveGraveErrors';
import {
  CLOUD_SYNC_INTERVAL_MS,
  cloudSyncDelayMs,
  mapCloudSurveyRow,
  readResultFromResponse,
  saveResultFromError,
  saveResultFromOutcome,
  surveySessionRow,
} from '../src/lib/surveys/queueAdapters';

const yusuf: StoneReading = {
  hasGraveDetails: true,
  firstName: 'Yusuf',
  middleNames: [],
  surname: 'Kamish',
  nickname: null,
  graveNumber: null,
  birthDate: '1952-02-02',
  deathDate: '2018-06-16',
  datesAsWritten: null,
  transcript: 'YUSUF KAMISH',
  confidence: { name: 0.95, graveNumber: 0, dates: 0.9 },
  notes: [],
};

const survey: Survey = {
  id: 'survey_1',
  userId: 'user-1',
  cemeteryId: 'cem_athlone',
  cemeteryName: 'Athlone Muslim Cemetery',
  sectionNote: 'Row 12',
  startedAt: '2026-09-15T10:00:00.000Z',
  status: 'ACTIVE',
};

const counts = { captured: 5, saved: 2, pending: 2, review: 1 };
const NOW = Date.parse('2026-09-15T10:05:00.000Z');

describe('Read Result Tests', () => {
  it('turns a reading into form details', () => {
    const result = readResultFromResponse(200, { reading: yusuf });
    expect(result).toMatchObject({ kind: 'reading', reading: { firstName: 'Yusuf', surname: 'Kamish', birthDate: '1952-02-02' } });
  });

  it('maps each failure to what the queue does next', () => {
    expect(readResultFromResponse(0, null)).toEqual({ kind: 'offline' });
    expect(readResultFromResponse(401, { error: 'Sign in to read a photo.' })).toEqual({ kind: 'signed-out' });
    expect(readResultFromResponse(429, { error: 'Too many photos read. Try again later.' })).toEqual({ kind: 'rate-limited' });
    expect(readResultFromResponse(422, { error: 'No grave details were found in this photo.' })).toEqual({
      kind: 'unreadable',
      message: 'No grave details were found in this photo.',
    });
    expect(readResultFromResponse(422, null)).toMatchObject({ kind: 'unreadable' });
    expect(readResultFromResponse(502, { error: "The photo couldn't be read." })).toEqual({ kind: 'error', message: "The photo couldn't be read." });
    expect(readResultFromResponse(503, null)).toMatchObject({ kind: 'error' });
    expect(readResultFromResponse(200, { reading: { name: 'broken' } })).toMatchObject({ kind: 'error' });
  });
});

describe('Save Result Tests', () => {
  it('passes saved, added and matched outcomes through', () => {
    expect(saveResultFromOutcome({ outcome: 'created', graveId: 'grave_1', personId: 'person_1', photoUrl: 'https://x/p.jpg' })).toEqual({
      kind: 'created',
      graveId: 'grave_1',
    });
    expect(saveResultFromOutcome({ outcome: 'added-photo', graveId: 'grave_2', personId: 'person_1', photoUrl: 'https://x/p.jpg' })).toEqual({
      kind: 'added-photo',
      graveId: 'grave_2',
    });
    const candidate = { graveId: 'grave_2', fullName: 'Yusuf Kamish', graveNumber: '', distanceMeters: 3, match: 'possible' as const };
    expect(saveResultFromOutcome({ outcome: 'match-found', candidate })).toEqual({ kind: 'match-found', candidate });
  });

  it('keeps offline and signed-out apart from real failures', () => {
    expect(saveResultFromError(new TypeError('Failed to fetch'))).toEqual({ kind: 'offline' });
    expect(saveResultFromError(new SaveGraveError('offline', 'offline'))).toEqual({ kind: 'offline' });
    expect(saveResultFromError({ code: '42501', message: 'Sign in to map a grave.' })).toEqual({ kind: 'signed-out' });
    expect(saveResultFromError(new SaveGraveError('signed-out', 'x'))).toEqual({ kind: 'signed-out' });
    expect(saveResultFromError({ code: '22023', message: 'GPS accuracy must be 10 m or better.' })).toEqual({
      kind: 'error',
      message: 'GPS accuracy must be 10 m or better.',
    });
    expect(saveResultFromError(new Error('boom'))).toEqual({ kind: 'error', message: UNKNOWN_SAVE_MESSAGE });
  });
});

describe('Cloud Survey Tests', () => {
  it('writes a new survey straight away', () => {
    expect(cloudSyncDelayMs(survey, counts, NOW)).toBe(0);
  });

  it('writes changed counts at most once a minute', () => {
    const synced = { ...survey, cloudSyncedAt: '2026-09-15T10:04:30.000Z', cloudCounts: { ...counts, saved: 1 } };
    expect(cloudSyncDelayMs(synced, counts, NOW)).toBe(30_000);
    expect(cloudSyncDelayMs(synced, counts, NOW + 30_000)).toBe(0);
    expect(cloudSyncDelayMs({ ...synced, cloudCounts: counts }, counts, NOW + CLOUD_SYNC_INTERVAL_MS)).toBeNull();
  });

  it('writes a finished survey straight away', () => {
    const finished: Survey = {
      ...survey,
      status: 'COMPLETED',
      completedAt: '2026-09-15T10:04:50.000Z',
      cloudSyncedAt: '2026-09-15T10:04:30.000Z',
      cloudCounts: counts,
    };
    expect(cloudSyncDelayMs(finished, counts, NOW)).toBe(0);
    expect(cloudSyncDelayMs({ ...finished, cloudSyncedAt: '2026-09-15T10:04:55.000Z' }, counts, NOW)).toBeNull();
  });

  it('maps a survey to a survey_sessions row, with Saved as processed', () => {
    expect(surveySessionRow(survey, counts)).toEqual({
      id: 'survey_1',
      user_id: 'user-1',
      cemetery_id: 'cem_athlone',
      cemetery_name: 'Athlone Muslim Cemetery',
      section_code: 'Row 12',
      started_at: '2026-09-15T10:00:00.000Z',
      completed_at: null,
      status: 'ACTIVE',
      captured_count: 5,
      processed_count: 2,
      pending_count: 2,
      review_count: 1,
    });
    expect(surveySessionRow({ ...survey, sectionNote: '' }, counts).section_code).toBeNull();
  });

  it('reads cloud rows for surveys from another phone', () => {
    expect(
      mapCloudSurveyRow({
        id: 'survey_9',
        cemetery_name: 'Mowbray Muslim Cemetery',
        section_code: null,
        started_at: '2026-09-01T08:00:00+00:00',
        completed_at: '2026-09-01T11:00:00+00:00',
        status: 'COMPLETED',
        captured_count: 40,
        processed_count: 35,
        pending_count: 0,
        review_count: 5,
      })
    ).toEqual({
      id: 'survey_9',
      cemeteryName: 'Mowbray Muslim Cemetery',
      sectionNote: '',
      startedAt: '2026-09-01T08:00:00+00:00',
      completedAt: '2026-09-01T11:00:00+00:00',
      status: 'COMPLETED',
      counts: { captured: 40, saved: 35, pending: 0, review: 5 },
    });
    expect(mapCloudSurveyRow({ id: 'survey_9' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/survey_queue_adapters.test.ts`
Expected: FAIL, cannot resolve `../src/lib/surveys/queueAdapters`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/surveys/queueAdapters.ts`:

```ts
import type { AIStructuredExtraction, Survey, SurveyCounts, SurveyStatus } from '@/types';
import type { SaveMappedGraveResult } from '../capture/saveMappedGrave';
import type { MatchCandidate } from '../graves/matchCandidate';
import { isStoneReading, stoneReadingToExtraction } from '../ai/stoneReading';
import { mapSaveGraveError } from '../supabase/saveGraveErrors';

// Turns network answers into the few results the survey queue acts on

export type ReadResult =
  | { kind: 'reading'; reading: AIStructuredExtraction }
  | { kind: 'offline' }
  | { kind: 'rate-limited' }
  | { kind: 'signed-out' }
  | { kind: 'unreadable'; message: string }
  | { kind: 'error'; message: string };

const READ_FAILED = "The photo couldn't be read.";

function errorText(body: unknown): string | undefined {
  const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  return typeof error === 'string' ? error : undefined;
}

// Status 0 means no answer arrived, so the read may never have reached the server
export function readResultFromResponse(status: number, body: unknown): ReadResult {
  if (status === 0) return { kind: 'offline' };
  if (status === 200) {
    const reading = body && typeof body === 'object' ? (body as { reading?: unknown }).reading : undefined;
    return isStoneReading(reading) ? { kind: 'reading', reading: stoneReadingToExtraction(reading) } : { kind: 'error', message: READ_FAILED };
  }
  if (status === 401) return { kind: 'signed-out' };
  if (status === 429) return { kind: 'rate-limited' };
  if (status === 422) return { kind: 'unreadable', message: errorText(body) ?? 'No grave details were found in this photo.' };
  return { kind: 'error', message: errorText(body) ?? READ_FAILED };
}

export type SaveResult =
  | { kind: 'created' | 'added-photo'; graveId: string }
  | { kind: 'match-found'; candidate: MatchCandidate }
  | { kind: 'offline' }
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string };

export function saveResultFromOutcome(result: SaveMappedGraveResult): SaveResult {
  if (result.outcome === 'match-found') return { kind: 'match-found', candidate: result.candidate };
  return { kind: result.outcome, graveId: result.graveId };
}

export function saveResultFromError(err: unknown): SaveResult {
  const mapped = mapSaveGraveError(err);
  if (mapped.code === 'offline') return { kind: 'offline' };
  if (mapped.code === 'signed-out') return { kind: 'signed-out' };
  return { kind: 'error', message: mapped.message };
}

export const CLOUD_SYNC_INTERVAL_MS = 60_000;

const sameCounts = (a: SurveyCounts | undefined, b: SurveyCounts) =>
  Boolean(a) && a!.captured === b.captured && a!.saved === b.saved && a!.pending === b.pending && a!.review === b.review;

// A new or finished survey is written at once; changing counts at most once a minute
export function cloudSyncDelayMs(survey: Survey, counts: SurveyCounts, now: number): number | null {
  if (!survey.cloudSyncedAt) return 0;
  if (survey.completedAt && survey.cloudSyncedAt < survey.completedAt) return 0;
  if (sameCounts(survey.cloudCounts, counts)) return null;
  return Math.max(0, Date.parse(survey.cloudSyncedAt) + CLOUD_SYNC_INTERVAL_MS - now);
}

export interface SurveySessionRow {
  id: string;
  user_id: string;
  cemetery_id: string;
  cemetery_name: string;
  section_code: string | null;
  started_at: string;
  completed_at: string | null;
  status: SurveyStatus;
  captured_count: number;
  processed_count: number;
  pending_count: number;
  review_count: number;
}

export function surveySessionRow(survey: Survey, counts: SurveyCounts): SurveySessionRow {
  return {
    id: survey.id,
    user_id: survey.userId,
    cemetery_id: survey.cemeteryId,
    cemetery_name: survey.cemeteryName,
    section_code: survey.sectionNote || null,
    started_at: survey.startedAt,
    completed_at: survey.completedAt ?? null,
    status: survey.status,
    captured_count: counts.captured,
    processed_count: counts.saved,
    pending_count: counts.pending,
    review_count: counts.review,
  };
}

// A survey recorded in the cloud, for listing surveys made on another phone
export interface CloudSurveySummary {
  id: string;
  cemeteryName: string;
  sectionNote: string;
  startedAt: string;
  completedAt?: string;
  status: SurveyStatus;
  counts: SurveyCounts;
}

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export function mapCloudSurveyRow(row: unknown): CloudSurveySummary | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.cemetery_name !== 'string' || typeof r.started_at !== 'string') return null;
  return {
    id: r.id,
    cemeteryName: r.cemetery_name,
    sectionNote: typeof r.section_code === 'string' ? r.section_code : '',
    startedAt: r.started_at,
    completedAt: typeof r.completed_at === 'string' ? r.completed_at : undefined,
    // PAUSED is an old status this app no longer writes; it reads as active
    status: r.status === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE',
    counts: {
      captured: count(r.captured_count),
      saved: count(r.processed_count),
      pending: count(r.pending_count),
      review: count(r.review_count),
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/survey_queue_adapters.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/surveys/queueAdapters.ts tests/survey_queue_adapters.test.ts
git commit -m "feat(surveys): map read and save answers, and survey rows for the cloud

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Queue worker

**Files:**
- Create: `src/lib/surveys/queueWorker.ts`
- Test: `tests/survey_queue_worker.test.ts`

**Interfaces:**
- Consumes: Task 2 rules (`backoffMs`, `decideAfterReading`, `nextQueueState`, `readLimit`, `saveLimit`, `wakeDelayMs`, `RATE_LIMIT_WAIT_MS`, `OFFLINE_RETRY_MS`, `QueueActivity`, `StepResult`, `isEligible` in tests); Task 4 `ReadResult`, `SaveResult`; Task 1 types. `SurveyStore` (Task 3) satisfies `QueueStorage` structurally.
- Produces:

```ts
export interface QueueStorage {
  eligibleCaptures(userId: string, now: number): Promise<SurveyCapture[]>;
  earliestNextAttempt(userId: string): Promise<number | null>;
  resetInterruptedReads(userId: string): Promise<number>;
  updateCapture(id: string, changes: Partial<SurveyCapture>): Promise<void>;
  getSurvey(surveyId: string): Promise<Survey | undefined>;
  getQueueState(userId: string): Promise<SurveyQueueState>;
  setQueueState(state: SurveyQueueState): Promise<void>;
}
export interface QueueWorkerDeps {
  storage: QueueStorage;
  readPhoto: (capture: SurveyCapture) => Promise<ReadResult>;
  saveCapture: (capture: SurveyCapture, survey: Survey) => Promise<SaveResult>;
  getUserId: () => Promise<string | null>;
  isOnline: () => boolean;
  now: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  runExclusive: (task: () => Promise<void>) => Promise<void>;
  onChange?: () => void;
  onError?: (err: unknown) => void;
}
export interface QueueWorker {
  wake(): Promise<void>;          // process whatever is eligible now
  resume(): Promise<void>;        // clear the repeated-errors pause, then wake
  signedIn(): Promise<void>;      // clear the signed-out pause, then wake
  activity(): QueueActivity;
  subscribe(listener: (activity: QueueActivity) => void): () => void;
  stop(): void;
}
export function createQueueWorker(deps: QueueWorkerDeps): QueueWorker;
export function createExclusiveRunner(locks?: { request: LockManager['request'] }, name?: string): (task: () => Promise<void>) => Promise<void>;
```

How the worker protects the AI budget (each point has a test):
- `readAttempts` is saved before every read. At `readLimit` the capture becomes `failed` without another read, including after a restart.
- Offline and signed-out answers are not counted, but stop the run. Nothing is retried in a loop: offline waits for the `online` event (or 30 seconds when the phone still reports a connection), signed-out waits for `signedIn()`.
- 429 holds the whole queue for 60 seconds.
- Other errors back off 30 s, 2 min, 10 min. Five failures in a row (reads or saves) pause the queue, stored per user, until `resume()`.
- Only one run at a time: a wake during a run sets a flag and the run repeats once, and `runExclusive` stops two tabs running together.
- The run ends when nothing is eligible and sets one timer for the earliest `nextAttemptAt`, never under 30 seconds.

- [ ] **Step 1: Write the failing test**

Create `tests/survey_queue_worker.test.ts`:

```ts
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

  const storage: QueueStorage = {
    async eligibleCaptures(user, at) {
      return [...rows.values()]
        .filter((c) => isEligible(c, user, at))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((c) => ({ ...c, attempt: { ...c.attempt } }));
    },
    async earliestNextAttempt(user) {
      const waiting = [...rows.values()].filter((c) => c.userId === user && (c.status === 'queued' || c.status === 'saving'));
      return waiting.length ? Math.min(...waiting.map((c) => c.nextAttemptAt)) : null;
    },
    async resetInterruptedReads(user) {
      const reading = [...rows.values()].filter((c) => c.userId === user && c.status === 'reading');
      reading.forEach((c) => (c.status = 'queued'));
      return reading.length;
    },
    async updateCapture(id, changes) {
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

  it('does not count a read that lost its connection, and tries again in 30 seconds', async () => {
    const q = setup([capture(1)]);
    q.readPhoto.mockResolvedValueOnce({ kind: 'offline' });
    await q.worker.wake();
    expect(q.row('capture_1')).toMatchObject({ status: 'queued', readAttempts: 0 });
    expect(q.worker.activity()).toBe('offline');
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
    q.readPhoto.mockResolvedValueOnce({ kind: 'rate-limited' });
    await q.worker.wake();
    expect(q.readPhoto).toHaveBeenCalledTimes(1);
    expect(q.row('capture_1')).toMatchObject({ status: 'queued', readAttempts: 0 });
    expect(q.worker.activity()).toBe('waiting');
    expect(q.timers.map((t) => t.ms)).toEqual([60_000]);
    await q.fireTimer();
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/survey_queue_worker.test.ts`
Expected: FAIL, cannot resolve `../src/lib/surveys/queueWorker`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/surveys/queueWorker.ts`:

```ts
import type { Survey, SurveyCapture, SurveyQueueState } from '@/types';
import type { ReadResult, SaveResult } from './queueAdapters';
import {
  OFFLINE_RETRY_MS,
  QueueActivity,
  RATE_LIMIT_WAIT_MS,
  StepResult,
  backoffMs,
  decideAfterReading,
  nextQueueState,
  readLimit,
  saveLimit,
  wakeDelayMs,
} from './queueRules';

// Processes a surveyor's queued captures one at a time: read the photo, decide, save. Storage, network,
// clock and timers are passed in, so every limit that protects the AI budget is tested without a browser.

export interface QueueStorage {
  eligibleCaptures(userId: string, now: number): Promise<SurveyCapture[]>;
  earliestNextAttempt(userId: string): Promise<number | null>;
  resetInterruptedReads(userId: string): Promise<number>;
  updateCapture(id: string, changes: Partial<SurveyCapture>): Promise<void>;
  getSurvey(surveyId: string): Promise<Survey | undefined>;
  getQueueState(userId: string): Promise<SurveyQueueState>;
  setQueueState(state: SurveyQueueState): Promise<void>;
}

export interface QueueWorkerDeps {
  storage: QueueStorage;
  readPhoto: (capture: SurveyCapture) => Promise<ReadResult>;
  saveCapture: (capture: SurveyCapture, survey: Survey) => Promise<SaveResult>;
  getUserId: () => Promise<string | null>;
  isOnline: () => boolean;
  now: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  runExclusive: (task: () => Promise<void>) => Promise<void>;
  onChange?: () => void;
  onError?: (err: unknown) => void;
}

export interface QueueWorker {
  wake(): Promise<void>;
  resume(): Promise<void>;
  signedIn(): Promise<void>;
  activity(): QueueActivity;
  subscribe(listener: (activity: QueueActivity) => void): () => void;
  stop(): void;
}

export function createQueueWorker(deps: QueueWorkerDeps): QueueWorker {
  let running = false;
  let wakeAgain = false;
  let stopped = false;
  // Kept in memory only: a restart tries once more, and a 401 costs no AI tokens
  let signedOut = false;
  let rateLimitedUntil = 0;
  let timer: unknown = null;
  let current: QueueActivity = 'idle';
  const recoveredUsers = new Set<string>();
  const listeners = new Set<(activity: QueueActivity) => void>();

  function setActivity(activity: QueueActivity) {
    if (activity === current) return;
    current = activity;
    listeners.forEach((listener) => listener(activity));
  }

  // At most one timer, so waiting never turns into a loop
  function schedule(ms: number | null) {
    if (timer !== null) {
      deps.clearTimer(timer);
      timer = null;
    }
    if (ms === null || stopped) return;
    timer = deps.setTimer(() => {
      timer = null;
      void wake();
    }, ms);
  }

  async function update(capture: SurveyCapture, changes: Partial<SurveyCapture>) {
    await deps.storage.updateCapture(capture.id, changes);
    deps.onChange?.();
  }

  async function readStep(capture: SurveyCapture, now: number): Promise<StepResult> {
    const limit = readLimit(capture);
    if (capture.readAttempts >= limit) {
      await update(capture, { status: 'failed', lastError: capture.lastError ?? "The photo couldn't be read." });
      return 'progress';
    }

    // Counted before the request, so a read cut off by the app closing still counts toward the cap
    const readAttempts = capture.readAttempts + 1;
    await update(capture, { status: 'reading', readAttempts });
    const result = await deps.readPhoto({ ...capture, readAttempts });

    switch (result.kind) {
      case 'reading': {
        const next = decideAfterReading(result.reading, capture.insideBoundary);
        await update(
          capture,
          next.status === 'review'
            ? { status: 'review', reviewReason: next.reason, reading: result.reading, lastError: undefined }
            : { status: 'saving', reading: result.reading, nextAttemptAt: 0, lastError: undefined }
        );
        return 'progress';
      }
      case 'unreadable':
        await update(capture, { status: 'review', reviewReason: 'unreadable', lastError: result.message });
        return 'progress';
      case 'offline':
        // No answer arrived, so the attempt isn't counted
        await update(capture, { status: 'queued', readAttempts: capture.readAttempts });
        return 'offline';
      case 'rate-limited':
        await update(capture, { status: 'queued', readAttempts: capture.readAttempts, nextAttemptAt: now + RATE_LIMIT_WAIT_MS });
        return 'rate-limited';
      case 'signed-out':
        await update(capture, { status: 'queued', readAttempts: capture.readAttempts });
        return 'signed-out';
      default:
        await update(
          capture,
          readAttempts >= limit
            ? { status: 'failed', lastError: result.message }
            : { status: 'queued', nextAttemptAt: now + backoffMs(readAttempts), lastError: result.message }
        );
        return 'failure';
    }
  }

  async function saveStep(capture: SurveyCapture, now: number): Promise<StepResult> {
    const survey = await deps.storage.getSurvey(capture.surveyId);
    if (!survey) {
      await update(capture, { status: 'failed', lastError: 'This survey is no longer on this phone.' });
      return 'progress';
    }
    const limit = saveLimit(capture);
    if (capture.saveFailures >= limit) {
      await update(capture, { status: 'failed', lastError: capture.lastError ?? "The grave couldn't be saved." });
      return 'progress';
    }

    // The save records its uploaded photo on this copy, which is stored whatever happens next
    const attempt = { ...capture.attempt };
    const result = await deps.saveCapture({ ...capture, attempt }, survey);

    switch (result.kind) {
      case 'created':
      case 'added-photo':
        await update(capture, {
          status: 'saved',
          outcome: result.kind,
          graveId: result.graveId,
          photo: undefined,
          attempt,
          matchCandidate: undefined,
          lastError: undefined,
        });
        return 'progress';
      case 'match-found':
        await update(capture, { status: 'review', reviewReason: 'possible-duplicate', matchCandidate: result.candidate, attempt });
        return 'progress';
      case 'offline':
        await update(capture, { attempt });
        return 'offline';
      case 'signed-out':
        await update(capture, { attempt });
        return 'signed-out';
      default: {
        const saveFailures = capture.saveFailures + 1;
        await update(
          capture,
          saveFailures >= limit
            ? { status: 'failed', saveFailures, attempt, lastError: result.message }
            : { saveFailures, attempt, nextAttemptAt: now + backoffMs(saveFailures), lastError: result.message }
        );
        return 'failure';
      }
    }
  }

  async function runOnce(): Promise<void> {
    const userId = await deps.getUserId();
    if (!userId || signedOut) {
      setActivity('signed-out');
      return;
    }
    let state = await deps.storage.getQueueState(userId);
    if (state.pausedForErrors) {
      setActivity('paused');
      return;
    }
    if (!recoveredUsers.has(userId)) {
      await deps.storage.resetInterruptedReads(userId);
      recoveredUsers.add(userId);
    }

    while (!stopped) {
      // The online event wakes the worker again
      if (!deps.isOnline()) {
        setActivity('offline');
        return;
      }
      const now = deps.now();
      if (rateLimitedUntil > now) {
        setActivity('waiting');
        schedule(rateLimitedUntil - now);
        return;
      }

      const [next] = await deps.storage.eligibleCaptures(userId, now);
      if (!next) {
        const delay = wakeDelayMs(await deps.storage.earliestNextAttempt(userId), now);
        schedule(delay);
        setActivity(delay === null ? 'idle' : 'waiting');
        return;
      }

      setActivity('working');
      const step = next.status === 'saving' ? await saveStep(next, now) : await readStep(next, now);

      const nextState = nextQueueState(state, step);
      if (nextState !== state) {
        state = nextState;
        await deps.storage.setQueueState(state);
      }
      if (state.pausedForErrors) {
        schedule(null);
        setActivity('paused');
        return;
      }
      if (step === 'signed-out') {
        signedOut = true;
        setActivity('signed-out');
        return;
      }
      if (step === 'rate-limited') rateLimitedUntil = now + RATE_LIMIT_WAIT_MS;
      if (step === 'offline') {
        // Requests can fail while the phone still reports a connection, so try again shortly in that case
        setActivity('offline');
        schedule(deps.isOnline() ? OFFLINE_RETRY_MS : null);
        return;
      }
    }
  }

  async function wake(): Promise<void> {
    if (stopped) return;
    if (running) {
      wakeAgain = true;
      return;
    }
    running = true;
    try {
      do {
        wakeAgain = false;
        await deps.runExclusive(runOnce);
      } while (wakeAgain && !stopped);
    } catch (err) {
      // A storage failure ends this run; the next trigger starts a fresh one
      deps.onError?.(err);
      setActivity('idle');
    } finally {
      running = false;
    }
  }

  return {
    wake,
    async resume() {
      const userId = await deps.getUserId();
      if (userId) await deps.storage.setQueueState({ userId, consecutiveFailures: 0, pausedForErrors: false });
      await wake();
    },
    async signedIn() {
      signedOut = false;
      await wake();
    },
    activity: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      stopped = true;
      schedule(null);
    },
  };
}

// Web Locks stop two tabs processing the same queue. Without them, one run at a time in this tab.
export function createExclusiveRunner(
  locks?: { request: LockManager['request'] },
  name = 'qabrmap-survey-queue'
): (task: () => Promise<void>) => Promise<void> {
  let busy = false;
  return async (task) => {
    if (locks) {
      await locks.request(name, { ifAvailable: true }, async (lock) => {
        if (lock) await task();
      });
      return;
    }
    if (busy) return;
    busy = true;
    try {
      await task();
    } finally {
      busy = false;
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/survey_queue_worker.test.ts`
Expected: PASS (18 tests). If a timing test is flaky, fix the worker, not by adding sleeps to the test: every wake must finish its run before `wake()` resolves.

Run: `npx tsc --noEmit`
Expected: no errors. (`LockManager` comes from the DOM lib that `tsconfig.json` already includes.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/surveys/queueWorker.ts tests/survey_queue_worker.test.ts
git commit -m "feat(surveys): process queued captures with read caps, backoff and a circuit breaker

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Connecting the queue to the browser

**Files:**
- Create: `src/lib/surveys/capturePhoto.ts`
- Create: `src/lib/surveys/surveyQueue.ts`
- Create: `src/lib/surveys/useSurveyData.ts`
- Test: `tests/survey_capture_photo.test.ts`

**Interfaces:**
- Consumes: `createQueueWorker`, `createExclusiveRunner` (Task 5); `surveyStore` (Task 3); adapters (Task 4); rules (Task 2); `saveMappedGrave` (Plan 1); `uploadGravePhoto`, `deleteGravePhoto`, `dataUrlToBlob` (`src/lib/supabase/storage.ts`); `shrinkPhotoDataUrl` (`src/lib/capture/stonePhoto.ts`); `findCemeteryForLocation` (`src/lib/capture/cemeteryForLocation.ts`).
- Produces:
  - `capturePhoto.ts`: `THUMBNAIL_MAX_EDGE = 160`, `prepareCapturePhoto(dataUrl: string): Promise<{ photo: Blob; thumbnail: string }>` (browser only), `blobToDataUrl(blob: Blob): Promise<string>`
  - `surveyQueue.ts`:
    - `surveyQueue: QueueWorker` (the app's single worker)
    - `startSurveyQueue(): void` (idempotent; adds the wake listeners and wakes once)
    - `beginSurvey(input: StartSurveyInput): Promise<{ survey: Survey; persisted: boolean }>`
    - `endSurvey(surveyId: string): Promise<void>`
    - `queueSurveyCapture(survey: Survey, photoDataUrl: string, telemetry: DeviceTelemetry, cemeteries: Cemetery[]): Promise<SurveyCapture>` (throws when the phone can't store it)
    - `retrySurveyCapture(capture: SurveyCapture): Promise<void>`
    - `discardSurveyCapture(captureId: string): Promise<void>`
    - `markCaptureSaved(captureId: string, graveId: string, outcome: 'created' | 'added-photo', attempt: CaptureSaveAttempt): Promise<void>`
    - `rememberCaptureAttempt(captureId: string, attempt: CaptureSaveAttempt): Promise<void>`
    - `syncSurveysToCloud(): Promise<void>`
    - `listCloudSurveys(userId: string): Promise<CloudSurveySummary[]>`
    - `isStoragePersisted(): Promise<boolean>`
  - `useSurveyData.ts`: `useLiveValue<T>(query: () => Promise<T>, deps: unknown[], initial: T): T`, `useQueueActivity(): QueueActivity`

- [ ] **Step 1: Write the failing test**

Create `tests/survey_capture_photo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { blobToDataUrl } from '../src/lib/surveys/capturePhoto';
import { dataUrlToBlob } from '../src/lib/supabase/storage';

describe('Capture Photo Tests', () => {
  it('turns a stored photo back into the data URL the reader and uploader expect', async () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 251);
    const dataUrl = await blobToDataUrl(new Blob([bytes], { type: 'image/jpeg' }));
    expect(dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    const { blob, mimeType } = dataUrlToBlob(dataUrl);
    expect(mimeType).toBe('image/jpeg');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });

  it('assumes JPEG when a stored photo has no type', async () => {
    await expect(blobToDataUrl(new Blob([new Uint8Array([1])]))).resolves.toBe('data:image/jpeg;base64,AQ==');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/survey_capture_photo.test.ts`
Expected: FAIL, cannot resolve `../src/lib/surveys/capturePhoto`.

- [ ] **Step 3: Write the photo helpers**

Create `src/lib/surveys/capturePhoto.ts`:

```ts
import { dataUrlToBlob } from '../supabase/storage';
import { shrinkPhotoDataUrl } from '../capture/stonePhoto';

export const THUMBNAIL_MAX_EDGE = 160;

// Browser only. The full photo is stored at the size it will be read and uploaded at, plus a small thumbnail.
export async function prepareCapturePhoto(dataUrl: string): Promise<{ photo: Blob; thumbnail: string }> {
  const [full, thumbnail] = await Promise.all([shrinkPhotoDataUrl(dataUrl), shrinkPhotoDataUrl(dataUrl, THUMBNAIL_MAX_EDGE)]);
  return { photo: dataUrlToBlob(full).blob, thumbnail };
}

// Works without FileReader, so it can be tested outside a browser
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/survey_capture_photo.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the worker to the browser**

Create `src/lib/surveys/surveyQueue.ts`:

```ts
import type { CaptureSaveAttempt, Cemetery, DeviceTelemetry, Survey, SurveyCapture } from '@/types';
import { supabase, isSupabaseConfigured } from '../supabase/client';
import { deleteGravePhoto, uploadGravePhoto } from '../supabase/storage';
import { NOT_SET_UP_MESSAGE } from '../supabase/saveGraveErrors';
import { saveMappedGrave } from '../capture/saveMappedGrave';
import { findCemeteryForLocation } from '../capture/cemeteryForLocation';
import { StartSurveyInput, surveyStore } from './surveyStore';
import { createExclusiveRunner, createQueueWorker } from './queueWorker';
import { countCaptures, formFromReading, retryChanges, canRetry } from './queueRules';
import {
  CloudSurveySummary,
  ReadResult,
  SaveResult,
  cloudSyncDelayMs,
  mapCloudSurveyRow,
  readResultFromResponse,
  saveResultFromError,
  saveResultFromOutcome,
  surveySessionRow,
} from './queueAdapters';
import { blobToDataUrl, prepareCapturePhoto } from './capturePhoto';

// The app's survey queue: the worker from queueWorker.ts with the real network, storage and browser events

const PHOTO_MISSING = 'The photo is no longer stored on this phone.';

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine;

// Read from the stored session, so it works without signal
async function currentSession() {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

async function readPhoto(capture: SurveyCapture): Promise<ReadResult> {
  const session = await currentSession();
  if (!session?.access_token) return { kind: 'signed-out' };
  if (!capture.photo) return { kind: 'error', message: PHOTO_MISSING };

  let response: Response;
  try {
    response = await fetch('/api/graves/read-stone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ image: await blobToDataUrl(capture.photo) }),
    });
  } catch {
    return readResultFromResponse(0, null);
  }
  return readResultFromResponse(response.status, await response.json().catch(() => null));
}

async function saveCapture(capture: SurveyCapture, survey: Survey): Promise<SaveResult> {
  if (!isSupabaseConfigured || !supabase) return { kind: 'error', message: NOT_SET_UP_MESSAGE };
  if (!capture.photo || !capture.reading) return { kind: 'error', message: PHOTO_MISSING };
  try {
    const result = await saveMappedGrave(
      {
        form: formFromReading(capture.reading, survey.cemeteryId),
        cemeteryName: survey.cemeteryName,
        photoDataUrl: await blobToDataUrl(capture.photo),
        telemetry: capture.telemetry,
        attempt: capture.attempt,
        matchMode: 'auto',
      },
      { client: supabase, isOnline, uploadPhoto: uploadGravePhoto, deletePhoto: deleteGravePhoto }
    );
    return saveResultFromOutcome(result);
  } catch (err) {
    return saveResultFromError(err);
  }
}

let cloudSyncTimer: ReturnType<typeof setTimeout> | null = null;

export const surveyQueue = createQueueWorker({
  storage: surveyStore,
  readPhoto,
  saveCapture,
  getUserId: async () => (await currentSession())?.user.id ?? null,
  isOnline,
  now: () => Date.now(),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  runExclusive: createExclusiveRunner(typeof navigator !== 'undefined' ? navigator.locks : undefined),
  onChange: () => {
    // Counts change with every step, so the cloud copy is refreshed shortly after the steps settle
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(() => {
      cloudSyncTimer = null;
      void syncSurveysToCloud();
    }, 2000);
  },
  onError: (err) => console.warn('Survey queue stopped:', err),
});

let started = false;

// Called once the app has mounted. Each trigger only wakes the worker; the worker decides whether there is work.
export function startSurveyQueue(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => void surveyQueue.wake());
  window.addEventListener('offline', () => void surveyQueue.wake());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void surveyQueue.wake();
  });
  navigator.serviceWorker?.addEventListener('message', (event) => {
    if (event.data?.type === 'TRIGGER_BACKGROUND_SYNC') void surveyQueue.wake();
  });
  void surveyQueue.wake();
  void syncSurveysToCloud();
}

export async function isStoragePersisted(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}

// Asks the browser not to clear stored photos when space runs low
export async function beginSurvey(input: StartSurveyInput): Promise<{ survey: Survey; persisted: boolean }> {
  const survey = await surveyStore.startSurvey(input);
  let persisted = false;
  try {
    persisted = (await navigator.storage?.persist?.()) ?? false;
  } catch {
    persisted = false;
  }
  void syncSurveysToCloud();
  return { survey, persisted };
}

export async function endSurvey(surveyId: string): Promise<void> {
  await surveyStore.finishSurvey(surveyId);
  void syncSurveysToCloud();
}

export async function queueSurveyCapture(
  survey: Survey,
  photoDataUrl: string,
  telemetry: DeviceTelemetry,
  cemeteries: Cemetery[]
): Promise<SurveyCapture> {
  const { photo, thumbnail } = await prepareCapturePhoto(photoDataUrl);
  const insideBoundary = findCemeteryForLocation(cemeteries, telemetry.latitude, telemetry.longitude)?.id === survey.cemeteryId;
  const capture = await surveyStore.addCapture({ survey, photo, thumbnail, telemetry, insideBoundary });
  void surveyQueue.wake();
  return capture;
}

export async function retrySurveyCapture(capture: SurveyCapture): Promise<void> {
  if (!canRetry(capture)) return;
  await surveyStore.updateCapture(capture.id, retryChanges(capture));
  void surveyQueue.wake();
}

export async function discardSurveyCapture(captureId: string): Promise<void> {
  await surveyStore.deleteCapture(captureId);
}

// A capture saved from the Confirm screen during review
export async function markCaptureSaved(
  captureId: string,
  graveId: string,
  outcome: 'created' | 'added-photo',
  attempt: CaptureSaveAttempt
): Promise<void> {
  await surveyStore.updateCapture(captureId, {
    status: 'saved',
    graveId,
    outcome,
    attempt,
    photo: undefined,
    reviewReason: undefined,
    matchCandidate: undefined,
    lastError: undefined,
  });
  void syncSurveysToCloud();
}

// Keeps an uploaded photo on the capture after a failed review save, so the next try reuses it
export async function rememberCaptureAttempt(captureId: string, attempt: CaptureSaveAttempt): Promise<void> {
  await surveyStore.updateCapture(captureId, { attempt });
}

let pendingCloudSync: ReturnType<typeof setTimeout> | null = null;

// Writes each of the surveyor's surveys to survey_sessions when it is new, finished, or its counts changed
export async function syncSurveysToCloud(): Promise<void> {
  if (!isSupabaseConfigured || !supabase || !isOnline()) return;
  const session = await currentSession();
  if (!session) return;

  let soonest: number | null = null;
  for (const survey of await surveyStore.listSurveys(session.user.id)) {
    const counts = countCaptures(await surveyStore.listCaptures(survey.id));
    const delay = cloudSyncDelayMs(survey, counts, Date.now());
    if (delay === null) continue;
    if (delay > 0) {
      soonest = soonest === null ? delay : Math.min(soonest, delay);
      continue;
    }
    const { error } = await supabase.from('survey_sessions').upsert(surveySessionRow(survey, counts));
    if (!error) await surveyStore.updateSurvey(survey.id, { cloudSyncedAt: new Date().toISOString(), cloudCounts: counts });
  }

  if (soonest !== null && !pendingCloudSync) {
    pendingCloudSync = setTimeout(() => {
      pendingCloudSync = null;
      void syncSurveysToCloud();
    }, soonest);
  }
}

// Surveys recorded in the cloud, including those made on another phone
export async function listCloudSurveys(userId: string): Promise<CloudSurveySummary[]> {
  if (!isSupabaseConfigured || !supabase || !isOnline()) return [];
  const { data, error } = await supabase
    .from('survey_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(50);
  if (error || !Array.isArray(data)) return [];
  return data.map(mapCloudSurveyRow).filter((row): row is CloudSurveySummary => row !== null);
}
```

Create `src/lib/surveys/useSurveyData.ts`:

```ts
'use client';

import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import type { QueueActivity } from './queueRules';
import { surveyQueue } from './surveyQueue';

// Re-runs an IndexedDB query whenever the tables it read change, so counts and lists update as the queue works
export function useLiveValue<T>(query: () => Promise<T>, deps: unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: (next) => setValue(() => next),
      error: (err) => console.warn('Survey data could not be read:', err),
    });
    return () => subscription.unsubscribe();
    // The caller lists what the query depends on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

export function useQueueActivity(): QueueActivity {
  const [activity, setActivity] = useState<QueueActivity>(() => surveyQueue.activity());
  useEffect(() => {
    setActivity(surveyQueue.activity());
    return surveyQueue.subscribe(setActivity);
  }, []);
  return activity;
}
```

- [ ] **Step 6: Type check and tests**

Run: `npx tsc --noEmit`
Expected: no errors. If `navigator.locks` is typed as always present, keep the `typeof navigator !== 'undefined'` guard for server rendering and pass `navigator.locks` as is. If `unsubscribe` from `subscribe` returns `boolean` and React complains about the effect cleanup type, wrap it: `return () => { unsubscribe(); };`.

Run: `npx vitest run`
Expected: all files pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/surveys/capturePhoto.ts src/lib/surveys/surveyQueue.ts src/lib/surveys/useSurveyData.ts tests/survey_capture_photo.test.ts
git commit -m "feat(surveys): run the capture queue in the browser and sync surveys to the cloud

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Survey mode on the camera

**Files:**
- Modify: `src/components/screens/CaptureScreen.tsx` (imports, props, shutter, header, bottom controls)

**Interfaces:**
- Consumes: `findCemeteryForLocation` (`src/lib/capture/cemeteryForLocation.ts`), `useWakeLock` (`src/lib/device/useWakeLock.ts`), `Cemetery` type.
- Produces: `CaptureScreen` props

```ts
interface CaptureScreenProps {
  mode?: 'single' | 'survey';
  onCaptureComplete: (imageDataUrl: string, telemetry: DeviceTelemetry) => void | Promise<void>;
  onBack: () => void;
  surveyCemetery?: Cemetery;
  cemeteries?: Cemetery[];
  queuedCount?: number;
}
```

In `survey` mode the shutter awaits `onCaptureComplete` (Task 9 passes `queueSurveyCapture`), stays on the camera, shows "Queued ✓" for 1.2 seconds, shows "Couldn't store this photo on the phone" if the promise rejects, keeps the screen awake, warns when the GPS fix is outside the survey cemetery, and the back button reads Done. `single` mode (the default) behaves exactly as before.

There is no React test setup, so this task is checked with the type check, the build, and the browser check in Task 10.

- [ ] **Step 1: Update imports and props**

In `src/components/screens/CaptureScreen.tsx`, replace:

```tsx
import { ArrowLeft, Zap, ZapOff, Grid, MapPin, Compass, CameraOff, Loader2 } from 'lucide-react';
import { DeviceTelemetry } from '@/types';
```

with:

```tsx
import { AlertTriangle, ArrowLeft, Check, Zap, ZapOff, Grid, MapPin, Compass, CameraOff, Loader2 } from 'lucide-react';
import { Cemetery, DeviceTelemetry } from '@/types';
import { findCemeteryForLocation } from '@/lib/capture/cemeteryForLocation';
import { useWakeLock } from '@/lib/device/useWakeLock';
```

Replace:

```tsx
interface CaptureScreenProps {
  onCaptureComplete: (imageDataUrl: string, telemetry: DeviceTelemetry) => void;
  onBack: () => void;
}
```

with:

```tsx
interface CaptureScreenProps {
  // single: one grave, read and confirmed straight away. survey: each photo is queued and the camera stays open.
  mode?: 'single' | 'survey';
  onCaptureComplete: (imageDataUrl: string, telemetry: DeviceTelemetry) => void | Promise<void>;
  onBack: () => void;
  // Survey mode only
  surveyCemetery?: Cemetery;
  cemeteries?: Cemetery[];
  queuedCount?: number;
}

type ShotState = 'idle' | 'storing' | 'queued' | 'failed';
```

Replace:

```tsx
export const CaptureScreen: React.FC<CaptureScreenProps> = ({ onCaptureComplete, onBack }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
```

with:

```tsx
export const CaptureScreen: React.FC<CaptureScreenProps> = ({
  mode = 'single',
  onCaptureComplete,
  onBack,
  surveyCemetery,
  cemeteries = [],
  queuedCount = 0,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isSurvey = mode === 'survey';
  const [shot, setShot] = useState<ShotState>('idle');

  // A survey walks row after row, so the screen must not lock between photos
  useWakeLock(isSurvey);
```

- [ ] **Step 2: Queue in survey mode**

Replace the body of `handleTriggerShutter`, from `const handleTriggerShutter = () => {` to its closing `};`, with:

```tsx
  const handleTriggerShutter = async () => {
    const video = videoRef.current;
    if (!readiness.ready || !video || !fix || heading === null || shot === 'storing') return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 960;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const photo = canvas.toDataURL('image/jpeg', 0.85);
    const telemetry: DeviceTelemetry = {
      latitude: fix.lat,
      longitude: fix.lng,
      gpsAccuracy: Number(fix.accuracy.toFixed(1)),
      headingDegrees: heading,
      timestamp: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      imageDimensions: { width: canvas.width, height: canvas.height },
    };

    if (!isSurvey) {
      void onCaptureComplete(photo, telemetry);
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

  // "Queued" and the storage error clear themselves so the next photo starts clean
  useEffect(() => {
    if (shot !== 'queued' && shot !== 'failed') return;
    const timer = window.setTimeout(() => setShot('idle'), shot === 'queued' ? 1200 : 4000);
    return () => window.clearTimeout(timer);
  }, [shot]);

  const outsideSurveyCemetery =
    isSurvey && Boolean(fix) && Boolean(surveyCemetery) &&
    findCemeteryForLocation(cemeteries, fix!.lat, fix!.lng)?.id !== surveyCemetery!.id;
```

(The `useEffect` import already exists at the top of the file.)

- [ ] **Step 3: Header, warnings and controls**

Replace the back button and title inside the top header:

```tsx
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/30 transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>

        <h1 className="text-sm font-bold tracking-tight text-white drop-shadow">Capture Grave</h1>
```

with:

```tsx
        {isSurvey ? (
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

        <div className="min-w-0 px-2 text-center">
          <h1 className="text-sm font-bold tracking-tight text-white drop-shadow">{isSurvey ? 'Survey' : 'Capture Grave'}</h1>
          {isSurvey && surveyCemetery && <p className="text-[11px] text-white/70 truncate">{surveyCemetery.name}</p>}
        </div>
```

Replace the guidance pill:

```tsx
        <div className="mt-4 bg-black/55 backdrop-blur-md text-white text-xs font-medium py-1.5 px-4 rounded-full border border-white/15">
          {readiness.message}
        </div>
```

with:

```tsx
        <div
          role="status"
          className={`mt-4 backdrop-blur-md text-xs font-medium py-1.5 px-4 rounded-full border flex items-center ${
            shot === 'queued'
              ? 'bg-emerald-600/90 border-emerald-300/40 text-white'
              : shot === 'failed'
                ? 'bg-rose-600/90 border-rose-300/40 text-white'
                : 'bg-black/55 border-white/15 text-white'
          }`}
        >
          {shot === 'queued' ? (
            <>
              <Check className="w-3.5 h-3.5 mr-1.5" /> Queued
            </>
          ) : shot === 'failed' ? (
            "Couldn't store this photo on the phone"
          ) : shot === 'storing' ? (
            'Storing…'
          ) : (
            readiness.message
          )}
        </div>

        {outsideSurveyCemetery && surveyCemetery && (
          <div className="mt-2 max-w-[280px] bg-amber-500/90 text-slate-900 text-[11px] font-semibold py-1.5 px-3 rounded-2xl flex items-start">
            <AlertTriangle className="w-3.5 h-3.5 mr-1.5 mt-px shrink-0" />
            <span>Outside {surveyCemetery.name}. Photos taken here will wait for review.</span>
          </div>
        )}
```

Replace the bottom controls block:

```tsx
        {/* Keeps the shutter centred */}
        <div className="w-12 h-12 shrink-0" aria-hidden="true" />

        <button
          onClick={handleTriggerShutter}
          disabled={!readiness.ready}
```

with:

```tsx
        {/* Survey mode shows how many photos are stored; otherwise this keeps the shutter centred */}
        <div className="w-12 h-12 shrink-0 flex flex-col items-center justify-center text-white" aria-live="polite">
          {isSurvey && (
            <>
              <span className="text-base font-bold leading-none">{queuedCount}</span>
              <span className="text-[10px] text-white/70">taken</span>
            </>
          )}
        </div>

        <button
          onClick={handleTriggerShutter}
          disabled={!readiness.ready || shot === 'storing'}
```

- [ ] **Step 4: Type check and build**

Run: `npx tsc --noEmit`
Expected: no errors. `page.tsx` still passes only `onCaptureComplete` and `onBack`, which is valid because the new props are optional.

Run: `npx vitest run`
Expected: all files pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/screens/CaptureScreen.tsx
git commit -m "feat(surveys): rapid survey mode on the capture camera

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: My Surveys screen

**Files:**
- Create: `src/components/surveys/StartSurveyCard.tsx`
- Create: `src/components/surveys/SurveySummaryCard.tsx`
- Create: `src/components/surveys/SurveyCaptureList.tsx`
- Modify: `src/components/screens/SurveySessionScreen.tsx` (whole file)

**Interfaces:**
- Consumes: `surveyStore` (Task 3); `beginSurvey`, `endSurvey`, `retrySurveyCapture`, `discardSurveyCapture`, `isStoragePersisted`, `listCloudSurveys`, `surveyQueue` (Task 6); `useLiveValue`, `useQueueActivity` (Task 6); `countCaptures`, `surveyStatusLine`, `matchesFilter`, `captureStatusLabel`, `canRetry`, `CaptureFilter` (Task 2); `CloudSurveySummary` (Task 4); `findCemeteryForLocation`.
- Produces: `SurveySessionScreen` props (Task 9 renders it):

```ts
export type OpenGraveResult = 'opened' | 'removed' | 'offline';
interface SurveySessionScreenProps {
  userId: string;
  cemeteries: Cemetery[];
  onContinueSurvey: (survey: Survey) => void;
  onReviewCapture: (capture: SurveyCapture) => void;
  onOpenGrave: (graveId: string) => Promise<OpenGraveResult>;
  onBack: () => void;
}
```

No React test setup exists; the logic these components show is tested in Tasks 2 to 6. Check with the type check and the browser check in Task 10.

- [ ] **Step 1: Start card**

Create `src/components/surveys/StartSurveyCard.tsx`:

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import { ClipboardList, Loader2, MapPin } from 'lucide-react';
import { Cemetery } from '@/types';
import { findCemeteryForLocation } from '@/lib/capture/cemeteryForLocation';

interface StartSurveyCardProps {
  cemeteries: Cemetery[];
  onStart: (cemetery: Cemetery, sectionNote: string) => Promise<void>;
}

const labelClass = 'block text-[11px] font-semibold text-slate-500 mb-0.5';
const inputClass =
  'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-forest';

export const StartSurveyCard: React.FC<StartSurveyCardProps> = ({ cemeteries, onStart }) => {
  const [cemeteryId, setCemeteryId] = useState('');
  const [sectionNote, setSectionNote] = useState('');
  const [detected, setDetected] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preselects the cemetery the surveyor is standing in, without replacing a choice they already made
  useEffect(() => {
    if (!navigator.geolocation || cemeteries.length === 0) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const here = findCemeteryForLocation(cemeteries, pos.coords.latitude, pos.coords.longitude);
        if (!here) return;
        setCemeteryId((current) => current || here.id);
        setDetected(true);
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 }
    );
    return () => {
      cancelled = true;
    };
  }, [cemeteries]);

  const cemetery = cemeteries.find((c) => c.id === cemeteryId);

  const start = async () => {
    if (!cemetery || starting) return;
    setStarting(true);
    setError(null);
    try {
      await onStart(cemetery, sectionNote);
    } catch {
      setError("The survey couldn't be started on this phone. Check that the browser allows storage.");
      setStarting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm space-y-3">
      <div className="flex items-center space-x-2">
        <div className="w-9 h-9 rounded-xl bg-emerald-50 text-brand-forest flex items-center justify-center">
          <ClipboardList className="w-4 h-4" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-900">Start a survey</h2>
          <p className="text-[11px] text-slate-500">Photograph graves one after another. They are read and saved as signal allows.</p>
        </div>
      </div>

      <div>
        <label htmlFor="surveyCemetery" className={labelClass}>
          Cemetery
        </label>
        <select id="surveyCemetery" value={cemeteryId} onChange={(e) => setCemeteryId(e.target.value)} className={inputClass}>
          <option value="">Choose a cemetery</option>
          {cemeteries.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {detected && cemetery && (
          <p className="mt-1 flex items-center text-[11px] text-emerald-700">
            <MapPin className="w-3 h-3 mr-1" />
            You&apos;re at {cemetery.name}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="surveySection" className={labelClass}>
          Section or row (optional)
        </label>
        <input
          id="surveySection"
          type="text"
          value={sectionNote}
          onChange={(e) => setSectionNote(e.target.value)}
          placeholder="For example Row 12"
          className={inputClass}
        />
      </div>

      {error && (
        <p role="alert" className="text-[11px] font-semibold text-rose-700">
          {error}
        </p>
      )}

      <button
        onClick={start}
        disabled={!cemetery || starting}
        className="w-full py-3 px-4 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold shadow-md transition-all active:scale-[0.99] flex items-center justify-center space-x-2 disabled:opacity-50"
      >
        {starting && <Loader2 className="w-4 h-4 animate-spin" />}
        <span>{cemetery ? 'Start survey' : 'Choose a cemetery'}</span>
      </button>
    </div>
  );
};
```

- [ ] **Step 2: Summary card**

Create `src/components/surveys/SurveySummaryCard.tsx`:

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Camera, RotateCw } from 'lucide-react';
import { Survey, SurveyCounts } from '@/types';

interface SurveySummaryCardProps {
  survey: Survey;
  counts: SurveyCounts;
  statusLine: string | null;
  paused: boolean;
  storageWarning: boolean;
  onResume: () => void;
  // Only for the active survey
  onContinue?: () => void;
  onFinish?: () => void;
}

const formatStarted = (iso: string) =>
  new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const SurveySummaryCard: React.FC<SurveySummaryCardProps> = ({
  survey,
  counts,
  statusLine,
  paused,
  storageWarning,
  onResume,
  onContinue,
  onFinish,
}) => {
  // Finishing takes two taps, so a stray tap in the field doesn't end the survey
  const [confirmFinish, setConfirmFinish] = useState(false);
  useEffect(() => {
    if (!confirmFinish) return;
    const timer = window.setTimeout(() => setConfirmFinish(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmFinish]);

  const counters = [
    { label: 'Captured', value: counts.captured, className: 'text-slate-900' },
    { label: 'Saved', value: counts.saved, className: 'text-emerald-700' },
    { label: 'Pending', value: counts.pending, className: 'text-amber-600' },
    { label: 'Review', value: counts.review, className: 'text-rose-600' },
  ];

  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900 min-w-0 truncate">{survey.cemeteryName}</h2>
        <span
          className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full shrink-0 ${
            survey.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {survey.status === 'ACTIVE' ? 'Active' : 'Finished'}
        </span>
      </div>
      <p className="text-xs text-slate-500 font-medium mt-1">
        {survey.sectionNote ? `${survey.sectionNote} • ` : ''}Started {formatStarted(survey.startedAt)}
      </p>

      <div className="grid grid-cols-4 gap-2 mt-4 pt-3 border-t border-slate-100 text-center">
        {counters.map((counter) => (
          <div key={counter.label} className="bg-slate-50 rounded-xl p-2">
            <div className={`text-lg font-extrabold ${counter.className}`}>{counter.value}</div>
            <div className="text-[10px] text-slate-500 font-medium">{counter.label}</div>
          </div>
        ))}
      </div>

      {statusLine && (
        <div className="mt-3 flex items-center justify-between gap-2 text-xs font-medium text-slate-600" role="status">
          <span>{statusLine}</span>
          {paused && (
            <button onClick={onResume} className="shrink-0 flex items-center text-xs font-semibold text-brand-forest">
              <RotateCw className="w-3.5 h-3.5 mr-1" />
              Resume
            </button>
          )}
        </div>
      )}

      {storageWarning && survey.status === 'ACTIVE' && (
        <p className="mt-3 flex items-start text-[11px] text-amber-700">
          <AlertTriangle className="w-3.5 h-3.5 mr-1 shrink-0" />
          This phone may clear stored photos if it runs low on space. Stay online when you can.
        </p>
      )}

      {(onContinue || onFinish) && (
        <div className="mt-4 space-y-2">
          {onContinue && (
            <button
              onClick={onContinue}
              className="w-full bg-brand-forest hover:bg-brand-dark text-white rounded-xl py-3.5 px-4 font-semibold text-sm flex items-center justify-center space-x-2 shadow-md transition-all active:scale-[0.99]"
            >
              <Camera className="w-5 h-5 stroke-[2.2]" />
              <span>Continue surveying</span>
            </button>
          )}
          {onFinish && (
            <button
              onClick={() => (confirmFinish ? onFinish() : setConfirmFinish(true))}
              className="w-full py-2.5 px-4 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {confirmFinish ? 'Tap again to finish the survey' : 'Finish survey'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 3: Captures list**

Create `src/components/surveys/SurveyCaptureList.tsx`:

```tsx
'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { ChevronRight } from 'lucide-react';
import { SurveyCapture } from '@/types';
import { CaptureFilter, canRetry, captureStatusLabel, matchesFilter } from '@/lib/surveys/queueRules';

export type OpenGraveResult = 'opened' | 'removed' | 'offline';

interface SurveyCaptureListProps {
  captures: SurveyCapture[];
  onReview: (capture: SurveyCapture) => void;
  onOpenGrave: (graveId: string) => Promise<OpenGraveResult>;
  onRetry: (capture: SurveyCapture) => void;
  onDiscard: (capture: SurveyCapture) => void;
}

const FILTERS: Array<{ id: CaptureFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'review', label: 'Needs review' },
  { id: 'pending', label: 'Pending' },
  { id: 'saved', label: 'Saved' },
];

const STATUS_COLOURS: Record<SurveyCapture['status'], string> = {
  queued: 'text-slate-500',
  reading: 'text-blue-600',
  saving: 'text-blue-600',
  review: 'text-amber-700',
  saved: 'text-emerald-700',
  failed: 'text-rose-700',
};

const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const SurveyCaptureList: React.FC<SurveyCaptureListProps> = ({ captures, onReview, onOpenGrave, onRetry, onDiscard }) => {
  const [filter, setFilter] = useState<CaptureFilter>('all');
  // Saved graves that were deleted since, or couldn't be opened without signal
  const [notices, setNotices] = useState<Record<string, string>>({});

  const shown = captures.filter((capture) => matchesFilter(capture, filter));

  const open = async (capture: SurveyCapture) => {
    if (capture.status === 'review' || capture.status === 'failed') {
      onReview(capture);
      return;
    }
    if (capture.status !== 'saved' || !capture.graveId) return;
    const result = await onOpenGrave(capture.graveId);
    if (result === 'opened') return;
    setNotices((prev) => ({ ...prev, [capture.id]: result === 'removed' ? 'Grave removed' : 'Connect to open this grave' }));
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-center gap-2 mt-1 mb-3">
        {FILTERS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
              filter === tab.id ? 'bg-brand-forest text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-center text-xs text-slate-500 py-6">
          {captures.length === 0 ? 'No photos yet. Tap Continue surveying to start.' : 'Nothing here right now.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((capture) => {
            const tappable = capture.status === 'review' || capture.status === 'failed' || capture.status === 'saved';
            const name = capture.reading?.fullName || captureStatusLabel(capture);
            return (
              <li key={capture.id} className="bg-white rounded-xl border border-slate-200/80 shadow-sm">
                <button
                  onClick={() => open(capture)}
                  disabled={!tappable}
                  className="w-full p-3 flex items-center justify-between text-left disabled:cursor-default"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="w-11 h-11 rounded-lg overflow-hidden relative bg-slate-100 shrink-0 border border-slate-200">
                      <Image src={capture.thumbnail} alt="" fill className="object-cover" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 truncate">{name}</div>
                      <div className={`text-[10px] font-semibold mt-0.5 ${STATUS_COLOURS[capture.status]}`}>
                        {notices[capture.id] ?? captureStatusLabel(capture)}
                      </div>
                      {capture.status === 'failed' && capture.lastError && (
                        <div className="text-[10px] text-slate-500 truncate">{capture.lastError}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center shrink-0 pl-2">
                    <span className="text-xs text-slate-400 font-mono font-medium">{formatTime(capture.createdAt)}</span>
                    {tappable && <ChevronRight className="w-4 h-4 text-slate-400 ml-1" />}
                  </div>
                </button>
                {capture.status === 'failed' && (
                  <div className="flex border-t border-slate-100 divide-x divide-slate-100">
                    {canRetry(capture) && (
                      <button onClick={() => onRetry(capture)} className="flex-1 py-2 text-xs font-semibold text-brand-forest">
                        Retry
                      </button>
                    )}
                    <button onClick={() => onDiscard(capture)} className="flex-1 py-2 text-xs font-semibold text-rose-700">
                      Discard
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
```

- [ ] **Step 4: The screen**

Replace the whole of `src/components/screens/SurveySessionScreen.tsx` with:

```tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Cloud, Loader2 } from 'lucide-react';
import { Cemetery, Survey, SurveyCapture } from '@/types';
import { surveyStore } from '@/lib/surveys/surveyStore';
import {
  beginSurvey,
  discardSurveyCapture,
  endSurvey,
  isStoragePersisted,
  listCloudSurveys,
  retrySurveyCapture,
  surveyQueue,
} from '@/lib/surveys/surveyQueue';
import { useLiveValue, useQueueActivity } from '@/lib/surveys/useSurveyData';
import { countCaptures, surveyStatusLine } from '@/lib/surveys/queueRules';
import { CloudSurveySummary } from '@/lib/surveys/queueAdapters';
import { StartSurveyCard } from '@/components/surveys/StartSurveyCard';
import { SurveySummaryCard } from '@/components/surveys/SurveySummaryCard';
import { OpenGraveResult, SurveyCaptureList } from '@/components/surveys/SurveyCaptureList';

interface SurveySessionScreenProps {
  userId: string;
  cemeteries: Cemetery[];
  onContinueSurvey: (survey: Survey) => void;
  onReviewCapture: (capture: SurveyCapture) => void;
  onOpenGrave: (graveId: string) => Promise<OpenGraveResult>;
  onBack: () => void;
}

const formatDay = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

export const SurveySessionScreen: React.FC<SurveySessionScreenProps> = ({
  userId,
  cemeteries,
  onContinueSurvey,
  onReviewCapture,
  onOpenGrave,
  onBack,
}) => {
  // null while loading, undefined when there is no active survey
  const active = useLiveValue<Survey | undefined | null>(() => surveyStore.activeSurvey(userId), [userId], null);
  const surveys = useLiveValue<Survey[]>(() => surveyStore.listSurveys(userId), [userId], []);
  const allCaptures = useLiveValue<SurveyCapture[]>(() => surveyStore.userCaptures(userId), [userId], []);
  const activity = useQueueActivity();

  const [viewingId, setViewingId] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const [cloudSurveys, setCloudSurveys] = useState<CloudSurveySummary[]>([]);

  const viewing = surveys.find((survey) => survey.id === viewingId) ?? null;
  const shown = viewing ?? active ?? null;
  const captures = useMemo(() => allCaptures.filter((capture) => capture.surveyId === shown?.id), [allCaptures, shown?.id]);
  const counts = countCaptures(captures);

  const activeId = active?.id;
  useEffect(() => {
    if (!activeId) return;
    isStoragePersisted().then((persisted) => setStorageWarning(!persisted));
  }, [activeId]);

  // Surveys made on another phone appear with their counts only
  useEffect(() => {
    let cancelled = false;
    listCloudSurveys(userId).then((rows) => {
      if (!cancelled) setCloudSurveys(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleStart = async (cemetery: Cemetery, sectionNote: string) => {
    const { persisted } = await beginSurvey({ userId, cemeteryId: cemetery.id, cemeteryName: cemetery.name, sectionNote });
    setStorageWarning(!persisted);
  };

  const phoneSurveyIds = new Set(surveys.map((survey) => survey.id));
  const pastSurveys = surveys.filter((survey) => survey.status === 'COMPLETED');
  const otherPhoneSurveys = cloudSurveys.filter((survey) => !phoneSurveyIds.has(survey.id));

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-y-auto">
      <div className="px-4 py-3 bg-white border-b border-slate-200/80 flex items-center shrink-0">
        <button
          onClick={() => (viewing ? setViewingId(null) : onBack())}
          className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-colors mr-2"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">{viewing ? 'Past Survey' : 'My Surveys'}</h1>
      </div>

      <div className="p-4 space-y-4 flex-1">
        {active === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
          </div>
        ) : shown ? (
          <>
            <SurveySummaryCard
              survey={shown}
              counts={counts}
              statusLine={surveyStatusLine(activity, counts)}
              paused={activity === 'paused'}
              storageWarning={storageWarning}
              onResume={() => void surveyQueue.resume()}
              onContinue={shown.status === 'ACTIVE' ? () => onContinueSurvey(shown) : undefined}
              onFinish={shown.status === 'ACTIVE' ? () => void endSurvey(shown.id) : undefined}
            />
            <SurveyCaptureList
              captures={captures}
              onReview={onReviewCapture}
              onOpenGrave={onOpenGrave}
              onRetry={(capture) => void retrySurveyCapture(capture)}
              onDiscard={(capture) => void discardSurveyCapture(capture.id)}
            />
          </>
        ) : (
          <>
            <StartSurveyCard cemeteries={cemeteries} onStart={handleStart} />

            {(pastSurveys.length > 0 || otherPhoneSurveys.length > 0) && (
              <div>
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2.5 px-1">Past surveys</h3>
                <ul className="space-y-2">
                  {pastSurveys.map((survey) => {
                    const surveyCounts = countCaptures(allCaptures.filter((capture) => capture.surveyId === survey.id));
                    return (
                      <li key={survey.id}>
                        <button
                          onClick={() => setViewingId(survey.id)}
                          className="w-full bg-white rounded-xl p-3 border border-slate-200/80 shadow-sm flex items-center justify-between text-left"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-900 truncate">{survey.cemeteryName}</div>
                            <div className="text-[11px] text-slate-500">
                              {formatDay(survey.startedAt)}
                              {survey.sectionNote ? ` • ${survey.sectionNote}` : ''} • {surveyCounts.saved} saved
                              {surveyCounts.review ? `, ${surveyCounts.review} to review` : ''}
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                        </button>
                      </li>
                    );
                  })}
                  {otherPhoneSurveys.map((survey) => (
                    <li key={survey.id} className="bg-white rounded-xl p-3 border border-slate-200/80 shadow-sm flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 truncate">{survey.cemeteryName}</div>
                        <div className="text-[11px] text-slate-500">
                          {formatDay(survey.startedAt)} • {survey.counts.saved} saved of {survey.counts.captured}
                        </div>
                      </div>
                      <span className="flex items-center text-[10px] text-slate-400 shrink-0 pl-2">
                        <Cloud className="w-3 h-3 mr-1" />
                        Another phone
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: one group of errors, all in `src/app/page.tsx`, where `SurveySessionScreen` is still given the old `session`/`onCaptureNextGrave` props. Task 9 fixes them. There must be no errors in the files this task created.

- [ ] **Step 6: Commit**

```bash
git add src/components/surveys/StartSurveyCard.tsx src/components/surveys/SurveySummaryCard.tsx src/components/surveys/SurveyCaptureList.tsx src/components/screens/SurveySessionScreen.tsx
git commit -m "feat(surveys): My Surveys screen with live counts, captures and past surveys

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Wiring surveys into the app and removing the mock survey

**Files:**
- Modify: `src/components/screens/ConfirmDetailsScreen.tsx` (review props)
- Modify: `src/app/page.tsx` (imports, state, handlers, three screen renders)
- Modify: `src/components/screens/ProfileScreen.tsx` (counts)
- Modify: `src/components/screens/OfflineStatusScreen.tsx` (real pending count, no fake sync time)
- Modify: `src/lib/data/store.ts`, `src/lib/data/mockData.ts`, `src/types/index.ts` (remove the mock survey and `SurveySession`)

**Interfaces:**
- Consumes: everything from Tasks 1 to 8; `ConfirmDetailsScreen` and `dataStore` from Plan 1.
- Produces: `ConfirmDetailsScreen` gains optional props `title?: string`, `defaultCemeteryId?: string`, `initialAttempt?: SaveAttempt`, `initialCandidate?: MatchCandidate`, `onAttemptChange?: (attempt: SaveAttempt) => void`, `onDiscard?: () => void`. Existing Capture usage is unchanged.

- [ ] **Step 1: Review props on the Confirm screen**

In `src/components/screens/ConfirmDetailsScreen.tsx` (the Plan 1 version):

Replace `import { createSaveAttempt, MatchMode } from '@/lib/capture/saveMappedGrave';` with:

```tsx
import { createSaveAttempt, MatchMode, SaveAttempt } from '@/lib/capture/saveMappedGrave';
```

In `ConfirmDetailsScreenProps`, after `onBack: () => void;` add:

```tsx
  // Survey review only: the capture's own save ids, cemetery and duplicate, plus a way to throw the photo away
  title?: string;
  defaultCemeteryId?: string;
  initialAttempt?: SaveAttempt;
  initialCandidate?: MatchCandidate;
  onAttemptChange?: (attempt: SaveAttempt) => void;
  onDiscard?: () => void;
```

In the component's destructured props, after `onBack,` add:

```tsx
  title,
  defaultCemeteryId,
  initialAttempt,
  initialCandidate,
  onAttemptChange,
  onDiscard,
```

Replace `    cemeteryId: detectedCemetery?.id || '',` with:

```tsx
    cemeteryId: defaultCemeteryId || detectedCemetery?.id || '',
```

Replace:

```tsx
  const [attempt] = useState(createSaveAttempt);
```

with:

```tsx
  const [attempt] = useState<SaveAttempt>(() => (initialAttempt ? { ...initialAttempt } : createSaveAttempt()));
```

Replace `  const [candidate, setCandidate] = useState<MatchCandidate | null>(null);` with:

```tsx
  const [candidate, setCandidate] = useState<MatchCandidate | null>(initialCandidate ?? null);
```

Inside `save`, replace:

```tsx
        addToGraveId,
      });
      if (result.outcome === 'match-found') {
```

with:

```tsx
        addToGraveId,
      });
      onAttemptChange?.(attempt);
      if (result.outcome === 'match-found') {
```

and replace:

```tsx
    } catch (err) {
      setIsSaving(false);
      setError(err instanceof SaveGraveError ? err.message : UNKNOWN_SAVE_MESSAGE);
```

with:

```tsx
    } catch (err) {
      // An uploaded photo stays on the attempt, so the next try doesn't upload it again
      onAttemptChange?.(attempt);
      setIsSaving(false);
      setError(err instanceof SaveGraveError ? err.message : UNKNOWN_SAVE_MESSAGE);
```

Replace `        <h1 className="text-lg font-bold text-slate-900 tracking-tight">Confirm Details</h1>` with:

```tsx
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">{title ?? 'Confirm Details'}</h1>
```

In the footer, directly after the Save `</button>` and before the footer's closing `</div>`, add:

```tsx
        {onDiscard && (
          <button
            onClick={onDiscard}
            disabled={isSaving}
            className="w-full py-2 text-xs font-semibold text-rose-700 hover:text-rose-800 disabled:opacity-50"
          >
            Discard this photo
          </button>
        )}
```

- [ ] **Step 2: Page imports and state**

In `src/app/page.tsx`:

Replace `import { Cemetery, Grave, DeviceTelemetry, AIStructuredExtraction, SurveySession } from '@/types';` with:

```tsx
import { Cemetery, Grave, DeviceTelemetry, AIStructuredExtraction, CaptureSaveAttempt, Survey, SurveyCapture } from '@/types';
```

After `import { compassPermission } from '@/lib/device/compass';` add:

```tsx
import { surveyStore } from '@/lib/surveys/surveyStore';
import {
  discardSurveyCapture,
  markCaptureSaved,
  queueSurveyCapture,
  rememberCaptureAttempt,
  startSurveyQueue,
  surveyQueue,
} from '@/lib/surveys/surveyQueue';
import { useLiveValue } from '@/lib/surveys/useSurveyData';
import { countCaptures } from '@/lib/surveys/queueRules';
import { blobToDataUrl } from '@/lib/surveys/capturePhoto';
import type { OpenGraveResult } from '@/components/surveys/SurveyCaptureList';
```

Delete `  const [pendingUploads, setPendingUploads] = useState(0);`.

Replace `  const [surveySession, setSurveySession] = useState<SurveySession>(dataStore.getActiveSurveySession());` with:

```tsx
  // The survey camera adds to surveyForCamera; reviewCapture is the survey photo open on the Confirm screen
  const [captureMode, setCaptureMode] = useState<'single' | 'survey'>('single');
  const [surveyForCamera, setSurveyForCamera] = useState<Survey | null>(null);
  const [reviewCapture, setReviewCapture] = useState<SurveyCapture | null>(null);
  const reviewAttempt = useRef<CaptureSaveAttempt | null>(null);
```

Replace `  const { user, openAuthModal, loading: authLoading } = useAuth();` with:

```tsx
  const { user, openAuthModal, loading: authLoading } = useAuth();
  const userId = user?.id;

  // Survey photos on this phone, for the offline screen and the survey camera's counter
  const myCaptures = useLiveValue<SurveyCapture[]>(
    () => (userId ? surveyStore.userCaptures(userId) : Promise.resolve([])),
    [userId],
    []
  );
  const pendingUploads = countCaptures(myCaptures).pending;
  const queuedCount = surveyForCamera ? myCaptures.filter((capture) => capture.surveyId === surveyForCamera.id).length : 0;

  // The survey queue runs while the app is open. Signing in lifts a pause caused by an ended session.
  useEffect(() => {
    if (mounted) startSurveyQueue();
  }, [mounted]);
  useEffect(() => {
    if (userId) void surveyQueue.signedIn();
  }, [userId]);
```

- [ ] **Step 3: Page handlers**

In `openCapture`, replace:

```tsx
    setCurrentNavTab('capture');
    setPhotoTargetGrave(null);
    setCurrentScreen('capture');
  }, [user, openAuthModal]);
```

with:

```tsx
    setCurrentNavTab('capture');
    setCaptureMode('single');
    setPhotoTargetGrave(null);
    setCurrentScreen('capture');
  }, [user, openAuthModal]);

  // The survey camera stays open and queues each photo for the survey
  const openSurveyCamera = (survey: Survey) => {
    void compassPermission.request();
    setSurveyForCamera(survey);
    setCaptureMode('survey');
    setPhotoTargetGrave(null);
    setCurrentScreen('capture');
  };
```

In `leaveGraveDetails`, replace `    else if (previousScreen === 'home') setCurrentScreen('home');` with:

```tsx
    else if (previousScreen === 'home') setCurrentScreen('home');
    else if (previousScreen === 'survey-session') setCurrentScreen('survey-session');
```

Replace the whole `handleCaptureComplete`:

```tsx
  const handleCaptureComplete = (dataUrl: string, telemetry: DeviceTelemetry) => {
    setCapturedImage(dataUrl);
    setCapturedTelemetry(telemetry);
    // A photo for an existing grave skips the AI read and the new-grave form
    setCurrentScreen(photoTargetGrave ? 'add-photo' : 'ai-processing');
  };
```

with:

```tsx
  const handleCaptureComplete = async (dataUrl: string, telemetry: DeviceTelemetry) => {
    // Survey photos are stored and processed in the background; a failure here tells the camera to say so
    if (captureMode === 'survey' && surveyForCamera) {
      await queueSurveyCapture(surveyForCamera, dataUrl, telemetry, cemeteries);
      return;
    }
    setCapturedImage(dataUrl);
    setCapturedTelemetry(telemetry);
    // A photo for an existing grave skips the AI read and the new-grave form
    setCurrentScreen(photoTargetGrave ? 'add-photo' : 'ai-processing');
  };

  // A survey photo that needs a person opens on the Confirm screen with its own photo, reading and save ids
  const handleReviewCapture = async (capture: SurveyCapture) => {
    if (!capture.photo) return;
    setCapturedImage(await blobToDataUrl(capture.photo));
    setCapturedTelemetry(capture.telemetry);
    setExtractedData(capture.reading ?? EMPTY_EXTRACTION);
    reviewAttempt.current = capture.attempt;
    setReviewCapture(capture);
    setCurrentScreen('confirm-details');
  };

  const leaveReview = () => {
    setReviewCapture(null);
    reviewAttempt.current = null;
    setCurrentScreen('survey-session');
  };

  const openSavedGrave = async (graveId: string): Promise<OpenGraveResult> => {
    const grave = await dataStore.getGraveById(graveId).catch(() => undefined);
    if (!grave) return navigator.onLine ? 'removed' : 'offline';
    setPreviousScreen('survey-session');
    setSelectedGrave(grave);
    setCurrentScreen('grave-details');
    return 'opened';
  };
```

In `handleGraveSaved`, delete the line `    setSurveySession({ ...dataStore.getActiveSurveySession() });`.

Replace the Task 1 version of `handleTriggerSync`:

```tsx
  // Survey captures are processed by the survey queue; Task 9 wires it in here
  const handleTriggerSync = async () => {
    setPendingUploads(0);
  };
```

with:

```tsx
  // Sync Now on the offline screen wakes the survey queue
  const handleTriggerSync = async () => {
    await surveyQueue.wake();
  };
```

- [ ] **Step 4: Page renders**

Replace the capture render:

```tsx
        {currentScreen === 'capture' && (
          <CaptureScreen
            onCaptureComplete={handleCaptureComplete}
            onBack={() => {
              if (photoTargetGrave) {
                setPhotoTargetGrave(null);
                setCurrentScreen('grave-details');
              } else {
                setCurrentScreen('home');
              }
            }}
          />
        )}
```

with:

```tsx
        {currentScreen === 'capture' && (
          <CaptureScreen
            mode={captureMode}
            surveyCemetery={captureMode === 'survey' ? cemeteries.find((c) => c.id === surveyForCamera?.cemeteryId) : undefined}
            cemeteries={cemeteries}
            queuedCount={queuedCount}
            onCaptureComplete={handleCaptureComplete}
            onBack={() => {
              if (captureMode === 'survey') {
                setCaptureMode('single');
                setCurrentScreen('survey-session');
              } else if (photoTargetGrave) {
                setPhotoTargetGrave(null);
                setCurrentScreen('grave-details');
              } else {
                setCurrentScreen('home');
              }
            }}
          />
        )}
```

Replace the confirm render:

```tsx
        {currentScreen === 'confirm-details' && capturedTelemetry && (
          <ConfirmDetailsScreen
            initialData={extractedData}
            capturedImage={capturedImage}
            telemetry={capturedTelemetry}
            cemeteries={cemeteries}
            onSaved={handleGraveSaved}
            onRequireSignIn={openAuthModal}
            onBack={() => setCurrentScreen('capture')}
          />
        )}
```

with:

```tsx
        {currentScreen === 'confirm-details' && capturedTelemetry && (
          <ConfirmDetailsScreen
            // A new key per capture, so a review never reuses another photo's form or save ids
            key={reviewCapture?.id ?? 'capture'}
            initialData={extractedData}
            capturedImage={capturedImage}
            telemetry={capturedTelemetry}
            cemeteries={cemeteries}
            title={reviewCapture ? 'Review Survey Photo' : undefined}
            defaultCemeteryId={reviewCapture?.cemeteryId}
            initialAttempt={reviewCapture?.attempt}
            initialCandidate={reviewCapture?.matchCandidate}
            onAttemptChange={(attempt) => {
              if (!reviewCapture) return;
              reviewAttempt.current = attempt;
              void rememberCaptureAttempt(reviewCapture.id, attempt);
            }}
            onDiscard={
              reviewCapture
                ? () => {
                    void discardSurveyCapture(reviewCapture.id);
                    leaveReview();
                  }
                : undefined
            }
            onSaved={(grave, outcome) => {
              if (reviewCapture) {
                void markCaptureSaved(reviewCapture.id, grave.id, outcome, reviewAttempt.current ?? reviewCapture.attempt);
                setReviewCapture(null);
                reviewAttempt.current = null;
              }
              handleGraveSaved(grave, outcome);
            }}
            onRequireSignIn={openAuthModal}
            onBack={() => (reviewCapture ? leaveReview() : setCurrentScreen('capture'))}
          />
        )}
```

Replace the survey render:

```tsx
        {currentScreen === 'survey-session' && (
          <SurveySessionScreen
            session={surveySession}
            onCaptureNextGrave={openCapture}
            onBack={() => setCurrentScreen('home')}
          />
        )}
```

with:

```tsx
        {currentScreen === 'survey-session' &&
          (user ? (
            <SurveySessionScreen
              userId={user.id}
              cemeteries={cemeteries}
              onContinueSurvey={openSurveyCamera}
              onReviewCapture={(capture) => void handleReviewCapture(capture)}
              onOpenGrave={openSavedGrave}
              onBack={() => setCurrentScreen('home')}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <p className="text-sm font-semibold text-slate-800">Sign in to run surveys</p>
              <button
                onClick={openAuthModal}
                className="mt-3 py-2.5 px-5 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold"
              >
                Sign in
              </button>
            </div>
          ))}
```

- [ ] **Step 5: Profile and offline screens**

In `src/components/screens/ProfileScreen.tsx`, after `import { dataStore } from '@/lib/data/store';` add:

```tsx
import { SurveyCapture } from '@/types';
import { surveyStore } from '@/lib/surveys/surveyStore';
import { useLiveValue } from '@/lib/surveys/useSurveyData';
import { countCaptures } from '@/lib/surveys/queueRules';
```

Replace `  const activeSession = dataStore.getActiveSurveySession();` with:

```tsx
  const userId = user?.id;
  const surveyCount = useLiveValue(() => (userId ? surveyStore.listSurveys(userId).then((s) => s.length) : Promise.resolve(0)), [userId], 0);
  const surveyCaptures = useLiveValue<SurveyCapture[]>(
    () => (userId ? surveyStore.userCaptures(userId) : Promise.resolve([])),
    [userId],
    []
  );
  const mappedCount = countCaptures(surveyCaptures).saved;
```

Replace (the stats bar value):

```tsx
              {activeSession.capturedCount}
            </span>
            <span className="text-[11px] text-slate-500 font-medium">
              Graves Mapped
```

with:

```tsx
              {mappedCount}
            </span>
            <span className="text-[11px] text-slate-500 font-medium">
              Graves Mapped
```

Replace:

```tsx
                  {activeSession.capturedCount} field graves cataloged
```

with:

```tsx
                  {surveyCount} {surveyCount === 1 ? 'survey' : 'surveys'}, {mappedCount} {mappedCount === 1 ? 'grave' : 'graves'} saved
```

In `src/components/screens/OfflineStatusScreen.tsx`:
- Replace `  pendingUploadCount = 3,` with `  pendingUploadCount = 0,`.
- Replace
  ```tsx
              {pendingUploadCount} photos pending upload
  ```
  with
  ```tsx
              {pendingUploadCount} survey {pendingUploadCount === 1 ? 'photo' : 'photos'} waiting to be read
  ```
- Delete the made-up sync time:
  ```tsx
          <div className="text-center pt-1 text-[11px] text-slate-400 font-medium">
            Last synced: 12 Sep 2026, 08:14
          </div>
  ```
- Replace `      setSyncStatus('Sync complete! All records backed up.');` with `      setSyncStatus('Processing survey photos.');`.

- [ ] **Step 6: Remove the mock survey**

In `src/lib/data/store.ts`:
- In the `@/types` import, delete the line `  SurveySession,`.
- Replace `import { MOCK_CEMETERIES, MOCK_GRAVES, MOCK_ACTIVE_SURVEY_SESSION } from './mockData';` with `import { MOCK_CEMETERIES, MOCK_GRAVES } from './mockData';`.
- Delete `  private activeSurvey: SurveySession = { ...MOCK_ACTIVE_SURVEY_SESSION };`.
- Delete the `// --- SURVEY SESSIONS ---` comment and the `getActiveSurveySession()` method below it.

In `src/lib/data/mockData.ts`:
- Change `import { Cemetery, Grave, SurveySession } from '@/types';` to `import { Cemetery, Grave } from '@/types';`.
- Delete the whole `export const MOCK_ACTIVE_SURVEY_SESSION: SurveySession = { ... };` block at the end of the file.

In `src/types/index.ts`, delete the whole `SurveySession` interface.

- [ ] **Step 7: Check nothing refers to the removed pieces**

Run: `git grep -n -E "getActiveSurveySession|MOCK_ACTIVE_SURVEY_SESSION|SurveySession\b|offlineUploadQueue|syncPendingUploads|surveySession\b" -- src tests`
Expected: no output. (`SurveySessionScreen` does not match because of `\b`. The version 1 schema in `db.ts` names `offlineUploadQueue`; if it is listed, that single match is expected.)

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: all files pass.

Run: `npm run build` (no dev server running)
Expected: success.

- [ ] **Step 8: Commit**

```bash
git add src/components/screens/ConfirmDetailsScreen.tsx src/app/page.tsx src/components/screens/ProfileScreen.tsx src/components/screens/OfflineStatusScreen.tsx src/lib/data/store.ts src/lib/data/mockData.ts src/types/index.ts
git commit -m "feat(surveys): survey camera, review and real counts across the app; remove the mock survey

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Final checks and browser check

**Files:**
- None changed, unless a check finds a bug (fix it in the file where it lives, with a test where the logic is testable, and commit it separately).

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Run everything**

Run: `npx vitest run`
Expected: all files pass, including `survey_db`, `survey_queue_rules`, `survey_store`, `survey_queue_adapters`, `survey_queue_worker` and `survey_capture_photo`.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: success.

Run: `git diff main --name-only | xargs grep -nP "\x{2014}" || echo "no em dashes"`
Expected: `no em dashes`.

- [ ] **Step 2: Start the dev server**

Run `npm run dev` in the background and wait for `Ready`. Open `http://localhost:3000` in the Chrome DevTools browser (use `new_page` if page ids have reset).

- [ ] **Step 3: Seed sample captures that can't reach the AI**

The test browser has no camera. Sign in first if the session isn't signed in (ask the user to sign in in that browser if needed; don't enter credentials yourself). Then run this with `evaluate_script`. It adds a survey and captures whose statuses never trigger a read: `review`, `failed`, `saved`, and a `queued` one scheduled for the year 3000.

```js
async () => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
  const userId = key && JSON.parse(localStorage.getItem(key)).user?.id;
  if (!userId) return 'not signed in';
  const pixel = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const photo = await (await fetch(pixel)).blob();
  const telemetry = { latitude: -33.968, longitude: 18.503, gpsAccuracy: 4, headingDegrees: 62, timestamp: new Date().toISOString() };
  const surveyId = 'survey_browsercheck';
  const now = Date.now();
  const base = (n, extra) => ({
    id: `capture_browsercheck_${n}`, surveyId, userId, cemeteryId: 'cem_athlone',
    createdAt: new Date(now - n * 60000).toISOString(), photo, thumbnail: pixel, telemetry, insideBoundary: true,
    readAttempts: 1, saveFailures: 0, manualRetries: 0, nextAttemptAt: 0,
    attempt: { graveId: `grave_browsercheck_${n}`, personId: `person_browsercheck_${n}` }, ...extra,
  });
  const reading = { graveNumber: '', firstName: 'Yusuf', middleNames: [], surname: 'Kamish', nickname: '', fullName: 'Yusuf Kamish',
    birthDate: '1952-02-02', deathDate: '2018-06-16', confidence: 0.7, rawOcrText: 'YUSUF KAMISH', otherText: [],
    fieldConfidences: { graveNumber: 0, fullName: 0.7, dates: 0.9 } };
  const rows = [
    base(1, { status: 'review', reviewReason: 'low-confidence', reading }),
    base(2, { status: 'review', reviewReason: 'possible-duplicate', reading: { ...reading, fieldConfidences: { ...reading.fieldConfidences, fullName: 0.95 } },
      matchCandidate: { graveId: 'grave_missing', fullName: 'Yusuf Kamish', birthDate: '1952-02-02', deathDate: '2018-06-16', graveNumber: '', distanceMeters: 4, match: 'strong' } }),
    base(3, { status: 'failed', readAttempts: 3, lastError: "The photo couldn't be read." }),
    base(4, { status: 'saved', outcome: 'created', graveId: 'grave_that_does_not_exist', photo: undefined }),
    base(5, { status: 'queued', readAttempts: 0, nextAttemptAt: Date.parse('3000-01-01') }),
  ];
  const db = await new Promise((resolve, reject) => { const r = indexedDB.open('QabrMapDB'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const tx = db.transaction(['surveys', 'surveyCaptures'], 'readwrite');
  tx.objectStore('surveys').put({ id: surveyId, userId, cemeteryId: 'cem_athlone', cemeteryName: 'Athlone Muslim Cemetery', sectionNote: 'Row 12',
    startedAt: new Date(now - 3600000).toISOString(), status: 'ACTIVE' });
  rows.forEach((row) => { if (row.photo === undefined) delete row.photo; tx.objectStore('surveyCaptures').put(row); });
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  db.close();
  return `seeded for ${userId}`;
}
```

If the user already has an active survey on this browser, first finish it in the UI, because only one active survey is allowed.

- [ ] **Step 4: Check the screen**

Open the My Surveys tab and check, with `take_snapshot` and a screenshot at 400 px width (`resize_page` to 400 x 860):
- The card shows Athlone Muslim Cemetery, "Row 12", Active, and counters Captured 5, Saved 1, Pending 1, Review 3.
- The status line reads "Retrying 1 photo shortly" (the far-future queued capture).
- The chips All, Needs review, Pending, Saved wrap and are centred, and each filter shows the right rows.
- Tapping the saved row shows "Grave removed".
- The failed row shows Retry and Discard. Discard removes it and the counters update to Captured 4 and Review 2 without reloading. Do not tap Retry (it would send the photo to the AI).
- Tapping the low-confidence review row opens "Review Survey Photo" with Yusuf Kamish filled in, Athlone selected, and "Discard this photo". Tap Back and confirm it returns to My Surveys. Do not save.
- The possible-duplicate row opens with the "Already mapped nearby" card showing both dates.
- Profile shows the survey count and saved count.
- `list_console_messages` shows no errors from the survey code.

- [ ] **Step 5: Clean up the seeded data**

Run with `evaluate_script`:

```js
async () => {
  const db = await new Promise((resolve, reject) => { const r = indexedDB.open('QabrMapDB'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const tx = db.transaction(['surveys', 'surveyCaptures'], 'readwrite');
  tx.objectStore('surveys').delete('survey_browsercheck');
  for (let n = 1; n <= 5; n++) tx.objectStore('surveyCaptures').delete(`capture_browsercheck_${n}`);
  await new Promise((resolve) => (tx.oncomplete = resolve));
  db.close();
  return 'removed';
}
```

The seeded survey may have been written to `survey_sessions` in the cloud by the sync. Tell the user it exists (id `survey_browsercheck`) and offer the SQL to remove it: `delete from public.survey_sessions where id = 'survey_browsercheck';`. Do not run SQL against production yourself.

Stop the dev server.

- [ ] **Step 6: Report to the user**

Without pushing or deploying, report:
1. Plan 1's two migrations must be run in the SQL Editor before deploying (surveys save through `save_or_add_grave` and read through the limited route). Plan 2 needs no new migration.
2. What was checked in the browser, and that capture itself can only be checked on a phone.
3. The phone check after deploying: start a survey, take a few photos with signal, a few in flight mode, turn signal back on and watch Pending fall; photograph the same stone twice and expect the second to show "Photo added to a mapped grave".
