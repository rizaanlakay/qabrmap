# Saving a new grave from Capture

Date: 2026-09-15
Status: approved design, not yet implemented

## Problem

Capture looks like it saves a grave, but the grave never reaches Supabase.

- `graves` and `persons` only have SELECT policies. `dataStore.saveNewGrave` upserts both, supabase-js returns `{ error }` instead of throwing, and the store never reads it. The live `graves` table has 0 rows.
- The Confirm screen hardcodes `cemeteryName: 'Athlone Muslim Cemetery'`, `sectionId: 'sec_b'`, `sectionName: 'Section B'` and `lastVerifiedAt: '12 September 2026'`. The live `cemetery_sections` table is empty, so `sec_b` would also break the foreign key.
- The cemetery is whichever one loaded first. The user never chooses it.
- Uploaded photos without a GPS fix are pinned to fixed Athlone coordinates.
- Capture doesn't require sign-in, but storage uploads do. Signed-out photos go to an offline queue that can never succeed.
- The first photo only goes into `graves.primary_photo_url`. No `grave_photos` row is written, so the photo trigger later replaces it.
- A failed upload leaves the base64 image in `primary_photo_url`.
- If the processing pipeline throws, the processing screen spins forever.
- Navigation, AR and Capture all read `360 - alpha` from `deviceorientation`, which is not measured from true north on Android, and never ask for motion permission, so iOS gets no heading at all.

## Live database facts (checked 2026-09-15 with the anon key)

- The live schema is `001_initial_schema.sql` (text IDs) plus `20260914170000_grave_photos.sql`. The PostGIS migration was never applied (`grave_observations` and `users` don't exist).
- Tables `graves`, `persons`, `cemetery_sections`, `grave_photos`, `survey_sessions` exist and are empty.
- All four cemeteries (`cem_athlone`, `cem_mowbray`, `cem_mountview`, `cem_wynberg`) have a GeoJSON `Polygon` boundary.
- Migrations in this repo are applied by hand in the Supabase SQL Editor.

## Decisions

| Topic | Decision |
|---|---|
| Sign-in | Required before capturing a new grave |
| Write path | One database function, `create_mapped_grave`, that checks the signed-in user and records `created_by` on graves and persons. No direct INSERT rights on either table |
| Visibility | Public immediately, marked unverified |
| Cemetery | Chosen automatically from GPS and boundary, user can change it |
| Photo source | Live in-app camera only. Upload is removed everywhere, including Add Photo |
| GPS | Shutter needs accuracy of 10 m or better |
| Heading | Shutter needs a compass heading |
| Offline | Saving is blocked with a clear message; the form stays filled in |
| Required fields | First name and surname |
| Optional fields | Middle names, nickname (new), grave number, birth date, death date |
| After saving | Open the new grave's details page |

The photo exists for position and direction, so AR can guide someone back to where the photographer stood and which way they faced. Many stones have no readable details and the user types them in.

## 1. Database

New migration `supabase/migrations/20260915120000_create_mapped_grave.sql`, safe to run more than once.

### Columns

- `persons.nickname text` (nullable).
- `persons.created_by uuid default auth.uid() references auth.users (id) on delete set null`, with an index.
- `graves.created_by uuid default auth.uid() references auth.users (id) on delete set null`, with an index.

`grave_number` stays `NOT NULL`. A grave without a number is stored as `''`, which keeps every existing `graveNumber.toLowerCase()` call safe.

### Policies

- No INSERT, UPDATE or DELETE policies on `graves` or `persons`. With row level security on and no policy, the API rejects direct writes, so the only way to add a grave is `create_mapped_grave`. Open INSERT policies would let a client skip the function and insert a grave as `VERIFIED` with no photo or GPS checks.
- `storage.objects` DELETE to `authenticated` using `bucket_id = 'grave-photos' and owner_id = (select auth.uid())::text`. Today only INSERT exists, so the existing "delete the orphaned file" cleanup in `addGravePhoto` silently fails. This policy fixes that path and the new one.

### Duplicate grave numbers

Partial unique index on `graves (cemetery_id, grave_number) where grave_number <> ''`. Graves without a number are not checked for duplicates in this change.

### Function `public.create_mapped_grave`

Runs the three inserts in one transaction so a grave is never half saved.

- `security definer`, `set search_path = ''`. It is the only write path, so it checks `(select auth.uid())` is not null first (raising `42501`) and stamps that id into `persons.created_by`, `graves.created_by` and `grave_photos.uploaded_by` itself.
- `revoke execute ... from public, anon`, `grant execute ... to authenticated`.
- Parameters: grave id, person id, cemetery id, grave number, first name, middle names, surname, nickname, birth date, death date, latitude, longitude, GPS accuracy in metres, heading in degrees, captured at, photo public URL, photo storage path.
- Validation, raising `22023` (invalid parameter) with a readable message:
  - trimmed first name and surname are not empty
  - accuracy is between 0 and 10
  - heading is between 0 and 360
  - latitude and longitude are in range and not 0,0
  - photo URL is not empty
- The function sets the saved values itself, so a client can't claim a better status:
  - `status`: `MAPPED` when accuracy is 5 m or better, otherwise `LOW_CONFIDENCE`
  - `position_confidence`: `HIGH` at 3.5 m or better, `MEDIUM` at 6 m or better, otherwise `LOW` (same thresholds as `processPhotoToGravePosition`)
  - `orientation_degrees`: the heading
  - `section_id` and `last_verified_at`: null
- Inserts the person, the grave, then a `grave_photos` row with `is_primary = true` and the capture latitude, longitude, accuracy, heading and time. The existing `sync_grave_photo_summary` trigger then sets `primary_photo_url` and `photo_count`.
- Returns the grave id.

## 2. Capture screen

### Compass helper

New `src/lib/device/compass.ts`:

- `readCompassHeading(event, source)` is a pure function. It returns `webkitCompassHeading` on iOS, `360 - alpha` only for a `deviceorientationabsolute` event, and `null` for a relative `deviceorientation` event.
- `useCompassHeading()` returns `{ heading, status, requestPermission }` where `status` is `'unsupported' | 'needs-permission' | 'active' | 'denied'`. On iOS, `requestPermission` calls `DeviceOrientationEvent.requestPermission()` and must run from a tap.

`CaptureScreen`, `NavigationScreen` and `ARGuidanceScreen` all switch to the hook, so a heading saved at capture and a heading read during AR use the same reference.

### Shutter readiness

New pure function `getCaptureReadiness({ cameraLive, fix, heading, compassStatus })` in `src/lib/capture/readiness.ts`. It returns `ready` plus the first thing that's missing, in this order:

1. Camera not live: "Camera is not available"
2. No GPS fix: "Locating…"
3. Accuracy worse than 10 m: "Improving GPS (± 14 m)…"
4. Compass needs permission: shows an "Enable compass" button
5. No heading: "Compass not available on this device"

The guidance pill shows that message and the shutter stays disabled until `ready`.

### Other changes

- Remove the Upload button, the hidden file input and `UPLOAD_FALLBACK_POSITION`.
- Telemetry passed on: latitude, longitude, accuracy, heading, timestamp, timezone.

### Sign-in gate

When there's no signed-in user, these open the sign-in modal instead of Capture:

- the Capture tab in `BottomNav`
- the "Map a grave" card on Home
- "Capture Next Grave" on the survey screen
- the `?mode=capture` launch shortcut, once auth has finished loading

## 3. Processing screen

When the pipeline throws, show the error with two buttons: "Retake" (back to Capture) and "Enter details manually" (Confirm screen with an empty extraction).

## 4. Confirm & Save

### Cemetery

New pure function `findCemeteryForLocation(cemeteries, lat, lng)` in `src/lib/capture/cemeteryForLocation.ts`, using `isPointInPolygon` on `boundary.coordinates[0]` (`[lng, lat]` order).

- Inside a boundary: that cemetery is preselected in a picker. If boundaries overlap, the first match in the loaded cemetery list wins. Cemeteries with no boundary are skipped.
- Outside every boundary: nothing is preselected, the picker is required, and a warning says the location is outside the chosen cemetery's boundary.

### Form

| Field | Rule |
|---|---|
| First name | Required |
| Surname | Required |
| Middle names | Optional |
| Nickname | Optional |
| Grave number | Optional |
| Date of birth | Optional, `type="date"` |
| Date of death | Optional, `type="date"` |
| Cemetery | Required |

- OCR results prefill the fields as today.
- A line by the thumbnail: if the stone has no readable details, the photo records location and direction, so type the details in.
- Validation lives in a pure `validateNewGraveForm` in `src/lib/capture/newGrave.ts`. Confirm & Save stays disabled until it passes.
- Remove the "Edit Manually" button.

### Save sequence

`dataStore.saveNewGrave(input)` takes the form values, cemetery id and telemetry, and either returns the saved `Grave` or throws a `SaveGraveError` with a `code`.

1. If `navigator.onLine` is false, throw `offline`.
2. Confirm there's a signed-in user, else throw `signed-out`.
3. Generate `grave_<uuid>` and `person_<uuid>` ids.
4. Upload the photo with `uploadGravePhoto({ upsert: false })`. A failure throws `upload-failed`, or `offline` for a network error.
5. Call `create_mapped_grave`.
6. If the call fails, delete the uploaded file, then throw the mapped error.
7. Load the saved grave with `getGraveById`, cache it in IndexedDB and return it.

Removed from `saveNewGrave`: the offline upload queue, `memoryGraves`, and writing base64 into `primary_photo_url`. The survey counter increment is left as it is until the My Surveys work.

### Errors

New pure `mapSaveGraveError(error)` in `src/lib/supabase/saveGraveErrors.ts`:

| Source | Code | Message shown |
|---|---|---|
| Offline or network `TypeError` | `offline` | You're offline. Connect to the internet and tap Save again. |
| No user, or Postgres `42501` | `signed-out` | Your session has ended. Sign in and tap Save again. (Opens sign-in.) |
| Postgres `23505` | `duplicate` | Grave {number} is already mapped at {cemetery}. |
| Postgres `22023` | `invalid` | The function's message |
| PostgREST `PGRST202` | `not-set-up` | Saving graves isn't set up in the database yet. |
| Storage failure | `upload-failed` | The photo couldn't be uploaded. Please try again. |
| Anything else | `unknown` | The grave couldn't be saved. Please try again. |

Errors show inline above the buttons. The form keeps every value. The button shows "Saving…" and is disabled while saving.

### After saving

`page.tsx` sets the saved grave as selected, refreshes the cemetery's graves and opens `grave-details`. The fake `survey-session` jump goes away, along with the sample defaults for `capturedImage` and `capturedTelemetry`.

## 5. Nickname and labels

- `Person.nickname?: string`; `mapDbPerson` and `personToDb` include it.
- Grave details shows "Known as {nickname}" under the full name when set.
- `dataStore.searchGraves`, `syncManager.searchOfflineGraves` and the My Cemeteries filter match nickname as well as name and number.
- New `graveNumberLabel(grave)` in `src/lib/ui/graveLabels.ts` returns `Grave 1402`, or `null` when the number is blank. These places use it so none show a bare "Grave" or "Plot":
  - `AddPhotoConfirmScreen`
  - `ARGuidanceScreen`
  - `CemeteryMapScreen`
  - `GraveDetailsScreen`: header, share text, correction title
  - `MyCemeteriesScreen`
  - `NavigationScreen`: marker, sheet subtitle, arrival message
  - `SearchScreen`
  - `AdminDashboard`

## Out of scope

- Fake quality, detection and duplicate steps in the pipeline
- OCR engine choice and Arabic support
- Fake provenance history on grave details
- Survey sessions and counters
- Editing or verifying a grave after it's saved
- Duplicate detection for graves without a number
- Estimating the stone's position in front of the camera. The saved position is where the phone was.

## Testing

### Unit tests (vitest, pure functions)

- `readCompassHeading`: iOS value, absolute event, relative event ignored, missing values
- `getCaptureReadiness`: each blocker in order, and ready at exactly 10 m
- `findCemeteryForLocation`: inside, outside, overlapping or missing boundary
- `validateNewGraveForm`: names required and trimmed, everything else optional
- `mapSaveGraveError`: every row of the error table
- `graveNumberLabel`: number and blank
- Nickname search in `searchOfflineGraves` with `fake-indexeddb`
- `mapDbPerson` and `personToDb` round-trip the nickname

### Migration test

Read the migration file as text, like `tests/grave_photos.test.ts`, and check:

- `created_by` on both tables, and the nickname column
- no INSERT, UPDATE or DELETE policies on `graves` or `persons`, and no bare `auth.uid()`
- the partial unique index
- `create_mapped_grave` is `security definer` with `set search_path = ''`, checks the caller, and is not executable by `anon`
- the storage DELETE policy

### Notes added while planning

- The compass hook also has a `waiting` status (listening, no reading yet). It becomes `unsupported` after 3 seconds without a reading, which is what laptops do.
- Graves loaded from the database don't carry a cemetery name, so screens fell back to "Athlone Muslim Cemetery". The store now fills in `cemeteryName` from the loaded cemeteries.
- Navigation map markers build HTML strings. Names and entrance names are escaped with a small `escapeHtml` helper, because they are now typed in by users.

### Manual end-to-end

1. Apply the migration in the SQL Editor.
2. Run the app on localhost, sign in, and use Chrome DevTools Sensors to set a location inside Athlone's boundary and an orientation.
3. Save a grave with a nickname and no grave number. Confirm with a read-only REST request that `persons`, `graves` and `grave_photos` each have the new row, and that `primary_photo_url` was set by the trigger.
4. Save a second grave with a number, then the same number again. Expect the duplicate message and no new file in storage.
5. Switch DevTools to offline and save. Expect the offline message with the form intact.
6. On a real Android phone and iPhone, check that the compass permission prompt and heading work in Capture, Navigation and AR.

## Rollout

Apply the migration before deploying the client. If the client ships first, saving shows "Saving graves isn't set up in the database yet." instead of failing silently.

## Retries on weak connections (added after code review)

- Each capture keeps one grave id, person id and uploaded photo across Save retries.
- The uploaded photo is deleted only when the database itself rejects the save (the error carries a Postgres or PostgREST code). A dropped connection or gateway timeout may have happened after the save committed, so the photo is kept.
- `create_mapped_grave` returns the existing grave when the same user sends a grave id that is already saved, so a retry after a lost response neither fails nor creates a second grave.
- If the saved grave can't be read back straight after saving, the app builds it from what it sent instead of reporting a failure.

## Compass always on (added 2026-09-15)

- The compass can't be switched on or off on the capture screen; there is no compass button.
- On iOS, motion access is asked for inside the tap that opens the camera (Capture tab, Map a grave, Capture Next Grave, Add a Photo). If the camera was opened without a tap (home screen shortcut, reload), the first tap anywhere on the screen asks, with the hint "Tap the screen to start the compass".
- The answer is kept in one shared record, so every screen uses it and nobody is asked twice.
- If motion access is refused, the shutter stays disabled with "Allow motion access for this site in Settings to map a grave".
