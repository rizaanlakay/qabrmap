# Save a New Grave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user photographs a grave with the live camera (GPS within 10 m plus a true-north heading), fills in the person's details, and the grave, person and photo are saved to Supabase in one step, with clear errors instead of silent failures.

**Architecture:** A new migration adds `created_by`, `persons.nickname`, a partial unique index and a security-definer function `create_mapped_grave` that is the only way to insert graves and persons. The browser uploads the photo to storage, then calls that function through `supabase.rpc`. Save logic lives in a small dependency-injected module (`saveMappedGrave`) so it can be unit tested without Supabase; the screens only gather input and show results.

**Tech Stack:** Next.js 14 App Router (client components), React 18, TypeScript, Supabase (Postgres, PostgREST, Storage, supabase-js v2), Dexie, Vitest 2.

**Spec:** `docs/superpowers/specs/2026-09-15-save-new-grave-design.md`

## Global Constraints

- Never use em dashes in code comments, UI copy, commit messages or docs. Use commas, colons, periods or parentheses.
- Runtime imports inside `src/lib/**` use relative paths (`../geospatial`), because Vitest has no `@/` alias. Type-only imports may use `@/types`. Components may use `@/`.
- Match the surrounding code: short comments that explain why, 2-space indent, single quotes, Tailwind classes in the existing style.
- GPS accuracy limit for the shutter and the database: 10 m. `MAPPED` at 5 m or better, otherwise `LOW_CONFIDENCE`. Position confidence `HIGH` at 3.5 m or better, `MEDIUM` at 6 m or better, otherwise `LOW`.
- First name and surname are required. Middle names, nickname, grave number, birth date and death date are optional. A blank grave number is stored as `''`.
- Photos come only from the live camera. There is no upload path.
- Do NOT stage or commit `src/components/screens/ARGuidanceScreen.tsx`, `src/lib/supabase/client.ts`, `src/app/auth/callback/route.ts` or `src/app/auth/callback/page.tsx` unless the task says so. They hold the user's own uncommitted work. Always `git add` explicit paths, never `git add -A` or `git add .`.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
- Run one test file: `npx vitest run tests/<file>.test.ts`. Run all tests: `npx vitest run`. Type check: `npx tsc --noEmit`. Baseline before this plan: 24 files, 126 tests passing, type check clean.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/20260915120000_create_mapped_grave.sql` | Create | Columns, index, `create_mapped_grave`, storage delete policy |
| `tests/create_mapped_grave_migration.test.ts` | Create | Checks the migration text |
| `src/types/index.ts` | Modify | `Person.nickname` |
| `src/lib/supabase/mappers.ts` | Modify | Map `nickname` |
| `src/lib/offline/sync.ts` | Modify | Nickname in offline search |
| `tests/nickname.test.ts` | Create | Mapper and offline search tests |
| `src/lib/ui/graveLabels.ts` | Create | `graveNumberLabel` |
| `src/lib/ui/escapeHtml.ts` | Create | Escape text placed in `innerHTML` |
| `tests/grave_labels.test.ts` | Create | Tests for both helpers |
| `src/lib/device/compass.ts` | Create | `readCompassHeading`, `CompassStatus` |
| `src/lib/device/useCompassHeading.ts` | Create | React hook for heading and iOS permission |
| `tests/compass.test.ts` | Create | Heading reading tests |
| `src/lib/capture/readiness.ts` | Create | `getCaptureReadiness` |
| `tests/capture_readiness.test.ts` | Create | Shutter readiness tests |
| `src/lib/capture/cemeteryForLocation.ts` | Create | `findCemeteryForLocation` |
| `src/lib/capture/newGrave.ts` | Create | `NewGraveForm`, `validateNewGraveForm` |
| `tests/new_grave_form.test.ts` | Create | Cemetery lookup and form validation tests |
| `src/lib/supabase/saveGraveErrors.ts` | Create | `SaveGraveError`, messages, `mapSaveGraveError` |
| `src/lib/capture/saveMappedGrave.ts` | Create | Upload photo, call RPC, clean up on failure |
| `tests/save_mapped_grave.test.ts` | Create | Error mapping and save orchestration tests |
| `src/lib/data/store.ts` | Modify | New `saveNewGrave`, cemetery names on graves, nickname search |
| `src/components/screens/CaptureScreen.tsx` | Modify | No upload, compass hook, readiness |
| `src/components/screens/AIProcessingScreen.tsx` | Modify | Error state with Retake and manual entry |
| `src/components/screens/ConfirmDetailsScreen.tsx` | Modify | Cemetery picker, new fields, save and errors |
| `src/components/screens/GraveDetailsScreen.tsx` | Modify | "Known as", number labels |
| `src/components/screens/NavigationScreen.tsx` | Modify | Compass hook, escaped marker HTML, number labels |
| `src/components/screens/AddPhotoConfirmScreen.tsx`, `CemeteryMapScreen.tsx`, `MyCemeteriesScreen.tsx`, `SearchScreen.tsx`, `src/components/admin/AdminDashboard.tsx` | Modify | Number labels, nickname filter |
| `src/app/page.tsx` | Modify | Sign-in gate, save handoff, no sample capture defaults |
| `src/components/screens/ARGuidanceScreen.tsx` | Modify (Task 9, gated) | Compass hook, number label |

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260915120000_create_mapped_grave.sql`
- Test: `tests/create_mapped_grave_migration.test.ts`

**Interfaces:**
- Produces: Postgres function `public.create_mapped_grave(p_grave_id text, p_person_id text, p_cemetery_id text, p_grave_number text, p_first_name text, p_middle_names text, p_surname text, p_nickname text, p_birth_date date, p_death_date date, p_latitude double precision, p_longitude double precision, p_accuracy_meters double precision, p_heading_degrees double precision, p_captured_at timestamptz, p_photo_public_url text, p_photo_storage_path text) returns text`. Raises `42501` when not signed in, `22023` for invalid input. Column `persons.nickname text`.

- [ ] **Step 1: Write the failing test**

Create `tests/create_mapped_grave_migration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20260915120000_create_mapped_grave.sql'),
  'utf8'
);

describe('Create Mapped Grave Migration Tests', () => {
  it('adds nickname and records who created each grave and person', () => {
    expect(MIGRATION).toMatch(/alter table public\.persons add column if not exists nickname text;/);
    expect(MIGRATION).toMatch(/alter table public\.persons add column if not exists created_by uuid/);
    expect(MIGRATION).toMatch(/alter table public\.graves add column if not exists created_by uuid/);
    expect(MIGRATION).toMatch(/create index if not exists persons_created_by_idx on public\.persons \(created_by\);/);
    expect(MIGRATION).toMatch(/create index if not exists graves_created_by_idx on public\.graves \(created_by\);/);
  });

  it('keeps direct writes to graves and persons closed so the function is the only way in', () => {
    expect(MIGRATION).not.toMatch(/on public\.(graves|persons)\s+for\s+(insert|update|delete|all)/i);
  });

  it('only checks graves that have a number for duplicates', () => {
    expect(MIGRATION).toMatch(
      /create unique index if not exists graves_cemetery_grave_number_unique_idx\s+on public\.graves \(cemetery_id, grave_number\)\s+where grave_number <> '';/
    );
  });

  it('runs create_mapped_grave as a locked-down security definer that checks the caller', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.create_mapped_grave\(/);
    expect(MIGRATION).toMatch(/security definer\s+set search_path = ''/);
    expect(MIGRATION).toMatch(/v_caller uuid := \(select auth\.uid\(\)\);/);
    expect(MIGRATION).toMatch(/if v_caller is null then\s+raise exception '[^']+' using errcode = '42501';/);
    expect(MIGRATION).toMatch(/revoke execute on function public\.create_mapped_grave\([^)]*\) from public, anon;/);
    expect(MIGRATION).toMatch(/grant execute on function public\.create_mapped_grave\([^)]*\) to authenticated;/);
  });

  it('validates required names, GPS accuracy and heading in the database', () => {
    expect(MIGRATION).toMatch(/if v_first_name is null or v_surname is null then/);
    expect(MIGRATION).toMatch(/p_accuracy_meters > 10/);
    expect(MIGRATION).toMatch(/p_heading_degrees > 360/);
  });

  it('sets status and position confidence from GPS accuracy instead of trusting the client', () => {
    expect(MIGRATION).toMatch(/when p_accuracy_meters <= 5 then 'MAPPED' else 'LOW_CONFIDENCE'/);
    expect(MIGRATION).toMatch(/when p_accuracy_meters <= 3\.5 then 'HIGH'\s+when p_accuracy_meters <= 6 then 'MEDIUM'\s+else 'LOW'/);
  });

  it('saves the first photo as the primary grave photo', () => {
    expect(MIGRATION).toMatch(/insert into public\.grave_photos \([^)]*is_primary[^)]*\)/);
  });

  it('lets signed-in users delete only their own photo files', () => {
    expect(MIGRATION).toMatch(/on storage\.objects for delete\s+to authenticated\s+using \(bucket_id = 'grave-photos' and owner_id = \(select auth\.uid\(\)::text\)\);/);
  });

  it('calls auth.uid() once per statement, wrapped in a select', () => {
    const withoutWrapped = MIGRATION.replace(/\(select auth\.uid\(\)(::text)?\)/g, '').replace(/default auth\.uid\(\)/g, '');
    expect(withoutWrapped).not.toMatch(/auth\.uid\(\)/);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run tests/create_mapped_grave_migration.test.ts`
Expected: FAIL with `ENOENT: no such file or directory` for the migration file.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260915120000_create_mapped_grave.sql`:

```sql
-- ============================================================
-- QabrMap: save a new grave from Capture
-- Run in Supabase Dashboard > SQL Editor > New query. Safe to run more than once.
-- ============================================================

alter table public.persons add column if not exists nickname text;
alter table public.persons add column if not exists created_by uuid default auth.uid() references auth.users (id) on delete set null;
alter table public.graves add column if not exists created_by uuid default auth.uid() references auth.users (id) on delete set null;

-- Used by ON DELETE SET NULL when an account is removed, and to list what a user has mapped
create index if not exists persons_created_by_idx on public.persons (created_by);
create index if not exists graves_created_by_idx on public.graves (created_by);

-- A number can't be mapped twice in one cemetery. Stones without a visible number are stored as ''.
create unique index if not exists graves_cemetery_grave_number_unique_idx
  on public.graves (cemetery_id, grave_number)
  where grave_number <> '';

-- The only way to add a grave. graves and persons have no insert policies, so a client can't skip these checks
-- or give its own grave a better status. Runs as the owner, so it checks the caller itself.
create or replace function public.create_mapped_grave(
  p_grave_id text,
  p_person_id text,
  p_cemetery_id text,
  p_grave_number text,
  p_first_name text,
  p_middle_names text,
  p_surname text,
  p_nickname text,
  p_birth_date date,
  p_death_date date,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_heading_degrees double precision,
  p_captured_at timestamptz,
  p_photo_public_url text,
  p_photo_storage_path text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_first_name text := nullif(btrim(p_first_name), '');
  v_middle_names text := nullif(btrim(p_middle_names), '');
  v_surname text := nullif(btrim(p_surname), '');
  v_nickname text := nullif(btrim(p_nickname), '');
  v_grave_number text := coalesce(btrim(p_grave_number), '');
begin
  if v_caller is null then
    raise exception 'Sign in to map a grave.' using errcode = '42501';
  end if;

  if v_first_name is null or v_surname is null then
    raise exception 'First name and surname are required.' using errcode = '22023';
  end if;

  if p_accuracy_meters is null or p_accuracy_meters < 0 or p_accuracy_meters > 10 then
    raise exception 'GPS accuracy must be 10 m or better.' using errcode = '22023';
  end if;

  if p_heading_degrees is null or p_heading_degrees < 0 or p_heading_degrees > 360 then
    raise exception 'A compass heading is required.' using errcode = '22023';
  end if;

  if p_latitude is null or p_longitude is null
    or p_latitude < -90 or p_latitude > 90
    or p_longitude < -180 or p_longitude > 180
    or (p_latitude = 0 and p_longitude = 0) then
    raise exception 'The GPS position is not valid.' using errcode = '22023';
  end if;

  if nullif(btrim(p_photo_public_url), '') is null then
    raise exception 'A photo is required.' using errcode = '22023';
  end if;

  insert into public.persons (id, first_name, middle_names, surname, full_name, nickname, birth_date, death_date, created_by)
  values (
    p_person_id,
    v_first_name,
    v_middle_names,
    v_surname,
    concat_ws(' ', v_first_name, v_middle_names, v_surname),
    v_nickname,
    p_birth_date,
    p_death_date,
    v_caller
  );

  insert into public.graves (
    id, cemetery_id, person_id, grave_number, latitude, longitude,
    position_accuracy_meters, position_confidence, orientation_degrees, status, photo_count, created_by
  )
  values (
    p_grave_id,
    p_cemetery_id,
    p_person_id,
    v_grave_number,
    p_latitude,
    p_longitude,
    round(p_accuracy_meters::numeric, 2),
    case
      when p_accuracy_meters <= 3.5 then 'HIGH'
      when p_accuracy_meters <= 6 then 'MEDIUM'
      else 'LOW'
    end,
    round(p_heading_degrees::numeric, 2),
    case when p_accuracy_meters <= 5 then 'MAPPED' else 'LOW_CONFIDENCE' end,
    0,
    v_caller
  );

  -- The grave_photos trigger fills in graves.primary_photo_url and photo_count
  insert into public.grave_photos (
    grave_id, storage_path, public_url, uploaded_by, is_primary,
    captured_at, capture_latitude, capture_longitude, gps_accuracy_meters, heading_degrees
  )
  values (
    p_grave_id,
    nullif(p_photo_storage_path, ''),
    p_photo_public_url,
    v_caller,
    true,
    p_captured_at,
    p_latitude,
    p_longitude,
    p_accuracy_meters,
    p_heading_degrees
  );

  return p_grave_id;
end;
$$;

revoke execute on function public.create_mapped_grave(text, text, text, text, text, text, text, text, date, date, double precision, double precision, double precision, double precision, timestamptz, text, text) from public, anon;
grant execute on function public.create_mapped_grave(text, text, text, text, text, text, text, text, date, date, double precision, double precision, double precision, double precision, timestamptz, text, text) to authenticated;

-- A failed save removes the photo it just uploaded, which needs delete permission on the user's own files
drop policy if exists "Users can delete their own grave photo files" on storage.objects;
create policy "Users can delete their own grave photo files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'grave-photos' and owner_id = (select auth.uid()::text));
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/create_mapped_grave_migration.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260915120000_create_mapped_grave.sql tests/create_mapped_grave_migration.test.ts
git commit -F - <<'EOF'
feat(db): add create_mapped_grave as the only way to save a grave

Adds persons.nickname, created_by on graves and persons, a unique grave
number per cemetery for numbered graves, and a storage delete policy so a
failed save can remove its own photo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: Nickname on people

**Files:**
- Modify: `src/types/index.ts` (interface `Person`)
- Modify: `src/lib/supabase/mappers.ts` (`mapDbPerson`, `personToDb`)
- Modify: `src/lib/offline/sync.ts` (`searchOfflineGraves`)
- Modify: `src/lib/data/store.ts` (`searchGraves`)
- Modify: `src/components/screens/MyCemeteriesScreen.tsx` (filter near line 72)
- Modify: `src/components/screens/GraveDetailsScreen.tsx` (name header near line 195)
- Test: `tests/nickname.test.ts`

**Interfaces:**
- Produces: `Person.nickname?: string`.

- [ ] **Step 1: Write the failing test**

Create `tests/nickname.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import type { Grave } from '../src/types';
import { mapDbPerson, personToDb } from '../src/lib/supabase/mappers';
import { SyncManager } from '../src/lib/offline/sync';
import { offlineDb } from '../src/lib/offline/db';

function graveWithPerson(id: string, firstName: string, surname: string, nickname?: string): Grave {
  return {
    id,
    cemeteryId: 'cem_nickname_test',
    graveNumber: '',
    latitude: -33.9675,
    longitude: 18.5033,
    positionAccuracyMeters: 4,
    positionConfidence: 'MEDIUM',
    status: 'MAPPED',
    photoCount: 1,
    person: { id: `person_${id}`, firstName, surname, fullName: `${firstName} ${surname}`, nickname },
    createdAt: '2026-09-15T10:00:00Z',
    updatedAt: '2026-09-15T10:00:00Z',
  };
}

describe('Nickname Tests', () => {
  it('maps a nickname to and from the persons table', () => {
    const person = mapDbPerson({ id: 'p1', first_name: 'Abdul', surname: 'Narker', full_name: 'Abdul Narker', nickname: 'Boeta Dul' });
    expect(person.nickname).toBe('Boeta Dul');
    expect(personToDb(person).nickname).toBe('Boeta Dul');
  });

  it('treats a missing nickname as empty', () => {
    const person = mapDbPerson({ id: 'p2', first_name: 'Fatima', surname: 'Davids', full_name: 'Fatima Davids', nickname: null });
    expect(person.nickname).toBeUndefined();
    expect(personToDb(person).nickname).toBeNull();
  });

  it('finds graves by nickname when searching offline', async () => {
    await offlineDb.graves.bulkPut([
      graveWithPerson('grave_nick_1', 'Abdul', 'Narker', 'Boeta Dul'),
      graveWithPerson('grave_nick_2', 'Fatima', 'Davids'),
    ]);
    const results = await new SyncManager().searchOfflineGraves('boeta', 'cem_nickname_test');
    expect(results.map((g) => g.id)).toEqual(['grave_nick_1']);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run tests/nickname.test.ts`
Expected: FAIL. `person.nickname` is `undefined` in the first test and the search returns `[]`.

- [ ] **Step 3: Add the field and mappings**

In `src/types/index.ts`, inside `interface Person`, after `fullName: string;` add:

```ts
  nickname?: string;
```

In `src/lib/supabase/mappers.ts`, in `mapDbPerson` after `fullName: row.full_name,` add:

```ts
    nickname: row.nickname || undefined,
```

and in `personToDb` after `full_name: person.fullName,` add:

```ts
    nickname: person.nickname || null,
```

- [ ] **Step 4: Add nickname to the offline search**

In `src/lib/offline/sync.ts`, replace the filter body in `searchOfflineGraves`:

```ts
      .filter((grave) => {
        const numMatch = grave.graveNumber.toLowerCase().includes(q);
        const nameMatch = grave.person?.fullName.toLowerCase().includes(q) ?? false;
        const surnameMatch = grave.person?.surname.toLowerCase().includes(q) ?? false;
        return numMatch || nameMatch || surnameMatch;
      })
```

with:

```ts
      .filter((grave) => {
        const numMatch = grave.graveNumber.toLowerCase().includes(q);
        const nameMatch = grave.person?.fullName.toLowerCase().includes(q) ?? false;
        const surnameMatch = grave.person?.surname.toLowerCase().includes(q) ?? false;
        const nicknameMatch = grave.person?.nickname?.toLowerCase().includes(q) ?? false;
        return numMatch || nameMatch || surnameMatch || nicknameMatch;
      })
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run tests/nickname.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Add nickname to the online search, My Cemeteries filter and grave details**

In `src/lib/data/store.ts`, in `searchGraves`, replace the saved-filter block:

```ts
      return saved.filter((g) => {
        const numMatch = g.graveNumber.toLowerCase().includes(q);
        const fullNameMatch = g.person?.fullName.toLowerCase().includes(q) ?? false;
        return numMatch || fullNameMatch;
      });
```

with:

```ts
      return saved.filter((g) => {
        const numMatch = g.graveNumber.toLowerCase().includes(q);
        const fullNameMatch = g.person?.fullName.toLowerCase().includes(q) ?? false;
        const nicknameMatch = g.person?.nickname?.toLowerCase().includes(q) ?? false;
        return numMatch || fullNameMatch || nicknameMatch;
      });
```

and replace the final filter:

```ts
    return all.filter((g) => {
      const numMatch = g.graveNumber.toLowerCase().includes(q);
      const fullNameMatch = g.person?.fullName.toLowerCase().includes(q) ?? false;
      const firstNameMatch = g.person?.firstName.toLowerCase().includes(q) ?? false;
      const surnameMatch = g.person?.surname.toLowerCase().includes(q) ?? false;

      if (filterType === 'names') {
        return fullNameMatch || firstNameMatch || surnameMatch;
      }
      if (filterType === 'numbers') {
        return numMatch;
      }
      return numMatch || fullNameMatch || firstNameMatch || surnameMatch;
    });
```

with:

```ts
    return all.filter((g) => {
      const numMatch = g.graveNumber.toLowerCase().includes(q);
      const fullNameMatch = g.person?.fullName.toLowerCase().includes(q) ?? false;
      const firstNameMatch = g.person?.firstName.toLowerCase().includes(q) ?? false;
      const surnameMatch = g.person?.surname.toLowerCase().includes(q) ?? false;
      // Families often only know someone by their nickname
      const nicknameMatch = g.person?.nickname?.toLowerCase().includes(q) ?? false;

      if (filterType === 'names') {
        return fullNameMatch || firstNameMatch || surnameMatch || nicknameMatch;
      }
      if (filterType === 'numbers') {
        return numMatch;
      }
      return numMatch || fullNameMatch || firstNameMatch || surnameMatch || nicknameMatch;
    });
```

In `src/components/screens/MyCemeteriesScreen.tsx`, replace:

```ts
    const numMatch = entry.grave.graveNumber?.toLowerCase().includes(q) ?? false;
    return nameMatch || surnameMatch || relMatch || cemMatch || numMatch;
```

with:

```ts
    const numMatch = entry.grave.graveNumber?.toLowerCase().includes(q) ?? false;
    const nicknameMatch = entry.grave.person?.nickname?.toLowerCase().includes(q) ?? false;
    return nameMatch || surnameMatch || relMatch || cemMatch || numMatch || nicknameMatch;
```

In `src/components/screens/GraveDetailsScreen.tsx`, replace:

```tsx
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            {grave.person?.fullName || `Grave ${grave.graveNumber}`}
          </h1>
```

with:

```tsx
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            {grave.person?.fullName || `Grave ${grave.graveNumber}`}
          </h1>
          {grave.person?.nickname && (
            <p className="text-xs text-slate-600 font-semibold mt-0.5">Known as {grave.person.nickname}</p>
          )}
```

- [ ] **Step 7: Type check and run all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/types/index.ts src/lib/supabase/mappers.ts src/lib/offline/sync.ts src/lib/data/store.ts src/components/screens/MyCemeteriesScreen.tsx src/components/screens/GraveDetailsScreen.tsx tests/nickname.test.ts
git commit -F - <<'EOF'
feat(graves): add an optional nickname to people

Shows "Known as" on grave details and matches nicknames in online,
offline and My Cemeteries search.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: Grave number labels and safe marker HTML

**Files:**
- Create: `src/lib/ui/graveLabels.ts`
- Create: `src/lib/ui/escapeHtml.ts`
- Test: `tests/grave_labels.test.ts`
- Modify: `src/components/screens/AddPhotoConfirmScreen.tsx`, `src/components/screens/CemeteryMapScreen.tsx`, `src/components/screens/GraveDetailsScreen.tsx`, `src/components/screens/MyCemeteriesScreen.tsx`, `src/components/screens/NavigationScreen.tsx`, `src/components/screens/SearchScreen.tsx`, `src/components/admin/AdminDashboard.tsx`

**Interfaces:**
- Produces: `graveNumberLabel(grave: Pick<Grave, 'graveNumber'>): string | null` and `escapeHtml(value: string | null | undefined): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/grave_labels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { graveNumberLabel } from '../src/lib/ui/graveLabels';
import { escapeHtml } from '../src/lib/ui/escapeHtml';

describe('Grave Label Tests', () => {
  it('labels a grave by its number', () => {
    expect(graveNumberLabel({ graveNumber: '1402' })).toBe('Grave 1402');
    expect(graveNumberLabel({ graveNumber: ' 1402 ' })).toBe('Grave 1402');
  });

  it('has no label for a stone without a visible number', () => {
    expect(graveNumberLabel({ graveNumber: '' })).toBeNull();
    expect(graveNumberLabel({ graveNumber: '   ' })).toBeNull();
  });

  it('escapes text typed by users before it goes into marker HTML', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(escapeHtml("Abdul 'Boeta' & Sons")).toBe('Abdul &#39;Boeta&#39; &amp; Sons');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(null)).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run tests/grave_labels.test.ts`
Expected: FAIL with `Failed to resolve import "../src/lib/ui/graveLabels"`.

- [ ] **Step 3: Write the helpers**

Create `src/lib/ui/graveLabels.ts`:

```ts
import type { Grave } from '@/types';

// "Grave 1402", or null when the stone had no visible number
export function graveNumberLabel(grave: Pick<Grave, 'graveNumber'>): string | null {
  const number = grave.graveNumber?.trim();
  return number ? `Grave ${number}` : null;
}
```

Create `src/lib/ui/escapeHtml.ts`:

```ts
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// Names and numbers are typed in by users, so they are escaped before being placed in a map marker's innerHTML
export function escapeHtml(value: string | null | undefined): string {
  return (value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/grave_labels.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Use the label in the screens**

Add `import { graveNumberLabel } from '@/lib/ui/graveLabels';` to each component below that uses it.

`src/components/screens/AddPhotoConfirmScreen.tsx`, replace:

```tsx
            {name} • Grave {grave.graveNumber}
```

with:

```tsx
            {[name, graveNumberLabel(grave)].filter(Boolean).join(' • ')}
```

`src/components/screens/CemeteryMapScreen.tsx`, replace:

```tsx
                  <span>{selectedGrave.graveNumber}</span>
```

with:

```tsx
                  {selectedGrave.graveNumber && <span>{selectedGrave.graveNumber}</span>}
```

(no import needed in this file)

`src/components/screens/GraveDetailsScreen.tsx`, three replacements:

```tsx
          text: `Grave ${grave.graveNumber} at ${grave.cemeteryName || 'Athlone Muslim Cemetery'}`,
```

becomes:

```tsx
          text: [graveNumberLabel(grave), grave.cemeteryName].filter(Boolean).join(' at '),
```

```tsx
              <span className="font-bold text-slate-900 text-sm">{grave.graveNumber}</span>
```

becomes:

```tsx
              <span className="font-bold text-slate-900 text-sm">{grave.graveNumber || 'Not recorded'}</span>
```

```tsx
            <h3 className="font-bold text-sm text-slate-900">Report Correction for Grave {grave.graveNumber}</h3>
```

becomes:

```tsx
            <h3 className="font-bold text-sm text-slate-900">
              Report Correction for {graveNumberLabel(grave) ?? grave.person?.fullName ?? 'this grave'}
            </h3>
```

`src/components/screens/MyCemeteriesScreen.tsx`, replace:

```tsx
                          Grave {grave.graveNumber} {grave.sectionName ? `• ${grave.sectionName}` : ''}
```

with:

```tsx
                          {[graveNumberLabel(grave), grave.sectionName].filter(Boolean).join(' • ')}
```

`src/components/screens/SearchScreen.tsx`, replace:

```tsx
                    <span className="font-semibold text-brand-dark">Grave {grave.graveNumber}</span>
                    <span className="mx-1.5 text-slate-300">•</span>
```

with:

```tsx
                    {graveNumberLabel(grave) && (
                      <>
                        <span className="font-semibold text-brand-dark">{graveNumberLabel(grave)}</span>
                        <span className="mx-1.5 text-slate-300">•</span>
                      </>
                    )}
```

`src/components/admin/AdminDashboard.tsx`, replace:

```tsx
                      <span className="text-xs font-bold text-slate-900">Grave {g.graveNumber}</span>
```

with:

```tsx
                      <span className="text-xs font-bold text-slate-900">
                        {graveNumberLabel(g) ?? g.person?.fullName ?? 'Unnumbered grave'}
                      </span>
```

- [ ] **Step 6: Escape marker HTML and use labels in Navigation**

In `src/components/screens/NavigationScreen.tsx` add:

```ts
import { graveNumberLabel } from '@/lib/ui/graveLabels';
import { escapeHtml } from '@/lib/ui/escapeHtml';
```

Replace in the target marker HTML:

```ts
              ${targetGrave.person?.fullName || `Grave ${targetGrave.graveNumber}`}
```

with:

```ts
              ${escapeHtml(targetGrave.person?.fullName || graveNumberLabel(targetGrave) || 'Grave')}
```

and:

```ts
                <span class="text-[10px] font-black">${targetGrave.graveNumber.slice(-4)}</span>
```

with:

```ts
                <span class="text-[10px] font-black">${escapeHtml(targetGrave.graveNumber.slice(-4))}</span>
```

In the entrance marker HTML replace:

```ts
              <span>${entranceName}</span>
```

with:

```ts
              <span>${escapeHtml(entranceName)}</span>
```

Replace the header subtitle:

```tsx
                : `${targetGrave.person?.fullName || 'Grave'} • Plot ${targetGrave.graveNumber}`}
```

with:

```tsx
                : [targetGrave.person?.fullName || 'Grave', targetGrave.graveNumber && `Plot ${targetGrave.graveNumber}`]
                    .filter(Boolean)
                    .join(' • ')}
```

Replace the arrival message:

```tsx
                  You have arrived! Grave {targetGrave.graveNumber} is right here (±
```

with:

```tsx
                  You have arrived! {graveNumberLabel(targetGrave) ?? targetGrave.person?.fullName ?? 'The grave'} is right here (±
```

- [ ] **Step 7: Type check and run all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass. (`entranceName` is always a string: `cemetery?.entranceName ?? \`${cemetery?.name || 'Cemetery'} Entrance\``.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/ui/graveLabels.ts src/lib/ui/escapeHtml.ts tests/grave_labels.test.ts src/components/screens/AddPhotoConfirmScreen.tsx src/components/screens/CemeteryMapScreen.tsx src/components/screens/GraveDetailsScreen.tsx src/components/screens/MyCemeteriesScreen.tsx src/components/screens/NavigationScreen.tsx src/components/screens/SearchScreen.tsx src/components/admin/AdminDashboard.tsx
git commit -F - <<'EOF'
fix(graves): handle graves without a number and escape marker text

Stones often have no visible number, so labels no longer show a bare
"Grave" or "Plot". Names typed by users are escaped before they go into
navigation marker HTML.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: True-north compass helper

**Files:**
- Create: `src/lib/device/compass.ts`
- Create: `src/lib/device/useCompassHeading.ts`
- Test: `tests/compass.test.ts`
- Modify: `src/components/screens/NavigationScreen.tsx` (effect starting `// Device orientation listener when available on phone`, near line 329)

**Interfaces:**
- Produces:
  - `type CompassStatus = 'waiting' | 'needs-permission' | 'active' | 'denied' | 'unsupported'`
  - `type CompassSource = 'absolute' | 'relative'`
  - `readCompassHeading(reading: { alpha?: number | null; webkitCompassHeading?: number | null }, source: CompassSource): number | null` (whole degrees, 0 to 359)
  - `useCompassHeading(): { heading: number | null; status: CompassStatus; requestPermission: () => Promise<void> }`

- [ ] **Step 1: Write the failing test**

Create `tests/compass.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readCompassHeading } from '../src/lib/device/compass';

describe('Compass Heading Tests', () => {
  it('uses the iOS compass heading, including due north', () => {
    expect(readCompassHeading({ webkitCompassHeading: 90, alpha: 10 }, 'relative')).toBe(90);
    expect(readCompassHeading({ webkitCompassHeading: 0 }, 'relative')).toBe(0);
    expect(readCompassHeading({ webkitCompassHeading: 359.6 }, 'relative')).toBe(0);
  });

  it('converts alpha from an absolute orientation event to a clockwise heading', () => {
    expect(readCompassHeading({ alpha: 90 }, 'absolute')).toBe(270);
    expect(readCompassHeading({ alpha: 0 }, 'absolute')).toBe(0);
    expect(readCompassHeading({ alpha: 270.4 }, 'absolute')).toBe(90);
  });

  it('ignores alpha from a relative event, which is not measured from north', () => {
    expect(readCompassHeading({ alpha: 90 }, 'relative')).toBeNull();
  });

  it('returns null when there is no usable reading', () => {
    expect(readCompassHeading({ alpha: null }, 'absolute')).toBeNull();
    expect(readCompassHeading({}, 'absolute')).toBeNull();
    expect(readCompassHeading({ webkitCompassHeading: Number.NaN }, 'relative')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run tests/compass.test.ts`
Expected: FAIL with `Failed to resolve import "../src/lib/device/compass"`.

- [ ] **Step 3: Write the pure reader**

Create `src/lib/device/compass.ts`:

```ts
// waiting: listening but no reading yet; needs-permission: iOS, must ask from a tap
export type CompassStatus = 'waiting' | 'needs-permission' | 'active' | 'denied' | 'unsupported';

// deviceorientationabsolute events are measured from north; plain deviceorientation events usually are not
export type CompassSource = 'absolute' | 'relative';

export interface OrientationReading {
  alpha?: number | null;
  webkitCompassHeading?: number | null;
}

// Heading in whole degrees clockwise from north, or null when the reading isn't tied to north
export function readCompassHeading(reading: OrientationReading, source: CompassSource): number | null {
  const iosHeading = reading.webkitCompassHeading;
  if (typeof iosHeading === 'number' && Number.isFinite(iosHeading)) {
    return wholeDegrees(iosHeading);
  }
  if (source === 'absolute' && typeof reading.alpha === 'number' && Number.isFinite(reading.alpha)) {
    return wholeDegrees(360 - reading.alpha);
  }
  return null;
}

function wholeDegrees(deg: number): number {
  return ((Math.round(deg) % 360) + 360) % 360;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/compass.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the hook**

Create `src/lib/device/useCompassHeading.ts`:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { CompassStatus, OrientationReading, readCompassHeading } from './compass';

type OrientationEventConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

// Laptops expose the orientation API but never send readings, so give up after this long
const NO_READING_TIMEOUT_MS = 3000;

export function useCompassHeading() {
  const [heading, setHeading] = useState<number | null>(null);
  const [status, setStatus] = useState<CompassStatus>('waiting');
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!('DeviceOrientationEvent' in window)) {
      setStatus('unsupported');
      return;
    }
    const ctor = window.DeviceOrientationEvent as OrientationEventConstructor;
    if (typeof ctor.requestPermission === 'function') {
      setStatus('needs-permission');
    } else {
      setListening(true);
    }
  }, []);

  useEffect(() => {
    if (!listening) return;
    setStatus((current) => (current === 'active' ? current : 'waiting'));

    const handle = (source: 'absolute' | 'relative') => (event: Event) => {
      const next = readCompassHeading(event as unknown as OrientationReading, source);
      if (next === null) return;
      setHeading(next);
      setStatus('active');
    };
    const onAbsolute = handle('absolute');
    const onRelative = handle('relative');

    window.addEventListener('deviceorientationabsolute', onAbsolute);
    window.addEventListener('deviceorientation', onRelative);
    const timer = window.setTimeout(() => {
      setStatus((current) => (current === 'waiting' ? 'unsupported' : current));
    }, NO_READING_TIMEOUT_MS);

    return () => {
      window.removeEventListener('deviceorientationabsolute', onAbsolute);
      window.removeEventListener('deviceorientation', onRelative);
      window.clearTimeout(timer);
    };
  }, [listening]);

  // iOS only allows this from a tap
  const requestPermission = useCallback(async () => {
    const ctor = window.DeviceOrientationEvent as OrientationEventConstructor;
    if (typeof ctor.requestPermission !== 'function') return;
    try {
      const result = await ctor.requestPermission();
      if (result === 'granted') {
        setListening(true);
      } else {
        setStatus('denied');
      }
    } catch {
      setStatus('denied');
    }
  }, []);

  return { heading, status, requestPermission };
}
```

- [ ] **Step 6: Switch Navigation to the hook**

In `src/components/screens/NavigationScreen.tsx` add:

```ts
import { useCompassHeading } from '@/lib/device/useCompassHeading';
```

Replace the whole effect that begins with `// Device orientation listener when available on phone` and ends with its closing `}, []);` with:

```tsx
  // Heading from the shared true-north compass, so it matches the direction saved when a grave was captured
  const { heading: compassHeading } = useCompassHeading();
  useEffect(() => {
    if (compassHeading !== null) setHeadingDeg(compassHeading);
  }, [compassHeading]);
```

- [ ] **Step 7: Type check and run all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/device/compass.ts src/lib/device/useCompassHeading.ts tests/compass.test.ts src/components/screens/NavigationScreen.tsx
git commit -F - <<'EOF'
fix(compass): read headings from true north on Android and iOS

Android now uses deviceorientationabsolute instead of the relative alpha
value, iOS asks for motion permission, and a heading of 0 (due north) is
no longer dropped. Navigation uses the shared hook.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: Capture screen readiness, no uploads

**Files:**
- Create: `src/lib/capture/readiness.ts`
- Test: `tests/capture_readiness.test.ts`
- Modify: `src/components/screens/CaptureScreen.tsx` (full replacement)

**Interfaces:**
- Consumes: `CompassStatus` from `src/lib/device/compass.ts`; `useCompassHeading` from Task 4.
- Produces:
  - `MAX_CAPTURE_ACCURACY_M = 10`
  - `getCaptureReadiness(input: { cameraLive: boolean; accuracyMeters: number | null; heading: number | null; compassStatus: CompassStatus }): { ready: boolean; blocker: 'camera' | 'gps' | 'gps-accuracy' | 'compass-permission' | 'compass' | null; message: string }`
  - `CaptureScreen` always passes `headingDegrees` as a number in `DeviceTelemetry`.

- [ ] **Step 1: Write the failing test**

Create `tests/capture_readiness.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getCaptureReadiness, MAX_CAPTURE_ACCURACY_M } from '../src/lib/capture/readiness';

const everythingReady = {
  cameraLive: true,
  accuracyMeters: 4,
  heading: 90,
  compassStatus: 'active' as const,
};

describe('Capture Readiness Tests', () => {
  it('waits for the camera first', () => {
    expect(getCaptureReadiness({ ...everythingReady, cameraLive: false, accuracyMeters: null })).toEqual({
      ready: false,
      blocker: 'camera',
      message: 'Camera is not available',
    });
  });

  it('waits for a GPS fix', () => {
    expect(getCaptureReadiness({ ...everythingReady, accuracyMeters: null })).toEqual({
      ready: false,
      blocker: 'gps',
      message: 'Locating…',
    });
  });

  it('needs GPS accuracy of 10 m or better', () => {
    expect(MAX_CAPTURE_ACCURACY_M).toBe(10);
    expect(getCaptureReadiness({ ...everythingReady, accuracyMeters: 10 }).ready).toBe(true);
    expect(getCaptureReadiness({ ...everythingReady, accuracyMeters: 10.4 })).toEqual({
      ready: false,
      blocker: 'gps-accuracy',
      message: 'Improving GPS (± 11 m)…',
    });
  });

  it('asks for compass permission on iOS', () => {
    expect(getCaptureReadiness({ ...everythingReady, heading: null, compassStatus: 'needs-permission' })).toEqual({
      ready: false,
      blocker: 'compass-permission',
      message: 'Tap Enable compass to record the direction',
    });
  });

  it('explains why there is no heading', () => {
    const noHeading = { ...everythingReady, heading: null };
    expect(getCaptureReadiness({ ...noHeading, compassStatus: 'waiting' }).message).toBe('Waiting for compass…');
    expect(getCaptureReadiness({ ...noHeading, compassStatus: 'denied' }).message).toBe('Compass permission was denied');
    expect(getCaptureReadiness({ ...noHeading, compassStatus: 'unsupported' })).toEqual({
      ready: false,
      blocker: 'compass',
      message: 'Compass not available on this device',
    });
  });

  it('is ready with a live camera, accurate GPS and a heading', () => {
    expect(getCaptureReadiness(everythingReady)).toEqual({
      ready: true,
      blocker: null,
      message: 'Position the gravestone in the frame',
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run tests/capture_readiness.test.ts`
Expected: FAIL with `Failed to resolve import "../src/lib/capture/readiness"`.

- [ ] **Step 3: Write the readiness function**

Create `src/lib/capture/readiness.ts`:

```ts
import type { CompassStatus } from '../device/compass';

// AR guides people back to where the photo was taken, so a new grave needs an accurate fix
export const MAX_CAPTURE_ACCURACY_M = 10;

export type CaptureBlocker = 'camera' | 'gps' | 'gps-accuracy' | 'compass-permission' | 'compass' | null;

export interface CaptureReadinessInput {
  cameraLive: boolean;
  accuracyMeters: number | null;
  heading: number | null;
  compassStatus: CompassStatus;
}

export interface CaptureReadiness {
  ready: boolean;
  blocker: CaptureBlocker;
  message: string;
}

// The first thing stopping the shutter, in the order a user can fix them
export function getCaptureReadiness({
  cameraLive,
  accuracyMeters,
  heading,
  compassStatus,
}: CaptureReadinessInput): CaptureReadiness {
  if (!cameraLive) return { ready: false, blocker: 'camera', message: 'Camera is not available' };
  if (accuracyMeters === null) return { ready: false, blocker: 'gps', message: 'Locating…' };
  if (accuracyMeters > MAX_CAPTURE_ACCURACY_M) {
    return {
      ready: false,
      blocker: 'gps-accuracy',
      message: `Improving GPS (± ${Math.ceil(accuracyMeters)} m)…`,
    };
  }
  if (compassStatus === 'needs-permission') {
    return { ready: false, blocker: 'compass-permission', message: 'Tap Enable compass to record the direction' };
  }
  if (heading === null) {
    const message =
      compassStatus === 'waiting'
        ? 'Waiting for compass…'
        : compassStatus === 'denied'
          ? 'Compass permission was denied'
          : 'Compass not available on this device';
    return { ready: false, blocker: 'compass', message };
  }
  return { ready: true, blocker: null, message: 'Position the gravestone in the frame' };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/capture_readiness.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Replace the capture screen**

Replace the entire contents of `src/components/screens/CaptureScreen.tsx` with:

```tsx
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Zap, ZapOff, Grid, MapPin, Compass, CameraOff, Loader2 } from 'lucide-react';
import { DeviceTelemetry } from '@/types';
import { formatBearingToCardinal } from '@/lib/geospatial';
import { isUsableGpsFix } from '@/lib/geospatial/routeProgress';
import { describeCameraError } from '@/lib/device/cameraErrors';
import { useCompassHeading } from '@/lib/device/useCompassHeading';
import { getCaptureReadiness } from '@/lib/capture/readiness';

interface CaptureScreenProps {
  onCaptureComplete: (imageDataUrl: string, telemetry: DeviceTelemetry) => void;
  onBack: () => void;
}

type CameraStatus = 'starting' | 'live' | 'unavailable';

interface PositionFix {
  lat: number;
  lng: number;
  accuracy: number;
}

// Photos only come from this camera, because each one records where it was taken and which way it faced
export const CaptureScreen: React.FC<CaptureScreenProps> = ({ onCaptureComplete, onBack }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flashOn, setFlashOn] = useState(false);
  const [showGrid, setShowGrid] = useState(true);

  // Real device readings; null until the device reports one
  const [fix, setFix] = useState<PositionFix | null>(null);
  const { heading, status: compassStatus, requestPermission } = useCompassHeading();

  // Start the rear camera. The <video> element is always mounted so the stream attaches the moment it arrives.
  useEffect(() => {
    const video = videoRef.current;
    let cancelled = false;
    let stream: MediaStream | null = null;

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(window.isSecureContext ? 'Camera not supported in this browser' : 'Camera requires HTTPS');
      setCameraStatus('unavailable');
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        if (video) {
          video.srcObject = s;
          video.play().catch(() => {});
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCameraError(describeCameraError(err));
        setCameraStatus('unavailable');
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, []);

  // Keep the position current while the gravestone is being framed
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!isUsableGpsFix(pos.coords.latitude, pos.coords.longitude)) return;
        setFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const cameraLive = cameraStatus === 'live';
  const readiness = getCaptureReadiness({
    cameraLive,
    accuracyMeters: fix?.accuracy ?? null,
    heading,
    compassStatus,
  });

  const handleTriggerShutter = () => {
    const video = videoRef.current;
    if (!readiness.ready || !video || !fix || heading === null) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 960;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    onCaptureComplete(canvas.toDataURL('image/jpeg', 0.85), {
      latitude: fix.lat,
      longitude: fix.lng,
      gpsAccuracy: Number(fix.accuracy.toFixed(1)),
      headingDegrees: heading,
      timestamp: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      imageDimensions: { width: canvas.width, height: canvas.height },
    });
  };

  return (
    <div className="flex-1 flex flex-col relative bg-black overflow-hidden select-none">
      {/* Live camera feed, faded in once it is actually playing */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        onPlaying={() => setCameraStatus('live')}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
          cameraLive ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Camera starting or unavailable */}
      {!cameraLive && (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-10 flex flex-col items-center px-12 text-center pointer-events-none">
          {cameraStatus === 'starting' ? (
            <>
              <Loader2 className="w-7 h-7 text-white/70 animate-spin" />
              <p className="mt-3 text-sm font-semibold text-white/80">Starting camera…</p>
            </>
          ) : (
            <>
              <CameraOff className="w-7 h-7 text-amber-300" />
              <p className="mt-3 text-sm font-semibold text-white">{cameraError || 'Camera unavailable'}</p>
              <p className="mt-1 text-xs text-white/60">Allow camera access to map a grave.</p>
            </>
          )}
        </div>
      )}

      {/* Top Header matching Mockup Screen 8 */}
      <div className="absolute top-0 inset-x-0 z-30 px-4 pt-3 pb-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between text-white">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/30 transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>

        <h1 className="text-sm font-bold tracking-tight text-white drop-shadow">Capture Grave</h1>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setFlashOn(!flashOn)}
            className={`w-9 h-9 rounded-full backdrop-blur-md flex items-center justify-center transition-colors ${
              flashOn ? 'bg-amber-400 text-slate-900' : 'bg-white/20 text-white hover:bg-white/30'
            }`}
            aria-label="Flash"
          >
            {flashOn ? <Zap className="w-4 h-4 fill-current" /> : <ZapOff className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`w-9 h-9 rounded-full backdrop-blur-md flex items-center justify-center transition-colors ${
              showGrid ? 'bg-emerald-600 text-white' : 'bg-white/20 text-white hover:bg-white/30'
            }`}
            aria-label="Grid"
          >
            <Grid className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Viewfinder Bounding Reticle matching Screen 8 */}
      <div className="flex-1 relative flex flex-col items-center justify-center pointer-events-none z-20 px-8">
        <div className="w-full max-w-[280px] aspect-[3/4] border-2 border-emerald-400/90 rounded-3xl relative shadow-[0_0_20px_rgba(16,185,129,0.3)]">
          <div className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl" />
          <div className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl" />
          <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl" />
          <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-emerald-400 rounded-br-xl" />

          {showGrid && (
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-20 pointer-events-none">
              <div className="border-r border-b border-white" />
              <div className="border-r border-b border-white" />
              <div className="border-b border-white" />
              <div className="border-r border-b border-white" />
              <div className="border-r border-b border-white" />
              <div className="border-b border-white" />
              <div className="border-r border-white" />
              <div className="border-r border-white" />
              <div />
            </div>
          )}
        </div>

        {/* Guidance: names whatever is still stopping the shutter */}
        <div className="mt-4 bg-black/55 backdrop-blur-md text-white text-xs font-medium py-1.5 px-4 rounded-full border border-white/15">
          {readiness.message}
        </div>

        {compassStatus === 'needs-permission' && (
          <button
            onClick={requestPermission}
            className="mt-3 pointer-events-auto flex items-center space-x-1.5 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 text-xs font-bold py-2 px-4 rounded-full shadow-lg active:scale-95 transition-transform"
          >
            <Compass className="w-4 h-4" />
            <span>Enable compass</span>
          </button>
        )}

        {/* Live Telemetry Pill matching Screen 8 */}
        <div className="mt-4 bg-black/75 backdrop-blur-md rounded-2xl py-2 px-4 border border-white/20 text-white text-[11px] space-y-1 shadow-xl">
          <div className="flex items-center space-x-1.5 text-emerald-300 font-mono">
            <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            {fix ? (
              <>
                <span>
                  {fix.lat.toFixed(6)}, {fix.lng.toFixed(6)}
                </span>
                <span className="text-white/60">± {Math.round(fix.accuracy)} m</span>
              </>
            ) : (
              <span className="text-white/70 font-sans">Locating…</span>
            )}
          </div>
          <div className="flex items-center space-x-1.5 text-slate-200">
            <Compass className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>
              {heading !== null ? `Heading ${formatBearingToCardinal(heading)}` : 'No compass heading yet'}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Shutter Controls matching Screen 8 */}
      <div className="h-28 bg-gradient-to-t from-black via-black/80 to-transparent flex items-center justify-around px-8 z-30 shrink-0 pb-3">
        {/* Keeps the shutter centred */}
        <div className="w-12 h-12 shrink-0" aria-hidden="true" />

        <button
          onClick={handleTriggerShutter}
          disabled={!readiness.ready}
          className="w-18 h-18 rounded-full border-4 border-white flex items-center justify-center p-1 group active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100"
          aria-label="Take Photo"
          title={readiness.ready ? 'Take photo' : readiness.message}
        >
          <div className="w-14 h-14 rounded-full bg-white group-hover:bg-emerald-100 group-disabled:group-hover:bg-white transition-colors" />
        </button>

        <div className="w-12 h-12 shrink-0" aria-hidden="true" />
      </div>
    </div>
  );
};
```

- [ ] **Step 6: Type check and run all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/capture/readiness.ts tests/capture_readiness.test.ts src/components/screens/CaptureScreen.tsx
git commit -F - <<'EOF'
feat(capture): require accurate GPS and a compass heading, remove uploads

The shutter waits for a live camera, GPS within 10 m and a true-north
heading, and says which one is missing. Photo uploads are gone, including
the fixed Athlone position used for uploads without GPS.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: Cemetery lookup and form validation

**Files:**
- Create: `src/lib/capture/cemeteryForLocation.ts`
- Create: `src/lib/capture/newGrave.ts`
- Test: `tests/new_grave_form.test.ts`

**Interfaces:**
- Produces:
  - `findCemeteryForLocation(cemeteries: Cemetery[], lat: number, lng: number): Cemetery | undefined`
  - `interface NewGraveForm { firstName: string; middleNames: string; surname: string; nickname: string; graveNumber: string; birthDate: string; deathDate: string; cemeteryId: string }` (dates are `YYYY-MM-DD` or `''`)
  - `validateNewGraveForm(form: NewGraveForm): { valid: boolean; errors: { firstName?: string; surname?: string; cemeteryId?: string } }`

- [ ] **Step 1: Write the failing test**

Create `tests/new_grave_form.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Cemetery } from '../src/types';
import { findCemeteryForLocation } from '../src/lib/capture/cemeteryForLocation';
import { NewGraveForm, validateNewGraveForm } from '../src/lib/capture/newGrave';

function cemetery(id: string, ring?: [number, number][]): Cemetery {
  return {
    id,
    name: id,
    slug: id,
    description: '',
    country: 'South Africa',
    province: 'Western Cape',
    city: 'Cape Town',
    denomination: 'Muslim',
    originLat: -33.9675,
    originLng: 18.5033,
    boundary: ring ? { type: 'Polygon', coordinates: [ring] } : undefined,
    totalGravesEstimate: 0,
    mappedGravesCount: 0,
    coveragePercentage: 0,
  };
}

// [lng, lat] squares
const ATHLONE_RING: [number, number][] = [
  [18.5, -33.97], [18.51, -33.97], [18.51, -33.96], [18.5, -33.96], [18.5, -33.97],
];
const MOWBRAY_RING: [number, number][] = [
  [18.47, -33.95], [18.48, -33.95], [18.48, -33.94], [18.47, -33.94], [18.47, -33.95],
];

const validForm: NewGraveForm = {
  firstName: 'Abdul',
  middleNames: '',
  surname: 'Narker',
  nickname: '',
  graveNumber: '',
  birthDate: '',
  deathDate: '',
  cemeteryId: 'cem_athlone',
};

describe('New Grave Form Tests', () => {
  it('finds the cemetery whose boundary contains the location', () => {
    const list = [cemetery('cem_mowbray', MOWBRAY_RING), cemetery('cem_athlone', ATHLONE_RING)];
    expect(findCemeteryForLocation(list, -33.965, 18.505)?.id).toBe('cem_athlone');
  });

  it('finds nothing outside every boundary', () => {
    expect(findCemeteryForLocation([cemetery('cem_athlone', ATHLONE_RING)], -33.9, 18.6)).toBeUndefined();
  });

  it('skips cemeteries without a boundary and uses the first match when boundaries overlap', () => {
    const list = [cemetery('cem_no_boundary'), cemetery('cem_first', ATHLONE_RING), cemetery('cem_second', ATHLONE_RING)];
    expect(findCemeteryForLocation(list, -33.965, 18.505)?.id).toBe('cem_first');
  });

  it('accepts a grave with only a first name, surname and cemetery', () => {
    expect(validateNewGraveForm(validForm)).toEqual({ valid: true, errors: {} });
  });

  it('requires a first name and surname, ignoring spaces', () => {
    expect(validateNewGraveForm({ ...validForm, firstName: '  ', surname: '' })).toEqual({
      valid: false,
      errors: { firstName: 'Enter a first name', surname: 'Enter a surname' },
    });
  });

  it('requires a cemetery', () => {
    expect(validateNewGraveForm({ ...validForm, cemeteryId: '' })).toEqual({
      valid: false,
      errors: { cemeteryId: 'Choose a cemetery' },
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run tests/new_grave_form.test.ts`
Expected: FAIL with `Failed to resolve import "../src/lib/capture/cemeteryForLocation"`.

- [ ] **Step 3: Write the lookup**

Create `src/lib/capture/cemeteryForLocation.ts`:

```ts
import type { Cemetery } from '@/types';
import { isPointInPolygon } from '../geospatial';

// The cemetery a capture location falls inside. Cemeteries without a boundary are skipped; if boundaries
// overlap, the first one in the list wins.
export function findCemeteryForLocation(cemeteries: Cemetery[], lat: number, lng: number): Cemetery | undefined {
  return cemeteries.find((cemetery) => {
    const ring = cemetery.boundary?.coordinates?.[0];
    return Array.isArray(ring) && ring.length >= 3 && isPointInPolygon([lng, lat], ring as [number, number][]);
  });
}
```

- [ ] **Step 4: Write the form validation**

Create `src/lib/capture/newGrave.ts`:

```ts
// What a user enters on the Confirm screen. Dates are YYYY-MM-DD from a date input, or ''.
export interface NewGraveForm {
  firstName: string;
  middleNames: string;
  surname: string;
  nickname: string;
  graveNumber: string;
  birthDate: string;
  deathDate: string;
  cemeteryId: string;
}

export interface NewGraveFormErrors {
  firstName?: string;
  surname?: string;
  cemeteryId?: string;
}

// Many stones have no readable details, so only the name and cemetery are required
export function validateNewGraveForm(form: NewGraveForm): { valid: boolean; errors: NewGraveFormErrors } {
  const errors: NewGraveFormErrors = {};
  if (!form.firstName.trim()) errors.firstName = 'Enter a first name';
  if (!form.surname.trim()) errors.surname = 'Enter a surname';
  if (!form.cemeteryId) errors.cemeteryId = 'Choose a cemetery';
  return { valid: Object.keys(errors).length === 0, errors };
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run tests/new_grave_form.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/capture/cemeteryForLocation.ts src/lib/capture/newGrave.ts tests/new_grave_form.test.ts
git commit -F - <<'EOF'
feat(capture): detect the cemetery from GPS and validate new grave details

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 7: Save errors and save orchestration

**Files:**
- Create: `src/lib/supabase/saveGraveErrors.ts`
- Create: `src/lib/capture/saveMappedGrave.ts`
- Test: `tests/save_mapped_grave.test.ts`
- Modify: `src/lib/data/store.ts` (imports, `memoryGraves`, `getGraves`, `getGraveById`, `saveNewGrave`)

**Interfaces:**
- Consumes: `NewGraveForm` (Task 6), `create_mapped_grave` parameter names (Task 1), `uploadGravePhoto` / `deleteGravePhoto` / `UploadPhotoOptions` / `UploadPhotoResult` from `src/lib/supabase/storage.ts`.
- Produces:
  - `type SaveGraveErrorCode = 'offline' | 'signed-out' | 'duplicate' | 'invalid' | 'not-set-up' | 'upload-failed' | 'unknown'`
  - `class SaveGraveError extends Error { readonly code: SaveGraveErrorCode }`
  - Message constants `OFFLINE_MESSAGE`, `SIGNED_OUT_MESSAGE`, `NOT_SET_UP_MESSAGE`, `UPLOAD_FAILED_MESSAGE`, `UNKNOWN_SAVE_MESSAGE`
  - `mapSaveGraveError(error: unknown, context?: { graveNumber?: string; cemeteryName?: string }): SaveGraveError`
  - `interface SaveMappedGraveInput { form: NewGraveForm; cemeteryName?: string; photoDataUrl: string; telemetry: DeviceTelemetry }`
  - `saveMappedGrave(input: SaveMappedGraveInput, deps: SaveMappedGraveDeps): Promise<string>` (resolves to the grave id)
  - `dataStore.saveNewGrave(input: SaveMappedGraveInput): Promise<Grave>` (throws `SaveGraveError`)

- [ ] **Step 1: Write the failing test**

Create `tests/save_mapped_grave.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { DeviceTelemetry } from '../src/types';
import type { NewGraveForm } from '../src/lib/capture/newGrave';
import {
  mapSaveGraveError,
  SaveGraveError,
  OFFLINE_MESSAGE,
  SIGNED_OUT_MESSAGE,
  NOT_SET_UP_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
  UNKNOWN_SAVE_MESSAGE,
} from '../src/lib/supabase/saveGraveErrors';
import { saveMappedGrave, SaveMappedGraveDeps } from '../src/lib/capture/saveMappedGrave';

const form: NewGraveForm = {
  firstName: ' Abdul ',
  middleNames: 'Wahab',
  surname: 'Narker ',
  nickname: 'Boeta Dul',
  graveNumber: ' 1402 ',
  birthDate: '1947-01-28',
  deathDate: '',
  cemeteryId: 'cem_athlone',
};

const telemetry: DeviceTelemetry = {
  latitude: -33.9675,
  longitude: 18.5033,
  gpsAccuracy: 4.2,
  headingDegrees: 62,
  timestamp: '2026-09-15T10:00:00.000Z',
};

const PHOTO = 'data:image/jpeg;base64,/9j/abc';

type RpcResult = { data: unknown; error: unknown };
type GetUserResult = { data: { user: { id: string } | null }; error: unknown };

function makeDeps(overrides: Partial<SaveMappedGraveDeps> = {}) {
  const ids = ['id1', 'id2'];
  // Loosely typed so tests can swap in failures with mockResolvedValueOnce
  const rpc = vi.fn(async (..._args: unknown[]): Promise<RpcResult> => ({ data: 'grave_id1', error: null }));
  const getUser = vi.fn(async (): Promise<GetUserResult> => ({ data: { user: { id: 'user-1' } }, error: null }));
  const deps: SaveMappedGraveDeps = {
    client: { rpc, auth: { getUser } } as unknown as SaveMappedGraveDeps['client'],
    isOnline: () => true,
    uploadPhoto: vi.fn(async () => ({ publicUrl: 'https://x.supabase.co/grave-photos/cem_athlone/grave_id1.jpg', path: 'cem_athlone/grave_id1.jpg' })),
    deletePhoto: vi.fn(async () => true),
    newId: () => ids.shift() ?? 'extra',
    ...overrides,
  };
  return { deps, rpc, getUser };
}

describe('Save Grave Error Tests', () => {
  it('treats network failures as offline', () => {
    expect(mapSaveGraveError(new TypeError('Failed to fetch'))).toMatchObject({ code: 'offline', message: OFFLINE_MESSAGE });
    expect(mapSaveGraveError({ code: '', message: 'TypeError: Failed to fetch' }).code).toBe('offline');
    expect(mapSaveGraveError({ message: 'Load failed' }).code).toBe('offline');
  });

  it('asks the user to sign in again when the database rejects the session', () => {
    expect(mapSaveGraveError({ code: '42501', message: 'Sign in to map a grave.' })).toMatchObject({
      code: 'signed-out',
      message: SIGNED_OUT_MESSAGE,
    });
  });

  it('names the duplicate grave and cemetery when it can', () => {
    expect(mapSaveGraveError({ code: '23505' }, { graveNumber: '1402', cemeteryName: 'Athlone Muslim Cemetery' }).message).toBe(
      'Grave 1402 is already mapped at Athlone Muslim Cemetery.'
    );
    expect(mapSaveGraveError({ code: '23505' }).message).toBe('This grave is already mapped.');
  });

  it("shows the database's own message for invalid input", () => {
    expect(mapSaveGraveError({ code: '22023', message: 'First name and surname are required.' })).toMatchObject({
      code: 'invalid',
      message: 'First name and surname are required.',
    });
  });

  it('explains when the migration has not been applied yet', () => {
    expect(mapSaveGraveError({ code: 'PGRST202', message: 'Could not find the function' })).toMatchObject({
      code: 'not-set-up',
      message: NOT_SET_UP_MESSAGE,
    });
  });

  it('falls back to a general message and passes existing save errors through', () => {
    expect(mapSaveGraveError({ code: 'XX000', message: 'boom' })).toMatchObject({ code: 'unknown', message: UNKNOWN_SAVE_MESSAGE });
    const existing = new SaveGraveError('upload-failed', UPLOAD_FAILED_MESSAGE);
    expect(mapSaveGraveError(existing)).toBe(existing);
  });
});

describe('Save Mapped Grave Tests', () => {
  it('uploads the photo, then saves the grave with trimmed details', async () => {
    const { deps, rpc } = makeDeps();
    await expect(saveMappedGrave({ form, cemeteryName: 'Athlone Muslim Cemetery', photoDataUrl: PHOTO, telemetry }, deps)).resolves.toBe(
      'grave_id1'
    );

    expect(deps.uploadPhoto).toHaveBeenCalledWith({ file: PHOTO, cemeteryId: 'cem_athlone', graveId: 'grave_id1', upsert: false });
    expect(rpc).toHaveBeenCalledWith('create_mapped_grave', {
      p_grave_id: 'grave_id1',
      p_person_id: 'person_id2',
      p_cemetery_id: 'cem_athlone',
      p_grave_number: '1402',
      p_first_name: 'Abdul',
      p_middle_names: 'Wahab',
      p_surname: 'Narker',
      p_nickname: 'Boeta Dul',
      p_birth_date: '1947-01-28',
      p_death_date: null,
      p_latitude: -33.9675,
      p_longitude: 18.5033,
      p_accuracy_meters: 4.2,
      p_heading_degrees: 62,
      p_captured_at: '2026-09-15T10:00:00.000Z',
      p_photo_public_url: 'https://x.supabase.co/grave-photos/cem_athlone/grave_id1.jpg',
      p_photo_storage_path: 'cem_athlone/grave_id1.jpg',
    });
    expect(deps.deletePhoto).not.toHaveBeenCalled();
  });

  it('stops before uploading when offline', async () => {
    const { deps } = makeDeps({ isOnline: () => false });
    await expect(saveMappedGrave({ form, photoDataUrl: PHOTO, telemetry }, deps)).rejects.toMatchObject({ code: 'offline' });
    expect(deps.uploadPhoto).not.toHaveBeenCalled();
  });

  it('stops when nobody is signed in', async () => {
    const { deps } = makeDeps();
    (deps.client.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(saveMappedGrave({ form, photoDataUrl: PHOTO, telemetry }, deps)).rejects.toMatchObject({ code: 'signed-out' });
    expect(deps.uploadPhoto).not.toHaveBeenCalled();
  });

  it('only accepts a photo from the camera with a heading', async () => {
    const { deps } = makeDeps();
    await expect(saveMappedGrave({ form, photoDataUrl: '/sample-gravestone.svg', telemetry }, deps)).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(
      saveMappedGrave({ form, photoDataUrl: PHOTO, telemetry: { ...telemetry, headingDegrees: undefined } }, deps)
    ).rejects.toMatchObject({ code: 'invalid' });
    expect(deps.uploadPhoto).not.toHaveBeenCalled();
  });

  it('reports an upload failure, or offline when the upload lost the connection', async () => {
    const failing = makeDeps({ uploadPhoto: vi.fn(async () => { throw new Error('storage exploded'); }) });
    await expect(saveMappedGrave({ form, photoDataUrl: PHOTO, telemetry }, failing.deps)).rejects.toMatchObject({
      code: 'upload-failed',
      message: UPLOAD_FAILED_MESSAGE,
    });

    const dropped = makeDeps({ uploadPhoto: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) });
    await expect(saveMappedGrave({ form, photoDataUrl: PHOTO, telemetry }, dropped.deps)).rejects.toMatchObject({ code: 'offline' });
    expect(failing.rpc).not.toHaveBeenCalled();
  });

  it('removes the uploaded photo when the grave cannot be saved', async () => {
    const { deps, rpc } = makeDeps();
    rpc.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key' } });
    await expect(
      saveMappedGrave({ form, cemeteryName: 'Athlone Muslim Cemetery', photoDataUrl: PHOTO, telemetry }, deps)
    ).rejects.toMatchObject({ code: 'duplicate', message: 'Grave 1402 is already mapped at Athlone Muslim Cemetery.' });
    expect(deps.deletePhoto).toHaveBeenCalledWith('cem_athlone/grave_id1.jpg');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx vitest run tests/save_mapped_grave.test.ts`
Expected: FAIL with `Failed to resolve import "../src/lib/supabase/saveGraveErrors"`.

- [ ] **Step 3: Write the error mapping**

Create `src/lib/supabase/saveGraveErrors.ts`:

```ts
export type SaveGraveErrorCode =
  | 'offline'
  | 'signed-out'
  | 'duplicate'
  | 'invalid'
  | 'not-set-up'
  | 'upload-failed'
  | 'unknown';

export const OFFLINE_MESSAGE = "You're offline. Connect to the internet and tap Save again.";
export const SIGNED_OUT_MESSAGE = 'Your session has ended. Sign in and tap Save again.';
export const NOT_SET_UP_MESSAGE = "Saving graves isn't set up in the database yet.";
export const UPLOAD_FAILED_MESSAGE = "The photo couldn't be uploaded. Please try again.";
export const UNKNOWN_SAVE_MESSAGE = "The grave couldn't be saved. Please try again.";

export class SaveGraveError extends Error {
  readonly code: SaveGraveErrorCode;

  constructor(code: SaveGraveErrorCode, message: string) {
    super(message);
    this.name = 'SaveGraveError';
    this.code = code;
  }
}

export interface SaveGraveErrorContext {
  graveNumber?: string;
  cemeteryName?: string;
}

// supabase-js reports a dropped connection as an error whose message still contains the fetch failure
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed|network request failed/i;

// Turns a Postgres, PostgREST or network error from saving a grave into something the user can act on
export function mapSaveGraveError(error: unknown, context: SaveGraveErrorContext = {}): SaveGraveError {
  if (error instanceof SaveGraveError) return error;

  const details = error && typeof error === 'object' ? (error as { code?: unknown; message?: unknown }) : {};
  const code = typeof details.code === 'string' ? details.code : '';
  const message = typeof details.message === 'string' ? details.message : '';

  if (NETWORK_FAILURE.test(message)) return new SaveGraveError('offline', OFFLINE_MESSAGE);

  switch (code) {
    case '42501':
      return new SaveGraveError('signed-out', SIGNED_OUT_MESSAGE);
    case '23505':
      return new SaveGraveError(
        'duplicate',
        context.graveNumber && context.cemeteryName
          ? `Grave ${context.graveNumber} is already mapped at ${context.cemeteryName}.`
          : 'This grave is already mapped.'
      );
    case '22023':
      return new SaveGraveError('invalid', message || UNKNOWN_SAVE_MESSAGE);
    case 'PGRST202':
      return new SaveGraveError('not-set-up', NOT_SET_UP_MESSAGE);
    default:
      return new SaveGraveError('unknown', UNKNOWN_SAVE_MESSAGE);
  }
}
```

- [ ] **Step 4: Write the save orchestration**

Create `src/lib/capture/saveMappedGrave.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DeviceTelemetry } from '@/types';
import type { NewGraveForm } from './newGrave';
import type { UploadPhotoOptions, UploadPhotoResult } from '../supabase/storage';
import {
  mapSaveGraveError,
  SaveGraveError,
  OFFLINE_MESSAGE,
  SIGNED_OUT_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
} from '../supabase/saveGraveErrors';

export interface SaveMappedGraveInput {
  form: NewGraveForm;
  cemeteryName?: string;
  photoDataUrl: string;
  telemetry: DeviceTelemetry;
}

// Passed in so the save can be tested without Supabase
export interface SaveMappedGraveDeps {
  client: Pick<SupabaseClient, 'rpc' | 'auth'>;
  isOnline: () => boolean;
  uploadPhoto: (options: UploadPhotoOptions) => Promise<UploadPhotoResult | null>;
  deletePhoto: (path: string) => Promise<boolean>;
  newId: () => string;
}

// Uploads the photo, then saves the person, grave and photo together. Resolves to the new grave's id.
export async function saveMappedGrave(input: SaveMappedGraveInput, deps: SaveMappedGraveDeps): Promise<string> {
  const { form, telemetry, photoDataUrl } = input;
  const context = { graveNumber: form.graveNumber.trim(), cemeteryName: input.cemeteryName };

  if (!deps.isOnline()) throw new SaveGraveError('offline', OFFLINE_MESSAGE);
  if (!photoDataUrl.startsWith('data:image/')) {
    throw new SaveGraveError('invalid', 'Take a photo of the grave with the camera.');
  }
  if (typeof telemetry.headingDegrees !== 'number') {
    throw new SaveGraveError('invalid', 'A compass heading is required.');
  }

  try {
    const { data } = await deps.client.auth.getUser();
    if (!data?.user) throw new SaveGraveError('signed-out', SIGNED_OUT_MESSAGE);
  } catch (err) {
    throw err instanceof SaveGraveError ? err : mapSaveGraveError(err, context);
  }

  const graveId = `grave_${deps.newId()}`;
  const personId = `person_${deps.newId()}`;

  let upload: UploadPhotoResult | null;
  try {
    upload = await deps.uploadPhoto({ file: photoDataUrl, cemeteryId: form.cemeteryId, graveId, upsert: false });
  } catch (err) {
    const mapped = mapSaveGraveError(err, context);
    throw mapped.code === 'offline' ? mapped : new SaveGraveError('upload-failed', UPLOAD_FAILED_MESSAGE);
  }
  if (!upload?.publicUrl || !upload.path) throw new SaveGraveError('upload-failed', UPLOAD_FAILED_MESSAGE);

  let saveError: unknown = null;
  try {
    const { error } = await deps.client.rpc('create_mapped_grave', {
      p_grave_id: graveId,
      p_person_id: personId,
      p_cemetery_id: form.cemeteryId,
      p_grave_number: form.graveNumber.trim(),
      p_first_name: form.firstName.trim(),
      p_middle_names: form.middleNames.trim() || null,
      p_surname: form.surname.trim(),
      p_nickname: form.nickname.trim() || null,
      p_birth_date: form.birthDate || null,
      p_death_date: form.deathDate || null,
      p_latitude: telemetry.latitude,
      p_longitude: telemetry.longitude,
      p_accuracy_meters: telemetry.gpsAccuracy,
      p_heading_degrees: telemetry.headingDegrees,
      p_captured_at: telemetry.timestamp,
      p_photo_public_url: upload.publicUrl,
      p_photo_storage_path: upload.path,
    });
    saveError = error;
  } catch (err) {
    saveError = err;
  }

  if (saveError) {
    // Don't leave a photo in storage that no grave points to
    await deps.deletePhoto(upload.path).catch(() => false);
    throw mapSaveGraveError(saveError, context);
  }

  return graveId;
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run tests/save_mapped_grave.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Wire the store to the new save**

In `src/lib/data/store.ts`:

1. Replace the imports line

```ts
import { mapDbCemetery, mapDbGrave, mapDbGravePhoto, graveToDb, personToDb } from '../supabase/mappers';
```

with

```ts
import { mapDbCemetery, mapDbGrave, mapDbGravePhoto } from '../supabase/mappers';
import { saveMappedGrave, SaveMappedGraveInput } from '../capture/saveMappedGrave';
import { SaveGraveError, NOT_SET_UP_MESSAGE, UNKNOWN_SAVE_MESSAGE } from '../supabase/saveGraveErrors';
```

2. Delete these two lines from the class fields:

```ts
  // Only graves saved on this device when the cloud is unavailable; there is no built-in sample data
  private memoryGraves: Grave[] = [];
```

3. In `getGraves`, delete the whole block that starts with `// 3. No cloud and no cache: only graves saved during this visit` and ends with its closing `}`. Then replace the return:

```ts
    return resultList.map((g) => ({
      ...g,
      relationship: this.relationships.get(g.id),
    }));
```

with:

```ts
    return resultList.map((g) => ({
      ...g,
      cemeteryName: g.cemeteryName || this.cemeteryNameFor(g.cemeteryId),
      relationship: this.relationships.get(g.id),
    }));
```

4. In `getGraveById`, replace:

```ts
          const grave = mapDbGrave(data);
          grave.relationship = this.relationships.get(grave.id);
```

with:

```ts
          const grave = mapDbGrave(data);
          grave.cemeteryName = this.cemeteryNameFor(grave.cemeteryId);
          grave.relationship = this.relationships.get(grave.id);
```

5. Add this private method just above `async getCemeteryById`:

```ts
  // Graves from the database don't carry their cemetery's name, which screens show
  private cemeteryNameFor(cemeteryId: string): string | undefined {
    return this.memoryCemeteries.find((cemetery) => cemetery.id === cemeteryId)?.name;
  }
```

6. Replace the entire `async saveNewGrave(grave: Grave): Promise<Grave> { ... }` method with:

```ts
  // Saves a grave captured on this device. Needs a signed-in user and a connection; throws SaveGraveError.
  async saveNewGrave(input: SaveMappedGraveInput): Promise<Grave> {
    if (!isSupabaseConfigured || !supabase) throw new SaveGraveError('not-set-up', NOT_SET_UP_MESSAGE);

    const graveId = await saveMappedGrave(input, {
      client: supabase,
      isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
      uploadPhoto: uploadGravePhoto,
      deletePhoto: deleteGravePhoto,
      newId: () => crypto.randomUUID(),
    });

    const saved = await this.getGraveById(graveId);
    if (!saved) throw new SaveGraveError('unknown', UNKNOWN_SAVE_MESSAGE);

    if (typeof window !== 'undefined') {
      offlineDb.graves.put(saved).catch(() => {});
    }

    // Update active survey counts
    this.activeSurvey.capturedCount++;
    this.activeSurvey.processedCount++;
    return saved;
  }
```

- [ ] **Step 7: Stop registration from creating a fake grave**

`RegisterScreen` used to call `saveNewGrave` with a made-up grave at fixed Athlone coordinates, marked `MAPPED` and `HIGH`, for the loved one named during sign-up. The database always rejected it, and it would plant a false map location. A loved one's grave now has to be found in Search or mapped with Capture.

In `src/components/screens/RegisterScreen.tsx`, delete the whole block inside `handleCompleteRegistration` that starts with `// 2. If user provided a loved one, save it into DataStore` and ends with the closing `}` of `if (hasLovedOne && lovedOneName.trim()) {`.

Then replace the success card:

```tsx
                <div className="flex items-center space-x-2 text-xs font-semibold text-slate-800">
                  <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />
                  <span>Saved to My Cemeteries:</span>
                </div>
```

with:

```tsx
                <div className="flex items-center space-x-2 text-xs font-semibold text-slate-800">
                  <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />
                  <span>Next, find or map their grave:</span>
                </div>
```

and add this line directly after the closing `</div>` of the relationship and cemetery row inside that card:

```tsx
                <p className="text-[11px] text-slate-500 mt-2">
                  Search for the grave, or photograph it with Capture, then tap the heart to save it to My Cemeteries.
                </p>
```

If `dataStore` is no longer used in `RegisterScreen.tsx` after the deletion, remove its import.

- [ ] **Step 8: Type check**

Run: `npx tsc --noEmit`
Expected: exactly one error, in `src/app/page.tsx`, because `handleSaveGrave` still passes a `Grave` to `saveNewGrave`. Task 8 fixes it. Any other error must be fixed now.

- [ ] **Step 8: Run all tests**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/supabase/saveGraveErrors.ts src/lib/capture/saveMappedGrave.ts tests/save_mapped_grave.test.ts src/lib/data/store.ts
git commit -F - <<'EOF'
feat(graves): save new graves through create_mapped_grave

The photo uploads first, then the person, grave and primary photo are
saved in one database call. Failures now surface as a SaveGraveError
with a message the user can act on, and a failed save removes its photo.
The offline queue and base64 fallback for new graves are gone.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 8: Confirm screen, processing errors and app wiring

**Files:**
- Modify: `src/components/screens/ConfirmDetailsScreen.tsx` (full replacement)
- Modify: `src/components/screens/AIProcessingScreen.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `findCemeteryForLocation` and `validateNewGraveForm` / `NewGraveForm` (Task 6), `SaveGraveError` / `UNKNOWN_SAVE_MESSAGE` (Task 7), `dataStore.saveNewGrave` (Task 7).
- Produces:
  - `ConfirmDetailsScreen` props: `{ initialData: AIStructuredExtraction; capturedImage: string; telemetry: DeviceTelemetry; cemeteries: Cemetery[]; onSaved: (grave: Grave) => void; onRequireSignIn: () => void; onBack: () => void }`
  - `AIProcessingScreen` gains prop `onEnterManually: () => void`

- [ ] **Step 1: Replace the Confirm screen**

Replace the entire contents of `src/components/screens/ConfirmDetailsScreen.tsx` with:

```tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { AlertTriangle, ArrowLeft, Calendar, CheckCircle2, Loader2 } from 'lucide-react';
import { AIStructuredExtraction, Cemetery, DeviceTelemetry, Grave } from '@/types';
import { dataStore } from '@/lib/data/store';
import { findCemeteryForLocation } from '@/lib/capture/cemeteryForLocation';
import { NewGraveForm, validateNewGraveForm } from '@/lib/capture/newGrave';
import { SaveGraveError, UNKNOWN_SAVE_MESSAGE } from '@/lib/supabase/saveGraveErrors';

interface ConfirmDetailsScreenProps {
  initialData: AIStructuredExtraction;
  capturedImage: string;
  telemetry: DeviceTelemetry;
  cemeteries: Cemetery[];
  onSaved: (grave: Grave) => void;
  onRequireSignIn: () => void;
  onBack: () => void;
}

const labelClass = 'block text-[11px] font-semibold text-slate-500 mb-0.5';
const inputClass =
  'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-forest';

export const ConfirmDetailsScreen: React.FC<ConfirmDetailsScreenProps> = ({
  initialData,
  capturedImage,
  telemetry,
  cemeteries,
  onSaved,
  onRequireSignIn,
  onBack,
}) => {
  const detectedCemetery = useMemo(
    () => findCemeteryForLocation(cemeteries, telemetry.latitude, telemetry.longitude),
    [cemeteries, telemetry.latitude, telemetry.longitude]
  );

  // Blank when the stone couldn't be read, so nobody saves a grave under another person's details
  const [form, setForm] = useState<NewGraveForm>(() => ({
    firstName: initialData.firstName || '',
    middleNames: initialData.middleNames?.join(' ') || '',
    surname: initialData.surname || '',
    nickname: '',
    graveNumber: initialData.graveNumber || '',
    birthDate: initialData.birthDate || '',
    deathDate: initialData.deathDate || '',
    cemeteryId: detectedCemetery?.id || '',
  }));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cemeteries can finish loading after the screen opens
  useEffect(() => {
    if (detectedCemetery) {
      setForm((prev) => (prev.cemeteryId ? prev : { ...prev, cemeteryId: detectedCemetery.id }));
    }
  }, [detectedCemetery]);

  const { valid, errors } = validateNewGraveForm(form);
  const selectedCemetery = cemeteries.find((cemetery) => cemetery.id === form.cemeteryId);
  const outsideSelectedBoundary = Boolean(selectedCemetery) && detectedCemetery?.id !== selectedCemetery?.id;
  const confidencePercent = Math.round((initialData.confidence ?? 0) * 100);

  const update =
    (field: keyof NewGraveForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSave = async () => {
    if (!valid || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const grave = await dataStore.saveNewGrave({
        form,
        cemeteryName: selectedCemetery?.name,
        photoDataUrl: capturedImage,
        telemetry,
      });
      onSaved(grave);
    } catch (err) {
      setIsSaving(false);
      setError(err instanceof SaveGraveError ? err.message : UNKNOWN_SAVE_MESSAGE);
      if (err instanceof SaveGraveError && err.code === 'signed-out') onRequireSignIn();
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden justify-between">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-slate-200/80 flex items-center shrink-0">
        <button
          onClick={onBack}
          disabled={isSaving}
          className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-colors mr-2 disabled:opacity-40"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">Confirm Details</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Photo and what it is for */}
        <div className="flex space-x-3 items-start">
          <div className="w-20 h-28 rounded-xl overflow-hidden relative shrink-0 bg-slate-800 border border-slate-300 shadow-sm">
            <Image src={capturedImage} alt="Captured gravestone" fill className="object-cover" />
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Check the details below. If the stone has no readable details, the photo still records the grave&apos;s
            location and direction, so type the details in.
          </p>
        </div>

        {/* Cemetery */}
        <div>
          <label htmlFor="cemetery" className={labelClass}>
            Cemetery *
          </label>
          <select id="cemetery" value={form.cemeteryId} onChange={update('cemeteryId')} className={inputClass}>
            <option value="">Choose a cemetery</option>
            {cemeteries.map((cemetery) => (
              <option key={cemetery.id} value={cemetery.id}>
                {cemetery.name}
              </option>
            ))}
          </select>
          {!detectedCemetery && (
            <p className="mt-1 flex items-start text-[11px] text-amber-700">
              <AlertTriangle className="w-3.5 h-3.5 mr-1 shrink-0" />
              Your location isn&apos;t inside a cemetery we know. Choose the cemetery this grave is in.
            </p>
          )}
          {detectedCemetery && outsideSelectedBoundary && selectedCemetery && (
            <p className="mt-1 flex items-start text-[11px] text-amber-700">
              <AlertTriangle className="w-3.5 h-3.5 mr-1 shrink-0" />
              This location is outside {selectedCemetery.name}&apos;s boundary.
            </p>
          )}
        </div>

        {/* Person */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="firstName" className={labelClass}>
              First name *
            </label>
            <input id="firstName" type="text" value={form.firstName} onChange={update('firstName')} className={inputClass} />
          </div>
          <div>
            <label htmlFor="surname" className={labelClass}>
              Surname *
            </label>
            <input id="surname" type="text" value={form.surname} onChange={update('surname')} className={inputClass} />
          </div>
        </div>

        <div>
          <label htmlFor="middleNames" className={labelClass}>
            Middle names
          </label>
          <input id="middleNames" type="text" value={form.middleNames} onChange={update('middleNames')} className={inputClass} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="nickname" className={labelClass}>
              Nickname
            </label>
            <input id="nickname" type="text" value={form.nickname} onChange={update('nickname')} className={inputClass} />
          </div>
          <div>
            <label htmlFor="graveNumber" className={labelClass}>
              Grave number
            </label>
            <input id="graveNumber" type="text" value={form.graveNumber} onChange={update('graveNumber')} className={inputClass} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="birthDate" className={labelClass}>
              Date of birth
            </label>
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input id="birthDate" type="date" value={form.birthDate} onChange={update('birthDate')} className={`${inputClass} pl-9`} />
            </div>
          </div>
          <div>
            <label htmlFor="deathDate" className={labelClass}>
              Date of death
            </label>
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input id="deathDate" type="date" value={form.deathDate} onChange={update('deathDate')} className={`${inputClass} pl-9`} />
            </div>
          </div>
        </div>

        {/* AI Confidence Indicator matching Screen 10 */}
        <div className="flex items-center justify-between py-2 px-1">
          <span className="text-xs font-semibold text-slate-600">AI Extraction Confidence</span>
          <span className="text-xs font-bold text-slate-800">{confidencePercent}%</span>
        </div>

        {/* Raw OCR text, kept so the original reading can be checked */}
        <div className="p-3 bg-slate-100 rounded-xl border border-slate-200 text-xs">
          <div className="font-bold text-slate-700 text-[11px] mb-1.5">Text read from the photo</div>
          <pre className="bg-white p-2 rounded-lg text-[11px] font-mono text-slate-700 whitespace-pre-wrap border border-slate-200/70 max-h-24 overflow-y-auto">
            {initialData.rawOcrText || 'No text could be read from this photo.'}
          </pre>
        </div>
      </div>

      {/* Save */}
      <div className="p-4 bg-white border-t border-slate-200/80 space-y-3 shrink-0">
        {error && (
          <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
            {error}
          </div>
        )}
        <button
          onClick={handleSave}
          disabled={!valid || isSaving}
          className="w-full py-3 px-4 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold shadow-md transition-all active:scale-[0.99] flex items-center justify-center space-x-2 disabled:opacity-50 disabled:active:scale-100"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {/* The label names what's still missing, so there's no need for separate field errors */}
          <span>
            {isSaving
              ? 'Saving…'
              : errors.firstName || errors.surname
                ? 'Enter a first name and surname'
                : errors.cemeteryId
                  ? 'Choose a cemetery'
                  : 'Confirm & Save'}
          </span>
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Add an error state to the processing screen**

In `src/components/screens/AIProcessingScreen.tsx`:

Change the lucide import to add `AlertTriangle`:

```tsx
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Clock,
  Sparkles,
} from 'lucide-react';
```

Replace the props interface and destructuring:

```tsx
interface AIProcessingScreenProps {
  capturedImage: string;
  telemetry: DeviceTelemetry;
  onProcessingFinished: (finalState: AIProcessingState) => void;
  onEnterManually: () => void;
  onBack: () => void;
}

export const AIProcessingScreen: React.FC<AIProcessingScreenProps> = ({
  capturedImage,
  telemetry,
  onProcessingFinished,
  onEnterManually,
  onBack,
}) => {
```

After the `useState<AIProcessingState>` block add:

```tsx
  const [error, setError] = useState<string | null>(null);
```

Replace:

```tsx
      .catch((err) => {
        console.error('AI Pipeline error:', err);
      });
```

with:

```tsx
      .catch((err: unknown) => {
        console.error('AI Pipeline error:', err);
        if (isMounted) setError(err instanceof Error ? err.message : 'The photo could not be processed.');
      });
```

Replace the bottom banner:

```tsx
      {/* Subtext Banner matching Screen 9 */}
      <div className="p-6 text-center">
        <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
          This may take a few moments. You can continue to use the app.
        </p>
      </div>
```

with:

```tsx
      {error ? (
        <div className="p-4 bg-white border-t border-slate-200/80 space-y-3">
          <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start">
            <AlertTriangle className="w-4 h-4 mr-2 shrink-0" />
            <span>
              <b className="font-semibold">The photo couldn&apos;t be read.</b> {error}
            </span>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={onBack}
              className="flex-1 py-3 px-4 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Retake
            </button>
            <button
              onClick={onEnterManually}
              className="flex-1 py-3 px-4 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold shadow-md transition-all"
            >
              Enter details manually
            </button>
          </div>
        </div>
      ) : (
        <div className="p-6 text-center">
          <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
            This may take a few moments. You can continue to use the app.
          </p>
        </div>
      )}
```

- [ ] **Step 3: Wire the page**

In `src/app/page.tsx`:

1. Change the React import to include `useCallback`:

```tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
```

2. Above `function QabrMapAppContent() {` add:

```tsx
// Used when the photo couldn't be read, so the user types everything in
const EMPTY_EXTRACTION: AIStructuredExtraction = {
  graveNumber: '',
  firstName: '',
  middleNames: [],
  surname: '',
  fullName: '',
  confidence: 0,
  rawOcrText: '',
  otherText: [],
  fieldConfidences: { graveNumber: 0, fullName: 0, dates: 0 },
};
```

3. Replace the capture state block:

```tsx
  // Capture & AI Pipeline Temporary State
  const [capturedImage, setCapturedImage] = useState<string>('/sample-gravestone.svg');
  const [capturedTelemetry, setCapturedTelemetry] = useState<DeviceTelemetry>({
    latitude: -33.967521,
    longitude: 18.503277,
    gpsAccuracy: 4.2,
    headingDegrees: 62.0,
    timestamp: new Date().toISOString(),
  });
  const [extractedData, setExtractedData] = useState<AIStructuredExtraction>({
    graveNumber: '',
    firstName: '',
    middleNames: [],
    surname: '',
    fullName: '',
    confidence: 0,
    rawOcrText: '',
    otherText: [],
    fieldConfidences: { graveNumber: 0, fullName: 0, dates: 0 },
  });
```

with:

```tsx
  // Capture & AI Pipeline Temporary State: empty until a photo is actually taken
  const [capturedImage, setCapturedImage] = useState<string>('');
  const [capturedTelemetry, setCapturedTelemetry] = useState<DeviceTelemetry | null>(null);
  const [extractedData, setExtractedData] = useState<AIStructuredExtraction>(EMPTY_EXTRACTION);

  const { user, openAuthModal, loading: authLoading } = useAuth();
  // Set by the ?mode=capture home screen shortcut; acted on once auth has loaded
  const pendingCaptureLaunch = useRef(false);
```

4. Delete the later line `  const { user, openAuthModal } = useAuth();` (just above `return (`).

5. Replace the launch-mode block:

```tsx
    if (launchMode === 'search' || launchMode === 'capture') {
      setCurrentNavTab(launchMode);
      setCurrentScreen(launchMode);
```

with:

```tsx
    if (launchMode === 'search' || launchMode === 'capture') {
      if (launchMode === 'search') {
        setCurrentNavTab('search');
        setCurrentScreen('search');
      } else {
        pendingCaptureLaunch.current = true;
      }
```

6. Directly after the load effect (the one ending `return () => unsub();\n  }, []);`) add:

```tsx
  // Mapping a grave records who added it, so signed-out visitors are asked to sign in first
  const openCapture = useCallback(() => {
    if (!user) {
      openAuthModal();
      return;
    }
    setCurrentNavTab('capture');
    setPhotoTargetGrave(null);
    setCurrentScreen('capture');
  }, [user, openAuthModal]);

  useEffect(() => {
    if (!pendingCaptureLaunch.current || authLoading) return;
    pendingCaptureLaunch.current = false;
    openCapture();
  }, [authLoading, openCapture]);
```

7. Replace `handleSelectNavTab`:

```tsx
  const handleSelectNavTab = (tab: NavTab) => {
    setCurrentNavTab(tab);
    if (tab === 'home') setCurrentScreen('home');
    if (tab === 'search') setCurrentScreen('search');
    if (tab === 'capture') {
      setPhotoTargetGrave(null);
      setCurrentScreen('capture');
    }
    if (tab === 'surveys') setCurrentScreen('survey-session');
    if (tab === 'profile') setCurrentScreen('profile');
  };
```

with:

```tsx
  const handleSelectNavTab = (tab: NavTab) => {
    if (tab === 'capture') {
      openCapture();
      return;
    }
    setCurrentNavTab(tab);
    if (tab === 'home') setCurrentScreen('home');
    if (tab === 'search') setCurrentScreen('search');
    if (tab === 'surveys') setCurrentScreen('survey-session');
    if (tab === 'profile') setCurrentScreen('profile');
  };
```

8. Replace `handleProcessingFinished` and `handleSaveGrave`:

```tsx
  // AI Pipeline Finished Handover
  const handleProcessingFinished = (state: AIProcessingState) => {
    if (state.data?.structured) {
      setExtractedData(state.data.structured);
    }
    setCurrentScreen('confirm-details');
  };

  // Save Grave Confirmation
  const handleSaveGrave = async (grave: Grave) => {
    const saved = await dataStore.saveNewGrave(grave);
    setSelectedGrave(saved);
    const updated = await dataStore.getGraves(selectedCemetery?.id);
    setGraves(updated);
    setSurveySession(dataStore.getActiveSurveySession());
    setCurrentScreen('survey-session');
  };
```

with:

```tsx
  // AI Pipeline Finished Handover. Stable so the processing screen doesn't restart the pipeline on every render.
  const handleProcessingFinished = useCallback((state: AIProcessingState) => {
    setExtractedData(state.data?.structured ?? EMPTY_EXTRACTION);
    setCurrentScreen('confirm-details');
  }, []);

  const handleEnterDetailsManually = () => {
    setExtractedData(EMPTY_EXTRACTION);
    setCurrentScreen('confirm-details');
  };

  // A saved grave opens on its own details page
  const handleGraveSaved = (saved: Grave) => {
    setSelectedGrave(saved);
    const cemetery = cemeteries.find((c) => c.id === saved.cemeteryId);
    if (cemetery) setSelectedCemetery(cemetery);
    dataStore.getGraves(saved.cemeteryId).then(setGraves);
    setSurveySession({ ...dataStore.getActiveSurveySession() });
    setPreviousScreen('home');
    setCurrentNavTab('home');
    setCurrentScreen('grave-details');
  };
```

9. In the `HomeScreen` `onNavigate` handler replace:

```tsx
              } else if (screen === 'capture') {
                setCurrentNavTab('capture');
                setPhotoTargetGrave(null);
                setCurrentScreen('capture');
```

with:

```tsx
              } else if (screen === 'capture') {
                openCapture();
```

10. Replace the three capture-flow render blocks:

```tsx
        {currentScreen === 'ai-processing' && (
          <AIProcessingScreen
            capturedImage={capturedImage}
            telemetry={capturedTelemetry}
            onProcessingFinished={handleProcessingFinished}
            onBack={() => setCurrentScreen('capture')}
          />
        )}

        {currentScreen === 'confirm-details' && (
          <ConfirmDetailsScreen
            initialData={extractedData}
            capturedImage={capturedImage}
            telemetry={capturedTelemetry}
            cemeteryId={selectedCemetery?.id}
            onSaveGrave={handleSaveGrave}
            onBack={() => setCurrentScreen('capture')}
          />
        )}

        {currentScreen === 'add-photo' && photoTargetGrave && (
```

with:

```tsx
        {currentScreen === 'ai-processing' && capturedTelemetry && (
          <AIProcessingScreen
            capturedImage={capturedImage}
            telemetry={capturedTelemetry}
            onProcessingFinished={handleProcessingFinished}
            onEnterManually={handleEnterDetailsManually}
            onBack={() => setCurrentScreen('capture')}
          />
        )}

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

        {currentScreen === 'add-photo' && photoTargetGrave && capturedTelemetry && (
```

11. In the `SurveySessionScreen` render replace:

```tsx
            onCaptureNextGrave={() => setCurrentScreen('capture')}
```

with:

```tsx
            onCaptureNextGrave={openCapture}
```

- [ ] **Step 4: Type check and run all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors (the Task 7 error in `page.tsx` is gone); all tests pass.

- [ ] **Step 5: Smoke test in the browser**

Run the dev server (`npm run dev`) and open the printed URL.
- Signed out: tap the Capture tab and the "Map a grave" card. Expected: the sign-in modal opens and the Capture screen does not.
- Open `/?mode=capture` signed out. Expected: sign-in modal opens after the page loads.
- Browser console has no new errors on the home screen.

- [ ] **Step 6: Commit**

```bash
git add src/components/screens/ConfirmDetailsScreen.tsx src/components/screens/AIProcessingScreen.tsx src/app/page.tsx
git commit -F - <<'EOF'
feat(capture): confirm and save new graves with real details

Capture now needs a signed-in user. The Confirm screen picks the cemetery
from GPS with a picker, requires only a first name and surname, adds
nickname and date pickers, and shows save errors without losing the form.
A saved grave opens on its details page. The processing screen offers
Retake or manual entry when a photo can't be read.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 9: AR guidance compass (gated on the user's uncommitted work)

**Files:**
- Modify: `src/components/screens/ARGuidanceScreen.tsx`

**Interfaces:**
- Consumes: `useCompassHeading` (Task 4), `graveNumberLabel` (Task 3).

- [ ] **Step 1: Check for the user's uncommitted changes**

Run: `git diff --stat -- src/components/screens/ARGuidanceScreen.tsx`
If it prints anything, STOP and ask the user to commit or stash their AR changes first. Do not commit their work as part of this task. Continue only once the file has no uncommitted changes.

- [ ] **Step 2: Switch AR to the shared compass**

In `src/components/screens/ARGuidanceScreen.tsx` add:

```tsx
import { useCompassHeading } from '@/lib/device/useCompassHeading';
import { graveNumberLabel } from '@/lib/ui/graveLabels';
```

Replace the whole effect that begins with `// Compass listener` and ends with its closing `}, []);` with:

```tsx
  // Same true-north heading that Capture saved with the grave
  const { heading: compassHeading, status: compassStatus, requestPermission } = useCompassHeading();
  useEffect(() => {
    if (compassHeading !== null) setPhoneHeading(compassHeading);
  }, [compassHeading]);
```

Replace the top-right button's `onClick` and `title`:

```tsx
          onClick={() => setPhoneHeading((h) => (h + 30) % 360)}
```

with:

```tsx
          onClick={() =>
            compassStatus === 'needs-permission' ? requestPermission() : setPhoneHeading((h) => (h + 30) % 360)
          }
```

and:

```tsx
          title="Simulate heading rotate"
```

with:

```tsx
          title={compassStatus === 'needs-permission' ? 'Enable compass' : 'Simulate heading rotate'}
```

Replace the grave number line in the bottom card:

```tsx
            <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">
              Grave {targetGrave.graveNumber}
            </div>
```

with:

```tsx
            {graveNumberLabel(targetGrave) && (
              <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">{graveNumberLabel(targetGrave)}</div>
            )}
```

- [ ] **Step 3: Type check and run all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/screens/ARGuidanceScreen.tsx
git commit -F - <<'EOF'
fix(ar): use the shared true-north compass in AR guidance

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 10: Apply the migration and verify end to end

**Files:** none changed. This task needs the user.

- [ ] **Step 1: Ask the user to apply the migration**

Ask the user to open Supabase Dashboard > SQL Editor > New query, paste `supabase/migrations/20260915120000_create_mapped_grave.sql`, and run it. (If the Supabase MCP server is authorized, it can be applied from the session instead, with the user's approval.)

- [ ] **Step 2: Confirm the function exists and anon can't call it**

Run from the repo root:

```bash
node -e '
const fs=require("fs");
const env=Object.fromEntries(fs.readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1).replace(/^["\x27]|["\x27]$/g,"")]}));
const url=env.NEXT_PUBLIC_SUPABASE_URL, key=env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
fetch(url+"/rest/v1/rpc/create_mapped_grave",{method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},body:"{}"}).then(async r=>console.log(r.status, await r.text()));
fetch(url+"/rest/v1/persons?select=nickname&limit=1",{headers:{apikey:key,Authorization:"Bearer "+key}}).then(async r=>console.log("persons.nickname", r.status, await r.text()));
'
```

Expected: `persons.nickname` returns `200 []` (before the migration it is `400` with code `42703`). The anonymous RPC call must not return `200`; record whatever it returns. The save in Step 3 is the real proof the function works.

- [ ] **Step 3: Save a grave in the browser**

With the dev server running and the user signed in:
1. Open Chrome DevTools > More tools > Sensors. Set Location to latitude `-33.9681`, longitude `18.5035` (inside Athlone, adjust if the boundary differs) and set Orientation to a custom value.
2. Tap Capture. Expected: the shutter enables once the camera is live, the hint reads "Position the gravestone in the frame".
3. Take the photo, wait for processing, enter first name, surname and a nickname, leave the grave number blank, and save.
4. Expected: the grave details page opens with the name, "Known as ...", the correct cemetery, and "Grave Number: Not recorded".

- [ ] **Step 4: Confirm the rows with read-only requests**

```bash
node -e '
const fs=require("fs");
const env=Object.fromEntries(fs.readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1).replace(/^["\x27]|["\x27]$/g,"")]}));
const url=env.NEXT_PUBLIC_SUPABASE_URL, key=env.NEXT_PUBLIC_SUPABASE_ANON_KEY, h={apikey:key,Authorization:"Bearer "+key};
(async()=>{for(const p of ["graves?select=id,cemetery_id,grave_number,status,position_confidence,orientation_degrees,primary_photo_url,photo_count,created_by,person:persons(full_name,nickname)&order=created_at.desc&limit=3","grave_photos?select=grave_id,is_primary,heading_degrees,gps_accuracy_meters&order=created_at.desc&limit=3"]){const r=await fetch(url+"/rest/v1/"+p,{headers:h});console.log(p.split("?")[0], r.status, await r.text())}})();
'
```

Expected: the new grave has `created_by` set, `photo_count` 1, a storage `primary_photo_url`, the heading in `orientation_degrees`, and the nickname on the person. `grave_photos` has one primary row with the heading and accuracy.

- [ ] **Step 5: Check duplicate and offline errors**

1. Capture a grave with number `9999` and save. Capture another with number `9999` in the same cemetery. Expected: "Grave 9999 is already mapped at ..." and the form keeps its values. The Supabase Storage bucket has no extra file for the failed save.
2. In DevTools Network, choose Offline and tap Save. Expected: "You're offline. Connect to the internet and tap Save again." with the form intact.
3. Ask the user whether to delete the test graves from the Table Editor.

- [ ] **Step 6: Real device check**

Ask the user to open the deployed or tunnelled HTTPS app on an Android phone and an iPhone and confirm:
- iPhone shows "Enable compass" on Capture, and the heading appears after allowing it.
- Android shows a heading without a prompt, and it points the right way when facing north.
- Navigation and AR headings turn in the same direction as the phone.

- [ ] **Step 7: Final test run**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass, no type errors.
