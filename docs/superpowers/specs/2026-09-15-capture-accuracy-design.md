# Capture accuracy, position observations and the AR marker

Date: 2026-09-15
Status: implemented on feature/my-surveys; migration 20260915200000_position_observations.sql must be run in the Supabase SQL Editor

## Problem

Standing at a gravestone, the shutter stays locked because the browser reports GPS accuracy worse than 10 m. The only hint is a small "Improving GPS (± 14 m)…" pill and a dimmed button, so it looks like a bug. Under trees or near a wall a phone may never get under 10 m, and a web app cannot ask the phone for anything better than its fused fix (3 to 5 m at best).

A single fix is the wrong thing to chase. Fixes taken on different days have independent errors, so the position of a grave gets better every time someone photographs it or navigates to it and confirms they found it. Nothing feeds that today: `reconcileMultiObservations` exists in `src/lib/geospatial/index.ts` but no observation is ever stored.

Navigation ends with an "arrived" radar circle. It does not show where the grave is on the camera, and it does not warn that the pin can be a few metres out.

## Decisions

| Topic | Decision |
|---|---|
| Guidance while GPS settles | "Hold the phone still while GPS settles. 14 m now, needs 10 m." with a lock icon on the shutter |
| Fix used for capture | Best fix from the last 10 s, position averaged while the phone is still, accuracy reported as the best single accuracy seen |
| Capture anyway | Offered after 15 s stuck with accuracy between 10 m and 25 m. Above 25 m there is no button |
| Database accuracy limit | `save_or_add_grave` accepts up to 25 m. Status and confidence thresholds do not change |
| Whole-grave photo | Single mode only, only after a capture-anyway shot, skippable. Stored as a `grave_photos` row with `kind = 'grave'` |
| Survey mode | Gets capture anyway. Does not get the whole-grave photo (the queue stores one photo per capture) |
| Observation sources | Every photo with a capture position, and "I found it" from navigation and AR |
| Who can confirm a visit | Signed-in users only |
| Visit sanity check | Accuracy 25 m or better and within 30 m of the grave's current position |
| Same-visit dedupe | One observation per user per grave per 6 hours, keeping the more accurate one |
| Position recompute | Inverse-variance mean, floor 1.5 m, in the database, on every new observation |
| VERIFIED graves | Collect observations and the count, but position, accuracy, confidence and status do not change |
| AR placement | Compass heading, phone pitch, GPS distance and an assumed camera field of view. No WebXR |
| Field of view | 65 degrees horizontal, a constant to tune on a real phone |
| AR settling | Exponential smoothing on heading, pitch and distance, heavier within 5 m |
| Off-screen grave | Arrow at the screen edge |
| Accuracy shown in AR | A ground ring sized to the grave's accuracy, plus the caption "± 4 m. Not the right name? Look around this spot." |

## 1. Capture screen

### Fix smoother

New pure module `src/lib/capture/gpsFixes.ts`:

- `TimedFix = { lat, lng, accuracy, at }` where `at` is epoch milliseconds.
- `smoothFixes(fixes: TimedFix[], now: number): PositionFix | null`:
  1. Drop fixes older than `FIX_WINDOW_MS = 10_000`.
  2. `best` is the fix with the smallest accuracy (latest wins a tie).
  3. `still` is every remaining fix within `STILL_RADIUS_M = 3` of `best`.
  4. Position is the inverse-variance mean of `still` (variance floor 0.25 m²).
  5. Accuracy is `best.accuracy`, never a smaller number.
  6. Returns `null` when nothing is left.
- `MAX_FIX_AGE_MS` is exported so the screen can prune its buffer.

`CaptureScreen` keeps a buffer of fixes from `watchPosition` (unusable fixes still dropped by `isUsableGpsFix`), prunes it on each reading, and derives `fix` with `smoothFixes`. `ARGuidanceScreen` uses the same smoother (section 4).

### Readiness

`getCaptureReadiness` in `src/lib/capture/readiness.ts` gains an input `lowAccuracyAllowed: boolean` and two outputs `canCaptureAnyway: boolean` and `lowAccuracy: boolean`. New constant `MAX_LOW_ACCURACY_CAPTURE_M = 25`.

| Accuracy | `lowAccuracyAllowed` | Result |
|---|---|---|
| 10 m or better | any | ready, `lowAccuracy: false` |
| 10 to 25 m | false | blocker `gps-accuracy`, message "Hold the phone still while GPS settles. 14 m now, needs 10 m.", `canCaptureAnyway: true` |
| 10 to 25 m | true | ready, `lowAccuracy: true`, message "Low accuracy. This grave will be marked for re-survey." |
| worse than 25 m | any | blocker `gps-accuracy`, same "Hold the phone still" message, `canCaptureAnyway: false` |

Camera, GPS-missing and compass blockers keep their order and wording. The compass blockers still apply when `lowAccuracyAllowed` is true.

### Screen behaviour

- The guidance pill shows the readiness message. While the blocker is `gps-accuracy` the shutter carries a small lock icon in its centre.
- A timer starts when the blocker becomes `gps-accuracy` and resets when it changes. After `CAPTURE_ANYWAY_AFTER_MS = 15_000`, and while `canCaptureAnyway` is true, a text button "Capture anyway" appears under the pill.
- Tapping it sets `lowAccuracyAllowed` for the rest of this camera session. The shutter ring turns amber and the pill shows the low-accuracy message. It applies in survey mode too.
- Telemetry is unchanged: `gpsAccuracy` carries the real accuracy.

### Whole-grave photo step

Single mode only. After a shot taken with `lowAccuracy` true, the screen does not call `onCaptureComplete` yet. It keeps the stone photo and telemetry and switches to a second step:

- Title "Photograph the whole grave", guidance "Step back so the whole grave is in the frame. It helps visitors find the spot."
- A wider, landscape reticle. No accuracy gate and no compass gate: the shutter is enabled while the camera is live.
- A "Skip" button in place of the back button.
- The shutter calls `onCaptureComplete(stonePhoto, telemetry, gravePhoto)`; Skip calls `onCaptureComplete(stonePhoto, telemetry)`.

`onCaptureComplete` gains an optional third argument `gravePhotoDataUrl?: string`.

### Database

The migration in section 3 recreates `save_or_add_grave` with the accuracy check raised to 25 m ("GPS accuracy must be 25 m or better."). Everything else in the function stays as it is.

## 2. Whole-grave photo storage and display

### Database

- `grave_photos.kind text not null default 'stone' check (kind in ('stone', 'grave'))`.
- `graves.grave_photo_url text` (nullable). `sync_grave_photo_summary` also sets it to the public URL of the oldest `kind = 'grave'` photo, or null, and the trigger also fires on update of `kind`.

### Client

- `GravePhoto.kind: 'stone' | 'grave'` (mapper defaults to `'stone'`).
- `Grave.gravePhotoUrl?: string` from `grave_photo_url`.
- `dataStore.addGravePhoto(grave, imageDataUrl, telemetry, kind = 'stone')` writes `kind`.
- `SaveMappedGraveInput.gravePhotoDataUrl?: string`. After `saveMappedGrave` returns `created` or `added-photo`, `dataStore.saveNewGrave` uploads the whole-grave photo with `addGravePhoto(..., 'grave')` against the saved grave. A failure there is swallowed: the grave is already saved and the photo is a bonus. The result gains `gravePhotoSaved: boolean` so the details screen can say "The whole-grave photo couldn't be saved" once.
- `page.tsx` keeps `capturedGravePhoto` next to `capturedImage`, clears it when a new capture starts, and passes it to `ConfirmDetailsScreen`, which passes it into `saveNewGrave`.
- Display: the photo carousel on grave details lists it like any other photo. Navigation's arrival panel and the AR screen (section 4) show it as a thumbnail with the label "Look for this grave" when `gravePhotoUrl` is set.

## 3. Position observations

### Migration

New file `supabase/migrations/20260915200000_position_observations.sql`, safe to run more than once. It contains, in order: the `grave_photos.kind` and `graves.grave_photo_url` columns and the updated `sync_grave_photo_summary` (section 2), the observation table and functions below, the recreated `save_or_add_grave` (section 1), and the backfill.

### Table `public.grave_position_observations`

| Column | Type |
|---|---|
| `id` | uuid primary key default `gen_random_uuid()` |
| `grave_id` | text not null references `graves (id)` on delete cascade |
| `observed_by` | uuid references `auth.users (id)` on delete set null |
| `latitude`, `longitude` | double precision not null |
| `accuracy_meters` | double precision not null, check `> 0 and <= 25` |
| `source` | text not null, check in (`'photo'`, `'visit'`) |
| `observed_at` | timestamptz not null default `now()` |
| `created_at` | timestamptz not null default `now()` |

Indexes on `(grave_id, observed_at)` and `(observed_by)`. Row level security on, public SELECT, no INSERT, UPDATE or DELETE policies: writes go through the functions below.

`graves.observation_count int not null default 0`, maintained by the recompute.

### Function `public.add_grave_position_observation`

Internal. `security definer`, `set search_path = ''`, execute revoked from public, anon and authenticated. Parameters: grave id, user id, latitude, longitude, accuracy, source, observed at.

1. Returns without writing when accuracy is null, not positive or above 25, or when latitude and longitude are out of range or 0,0.
2. Same-visit dedupe: if the same user already has an observation for this grave within 6 hours of `observed_at`, update that row only when the new accuracy is better (position, accuracy, observed at). Otherwise return.
3. Otherwise insert.
4. Call `recompute_grave_position(grave id)`.

### Function `public.recompute_grave_position(p_grave_id text)`

Internal, same locking as above.

- Weighted mean over the grave's observations with weight `1 / greatest(0.25, accuracy²)`. Combined accuracy `greatest(1.5, sqrt(1 / sum of weights))`, rounded to 2 decimals.
- Confidence `HIGH` at 3.5 m or better, `MEDIUM` at 6 m, otherwise `LOW`. Status `MAPPED` at 5 m or better, otherwise `LOW_CONFIDENCE`. Same thresholds as `save_or_add_grave`.
- Updates `observation_count` always. Updates latitude, longitude, accuracy, confidence and `updated_at` unless status is `VERIFIED`. Updates status only when the current status is `MAPPED` or `LOW_CONFIDENCE`.
- No observations: sets `observation_count = 0` and leaves everything else.

### Trigger on `grave_photos`

`grave_photos_record_observation`, after insert, for each row: when `capture_latitude`, `capture_longitude` and `gps_accuracy_meters` are all set, call `add_grave_position_observation(new.grave_id, new.uploaded_by, ..., 'photo', coalesce(new.captured_at, now()))`. This covers a new grave, a photo added to a match, a survey match and the whole-grave photo. The whole-grave photo dedupes against the stone photo from the same visit.

### Function `public.record_grave_visit`

Callable by `authenticated` only, `security definer`, `set search_path = ''`. Parameters: `p_grave_id text, p_latitude, p_longitude, p_accuracy_meters double precision`.

- Raises `42501` when not signed in, `P0002` when the grave does not exist, `22023` when accuracy is null, not positive or above 25, when the position is out of range, or when the haversine distance from the grave's current position is more than 30 m ("You're too far from this grave to confirm it.").
- Calls `add_grave_position_observation(..., 'visit', now())`.
- Returns `jsonb` with `latitude`, `longitude`, `position_accuracy_meters`, `position_confidence`, `status`, `observation_count` read back from the grave.

### Backfill

Loop over existing `grave_photos` rows with a capture position, oldest first, calling `add_grave_position_observation` with `'photo'`. The function's dedupe and recompute make this safe to run more than once: a second run updates nothing because the observation already exists with the same accuracy, and recompute is idempotent.

### Client

- `Grave.observationCount: number` from `observation_count` (default 0).
- `dataStore.recordGraveVisit(graveId, fix: { lat, lng, accuracy })` calls the RPC, maps the result onto the cached grave (IndexedDB and in-memory list) and returns the updated `Grave`. Errors map through `mapSaveGraveError` so offline, signed-out, not-set-up and the function's own `22023` messages read well. Pure helper `applyVisitResult(grave, data)` in `src/lib/graves/visits.ts` for the mapping.
- `page.tsx` passes `onConfirmVisit` to `NavigationScreen` and `ARGuidanceScreen` only when a user is signed in. The handler calls `recordGraveVisit`, updates `selectedGrave` and the graves list, and returns the updated grave.
- Navigation arrival panel (`isAtGrave`): an "I found it" button under the arrival line. While saving it reads "Saving…". On success the panel shows "Thanks. Position now ± 3.2 m from 4 visits." and the button goes away for the rest of the session. On error the message shows under the button and the button stays. When `gravePhotoUrl` is set, the panel shows the thumbnail with "Look for this grave".
- AR arrived state (distance 5 m or less): the same button and messages in the bottom card.
- Grave details accuracy row: "± 3.2 m (High Confidence)" becomes "± 3.2 m, High confidence, 4 visits" when `observationCount > 1`. The confidence label also handles `LOW` ("Low confidence") instead of showing "Medium" for it.

## 4. AR marker

### Sensors

- `OrientationReading` in `src/lib/device/compass.ts` gains `beta?: number | null`. New pure `readDevicePitch(reading): number | null` returns the camera's pitch in degrees above horizontal for a phone held upright in portrait: `beta - 90`, clamped to -90..90, null when `beta` is missing.
- `useCompassHeading()` returns `{ heading, pitch, status }`. Pitch comes from the same orientation events. Existing callers ignore it.

### Projection

New pure module `src/lib/ar/markerProjection.ts`:

```
projectGroundTarget({
  bearingDiffDeg,      // target bearing minus heading, -180..180
  pitchDeg,            // camera pitch, positive up
  distanceM,
  viewportWidth, viewportHeight,
  hFovDeg = AR_CAMERA_HFOV_DEG (65),
  eyeHeightM = 1.5,
}): { x, y, scale, onScreen, edgeAngleDeg, pxPerMeter }
```

- Vertical field of view from the horizontal one and the aspect ratio.
- `x = w/2 + tan(diff) / tan(hFov/2) * w/2`.
- The target is on the ground, `atan(eyeHeight / max(distance, 0.5))` below the horizon. `y = h/2 + tan(pitch + depression) / tan(vFov/2) * h/2`.
- `onScreen` is false when `|diff| > hFov/2` or the vertical angle leaves the view. `edgeAngleDeg` is the direction of the target from the screen centre, for the edge arrow.
- `scale = clamp(8 / max(distance, 1), 0.5, 1.6)`.
- `pxPerMeter = (w/2) / (tan(hFov/2) * max(distance, 0.5))`, used to size the accuracy ring.

New pure `smoothAngle(prev, next, alpha)` and `smoothValue(prev, next, alpha)` in `src/lib/ar/smoothing.ts`. `smoothAngle` takes the short way round the circle.

### Screen

`ARGuidanceScreen`:

- Runs its own `watchPosition` through `smoothFixes`, because `NavigationScreen` unmounts while AR is open and its watch stops. `userLocation` from the page remains the starting point until the first fix.
- Smoothing alpha 0.25 for heading and pitch, 0.3 for distance and bearing, and 0.1 for all of them within 5 m.
- The marker: a map pin (`MapPin`, lucide) with a gentle CSS bounce, positioned at the projected point, scaled by `scale`. Under it a translucent ellipse `2 * accuracy * pxPerMeter` wide and 35% as tall, clamped to the viewport.
- Caption under the marker: "± 4 m. Not the right name? Look around this spot." when the distance is 12 m or less, otherwise "Head toward the marker".
- When `onScreen` is false, an arrow at the screen edge points along `edgeAngleDeg`, and the guidance text keeps the existing Turn Left / Turn Right wording.
- When `gravePhotoUrl` is set, the bottom card shows that photo instead of the stone thumbnail, labelled "Look for this grave". The stone photo moves to a smaller inset.
- The arrived radar circle goes. AR counts as arrived at 5 m or less (it was 3 m), and the chevron ground path stays until then.
- "I found it" button and messages as in section 3, shown when the distance is 5 m or less and `onConfirmVisit` is provided.

## 5. Testing

- `tests/gps_fixes.test.ts`: window pruning, best fix, stillness radius, averaging, accuracy never below the best single fix.
- `tests/capture_readiness.test.ts`: the four accuracy rows above, compass still required in low-accuracy mode.
- `tests/marker_projection.test.ts`: centre of view, left and right of view, above and below the horizon, off-screen, scale bounds, `smoothAngle` across 359/1.
- `tests/compass.test.ts`: pitch reading.
- `tests/position_observations_migration.test.ts`: migration text, in the style of the other migration tests.
- `tests/grave_visits.test.ts`: `applyVisitResult` and the mapper changes (`kind`, `gravePhotoUrl`, `observationCount`).
- `tests/save_mapped_grave.test.ts`: the whole-grave photo is uploaded after a successful save and a failure there does not fail the save.
- Migrations run by hand in the Supabase SQL Editor. The camera, capture-anyway, AR marker and "I found it" flows need a walk with a phone.
