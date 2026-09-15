# My Surveys: queued survey capture, duplicate detection and AI cost limits

Date: 2026-09-15
Status: approved design, not yet implemented

## Problem

- **My Surveys is mock data.** `SurveySessionScreen.tsx` shows a hard-coded session (Athlone, Section B, 12 captured) and three hard-coded captures from `MOCK_ACTIVE_SURVEY_SESSION`. The Profile screen repeats the mock count.
- **No fast or offline capture.** The Capture tab reads and saves one grave at a time and needs signal for both.
- **No duplicate detection.** Two people photographing the same stone create two graves.
- **No server-side cost limit on photo reading.** A bug or a modified client could call GPT-5.6 Luna without bound.

## Decisions

| Topic | Decision |
|---|---|
| Modes | The Capture tab stays one grave at a time. My Surveys runs survey sessions with a rapid camera and an on-device queue |
| Architecture | The queue lives on the phone (IndexedDB) and the app processes it while open. No server-side job queue |
| Auto-save | Only when first name and surname are read, name confidence is 0.90 or higher, and the photo's GPS is inside the survey cemetery's boundary. Everything else waits in Needs review |
| Active surveys | At most one active survey per surveyor per phone |
| Cost guard | Server rate limit per user (60 reads per 10 minutes, 500 per day), a 24-hour reuse of the reading for an identical photo, a per-capture read cap, and a client circuit breaker |
| Duplicates | Checked on Capture's Confirm screen, in the survey worker, and inside the save function. Capture always asks the user. Surveys add the photo automatically on a strong match and send possible matches to review |
| Shared graves | One numbered grave can hold several burials, such as a son buried in his father's grave. Date of birth, then date of death, decides whether two people with the same name are the same person. The one-grave-per-number rule is dropped |

## Live database facts (checked 2026-09-15)

- `survey_sessions` exists with `id text`, `user_id`, `cemetery_id`, `cemetery_name`, `section_code`, `started_at`, `completed_at`, `status` (`ACTIVE`, `PAUSED`, `COMPLETED`), `captured_count`, `processed_count`, `pending_count`, `review_count`. Its row level security lets a user select, insert and update only their own rows. No change is needed.
- `graves` has the partial unique index `graves_cemetery_grave_number_unique_idx` on `(cemetery_id, grave_number)` for numbered graves. It would block mapping a second burial in the same grave, so the new migration drops it (section 5).
- `pg_trgm` is not enabled. The migration enables it in the `extensions` schema.
- PostGIS is installed, but graves store `latitude` and `longitude` as doubles. Distance uses a haversine expression in SQL, so the functions don't depend on PostGIS.
- `graves`, `persons` and `grave_photos` are currently empty.

## 1. Storage

### On the phone (Dexie database version 2)

**`surveys`** (indexes `id, userId, status, startedAt`)

| Field | Notes |
|---|---|
| `id` | `survey_<uuid>` |
| `userId` | the surveyor |
| `cemeteryId`, `cemeteryName` | chosen at start |
| `sectionNote` | optional free text such as "Row 12" |
| `startedAt`, `completedAt` | ISO timestamps |
| `status` | `ACTIVE` or `COMPLETED` |
| `cloudSyncedAt` | last successful write to `survey_sessions` |

**`surveyCaptures`** (indexes `id, surveyId, userId, status, createdAt, nextAttemptAt`)

| Field | Notes |
|---|---|
| `id` | `capture_<uuid>` |
| `surveyId`, `userId`, `cemeteryId`, `createdAt` | |
| `photo` | JPEG Blob, long edge 1600 px, quality 0.85. Removed once the capture is saved |
| `thumbnail` | JPEG data URL, long edge 160 px. Kept |
| `telemetry` | latitude, longitude, accuracy, heading, timestamp |
| `insideBoundary` | whether the GPS fix was inside the survey cemetery's boundary |
| `status` | `queued`, `reading`, `saving`, `review`, `saved`, `failed` |
| `reviewReason` | `no-name`, `low-confidence`, `outside-cemetery`, `possible-duplicate`, `unreadable` |
| `reading` | the `AIStructuredExtraction` from the photo |
| `readAttempts`, `manualRetries` | counters for the read cap (section 4) |
| `nextAttemptAt`, `lastError` | backoff and the last failure message |
| `attempt` | the existing `SaveAttempt` (grave id, person id, uploaded photo), so retries never duplicate |
| `graveId`, `outcome` | set when saved; `outcome` is `created` or `added-photo` |
| `matchCandidate` | the existing grave shown in the duplicate card (id, name, dates, grave number, distance) |

- **Counts are derived, never stored on the device.** Captured = all captures. Saved = `saved`. Pending = `queued` + `reading` + `saving`. Review = `review` + `failed`.
- **Persistent storage.** Starting a survey calls `navigator.storage.persist()`. If the browser refuses, the survey card shows: "This phone may clear stored photos if it runs low on space. Stay online when you can."
- **Removed.** The legacy `offlineUploadQueue` table (dropped in version 2) and its code in `SyncManager`, `MOCK_ACTIVE_SURVEY_SESSION`, and `dataStore.activeSurvey`.

### In the cloud

The survey is upserted into `survey_sessions` when it starts, at most once a minute while its counts change, and when it finishes. `processed_count` holds Saved. A write that fails offline is retried when the phone is next online. Individual captures stay on the phone until they become graves, so the graves themselves need no new columns.

## 2. Queue processing

The worker lives in `src/lib/surveys/queueWorker.ts` and takes its storage, photo reading, saving, clock, online check and signed-in user as injected dependencies.

- **One worker per browser.** It runs inside `navigator.locks.request('qabrmap-survey-queue', { ifAvailable: true })`, falling back to an in-memory flag where the Web Locks API is missing, so two tabs never process together.
- **Wake triggers.** App start, sign-in, a new capture, the `online` event, the page becoming visible, the service worker's `TRIGGER_BACKGROUND_SYNC` message, and a timer set to the earliest `nextAttemptAt` (never less than 30 seconds away). It stops when nothing is eligible.
- **Eligible captures.** Status `queued` or `saving`, belonging to the signed-in user, with `nextAttemptAt` in the past. On start, captures left in `reading` return to `queued`.

**Reading** (`/api/graves/read-stone`)

| Result | What happens |
|---|---|
| Success | Store the reading, then decide |
| Offline or network failure | Back to `queued`; the attempt isn't counted |
| 429 | `nextAttemptAt` in 60 seconds; the attempt isn't counted |
| 422, no grave details | `review` with `unreadable` |
| 401 | The queue pauses with "Sign in to keep processing your survey" |
| Other | Backoff of 30 seconds, 2 minutes, then 10 minutes. At 3 counted attempts the capture becomes `failed` |

`readAttempts` is incremented and saved before each request that reaches the server.

**Deciding**

1. No first name or no surname: `review` with `no-name`.
2. Name confidence below 0.90: `review` with `low-confidence`.
3. Outside the cemetery boundary: `review` with `outside-cemetery`.
4. Otherwise: `saving`.

**Saving** calls `save_or_add_grave` in `auto` mode (section 5) with the survey's cemetery, the capture's telemetry and its stored `attempt`.

| Outcome | What happens |
|---|---|
| `created` | `saved`, outcome `created`; the full photo is removed |
| `added-photo` | `saved`, outcome `added-photo`; the photo now belongs to the existing grave |
| `match-found` | `review` with `possible-duplicate` and the candidate |
| Offline | Stays `saving` and retries when online with the same `attempt` |
| 401 or 42501 | The queue pauses (signed out) |
| Other | Backoff as for reading; 3 failures make it `failed` |

**Review actions.** Tapping a `review` or `failed` capture opens the Confirm screen with the capture's photo (Blob converted to a data URL), telemetry, reading, `attempt` and cemetery. Save uses `ask` mode with the duplicate card. Discard deletes the capture. Retry is described in section 4.

## 3. Screens

### My Surveys tab with an active survey

- **Survey card:** cemetery, section note, start time, an Active badge, and four counters (Captured, Saved, Pending, Review).
- **Status line:** "Reading 3 of 8…", "No signal: 5 photos stored on this phone", "Paused: sign in to keep processing", or "Reading paused after repeated errors" with a Resume button.
- **Buttons:** Continue surveying (opens the survey camera) and Finish survey. Pending captures keep processing after the survey finishes, and review items stay reachable.
- **Captures list:** filter chips All, Needs review, Pending, Saved, centred and wrapping like Search. Each row shows the thumbnail, the name once read (otherwise Queued or Reading), the status with its review reason, and the time. Tapping opens Confirm for review items, the grave details for saved ones (or "Grave removed" if it has since been deleted), and Retry or Discard for failed ones.

### My Surveys tab with no active survey

- **Start a survey:** cemetery picker, preselected from GPS when inside a boundary, an optional "Section or row" field, and Start survey.
- **Past surveys:** the surveyor's surveys on this phone, plus cloud rows not on this phone (counts only). Tapping a survey on this phone shows its captures.

### Survey camera

`CaptureScreen` gets `mode: 'single' | 'survey'`. In survey mode:

- The capture rules stay the same: live camera, GPS within 10 m, always-on compass, sign-in required.
- The shutter stores the capture and stays on the camera, briefly showing "Queued ✓" and a running count.
- A live warning appears when the GPS fix is outside the survey's cemetery. Shooting is still allowed, and those captures go to review.
- The screen stays awake. Done returns to My Surveys.

### Other screens

- **Profile:** "My Survey Sessions" shows the real number of surveys and saved captures.

## 4. AI cost limits

### Server

The migration adds:

- **`photo_reads` table:** `id uuid` (primary key, default `gen_random_uuid()`), `user_id` (references `auth.users`, on delete cascade), `photo_hash text`, `reading jsonb`, `created_at timestamptz default now()`. Indexes on `(user_id, created_at desc)` and `(user_id, photo_hash, created_at desc)`. Row level security is on with no policies, so only the functions below touch it.
- **`begin_photo_read(p_photo_hash text) returns jsonb`**, security definer, caller checked:
  - If the same user has a reading for the same hash within 24 hours, it returns `{ "cached": <reading> }`.
  - If the user has 60 or more reads in the last 10 minutes, or 500 or more in the last 24 hours, it raises `53400` "Too many photos read. Try again later."
  - Otherwise it inserts a row and returns `{ "read_id": <id> }`.
- **`finish_photo_read(p_read_id uuid, p_reading jsonb)`**, security definer: stores the reading on the caller's own row.
- Both functions are executable by `authenticated` only.

The `/api/graves/read-stone` route:

1. Computes the SHA-256 of the decoded image bytes.
2. Calls `begin_photo_read` with a Supabase client carrying the user's token, so `auth.uid()` resolves.
3. On `cached`, returns that reading without calling OpenAI. On `53400`, returns 429.
4. Otherwise reads the photo with GPT-5.6 Luna, calls `finish_photo_read` when a reading comes back, and responds.

A failed OpenAI call still counts toward the limit, on purpose.

### Phone

- **Read cap:** at most 3 counted reads per capture before it becomes `failed`. Retry is allowed while `manualRetries` is below 2, and each Retry allows one more read, so a capture can reach at most 5 reads.
- **Circuit breaker:** 5 consecutive read or save failures (offline doesn't count) pause the whole queue until the surveyor taps Resume. The paused state is stored per user.
- **No busy loops:** retries always wait out their backoff, and the worker stops when nothing is eligible.

The project owner should also set a monthly spending limit on the OpenAI project.

## 5. Duplicate detection

### Graves can hold several burials

A numbered grave can hold more than one person, for example a son buried in his father's grave, often with the same name. Each burial stays its own `graves` row with its own person, at the same location and grave number. The migration therefore drops `graves_cemetery_grave_number_unique_idx`, and duplicate detection takes over the job of stopping the same person being mapped twice.

### Matching: `find_matching_graves`

A read-only, `stable`, security invoker function (graves and persons are publicly readable). Parameters: cemetery, latitude, longitude, GPS accuracy, first name, surname, birth date, death date and grave number. It returns up to 3 rows: grave id, full name, birth date, death date, grave number, distance in metres, and `match` (`strong` or `possible`), strong matches first and then by distance.

1. **Candidates** are graves in the same cemetery that are either within `least(20, greatest(10, new accuracy + existing position_accuracy_meters))` metres by haversine, or have the same non-empty grave number. A candidate with a different non-empty grave number is excluded.
2. **Names must match.** `extensions.similarity()` of the normalised "first name surname" strings must be 0.85 or higher. Normalising means lower case, trimmed, with whitespace collapsed. A candidate with a different name is a different person, even in the same grave.
3. **Dates decide between people with the same name**, in this order:
   - Both dates of birth known: equal means the same person. Different means different people (a father and son), so the candidate is excluded.
   - Otherwise, both dates of death known: equal means the same person. Different excludes the candidate.
   - Neither date can be compared: the candidate is kept as `possible`.
4. **`strong`:** names match and a compared date is equal. **`possible`:** names match and no date could be compared.

The Confirm card and the review card always show the candidate's dates of birth and death, so a person can tell a father and son apart when the function can't.

### Saving: `save_or_add_grave`

Replaces the app's use of `create_mapped_grave`. It keeps every parameter and all validation of `create_mapped_grave`, and adds `p_match_mode text` (`ask`, `auto` or `new`) and `p_add_to_grave_id text default null`. It returns `jsonb` with `outcome` (`created`, `added-photo` or `match-found`), `grave_id`, and `candidate` when relevant.

- **Race safety:** `pg_advisory_xact_lock(hashtext(p_cemetery_id))` serialises saves within a cemetery, so two people saving the same person at the same moment can't both create a grave.
- **Retries are idempotent:**
  - A grave with `p_grave_id` created by the caller returns `created`.
  - A `grave_photos` row with the same `public_url` uploaded by the caller returns `added-photo`.
- **`p_add_to_grave_id` set:** the grave must exist in the same cemetery. The function inserts a `grave_photos` row (uploaded by the caller, with the capture's GPS, accuracy, heading and time, `is_primary` false) and returns `added-photo`.
- **`ask` mode:** any `strong` or `possible` match returns `match-found` with the top candidate and writes nothing.
- **`auto` mode:** `strong` adds the photo to that grave and returns `added-photo`. `possible` returns `match-found`.
- **`new` mode:** creates the grave as `create_mapped_grave` does today.
- Execute permission is revoked from `public` and `anon` and granted to `authenticated`. `create_mapped_grave` stays in place until a later cleanup migration, after the new app is live.

### Capture (single mode)

- **When the check runs.** When the Confirm screen opens, and 500 ms after the cemetery, names, dates or grave number change, the screen calls `find_matching_graves`.
- **Match found.** A card appears at the top: "Already mapped nearby: Yusuf Kamish, born 2 Feb 1952, died 16 Jun 2018, 4 m away", with "Add my photo to this grave" and "It's a different person".
- **Add my photo** saves with `p_add_to_grave_id`, reusing the uploaded photo, then opens that grave's details.
- **It's a different person** saves in `new` mode, for example a son buried in his father's grave.
- **Plain Save** uses `ask` mode. If the server returns `match-found`, for example because someone saved the same grave seconds earlier, the same card appears and nothing new is created.

### Surveys

The worker saves in `auto` mode. Review items use `ask` mode on the Confirm screen, with the same card.

## 6. Edge cases

- **The app closes while reading:** the capture returns to `queued` and is read again (about $0.0008, or free if `begin_photo_read` returns the cached reading).
- **The app closes while saving:** it resumes with the same ids, so no duplicate is created.
- **Another user signs in on the phone:** only the signed-in surveyor's captures are shown and processed.
- **The phone can't store a capture:** the camera shows "Couldn't store this photo on the phone" and stays open.
- **A son buried in his father's grave, with the same name:** the same grave number and location. Different dates of birth, or failing that different dates of death, keep them as two burials. If no dates can be compared, a person decides using the card.
- **A father and son in neighbouring graves:** different grave numbers or different dates keep them separate.
- **GPS drift:** two fixes of the same stone can be up to 20 m apart and still match.
- **The same stone shot twice in one survey:** the second save finds the first grave, so the photo is added instead of creating a new grave.
- **A saved grave is deleted later:** the capture shows "Grave removed".
- **iPhones:** no background wake-ups, so processing resumes whenever QabrMap is open.
- **Local development:** the service worker is off on localhost. The queue relies on `navigator.onLine` and fetch failures, so offline behaviour can still be tested with DevTools' Offline mode.

## Out of scope

- Transliteration variants (Mohamed and Muhammad) beyond trigram similarity
- Processing while the app is closed
- Listing another phone's captures
- Editing a saved grave
- Surveys with several surveyors at once
- Grouping several burials under one plot record

## Testing

**Unit tests (pure functions)**
- the auto-save decision
- next step per status, including recovery after a restart
- backoff and the read cap
- mapping errors to review reasons
- derived counts
- the circuit breaker
- the duplicate card view model, including dates

**Queue worker tests** (fake reader, fake saver, fake clock, `fake-indexeddb`)
- offline captures stay queued
- a clear reading auto-saves
- low confidence goes to review
- a strong match adds the photo
- a possible match goes to review
- a lost response retries with the same ids
- a signed-out user pauses the queue
- 5 failures in a row pause the queue

**Dexie upgrade test:** a version 1 database opens as version 2 with the new tables and keeps cached graves.

**Route tests:** hashing, a cached reading skipping OpenAI, and 53400 mapped to 429, with fakes.

**Migration text tests:** security definer functions, grants, the advisory lock, `search_path`, and the dropped unique index.

**Local Postgres 17 checks**
- `find_matching_graves`: same person nearby (strong), no dates (possible), the radius, a different grave number excluded, and a son in his father's grave with the same name and grave number but a different date of birth excluded
- `save_or_add_grave`: all three modes, add-to, idempotent retries, two concurrent saves producing one grave, and a second burial saved under the same grave number
- `begin_photo_read`: the 10-minute and daily limits and the cached reading

**Browser check:** start a survey, counters, the captures list and review, using sample captures (the test browser has no camera).

**Phone check after deploy:** a few photos with signal, a few in flight mode, back online, and the same grave captured twice.

## Rollout

1. Run the new migration in the Supabase SQL Editor.
2. Deploy the app.
3. After the new app is live, a cleanup migration can drop `create_mapped_grave`.
