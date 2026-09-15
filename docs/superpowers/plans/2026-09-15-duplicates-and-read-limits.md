# Duplicate Detection and Photo Read Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two people photographing the same grave end up with one grave and two photos, a son buried in his father's grave can still be mapped, and photo reading with GPT-5.6 Luna is rate limited and cached on the server.

**Architecture:** Two new migrations. The first drops the unique grave number index and adds `find_matching_graves` (read-only matching by distance, grave number, name similarity and dates) and `save_or_add_grave` (creates a grave, adds a photo to an existing one, or reports a match, under a per-cemetery advisory lock). The second adds `photo_reads` with `begin_photo_read` and `finish_photo_read`. The read-stone route moves into a dependency-injected handler that hashes the photo, checks the limits and reuses cached readings. On the phone, `saveMappedGrave` calls the new function, and the Confirm screen shows a duplicate card with "Add my photo to this grave" and "It's a different person".

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Supabase (Postgres 17, PostgREST RPC, supabase-js v2), pg_trgm, OpenAI Node SDK 7.15, Vitest 2, Docker `postgres:17` for local SQL checks.

**Spec:** `docs/superpowers/specs/2026-09-15-my-surveys-design.md` (sections 4 and 5, plus the Capture part of section 5). Plan 2, `docs/superpowers/plans/2026-09-15-my-surveys-queue.md`, builds the survey queue on top of this plan.

## Global Constraints

- Never use em dashes in code comments, UI copy, SQL comments, commit messages or docs. Use commas, colons, periods or parentheses.
- Runtime imports inside `src/lib/**` use relative paths (`../supabase/client`), because Vitest has no `@/` alias. Type-only imports may use `@/types`. Components may use `@/`.
- Match the surrounding code: short comments that explain why, 2-space indent, single quotes, Tailwind classes in the existing style.
- SQL functions: `security definer` functions use `set search_path = ''`, fully qualified names (`public.graves`, `extensions.similarity`), `v_caller uuid := (select auth.uid());`, raise `42501` when there is no caller, and `revoke execute ... from public, anon;` then `grant execute ... to authenticated;`. Migrations must be safe to run more than once.
- Matching rules (verbatim from the spec): candidates are graves in the same cemetery within `least(20, greatest(10, new accuracy + existing position_accuracy_meters))` metres by haversine, or with the same non-empty grave number; a different non-empty grave number excludes; `extensions.similarity()` of normalised "first name surname" must be 0.85 or higher; both dates of birth known decides first, then both dates of death; `strong` when a compared date is equal, `possible` when none could be compared; at most 3 rows, strong first, then by distance.
- Read limits (verbatim): 60 reads per user in 10 minutes, 500 in 24 hours, error `53400` "Too many photos read. Try again later."; a reading for the same user and photo hash within 24 hours is returned as `cached`.
- `create_mapped_grave` stays in the database. Do not drop it.
- Do not push, deploy, or run SQL against the live Supabase project. The user runs migrations in the SQL Editor.
- Always `git add` explicit paths, never `git add -A` or `git add .`.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
- Run one test file: `npx vitest run tests/<file>.test.ts`. Run all tests: `npx vitest run`. Type check: `npx tsc --noEmit` (if it fails on stale `.next/types`, run `rm -rf .next/types` and retry). Baseline before this plan: 33 files, 208 tests passing, type check clean.
- Local Postgres scratch directory (call it `$PGWORK` below): `C:/Users/rizaa/AppData/Local/Temp/claude/d--Development-Projects-QabrMap-Code/f6cdb8ef-95a9-4c4c-853b-1bf7e4d91db8/scratchpad/migration-test`. It already holds `00_supabase_stub.sql`, `01_initial.sql` (001 without the postgis line) and `02_grave_photos.sql`. In Git Bash, prefix every `docker` command that passes a `/work` path with `MSYS_NO_PATHCONV=1`.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/20260915180000_duplicate_graves.sql` | Create | Drop unique grave number index, pg_trgm, `normalised_person_name`, `find_matching_graves`, `save_or_add_grave` |
| `tests/duplicate_graves_migration.test.ts` | Create | Checks the migration text |
| `supabase/migrations/20260915181000_photo_read_limits.sql` | Create | `photo_reads`, `begin_photo_read`, `finish_photo_read` |
| `tests/photo_read_limits_migration.test.ts` | Create | Checks the migration text |
| `src/lib/ai/photoHash.ts` | Create | SHA-256 of a data URL's image bytes (server only) |
| `src/lib/ai/readStoneRequest.ts` | Create | `handleReadStone`: auth, limits, cache, model call, recording |
| `src/app/api/graves/read-stone/route.ts` | Modify | Wires `handleReadStone` to Supabase and OpenAI |
| `tests/read_stone_route.test.ts` | Create | Handler tests with fakes |
| `src/lib/graves/matchCandidate.ts` | Create | `MatchCandidate`, `matchCheckParams`, `mapMatchCandidate`, `describeMatchCandidate`, `matchHeading`, `findMatchingGraves` |
| `tests/match_candidate.test.ts` | Create | Tests for the above |
| `src/lib/supabase/saveGraveErrors.ts` | Modify | `grave-missing` code for `P0002` |
| `src/lib/capture/saveMappedGrave.ts` | Modify | Calls `save_or_add_grave`, returns an outcome |
| `tests/save_mapped_grave.test.ts` | Modify | New RPC, outcomes, add-to |
| `src/lib/data/store.ts` | Modify | `saveNewGrave` returns an outcome, `findMatchingGraves` |
| `src/components/common/DuplicateMatchCard.tsx` | Create | The "Already mapped nearby" card |
| `src/components/screens/ConfirmDetailsScreen.tsx` | Modify | Runs the match check, shows the card, saves in ask/new/add-to |
| `src/app/page.tsx` | Modify | `handleGraveSaved` takes the outcome |

---

### Task 1: Duplicate graves migration

**Files:**
- Create: `supabase/migrations/20260915180000_duplicate_graves.sql`
- Test: `tests/duplicate_graves_migration.test.ts`
- Scratch (not committed): `$PGWORK/00_supabase_stub.sql` (append), `$PGWORK/03_create_mapped_grave.sql`, `$PGWORK/04_delete_mapped_grave.sql`, `$PGWORK/05_duplicate_graves.sql`, `$PGWORK/97_verify_duplicates.sql`, `$PGWORK/97_race_a.sql`, `$PGWORK/97_race_b.sql`

**Interfaces:**
- Produces: `public.find_matching_graves(p_cemetery_id text, p_latitude double precision, p_longitude double precision, p_accuracy_meters double precision, p_first_name text, p_surname text, p_birth_date date, p_death_date date, p_grave_number text) returns table (grave_id text, full_name text, birth_date date, death_date date, grave_number text, distance_meters double precision, match text)`.
- Produces: `public.save_or_add_grave(<the 17 create_mapped_grave parameters in the same order>, p_match_mode text, p_add_to_grave_id text default null) returns jsonb`. The jsonb is `{ "outcome": "created" | "added-photo" | "match-found", "grave_id": text | null, "candidate": { grave_id, full_name, birth_date, death_date, grave_number, distance_meters, match } | null }` (`candidate` is absent for `created`). Raises `42501` when not signed in, `22023` for invalid input or an unknown mode, `P0002` when `p_add_to_grave_id` is not a grave in that cemetery.

- [ ] **Step 1: Write the failing test**

Create `tests/duplicate_graves_migration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20260915180000_duplicate_graves.sql'),
  'utf8'
);

describe('Duplicate Graves Migration Tests', () => {
  it('lets one numbered grave hold several burials', () => {
    expect(MIGRATION).toMatch(/drop index if exists public\.graves_cemetery_grave_number_unique_idx;/);
    expect(MIGRATION).toMatch(
      /create index if not exists graves_cemetery_grave_number_idx\s+on public\.graves \(cemetery_id, grave_number\)\s+where grave_number <> '';/
    );
    expect(MIGRATION).not.toMatch(/create unique index/i);
  });

  it('enables trigram matching in the extensions schema', () => {
    expect(MIGRATION).toMatch(/create extension if not exists pg_trgm with schema extensions;/);
    expect(MIGRATION).toMatch(/extensions\.similarity\(/);
  });

  it('finds matches with a read-only function that signed-in users can call', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.find_matching_graves\(/);
    expect(MIGRATION).toMatch(/stable\s+security invoker\s+set search_path = ''/);
    expect(MIGRATION).toMatch(/revoke execute on function public\.find_matching_graves\([^)]*\) from public, anon;/);
    expect(MIGRATION).toMatch(/grant execute on function public\.find_matching_graves\([^)]*\) to authenticated;/);
  });

  it('matches by GPS radius or grave number, name similarity, then date of birth and date of death', () => {
    expect(MIGRATION).toMatch(/least\(20, greatest\(10, coalesce\(p_accuracy_meters, 0\) \+ c\.existing_accuracy\)\)/);
    expect(MIGRATION).toMatch(/extensions\.similarity\([^;]*\) >= 0\.85/);
    expect(MIGRATION).toMatch(/when p_birth_date is not null and c\.birth_date is not null then c\.birth_date = p_birth_date/);
    expect(MIGRATION).toMatch(/when p_death_date is not null and c\.death_date is not null then c\.death_date = p_death_date/);
    expect(MIGRATION).toMatch(/limit 3/);
  });

  it('saves through a locked-down security definer that checks the caller', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.save_or_add_grave\(/);
    expect(MIGRATION).toMatch(/returns jsonb\s+language plpgsql\s+security definer\s+set search_path = ''/);
    expect(MIGRATION).toMatch(/v_caller uuid := \(select auth\.uid\(\)\);/);
    expect(MIGRATION).toMatch(/if v_caller is null then\s+raise exception '[^']+' using errcode = '42501';/);
    expect(MIGRATION).toMatch(/revoke execute on function public\.save_or_add_grave\([^)]*\) from public, anon;/);
    expect(MIGRATION).toMatch(/grant execute on function public\.save_or_add_grave\([^)]*\) to authenticated;/);
  });

  it('serialises saves in a cemetery and treats retries as already saved', () => {
    expect(MIGRATION).toMatch(/perform pg_advisory_xact_lock\(hashtext\(p_cemetery_id\)\);/);
    expect(MIGRATION).toMatch(/if exists \(select 1 from public\.graves where id = p_grave_id and created_by = v_caller\) then/);
    expect(MIGRATION).toMatch(/where public_url = p_photo_public_url and uploaded_by = v_caller/);
  });

  it('asks about any match, auto-adds only strong matches, and never makes an added photo primary', () => {
    expect(MIGRATION).toMatch(/p_match_mode not in \('ask', 'auto', 'new'\)/);
    expect(MIGRATION).toMatch(/if p_match_mode = 'auto' and v_match\.match = 'strong' then/);
    expect(MIGRATION).toMatch(/'outcome', 'match-found'/);
    expect(MIGRATION).toMatch(/v_target_grave_id,\s+nullif\(p_photo_storage_path, ''\),\s+p_photo_public_url,\s+v_caller,\s+false,/);
  });

  it('keeps create_mapped_grave for the app that is still live', () => {
    expect(MIGRATION).not.toMatch(/drop function/i);
  });

  it('calls auth.uid() once, wrapped in a select', () => {
    expect(MIGRATION.replace(/\(select auth\.uid\(\)\)/g, '')).not.toMatch(/auth\.uid\(\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/duplicate_graves_migration.test.ts`
Expected: FAIL with `ENOENT: no such file or directory` for the migration.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260915180000_duplicate_graves.sql`:

```sql
-- ============================================================
-- QabrMap: duplicate detection, and graves that hold several burials
-- Run in Supabase Dashboard > SQL Editor > New query. Safe to run more than once.
-- ============================================================

-- A numbered grave can hold more than one burial, such as a son buried in his father's grave, so a number is
-- no longer unique in a cemetery. Duplicate detection below stops the same person being mapped twice.
drop index if exists public.graves_cemetery_grave_number_unique_idx;
create index if not exists graves_cemetery_grave_number_idx
  on public.graves (cemetery_id, grave_number)
  where grave_number <> '';

-- A retried "add my photo" is recognised by the file it uploaded
create index if not exists grave_photos_uploaded_by_public_url_idx on public.grave_photos (uploaded_by, public_url);

create extension if not exists pg_trgm with schema extensions;

-- Lower case, trimmed, single spaces, so "  Yusuf   KAMISH " and "yusuf kamish" compare equal
create or replace function public.normalised_person_name(p_first_name text, p_surname text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(concat_ws(' ', btrim(p_first_name), btrim(p_surname))), '\s+', ' ', 'g'))
$$;

-- Graves already mapped that could be the person being saved. Graves and persons are publicly readable,
-- so this runs as the caller.
create or replace function public.find_matching_graves(
  p_cemetery_id text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_first_name text,
  p_surname text,
  p_birth_date date,
  p_death_date date,
  p_grave_number text
)
returns table (
  grave_id text,
  full_name text,
  birth_date date,
  death_date date,
  grave_number text,
  distance_meters double precision,
  match text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with candidates as (
    select
      g.id,
      p.full_name,
      p.birth_date,
      p.death_date,
      g.grave_number,
      -- Haversine distance in metres; graves store plain latitude and longitude
      2 * 6371000 * asin(sqrt(
        power(sin(radians(g.latitude - p_latitude) / 2), 2)
        + cos(radians(p_latitude)) * cos(radians(g.latitude)) * power(sin(radians(g.longitude - p_longitude) / 2), 2)
      )) as distance_meters,
      coalesce(g.position_accuracy_meters, 0)::double precision as existing_accuracy,
      public.normalised_person_name(p.first_name, p.surname) as name
    from public.graves g
    join public.persons p on p.id = g.person_id
    where g.cemetery_id = p_cemetery_id
  ),
  matches as (
    select
      c.*,
      case
        when (p_birth_date is not null and c.birth_date is not null)
          or (p_death_date is not null and c.death_date is not null) then 'strong'
        else 'possible'
      end as match
    from candidates c
    where
      -- Close enough that two GPS fixes of one stone could differ this much, or the same grave number
      (
        c.distance_meters <= least(20, greatest(10, coalesce(p_accuracy_meters, 0) + c.existing_accuracy))
        or (btrim(coalesce(p_grave_number, '')) <> '' and lower(c.grave_number) = lower(btrim(p_grave_number)))
      )
      -- Two different numbers are two different graves
      and not (
        btrim(coalesce(p_grave_number, '')) <> '' and c.grave_number <> ''
        and lower(c.grave_number) <> lower(btrim(p_grave_number))
      )
      -- A different name is a different person, even in the same grave
      and extensions.similarity(c.name, public.normalised_person_name(p_first_name, p_surname)) >= 0.85
      -- People with the same name: date of birth decides, then date of death, so a father and son stay apart
      and case
        when p_birth_date is not null and c.birth_date is not null then c.birth_date = p_birth_date
        when p_death_date is not null and c.death_date is not null then c.death_date = p_death_date
        else true
      end
  )
  select
    m.id,
    m.full_name,
    m.birth_date,
    m.death_date,
    m.grave_number,
    round(m.distance_meters::numeric, 1)::double precision,
    m.match
  from matches m
  order by m.match = 'strong' desc, m.distance_meters
  limit 3
$$;

revoke execute on function public.find_matching_graves(text, double precision, double precision, double precision, text, text, date, date, text) from public, anon;
grant execute on function public.find_matching_graves(text, double precision, double precision, double precision, text, text, date, date, text) to authenticated;

-- Saves a captured grave. Depending on p_match_mode it creates the grave (new), reports a likely match
-- without writing anything (ask), or adds the photo to a strong match (auto). With p_add_to_grave_id it adds
-- the photo to that grave. Runs as the owner, so it checks the caller itself.
create or replace function public.save_or_add_grave(
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
  p_photo_storage_path text,
  p_match_mode text,
  p_add_to_grave_id text default null
)
returns jsonb
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
  v_target_grave_id text := nullif(btrim(p_add_to_grave_id), '');
  v_existing_grave_id text;
  v_match record;
  v_candidate jsonb;
begin
  if v_caller is null then
    raise exception 'Sign in to map a grave.' using errcode = '42501';
  end if;

  if p_match_mode is null or p_match_mode not in ('ask', 'auto', 'new') then
    raise exception 'Unknown match mode.' using errcode = '22023';
  end if;

  -- Saves in one cemetery run one at a time, so two people saving the same person can't both create a grave
  perform pg_advisory_xact_lock(hashtext(p_cemetery_id));

  -- A retry after a lost response sends the same ids and photo; whatever the first try saved is returned
  if exists (select 1 from public.graves where id = p_grave_id and created_by = v_caller) then
    return jsonb_build_object('outcome', 'created', 'grave_id', p_grave_id);
  end if;

  select grave_id into v_existing_grave_id
    from public.grave_photos
    where public_url = p_photo_public_url and uploaded_by = v_caller
    limit 1;
  if v_existing_grave_id is not null then
    return jsonb_build_object('outcome', 'added-photo', 'grave_id', v_existing_grave_id);
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

  if v_target_grave_id is not null then
    if not exists (select 1 from public.graves where id = v_target_grave_id and cemetery_id = p_cemetery_id) then
      raise exception 'That grave no longer exists. Save this as a new grave instead.' using errcode = 'P0002';
    end if;
  elsif p_match_mode <> 'new' then
    select * into v_match
      from public.find_matching_graves(
        p_cemetery_id, p_latitude, p_longitude, p_accuracy_meters,
        v_first_name, v_surname, p_birth_date, p_death_date, v_grave_number
      )
      limit 1;
    if found then
      v_candidate := jsonb_build_object(
        'grave_id', v_match.grave_id,
        'full_name', v_match.full_name,
        'birth_date', v_match.birth_date,
        'death_date', v_match.death_date,
        'grave_number', v_match.grave_number,
        'distance_meters', v_match.distance_meters,
        'match', v_match.match
      );
      -- Surveys add a photo to a clear match by themselves; anything less certain waits for a person
      if p_match_mode = 'auto' and v_match.match = 'strong' then
        v_target_grave_id := v_match.grave_id;
      else
        return jsonb_build_object('outcome', 'match-found', 'grave_id', null, 'candidate', v_candidate);
      end if;
    end if;
  end if;

  if v_target_grave_id is not null then
    -- The grave_photos trigger updates the grave's photo count
    insert into public.grave_photos (
      grave_id, storage_path, public_url, uploaded_by, is_primary,
      captured_at, capture_latitude, capture_longitude, gps_accuracy_meters, heading_degrees
    )
    values (
      v_target_grave_id,
      nullif(p_photo_storage_path, ''),
      p_photo_public_url,
      v_caller,
      false,
      p_captured_at,
      p_latitude,
      p_longitude,
      p_accuracy_meters,
      p_heading_degrees
    );
    return jsonb_build_object('outcome', 'added-photo', 'grave_id', v_target_grave_id, 'candidate', v_candidate);
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

  return jsonb_build_object('outcome', 'created', 'grave_id', p_grave_id);
end;
$$;

revoke execute on function public.save_or_add_grave(text, text, text, text, text, text, text, text, date, date, double precision, double precision, double precision, double precision, timestamptz, text, text, text, text) from public, anon;
grant execute on function public.save_or_add_grave(text, text, text, text, text, text, text, text, date, date, double precision, double precision, double precision, double precision, timestamptz, text, text, text, text) to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/duplicate_graves_migration.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Prepare the local Postgres copies**

The stub needs the `extensions` schema that Supabase provides. Append to `$PGWORK/00_supabase_stub.sql`:

```sql

-- Supabase installs extensions such as pg_trgm into this schema
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated;
```

Then copy the migrations:

```bash
PGWORK="C:/Users/rizaa/AppData/Local/Temp/claude/d--Development-Projects-QabrMap-Code/f6cdb8ef-95a9-4c4c-853b-1bf7e4d91db8/scratchpad/migration-test"
cp supabase/migrations/20260915120000_create_mapped_grave.sql "$PGWORK/03_create_mapped_grave.sql"
cp supabase/migrations/20260915150000_delete_mapped_grave.sql "$PGWORK/04_delete_mapped_grave.sql"
cp supabase/migrations/20260915180000_duplicate_graves.sql "$PGWORK/05_duplicate_graves.sql"
```

- [ ] **Step 6: Write the local checks**

Create `$PGWORK/97_verify_duplicates.sql`:

```sql
\set ON_ERROR_STOP on

delete from public.provenance_logs;
delete from public.saved_graves;
delete from public.grave_photos;
delete from public.graves;
delete from public.persons;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'first@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'second@test.local')
on conflict (id) do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- Shorthand for a save at 4 m accuracy, heading 62, in Athlone. Created as the authenticated role so it runs as that role.
create function pg_temp.save(
  p_grave_id text, p_first text, p_surname text, p_birth date, p_death date, p_number text,
  p_lat double precision, p_lng double precision, p_mode text, p_add_to text default null
) returns jsonb language sql as $$
  select public.save_or_add_grave(
    p_grave_id, replace(p_grave_id, 'grave_', 'person_'), 'cem_athlone', p_number, p_first, null, p_surname, null,
    p_birth, p_death, p_lat, p_lng, 4, 62, now(),
    'https://example.test/' || p_grave_id || '.jpg', 'cem_athlone/' || p_grave_id || '.jpg', p_mode, p_add_to
  )
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- 1. A first save creates the grave
do $$
declare r jsonb;
begin
  r := pg_temp.save('grave_yusuf', 'Yusuf', 'Kamish', '1952-02-02', '2018-06-16', '', -33.96800, 18.50300, 'ask');
  if r->>'outcome' <> 'created' then raise exception '1: got %', r; end if;
  raise notice 'OK 1: created %', r;
end $$;

-- 2. The same person 4 m away with the same date of birth is a strong match, with different spacing and case
do $$
declare r record; n int;
begin
  select count(*) into n from public.find_matching_graves('cem_athlone', -33.968036, 18.50300, 4, ' yusuf ', 'KAMISH', '1952-02-02', null, '');
  select * into r from public.find_matching_graves('cem_athlone', -33.968036, 18.50300, 4, ' yusuf ', 'KAMISH', '1952-02-02', null, '');
  if n <> 1 or r.match <> 'strong' or r.grave_id <> 'grave_yusuf' or r.distance_meters not between 3.5 and 4.5 then
    raise exception '2: got % rows, %', n, r;
  end if;
  raise notice 'OK 2: strong match %', r;
end $$;

-- 3. No dates to compare is a possible match
do $$
declare r record;
begin
  select * into r from public.find_matching_graves('cem_athlone', -33.968036, 18.50300, 4, 'Yusuf', 'Kamish', null, null, '');
  if r.match is distinct from 'possible' then raise exception '3: got %', r; end if;
  raise notice 'OK 3: possible match';
end $$;

-- 4. The radius: 30 m away is too far; 18 m matches only when the two accuracies add up past 18
do $$
declare n int;
begin
  select count(*) into n from public.find_matching_graves('cem_athlone', -33.96827, 18.50300, 4, 'Yusuf', 'Kamish', null, null, '');
  if n <> 0 then raise exception '4a: 30 m away matched'; end if;
  select count(*) into n from public.find_matching_graves('cem_athlone', -33.968162, 18.50300, 3, 'Yusuf', 'Kamish', null, null, '');
  if n <> 0 then raise exception '4b: 18 m matched with a 10 m radius'; end if;
  select count(*) into n from public.find_matching_graves('cem_athlone', -33.968162, 18.50300, 16, 'Yusuf', 'Kamish', null, null, '');
  if n <> 1 then raise exception '4c: 18 m did not match with the 20 m maximum radius'; end if;
  raise notice 'OK 4: radius';
end $$;

-- 5. A different name nearby is a different person
do $$
declare n int;
begin
  select count(*) into n from public.find_matching_graves('cem_athlone', -33.968018, 18.50300, 4, 'Fatima', 'Kamish', null, null, '');
  if n <> 0 then raise exception '5: different name matched'; end if;
  raise notice 'OK 5: different name excluded';
end $$;

-- 6. Grave numbers: a different number excludes, the same number matches from far away
do $$
declare r jsonb; n int;
begin
  r := pg_temp.save('grave_abdul', 'Abdul', 'Narker', '1947-01-28', null, '1402', -33.96900, 18.50400, 'new');
  if r->>'outcome' <> 'created' then raise exception '6: got %', r; end if;
  select count(*) into n from public.find_matching_graves('cem_athlone', -33.969018, 18.50400, 4, 'Abdul', 'Narker', '1947-01-28', null, '1403');
  if n <> 0 then raise exception '6a: a different grave number matched'; end if;
  select count(*) into n from public.find_matching_graves('cem_athlone', -33.96930, 18.50400, 4, 'Abdul', 'Narker', '1947-01-28', null, '1402');
  if n <> 1 then raise exception '6b: the same grave number 33 m away did not match'; end if;
  raise notice 'OK 6: grave numbers';
end $$;

-- 7. A son with his father's name in the same grave: a different date of birth keeps them apart, and he can be saved
do $$
declare r jsonb; n int;
begin
  select count(*) into n from public.find_matching_graves('cem_athlone', -33.96900, 18.50400, 4, 'Abdul', 'Narker', '1975-05-05', null, '1402');
  if n <> 0 then raise exception '7a: the son matched his father'; end if;
  r := pg_temp.save('grave_abdul_son', 'Abdul', 'Narker', '1975-05-05', null, '1402', -33.96900, 18.50400, 'ask');
  if r->>'outcome' <> 'created' then raise exception '7b: got %', r; end if;
  select count(*) into n from public.graves where cemetery_id = 'cem_athlone' and grave_number = '1402';
  if n <> 2 then raise exception '7c: expected two burials in grave 1402, got %', n; end if;
  raise notice 'OK 7: second burial in the same grave';
end $$;

-- 8. Ask mode reports a match and writes nothing
do $$
declare r jsonb; n int;
begin
  r := pg_temp.save('grave_ask', 'Yusuf', 'Kamish', '1952-02-02', null, '', -33.968036, 18.50300, 'ask');
  if r->>'outcome' <> 'match-found' or r->'candidate'->>'grave_id' <> 'grave_yusuf' or r->'candidate'->>'match' <> 'strong' then
    raise exception '8: got %', r;
  end if;
  select count(*) into n from public.graves where id = 'grave_ask';
  if n <> 0 then raise exception '8: ask mode created a grave'; end if;
  raise notice 'OK 8: ask mode %', r;
end $$;

-- 9. Auto mode adds the photo to a strong match, not as the primary photo
do $$
declare r jsonb; n int;
begin
  r := pg_temp.save('grave_auto', 'Yusuf', 'Kamish', null, '2018-06-16', '', -33.968036, 18.50300, 'auto');
  if r->>'outcome' <> 'added-photo' or r->>'grave_id' <> 'grave_yusuf' then raise exception '9: got %', r; end if;
  select count(*) into n from public.grave_photos where grave_id = 'grave_yusuf' and not is_primary;
  if n <> 1 then raise exception '9: expected one extra photo, got %', n; end if;
  select photo_count into n from public.graves where id = 'grave_yusuf';
  if n <> 2 then raise exception '9: photo_count is %', n; end if;
  raise notice 'OK 9: auto mode added the photo';
end $$;

-- 10. Auto mode leaves a possible match for a person to decide
do $$
declare r jsonb;
begin
  r := pg_temp.save('grave_auto_possible', 'Yusuf', 'Kamish', null, null, '', -33.968036, 18.50300, 'auto');
  if r->>'outcome' <> 'match-found' or r->'candidate'->>'match' <> 'possible' then raise exception '10: got %', r; end if;
  raise notice 'OK 10: possible match left for review';
end $$;

-- 11. New mode creates a grave even with a match
do $$
declare r jsonb;
begin
  r := pg_temp.save('grave_new', 'Yusuf', 'Kamish', null, null, '', -33.968036, 18.50300, 'new');
  if r->>'outcome' <> 'created' then raise exception '11: got %', r; end if;
  raise notice 'OK 11: new mode created';
end $$;

-- 12. Retries: the same grave id, or the same photo, returns what was saved without writing again
do $$
declare r jsonb; n int;
begin
  r := pg_temp.save('grave_yusuf', 'Yusuf', 'Kamish', '1952-02-02', '2018-06-16', '', -33.96800, 18.50300, 'ask');
  if r->>'outcome' <> 'created' then raise exception '12a: got %', r; end if;
  r := pg_temp.save('grave_auto', 'Yusuf', 'Kamish', null, '2018-06-16', '', -33.968036, 18.50300, 'auto');
  if r->>'outcome' <> 'added-photo' or r->>'grave_id' <> 'grave_yusuf' then raise exception '12b: got %', r; end if;
  select count(*) into n from public.grave_photos where grave_id = 'grave_yusuf';
  if n <> 2 then raise exception '12: expected 2 photos, got %', n; end if;
  raise notice 'OK 12: retries are idempotent';
end $$;

-- 13. Another user adds a photo to an existing grave
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$
declare r jsonb; n int;
begin
  r := pg_temp.save('grave_other', 'Yusuf', 'Kamish', null, null, '', -33.96801, 18.50300, 'ask', 'grave_yusuf');
  if r->>'outcome' <> 'added-photo' or r->>'grave_id' <> 'grave_yusuf' then raise exception '13: got %', r; end if;
  select count(*) into n from public.grave_photos
    where grave_id = 'grave_yusuf' and uploaded_by = '22222222-2222-2222-2222-222222222222';
  if n <> 1 then raise exception '13: photo not recorded for the second user'; end if;
  raise notice 'OK 13: add-to';
end $$;

-- 14. Adding to a grave that doesn't exist
do $$
begin
  perform pg_temp.save('grave_missing', 'Yusuf', 'Kamish', null, null, '', -33.96801, 18.50300, 'ask', 'grave_nope');
  raise exception '14: expected P0002';
exception when no_data_found then
  raise notice 'OK 14: missing grave reported: %', sqlerrm;
end $$;

-- 15. An unknown mode
do $$
begin
  perform pg_temp.save('grave_badmode', 'Yusuf', 'Kamish', null, null, '', -33.96801, 18.50300, 'maybe');
  raise exception '15: expected 22023';
exception when invalid_parameter_value then
  raise notice 'OK 15: unknown mode refused: %', sqlerrm;
end $$;

-- 16. No signed-in user
select set_config('request.jwt.claim.sub', '', false);
do $$
begin
  perform pg_temp.save('grave_nouser', 'Yusuf', 'Kamish', null, null, '', -33.96801, 18.50300, 'ask');
  raise exception '16: expected 42501';
exception when insufficient_privilege then
  raise notice 'OK 16: no user refused: %', sqlerrm;
end $$;

-- 17. The anon role can't call either function
reset role;
set role anon;
do $$
begin
  perform public.find_matching_graves('cem_athlone', -33.968, 18.503, 4, 'Yusuf', 'Kamish', null, null, '');
  raise exception '17: expected anon to be refused';
exception when insufficient_privilege then
  raise notice 'OK 17: anon refused: %', sqlerrm;
end $$;
reset role;
```

Create `$PGWORK/97_race_a.sql`:

```sql
\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
begin;
select public.save_or_add_grave('grave_race_a', 'person_race_a', 'cem_athlone', '', 'Race', null, 'Condition', null,
  '1960-01-01', null, -33.9700, 18.5050, 4, 62, now(), 'https://example.test/race_a.jpg', 'cem_athlone/race_a.jpg', 'auto');
-- Hold the cemetery lock while the second save starts
select pg_sleep(3);
commit;
```

Create `$PGWORK/97_race_b.sql`:

```sql
\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select public.save_or_add_grave('grave_race_b', 'person_race_b', 'cem_athlone', '', 'Race', null, 'Condition', null,
  '1960-01-01', null, -33.97001, 18.5050, 4, 62, now(), 'https://example.test/race_b.jpg', 'cem_athlone/race_b.jpg', 'auto') as race_b;
```

- [ ] **Step 7: Run the local checks**

```bash
PGWORK="C:/Users/rizaa/AppData/Local/Temp/claude/d--Development-Projects-QabrMap-Code/f6cdb8ef-95a9-4c4c-853b-1bf7e4d91db8/scratchpad/migration-test"
docker rm -f qabrmap-pg 2>/dev/null
MSYS_NO_PATHCONV=1 docker run -d --name qabrmap-pg -e POSTGRES_PASSWORD=postgres -v "$PGWORK:/work" postgres:17
docker exec qabrmap-pg sh -c 'until pg_isready -U postgres -q; do sleep 1; done'
for f in 00_supabase_stub 01_initial 02_grave_photos 03_create_mapped_grave 04_delete_mapped_grave 05_duplicate_graves; do
  MSYS_NO_PATHCONV=1 docker exec qabrmap-pg psql -U postgres -v ON_ERROR_STOP=1 -q -f /work/$f.sql || { echo "FAILED in $f"; break; }
done
# Running the migration a second time must also succeed
MSYS_NO_PATHCONV=1 docker exec qabrmap-pg psql -U postgres -v ON_ERROR_STOP=1 -q -f /work/05_duplicate_graves.sql && echo "rerun OK"
MSYS_NO_PATHCONV=1 docker exec qabrmap-pg psql -U postgres -v ON_ERROR_STOP=1 -f /work/97_verify_duplicates.sql
```

Expected: `rerun OK`, then notices `OK 1` through `OK 17` and no `ERROR`.

Then the concurrent saves:

```bash
MSYS_NO_PATHCONV=1 docker exec qabrmap-pg psql -U postgres -v ON_ERROR_STOP=1 -q -f /work/97_race_a.sql &
docker exec qabrmap-pg sleep 1
MSYS_NO_PATHCONV=1 docker exec qabrmap-pg psql -U postgres -v ON_ERROR_STOP=1 -f /work/97_race_b.sql
wait
docker exec qabrmap-pg psql -U postgres -t -c "select count(*) from public.graves where id like 'grave_race_%'"
```

Expected: `race_b` prints `{"outcome": "added-photo", "grave_id": "grave_race_a", ...}` after about 2 seconds, and the count is `1`.

If a check fails, fix the migration (not the check, unless the check contradicts the spec), copy it to `$PGWORK/05_duplicate_graves.sql` again, recreate the container and rerun. Leave the container running for Task 2.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260915180000_duplicate_graves.sql tests/duplicate_graves_migration.test.ts
git commit -m "feat(graves): detect duplicate graves and allow several burials per grave

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Photo read limits migration

**Files:**
- Create: `supabase/migrations/20260915181000_photo_read_limits.sql`
- Test: `tests/photo_read_limits_migration.test.ts`
- Scratch (not committed): `$PGWORK/06_photo_read_limits.sql`, `$PGWORK/96_verify_photo_reads.sql`

**Interfaces:**
- Produces: `public.begin_photo_read(p_photo_hash text) returns jsonb`: `{ "cached": <reading jsonb> }` or `{ "read_id": <uuid> }`. Raises `42501` when not signed in, `22023` when the hash is not 64 lowercase hex characters, `53400` "Too many photos read. Try again later." over the limits.
- Produces: `public.finish_photo_read(p_read_id uuid, p_reading jsonb) returns void`. Updates only the caller's own row.

- [ ] **Step 1: Write the failing test**

Create `tests/photo_read_limits_migration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20260915181000_photo_read_limits.sql'),
  'utf8'
);

describe('Photo Read Limits Migration Tests', () => {
  it('records reads in a table no client can touch directly', () => {
    expect(MIGRATION).toMatch(/create table if not exists public\.photo_reads \(/);
    expect(MIGRATION).toMatch(/user_id uuid not null references auth\.users \(id\) on delete cascade/);
    expect(MIGRATION).toMatch(/alter table public\.photo_reads enable row level security;/);
    expect(MIGRATION).toMatch(/revoke all on table public\.photo_reads from anon, authenticated;/);
    expect(MIGRATION).not.toMatch(/create policy/i);
  });

  it('indexes reads by user and time, and by user and photo', () => {
    expect(MIGRATION).toMatch(/on public\.photo_reads \(user_id, created_at desc\)/);
    expect(MIGRATION).toMatch(/on public\.photo_reads \(user_id, photo_hash, created_at desc\)/);
  });

  it('runs both functions as locked-down security definers that check the caller', () => {
    for (const name of ['begin_photo_read', 'finish_photo_read']) {
      expect(MIGRATION).toMatch(new RegExp(`create or replace function public\\.${name}\\(`));
      expect(MIGRATION).toMatch(new RegExp(`revoke execute on function public\\.${name}\\([^)]*\\) from public, anon;`));
      expect(MIGRATION).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated;`));
    }
    expect(MIGRATION.match(/security definer\s+set search_path = ''/g)).toHaveLength(2);
    expect(MIGRATION.match(/if v_caller is null then\s+raise exception '[^']+' using errcode = '42501';/g)).toHaveLength(2);
  });

  it('reuses a reading of the same photo from the last 24 hours before checking limits', () => {
    expect(MIGRATION).toMatch(/photo_hash = p_photo_hash and reading is not null and created_at > now\(\) - interval '24 hours'/);
    expect(MIGRATION.indexOf("'cached'")).toBeLessThan(MIGRATION.indexOf("errcode = '53400'"));
  });

  it('allows 60 reads in 10 minutes and 500 in a day', () => {
    expect(MIGRATION).toMatch(/interval '10 minutes'\) >= 60/);
    expect(MIGRATION).toMatch(/interval '24 hours'\) >= 500/);
    expect(MIGRATION).toMatch(/raise exception 'Too many photos read\. Try again later\.' using errcode = '53400';/);
  });

  it("serialises one user's reads so parallel requests can't pass the limits", () => {
    expect(MIGRATION).toMatch(/perform pg_advisory_xact_lock\(hashtext\('photo_reads:' \|\| v_caller::text\)\);/);
  });

  it("only stores a reading on the caller's own row", () => {
    expect(MIGRATION).toMatch(/update public\.photo_reads set reading = p_reading where id = p_read_id and user_id = v_caller;/);
  });

  it('calls auth.uid() once per function, wrapped in a select', () => {
    expect(MIGRATION.replace(/\(select auth\.uid\(\)\)/g, '')).not.toMatch(/auth\.uid\(\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/photo_read_limits_migration.test.ts`
Expected: FAIL with `ENOENT` for the migration.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260915181000_photo_read_limits.sql`:

```sql
-- ============================================================
-- QabrMap: limits on reading grave photos with the AI model
-- Run in Supabase Dashboard > SQL Editor > New query. Safe to run more than once.
-- ============================================================

-- One row per photo sent to the model. Only the functions below read or write it.
create table if not exists public.photo_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  photo_hash text not null,
  reading jsonb,
  created_at timestamptz not null default now()
);

create index if not exists photo_reads_user_created_idx on public.photo_reads (user_id, created_at desc);
create index if not exists photo_reads_user_hash_idx on public.photo_reads (user_id, photo_hash, created_at desc);

alter table public.photo_reads enable row level security;
revoke all on table public.photo_reads from anon, authenticated;

-- Called by the read-stone route before it pays for a read. Returns the earlier reading of the same photo,
-- refuses when the user is over the limits, or records the read and returns its id.
create or replace function public.begin_photo_read(p_photo_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_cached jsonb;
  v_read_id uuid;
begin
  if v_caller is null then
    raise exception 'Sign in to read a photo.' using errcode = '42501';
  end if;

  if p_photo_hash is null or p_photo_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A photo hash is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('photo_reads:' || v_caller::text));

  -- Only the last day matters, so older rows are cleared as the user reads
  delete from public.photo_reads where user_id = v_caller and created_at < now() - interval '2 days';

  -- The same photo sent again, for example after the app closed mid-read, costs nothing
  select reading into v_cached
    from public.photo_reads
    where user_id = v_caller and photo_hash = p_photo_hash and reading is not null and created_at > now() - interval '24 hours'
    order by created_at desc
    limit 1;
  if v_cached is not null then
    return jsonb_build_object('cached', v_cached);
  end if;

  if (select count(*) from public.photo_reads where user_id = v_caller and created_at > now() - interval '10 minutes') >= 60
    or (select count(*) from public.photo_reads where user_id = v_caller and created_at > now() - interval '24 hours') >= 500 then
    raise exception 'Too many photos read. Try again later.' using errcode = '53400';
  end if;

  -- Recorded before the model is called, so a failed read still counts toward the limits
  insert into public.photo_reads (user_id, photo_hash) values (v_caller, p_photo_hash) returning id into v_read_id;
  return jsonb_build_object('read_id', v_read_id);
end;
$$;

-- Stores what the model returned, so the same photo can be answered from the cache
create or replace function public.finish_photo_read(p_read_id uuid, p_reading jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null then
    raise exception 'Sign in to read a photo.' using errcode = '42501';
  end if;

  update public.photo_reads set reading = p_reading where id = p_read_id and user_id = v_caller;
end;
$$;

revoke execute on function public.begin_photo_read(text) from public, anon;
grant execute on function public.begin_photo_read(text) to authenticated;
revoke execute on function public.finish_photo_read(uuid, jsonb) from public, anon;
grant execute on function public.finish_photo_read(uuid, jsonb) to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/photo_read_limits_migration.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Write the local checks**

Create `$PGWORK/96_verify_photo_reads.sql`:

```sql
\set ON_ERROR_STOP on

delete from public.photo_reads;
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'first@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'second@test.local')
on conflict (id) do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- 1. A first read is recorded, and a finished read is returned from the cache
do $$
declare r jsonb;
begin
  r := public.begin_photo_read(repeat('a', 64));
  if r->>'read_id' is null then raise exception '1a: got %', r; end if;
  perform public.finish_photo_read((r->>'read_id')::uuid, '{"firstName": "Yusuf"}');
  r := public.begin_photo_read(repeat('a', 64));
  if r->'cached'->>'firstName' is distinct from 'Yusuf' then raise exception '1b: got %', r; end if;
  raise notice 'OK 1: cached reading returned';
end $$;

-- 2. A read that was never finished is not a cache hit
do $$
declare r jsonb;
begin
  r := public.begin_photo_read(repeat('b', 64));
  r := public.begin_photo_read(repeat('b', 64));
  if r->>'read_id' is null then raise exception '2: got %', r; end if;
  raise notice 'OK 2: unfinished read not cached';
end $$;

-- 3. A bad hash
do $$
begin
  perform public.begin_photo_read('not-a-hash');
  raise exception '3: expected 22023';
exception when invalid_parameter_value then
  raise notice 'OK 3: bad hash refused';
end $$;

-- 4. Another user can't store a reading on someone else's read, or see their cache
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select (public.begin_photo_read(repeat('c', 64))->>'read_id') as other_read \gset
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.finish_photo_read(:'other_read', '{"firstName": "Intruder"}');
do $$
declare r jsonb;
begin
  r := public.begin_photo_read(repeat('c', 64));
  if r ? 'cached' then raise exception '4: user 1 saw user 2''s cache: %', r; end if;
  raise notice 'OK 4: reads are per user';
end $$;
reset role;
select 1 / (case when (select reading from public.photo_reads where id = :'other_read') is null then 1 else 0 end) as ok_4b;

-- 5. 60 reads in 10 minutes blocks the next read, but a cached photo still comes back
delete from public.photo_reads;
insert into public.photo_reads (user_id, photo_hash, reading, created_at)
select '11111111-1111-1111-1111-111111111111', md5(i::text) || md5(i::text), case when i = 1 then '{"firstName": "Cached"}'::jsonb end, now() - interval '1 minute'
from generate_series(1, 60) i;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$
declare r jsonb;
begin
  r := public.begin_photo_read(md5('1') || md5('1'));
  if r->'cached'->>'firstName' is distinct from 'Cached' then raise exception '5a: got %', r; end if;
  perform public.begin_photo_read(repeat('d', 64));
  raise exception '5b: expected 53400';
exception when configuration_limit_exceeded then
  raise notice 'OK 5: 10 minute limit: %', sqlerrm;
end $$;

-- 6. Reads older than 10 minutes don't count toward the short limit
reset role;
update public.photo_reads set created_at = now() - interval '15 minutes';
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.begin_photo_read(repeat('e', 64));
  if r->>'read_id' is null then raise exception '6: got %', r; end if;
  raise notice 'OK 6: older reads not counted';
end $$;

-- 7. 500 reads in a day blocks the next read
reset role;
delete from public.photo_reads;
insert into public.photo_reads (user_id, photo_hash, created_at)
select '11111111-1111-1111-1111-111111111111', md5(i::text) || md5(i::text), now() - interval '2 hours'
from generate_series(1, 500) i;
set role authenticated;
do $$
begin
  perform public.begin_photo_read(repeat('f', 64));
  raise exception '7: expected 53400';
exception when configuration_limit_exceeded then
  raise notice 'OK 7: daily limit';
end $$;

-- 8. Rows older than 2 days are cleared
reset role;
delete from public.photo_reads;
insert into public.photo_reads (user_id, photo_hash, created_at)
values ('11111111-1111-1111-1111-111111111111', repeat('0', 64), now() - interval '3 days');
set role authenticated;
select public.begin_photo_read(repeat('1', 64));
reset role;
select 1 / (case when not exists (select 1 from public.photo_reads where created_at < now() - interval '2 days') then 1 else 0 end) as ok_8;

-- 9. Signed-in users can't read the table directly, and anon can't call the functions
set role authenticated;
do $$
begin
  perform count(*) from public.photo_reads;
  raise exception '9a: expected permission denied';
exception when insufficient_privilege then
  raise notice 'OK 9a: table closed to clients';
end $$;
reset role;
set role anon;
do $$
begin
  perform public.begin_photo_read(repeat('a', 64));
  raise exception '9b: expected anon to be refused';
exception when insufficient_privilege then
  raise notice 'OK 9b: anon refused';
end $$;
reset role;

-- 10. No signed-in user
set role authenticated;
select set_config('request.jwt.claim.sub', '', false);
do $$
begin
  perform public.begin_photo_read(repeat('a', 64));
  raise exception '10: expected 42501';
exception when insufficient_privilege then
  raise notice 'OK 10: no user refused';
end $$;
reset role;
```

- [ ] **Step 6: Run the local checks**

With the `qabrmap-pg` container from Task 1 still running (if not, rerun Task 1 Step 7's setup lines first):

```bash
PGWORK="C:/Users/rizaa/AppData/Local/Temp/claude/d--Development-Projects-QabrMap-Code/f6cdb8ef-95a9-4c4c-853b-1bf7e4d91db8/scratchpad/migration-test"
cp supabase/migrations/20260915181000_photo_read_limits.sql "$PGWORK/06_photo_read_limits.sql"
MSYS_NO_PATHCONV=1 docker exec qabrmap-pg psql -U postgres -v ON_ERROR_STOP=1 -q -f /work/06_photo_read_limits.sql
MSYS_NO_PATHCONV=1 docker exec qabrmap-pg psql -U postgres -v ON_ERROR_STOP=1 -q -f /work/06_photo_read_limits.sql && echo "rerun OK"
MSYS_NO_PATHCONV=1 docker exec qabrmap-pg psql -U postgres -v ON_ERROR_STOP=1 -f /work/96_verify_photo_reads.sql
```

Expected: `rerun OK`, notices `OK 1` to `OK 10` (with `ok_4b` and `ok_8` each printing `1`), and no `ERROR`. When done, remove the container: `docker rm -f qabrmap-pg`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260915181000_photo_read_limits.sql tests/photo_read_limits_migration.test.ts
git commit -m "feat(ai): rate limit and cache photo reads in the database

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Read-stone route with limits and cache

**Files:**
- Create: `src/lib/ai/photoHash.ts`
- Create: `src/lib/ai/readStoneRequest.ts`
- Modify: `src/app/api/graves/read-stone/route.ts` (whole file)
- Modify: `src/lib/capture/requestStoneReading.ts:15-16` (429 message)
- Test: `tests/read_stone_route.test.ts`, `tests/stone_reading.test.ts` (one assertion added)

**Interfaces:**
- Consumes: `begin_photo_read` and `finish_photo_read` from Task 2; `bearerToken`, `parseStonePhoto`, `isStoneReading`, `StoneReading` from `src/lib/ai/stoneReading.ts`; `readStonePhoto`, `StoneReadingError` from `src/lib/ai/readStone.ts`.
- Produces: `photoHash(dataUrl: string): string` (64 lowercase hex characters).
- Produces: `handleReadStone(authorization: string | null, deps: ReadStoneDeps): Promise<ReadStoneResult>`, `ReadStoneDeps`, `BeginReadResponse`, `ReadStoneResult = { status: number; body: { reading: StoneReading } | { error: string } }`, and the message constants `SIGN_IN_TO_READ_MESSAGE`, `READING_NOT_SET_UP_MESSAGE`, `READ_FAILED_MESSAGE`, `NO_GRAVE_DETAILS_MESSAGE`, `MODEL_BUSY_MESSAGE`, `TOO_MANY_READS_MESSAGE`. HTTP statuses stay as before (401, 503, 400, 422, 429, 502), so Plan 2's queue can rely on them.

- [ ] **Step 1: Write the failing test**

Create `tests/read_stone_route.test.ts`:

```ts
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
```

In `tests/stone_reading.test.ts`, inside `it('explains read failures in plain words', ...)`, add after the existing 429 assertion:

```ts
    expect(stoneReadingErrorMessage(429, 'Too many photos read. Try again later.')).toBe('Too many photos read. Try again later.');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/read_stone_route.test.ts tests/stone_reading.test.ts`
Expected: FAIL. `read_stone_route` cannot resolve `../src/lib/ai/photoHash`; `stone_reading` fails the new 429 assertion.

- [ ] **Step 3: Write the implementation**

Create `src/lib/ai/photoHash.ts`:

```ts
import { createHash } from 'node:crypto';

// Server only. Hashes the decoded image bytes, so the same photo is recognised whatever its data URL header says.
export function photoHash(dataUrl: string): string {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex');
}
```

Create `src/lib/ai/readStoneRequest.ts`:

```ts
import { StoneReading, bearerToken, isStoneReading, parseStonePhoto } from './stoneReading';
import { StoneReadingError } from './readStone';
import { photoHash } from './photoHash';

// What /api/graves/read-stone does, with Supabase and OpenAI passed in so it can be tested.
// Server only, because photoHash uses node:crypto.

export const SIGN_IN_TO_READ_MESSAGE = 'Sign in to read a photo.';
export const READING_NOT_SET_UP_MESSAGE = "Reading photos isn't set up yet.";
export const READ_FAILED_MESSAGE = "The photo couldn't be read.";
export const NO_GRAVE_DETAILS_MESSAGE = 'No grave details were found in this photo.';
export const MODEL_BUSY_MESSAGE = 'Too many photos are being read right now.';
export const TOO_MANY_READS_MESSAGE = 'Too many photos read. Try again later.';

export interface BeginReadResponse {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

export interface ReadStoneDeps {
  isConfigured: boolean;
  readBody: () => Promise<unknown>;
  getUserId: (token: string) => Promise<string | null>;
  beginRead: (token: string, hash: string) => Promise<BeginReadResponse>;
  finishRead: (token: string, readId: string, reading: StoneReading) => Promise<void>;
  readPhoto: (dataUrl: string) => Promise<StoneReading>;
  isRateLimitError: (err: unknown) => boolean;
  logError: (message: string, err: unknown) => void;
}

export interface ReadStoneResult {
  status: number;
  body: { reading: StoneReading } | { error: string };
}

const failure = (status: number, error: string): ReadStoneResult => ({ status, body: { error } });

const answer = (reading: StoneReading): ReadStoneResult =>
  reading.hasGraveDetails ? { status: 200, body: { reading } } : failure(422, NO_GRAVE_DETAILS_MESSAGE);

export async function handleReadStone(authorization: string | null, deps: ReadStoneDeps): Promise<ReadStoneResult> {
  const token = bearerToken(authorization);
  if (!token) return failure(401, SIGN_IN_TO_READ_MESSAGE);
  if (!deps.isConfigured) return failure(503, READING_NOT_SET_UP_MESSAGE);
  if (!(await deps.getUserId(token))) return failure(401, SIGN_IN_TO_READ_MESSAGE);

  const photo = parseStonePhoto(await deps.readBody());
  if (!photo.ok) return failure(400, photo.error);

  // The database checks the limits and records the read before anything is paid for. If it can't, nothing is read.
  let begun: BeginReadResponse;
  try {
    begun = await deps.beginRead(token, photoHash(photo.dataUrl));
  } catch (err) {
    deps.logError('Starting a photo read failed:', err);
    return failure(502, READ_FAILED_MESSAGE);
  }
  if (begun.error) {
    if (begun.error.code === '53400') return failure(429, TOO_MANY_READS_MESSAGE);
    if (begun.error.code === '42501') return failure(401, SIGN_IN_TO_READ_MESSAGE);
    if (begun.error.code === 'PGRST202') return failure(503, READING_NOT_SET_UP_MESSAGE);
    deps.logError('Starting a photo read failed:', begun.error);
    return failure(502, READ_FAILED_MESSAGE);
  }

  const started = (begun.data && typeof begun.data === 'object' ? begun.data : {}) as { cached?: unknown; read_id?: unknown };
  if (started.cached !== undefined) {
    return isStoneReading(started.cached) ? answer(started.cached) : failure(502, READ_FAILED_MESSAGE);
  }
  if (typeof started.read_id !== 'string') {
    deps.logError('Starting a photo read returned no id:', begun.data);
    return failure(502, READ_FAILED_MESSAGE);
  }

  let reading: StoneReading;
  try {
    reading = await deps.readPhoto(photo.dataUrl);
  } catch (err) {
    if (err instanceof StoneReadingError) return failure(422, err.message);
    if (deps.isRateLimitError(err)) return failure(429, MODEL_BUSY_MESSAGE);
    deps.logError('Reading a grave photo failed:', err);
    return failure(502, READ_FAILED_MESSAGE);
  }

  // Stored even when the stone has no details, so sending the same photo again costs nothing
  try {
    await deps.finishRead(token, started.read_id, reading);
  } catch (err) {
    deps.logError('Storing a photo reading failed:', err);
  }
  return answer(reading);
}
```

Replace the whole of `src/app/api/graves/read-stone/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readStonePhoto } from '@/lib/ai/readStone';
import { handleReadStone } from '@/lib/ai/readStoneRequest';

// Reads a grave marker photo with GPT-5.6 Luna. Signed-in users only, within the limits the database keeps,
// because every call is paid for.
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Acts as the signed-in user, so the database functions know whose reads to count
  let client: SupabaseClient | null = null;
  const clientFor = (token: string): SupabaseClient =>
    (client ??= createClient(supabaseUrl as string, supabaseAnonKey as string, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }));

  const result = await handleReadStone(request.headers.get('authorization'), {
    isConfigured: Boolean(supabaseUrl && supabaseAnonKey && process.env.OPENAI_API_KEY),
    readBody: () => request.json().catch(() => null),
    getUserId: async (token) => {
      const { data, error } = await clientFor(token).auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },
    beginRead: async (token, hash) => {
      const { data, error } = await clientFor(token).rpc('begin_photo_read', { p_photo_hash: hash });
      return { data, error };
    },
    finishRead: async (token, readId, reading) => {
      const { error } = await clientFor(token).rpc('finish_photo_read', { p_read_id: readId, p_reading: reading });
      if (error) throw error;
    },
    readPhoto: (dataUrl) => readStonePhoto(new OpenAI(), dataUrl),
    isRateLimitError: (err) => err instanceof OpenAI.RateLimitError,
    logError: (message, err) => console.error(message, err),
  });

  return NextResponse.json(result.body, { status: result.status });
}
```

In `src/lib/capture/requestStoneReading.ts`, replace:

```ts
    case 429:
      return 'Too many photos are being read right now. Try again in a moment.';
```

with:

```ts
    case 429:
      // The server says whether the model is busy or this account has read too many photos
      return serverMessage || 'Too many photos are being read right now. Try again in a moment.';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/read_stone_route.test.ts tests/stone_reading.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/photoHash.ts src/lib/ai/readStoneRequest.ts src/app/api/graves/read-stone/route.ts src/lib/capture/requestStoneReading.ts tests/read_stone_route.test.ts tests/stone_reading.test.ts
git commit -m "feat(ai): check read limits and reuse cached readings before calling the model

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Match candidates on the phone

**Files:**
- Create: `src/lib/graves/matchCandidate.ts`
- Test: `tests/match_candidate.test.ts`

**Interfaces:**
- Consumes: `find_matching_graves` from Task 1; `NewGraveForm` from `src/lib/capture/newGrave.ts`; `DeviceTelemetry` from `@/types`.
- Produces (Tasks 5 and 6 and Plan 2 use these exact names):
  - `type MatchStrength = 'strong' | 'possible'`
  - `interface MatchCandidate { graveId: string; fullName: string; birthDate?: string; deathDate?: string; graveNumber: string; distanceMeters: number; match: MatchStrength }`
  - `interface MatchCheckParams { p_cemetery_id: string; p_latitude: number; p_longitude: number; p_accuracy_meters: number; p_first_name: string; p_surname: string; p_birth_date: string | null; p_death_date: string | null; p_grave_number: string }`
  - `matchCheckParams(form: NewGraveForm, telemetry: DeviceTelemetry): MatchCheckParams | null`
  - `mapMatchCandidate(row: unknown): MatchCandidate | null` (accepts the snake_case rows and the `candidate` jsonb from `save_or_add_grave`)
  - `formatShortDate(isoDate: string): string`
  - `describeMatchCandidate(candidate: MatchCandidate): string`
  - `matchHeading(candidate: MatchCandidate): string`
  - `findMatchingGraves(client: Pick<SupabaseClient, 'rpc'>, params: MatchCheckParams): Promise<MatchCandidate[]>`

- [ ] **Step 1: Write the failing test**

Create `tests/match_candidate.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { DeviceTelemetry } from '../src/types';
import type { NewGraveForm } from '../src/lib/capture/newGrave';
import {
  MatchCandidate,
  describeMatchCandidate,
  findMatchingGraves,
  formatShortDate,
  mapMatchCandidate,
  matchCheckParams,
  matchHeading,
} from '../src/lib/graves/matchCandidate';

const form: NewGraveForm = {
  firstName: ' Yusuf ',
  middleNames: 'Ahmed',
  surname: 'Kamish ',
  nickname: '',
  graveNumber: ' 1402 ',
  birthDate: '1952-02-02',
  deathDate: '',
  cemeteryId: 'cem_athlone',
};

const telemetry: DeviceTelemetry = {
  latitude: -33.968,
  longitude: 18.503,
  gpsAccuracy: 4.2,
  headingDegrees: 62,
  timestamp: '2026-09-15T10:00:00.000Z',
};

const row = {
  grave_id: 'grave_yusuf',
  full_name: 'Yusuf Kamish',
  birth_date: '1952-02-02',
  death_date: '2018-06-16',
  grave_number: '',
  distance_meters: 4.2,
  match: 'strong',
};

const yusuf: MatchCandidate = {
  graveId: 'grave_yusuf',
  fullName: 'Yusuf Kamish',
  birthDate: '1952-02-02',
  deathDate: '2018-06-16',
  graveNumber: '',
  distanceMeters: 4.2,
  match: 'strong',
};

describe('Match Check Params Tests', () => {
  it('sends the trimmed details the database compares', () => {
    expect(matchCheckParams(form, telemetry)).toEqual({
      p_cemetery_id: 'cem_athlone',
      p_latitude: -33.968,
      p_longitude: 18.503,
      p_accuracy_meters: 4.2,
      p_first_name: 'Yusuf',
      p_surname: 'Kamish',
      p_birth_date: '1952-02-02',
      p_death_date: null,
      p_grave_number: '1402',
    });
  });

  it('skips the check until there is a cemetery, a first name and a surname', () => {
    expect(matchCheckParams({ ...form, cemeteryId: '' }, telemetry)).toBeNull();
    expect(matchCheckParams({ ...form, firstName: '  ' }, telemetry)).toBeNull();
    expect(matchCheckParams({ ...form, surname: '' }, telemetry)).toBeNull();
  });
});

describe('Match Candidate Tests', () => {
  it('maps a database row', () => {
    expect(mapMatchCandidate(row)).toEqual(yusuf);
    expect(mapMatchCandidate({ ...row, birth_date: null, death_date: null, grave_number: null, match: 'possible' })).toEqual({
      ...yusuf,
      birthDate: undefined,
      deathDate: undefined,
      graveNumber: '',
      match: 'possible',
    });
  });

  it('rejects anything without a grave id and name', () => {
    expect(mapMatchCandidate(null)).toBeNull();
    expect(mapMatchCandidate({ full_name: 'Yusuf Kamish' })).toBeNull();
    expect(mapMatchCandidate({ grave_id: 'grave_yusuf' })).toBeNull();
  });

  it('formats dates the same on every phone', () => {
    expect(formatShortDate('1952-02-02')).toBe('2 Feb 1952');
    expect(formatShortDate('2018-12-16')).toBe('16 Dec 2018');
    expect(formatShortDate('2018-13-01')).toBe('2018-13-01');
    expect(formatShortDate('1952')).toBe('1952');
  });

  it('describes the grave with both dates, so a father and son can be told apart', () => {
    expect(describeMatchCandidate(yusuf)).toBe('Yusuf Kamish, born 2 Feb 1952, died 16 Jun 2018, 4 m away');
    expect(describeMatchCandidate({ ...yusuf, birthDate: undefined, graveNumber: '1402', distanceMeters: 0.4 })).toBe(
      'Yusuf Kamish, died 16 Jun 2018, grave 1402, 0 m away'
    );
  });

  it('is sure only about a strong match', () => {
    expect(matchHeading(yusuf)).toBe('Already mapped nearby');
    expect(matchHeading({ ...yusuf, match: 'possible' })).toBe('This person may already be mapped nearby');
  });
});

describe('Find Matching Graves Tests', () => {
  it('calls the database and maps the rows', async () => {
    const rpc = vi.fn(async (..._args: unknown[]) => ({ data: [row], error: null }));
    const params = matchCheckParams(form, telemetry)!;
    await expect(findMatchingGraves({ rpc } as never, params)).resolves.toEqual([yusuf]);
    expect(rpc).toHaveBeenCalledWith('find_matching_graves', params);
  });

  it('treats a failed check as no match, because the save checks again', async () => {
    const params = matchCheckParams(form, telemetry)!;
    const failing = vi.fn(async () => ({ data: null, error: { code: 'PGRST202' } }));
    await expect(findMatchingGraves({ rpc: failing } as never, params)).resolves.toEqual([]);
    const throwing = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(findMatchingGraves({ rpc: throwing } as never, params)).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/match_candidate.test.ts`
Expected: FAIL, cannot resolve `../src/lib/graves/matchCandidate`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/graves/matchCandidate.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DeviceTelemetry } from '@/types';
import type { NewGraveForm } from '../capture/newGrave';

export type MatchStrength = 'strong' | 'possible';

// A grave already mapped that may be the person being saved
export interface MatchCandidate {
  graveId: string;
  fullName: string;
  birthDate?: string;
  deathDate?: string;
  graveNumber: string;
  distanceMeters: number;
  match: MatchStrength;
}

// The parameters of find_matching_graves
export interface MatchCheckParams {
  p_cemetery_id: string;
  p_latitude: number;
  p_longitude: number;
  p_accuracy_meters: number;
  p_first_name: string;
  p_surname: string;
  p_birth_date: string | null;
  p_death_date: string | null;
  p_grave_number: string;
}

// Null until there is something to compare: a cemetery, a first name and a surname
export function matchCheckParams(form: NewGraveForm, telemetry: DeviceTelemetry): MatchCheckParams | null {
  const firstName = form.firstName.trim();
  const surname = form.surname.trim();
  if (!form.cemeteryId || !firstName || !surname) return null;
  return {
    p_cemetery_id: form.cemeteryId,
    p_latitude: telemetry.latitude,
    p_longitude: telemetry.longitude,
    p_accuracy_meters: telemetry.gpsAccuracy,
    p_first_name: firstName,
    p_surname: surname,
    p_birth_date: form.birthDate || null,
    p_death_date: form.deathDate || null,
    p_grave_number: form.graveNumber.trim(),
  };
}

const optionalText = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

// Accepts a find_matching_graves row or the candidate returned by save_or_add_grave
export function mapMatchCandidate(row: unknown): MatchCandidate | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.grave_id !== 'string' || typeof r.full_name !== 'string') return null;
  const distance = Number(r.distance_meters);
  return {
    graveId: r.grave_id,
    fullName: r.full_name,
    birthDate: optionalText(r.birth_date),
    deathDate: optionalText(r.death_date),
    graveNumber: typeof r.grave_number === 'string' ? r.grave_number : '',
    distanceMeters: Number.isFinite(distance) ? distance : 0,
    match: r.match === 'strong' ? 'strong' : 'possible',
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "1952-02-02" as "2 Feb 1952", without depending on the phone's locale or time zone
export function formatShortDate(isoDate: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  const month = parts ? MONTHS[Number(parts[2]) - 1] : undefined;
  if (!parts || !month) return isoDate;
  return `${Number(parts[3])} ${month} ${parts[1]}`;
}

// Both dates are always shown, so a person can tell a father and son with the same name apart
export function describeMatchCandidate(candidate: MatchCandidate): string {
  const parts = [candidate.fullName];
  if (candidate.birthDate) parts.push(`born ${formatShortDate(candidate.birthDate)}`);
  if (candidate.deathDate) parts.push(`died ${formatShortDate(candidate.deathDate)}`);
  if (candidate.graveNumber) parts.push(`grave ${candidate.graveNumber}`);
  parts.push(`${Math.round(candidate.distanceMeters)} m away`);
  return parts.join(', ');
}

// A possible match had no dates to compare, so it is worded as a question
export function matchHeading(candidate: MatchCandidate): string {
  return candidate.match === 'strong' ? 'Already mapped nearby' : 'This person may already be mapped nearby';
}

// Only a hint for the Confirm screen: save_or_add_grave checks again, so a failed check shows no card
export async function findMatchingGraves(
  client: Pick<SupabaseClient, 'rpc'>,
  params: MatchCheckParams
): Promise<MatchCandidate[]> {
  try {
    const { data, error } = await client.rpc('find_matching_graves', params);
    if (error || !Array.isArray(data)) return [];
    return data.map(mapMatchCandidate).filter((candidate): candidate is MatchCandidate => candidate !== null);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/match_candidate.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/graves/matchCandidate.ts tests/match_candidate.test.ts
git commit -m "feat(graves): look up and describe graves that may already be mapped

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Save with duplicate outcomes

**Files:**
- Modify: `src/lib/supabase/saveGraveErrors.ts` (code union, message, `P0002` case)
- Modify: `src/lib/capture/saveMappedGrave.ts` (whole file)
- Modify: `src/lib/data/store.ts:17` (imports), `src/lib/data/store.ts:603-627` (`saveNewGrave`)
- Modify: `src/components/screens/ConfirmDetailsScreen.tsx:73-91` (temporary handling until Task 6)
- Test: `tests/save_mapped_grave.test.ts` (whole file)

**Interfaces:**
- Consumes: `MatchCandidate`, `MatchCheckParams`, `mapMatchCandidate`, `findMatchingGraves`, `describeMatchCandidate`, `matchHeading` from Task 4; `save_or_add_grave` from Task 1.
- Produces:
  - `type MatchMode = 'ask' | 'auto' | 'new'`
  - `SaveMappedGraveInput` gains `matchMode: MatchMode` and `addToGraveId?: string`
  - `interface SavedGraveResult { outcome: 'created' | 'added-photo'; graveId: string; personId: string; photoUrl: string }`
  - `interface MatchFoundResult { outcome: 'match-found'; candidate: MatchCandidate }`
  - `type SaveMappedGraveResult = SavedGraveResult | MatchFoundResult`
  - `buildSavedGrave(input: SaveMappedGraveInput, result: Pick<SavedGraveResult, 'graveId' | 'personId' | 'photoUrl'>, now: string): Grave`
  - `SaveGraveErrorCode` gains `'grave-missing'`; `GRAVE_MISSING_MESSAGE`
  - `dataStore.saveNewGrave(input: SaveMappedGraveInput): Promise<SaveNewGraveResult>` where `type SaveNewGraveResult = { outcome: 'created' | 'added-photo'; grave: Grave } | MatchFoundResult` (exported from `store.ts`)
  - `dataStore.findMatchingGraves(params: MatchCheckParams): Promise<MatchCandidate[]>`
  - `SaveAttempt`, `createSaveAttempt` and `SaveMappedGraveDeps` are unchanged. A `match-found` result keeps `attempt.upload`, so the next save (add-to or new) reuses the uploaded photo.

- [ ] **Step 1: Write the failing test**

Replace the whole of `tests/save_mapped_grave.test.ts` with:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { DeviceTelemetry } from '../src/types';
import type { NewGraveForm } from '../src/lib/capture/newGrave';
import {
  mapSaveGraveError,
  SaveGraveError,
  GRAVE_MISSING_MESSAGE,
  OFFLINE_MESSAGE,
  SIGNED_OUT_MESSAGE,
  NOT_SET_UP_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
  UNKNOWN_SAVE_MESSAGE,
} from '../src/lib/supabase/saveGraveErrors';
import {
  buildSavedGrave,
  createSaveAttempt,
  saveMappedGrave,
  SaveMappedGraveDeps,
  SaveMappedGraveInput,
} from '../src/lib/capture/saveMappedGrave';

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
const UPLOADED = {
  publicUrl: 'https://x.supabase.co/grave-photos/cem_athlone/grave_id1.jpg',
  path: 'cem_athlone/grave_id1.jpg',
};

const CANDIDATE_ROW = {
  grave_id: 'grave_existing',
  full_name: 'Abdul Wahab Narker',
  birth_date: '1947-01-28',
  death_date: null,
  grave_number: '1402',
  distance_meters: 3.1,
  match: 'strong',
};

type RpcResult = { data: unknown; error: unknown };
type GetUserResult = { data: { user: { id: string } | null }; error: unknown };

function idsFrom(ids: string[]) {
  return () => ids.shift() ?? 'extra';
}

function newAttempt() {
  return createSaveAttempt(idsFrom(['id1', 'id2']));
}

function input(overrides: Partial<SaveMappedGraveInput> = {}): SaveMappedGraveInput {
  return { form, photoDataUrl: PHOTO, telemetry, attempt: newAttempt(), matchMode: 'ask', ...overrides };
}

function makeDeps(overrides: Partial<SaveMappedGraveDeps> = {}) {
  // Loosely typed so tests can swap in failures with mockResolvedValueOnce
  const rpc = vi.fn(async (..._args: unknown[]): Promise<RpcResult> => ({
    data: { outcome: 'created', grave_id: 'grave_id1' },
    error: null,
  }));
  const getUser = vi.fn(async (): Promise<GetUserResult> => ({ data: { user: { id: 'user-1' } }, error: null }));
  const deps: SaveMappedGraveDeps = {
    client: { rpc, auth: { getUser } } as unknown as SaveMappedGraveDeps['client'],
    isOnline: () => true,
    uploadPhoto: vi.fn(async () => ({ ...UPLOADED })),
    deletePhoto: vi.fn(async () => true),
    ...overrides,
  };
  return { deps, rpc, getUser };
}

const rpcParams = (rpc: ReturnType<typeof makeDeps>['rpc'], call = 0) => rpc.mock.calls[call][1] as Record<string, unknown>;

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

  it('explains when the grave a photo was being added to is gone', () => {
    expect(mapSaveGraveError({ code: 'P0002', message: 'That grave no longer exists.' })).toMatchObject({
      code: 'grave-missing',
      message: GRAVE_MISSING_MESSAGE,
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
  it('uploads the photo, then saves the grave with trimmed details in ask mode', async () => {
    const { deps, rpc } = makeDeps();
    await expect(saveMappedGrave(input({ cemeteryName: 'Athlone Muslim Cemetery' }), deps)).resolves.toEqual({
      outcome: 'created',
      graveId: 'grave_id1',
      personId: 'person_id2',
      photoUrl: UPLOADED.publicUrl,
    });

    expect(deps.uploadPhoto).toHaveBeenCalledWith({ file: PHOTO, cemeteryId: 'cem_athlone', graveId: 'grave_id1', upsert: false });
    expect(rpc).toHaveBeenCalledWith('save_or_add_grave', {
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
      p_photo_public_url: UPLOADED.publicUrl,
      p_photo_storage_path: UPLOADED.path,
      p_match_mode: 'ask',
      p_add_to_grave_id: null,
    });
    expect(deps.deletePhoto).not.toHaveBeenCalled();
  });

  it('passes the survey and different-person modes through', async () => {
    const { deps, rpc } = makeDeps();
    await saveMappedGrave(input({ matchMode: 'auto' }), deps);
    await saveMappedGrave(input({ matchMode: 'new' }), deps);
    expect(rpcParams(rpc, 0).p_match_mode).toBe('auto');
    expect(rpcParams(rpc, 1).p_match_mode).toBe('new');
  });

  it('adds the photo to the grave chosen on the duplicate card', async () => {
    const { deps, rpc } = makeDeps();
    rpc.mockResolvedValueOnce({ data: { outcome: 'added-photo', grave_id: 'grave_existing' }, error: null });
    await expect(saveMappedGrave(input({ addToGraveId: 'grave_existing' }), deps)).resolves.toMatchObject({
      outcome: 'added-photo',
      graveId: 'grave_existing',
      photoUrl: UPLOADED.publicUrl,
    });
    expect(rpcParams(rpc).p_add_to_grave_id).toBe('grave_existing');
  });

  it('returns a match without deleting the photo, so the next choice reuses it', async () => {
    const { deps, rpc } = makeDeps();
    const attempt = newAttempt();
    rpc.mockResolvedValueOnce({ data: { outcome: 'match-found', grave_id: null, candidate: CANDIDATE_ROW }, error: null });
    await expect(saveMappedGrave(input({ attempt }), deps)).resolves.toEqual({
      outcome: 'match-found',
      candidate: {
        graveId: 'grave_existing',
        fullName: 'Abdul Wahab Narker',
        birthDate: '1947-01-28',
        deathDate: undefined,
        graveNumber: '1402',
        distanceMeters: 3.1,
        match: 'strong',
      },
    });
    expect(deps.deletePhoto).not.toHaveBeenCalled();
    expect(attempt.upload).toEqual(UPLOADED);

    rpc.mockResolvedValueOnce({ data: { outcome: 'added-photo', grave_id: 'grave_existing' }, error: null });
    await saveMappedGrave(input({ attempt, addToGraveId: 'grave_existing' }), deps);
    expect(deps.uploadPhoto).toHaveBeenCalledTimes(1);
  });

  it('stops before uploading when offline', async () => {
    const { deps } = makeDeps({ isOnline: () => false });
    await expect(saveMappedGrave(input(), deps)).rejects.toMatchObject({ code: 'offline' });
    expect(deps.uploadPhoto).not.toHaveBeenCalled();
  });

  it('stops when nobody is signed in', async () => {
    const { deps, getUser } = makeDeps();
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(saveMappedGrave(input(), deps)).rejects.toMatchObject({ code: 'signed-out' });
    expect(deps.uploadPhoto).not.toHaveBeenCalled();
  });

  it('only accepts a photo from the camera with a heading', async () => {
    const { deps } = makeDeps();
    await expect(saveMappedGrave(input({ photoDataUrl: '/sample-gravestone.svg' }), deps)).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      saveMappedGrave(input({ telemetry: { ...telemetry, headingDegrees: undefined } }), deps)
    ).rejects.toMatchObject({ code: 'invalid' });
    expect(deps.uploadPhoto).not.toHaveBeenCalled();
  });

  it('reports an upload failure, or offline when the upload lost the connection', async () => {
    const failing = makeDeps({
      uploadPhoto: vi.fn(async () => {
        throw new Error('storage exploded');
      }),
    });
    await expect(saveMappedGrave(input(), failing.deps)).rejects.toMatchObject({ code: 'upload-failed', message: UPLOAD_FAILED_MESSAGE });
    expect(failing.rpc).not.toHaveBeenCalled();

    const dropped = makeDeps({
      uploadPhoto: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });
    await expect(saveMappedGrave(input(), dropped.deps)).rejects.toMatchObject({ code: 'offline' });
  });

  it('removes the uploaded photo when the database rejects the grave', async () => {
    const { deps, rpc } = makeDeps();
    const attempt = newAttempt();
    rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'First name and surname are required.' } });
    await expect(saveMappedGrave(input({ attempt }), deps)).rejects.toMatchObject({
      code: 'invalid',
      message: 'First name and surname are required.',
    });
    expect(deps.deletePhoto).toHaveBeenCalledWith(UPLOADED.path);
    expect(attempt.upload).toBeUndefined();
  });

  it('removes the photo when the grave it was being added to is gone', async () => {
    const { deps, rpc } = makeDeps();
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0002', message: 'That grave no longer exists.' } });
    await expect(saveMappedGrave(input({ addToGraveId: 'grave_gone' }), deps)).rejects.toMatchObject({ code: 'grave-missing' });
    expect(deps.deletePhoto).toHaveBeenCalledWith(UPLOADED.path);
  });

  it('keeps the photo when the response is lost, and a retry reuses the same photo and ids', async () => {
    const { deps, rpc } = makeDeps();
    const attempt = newAttempt();
    // The database may have saved the grave before the connection dropped
    rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(saveMappedGrave(input({ attempt }), deps)).rejects.toMatchObject({ code: 'offline' });
    expect(deps.deletePhoto).not.toHaveBeenCalled();
    expect(attempt.upload).toEqual(UPLOADED);

    await expect(saveMappedGrave(input({ attempt }), deps)).resolves.toMatchObject({ graveId: 'grave_id1' });
    expect(deps.uploadPhoto).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map((call) => (call[1] as { p_grave_id: string }).p_grave_id)).toEqual(['grave_id1', 'grave_id1']);
  });

  it('keeps the photo when the failure has no database error code', async () => {
    const { deps, rpc } = makeDeps();
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Gateway Timeout' } });
    await expect(saveMappedGrave(input(), deps)).rejects.toMatchObject({ code: 'unknown' });
    expect(deps.deletePhoto).not.toHaveBeenCalled();
  });

  it('keeps the photo when the answer cannot be understood, because the grave may be saved', async () => {
    const { deps, rpc } = makeDeps();
    const attempt = newAttempt();
    rpc.mockResolvedValueOnce({ data: { outcome: 'something-else' }, error: null });
    await expect(saveMappedGrave(input({ attempt }), deps)).rejects.toMatchObject({ code: 'unknown' });
    expect(deps.deletePhoto).not.toHaveBeenCalled();
    expect(attempt.upload).toEqual(UPLOADED);
  });
});

describe('Saved Grave Fallback Tests', () => {
  const result = { graveId: 'grave_id1', personId: 'person_id2', photoUrl: UPLOADED.publicUrl };

  it('builds the saved grave from what was sent when it cannot be read back', () => {
    const grave = buildSavedGrave(input({ cemeteryName: 'Athlone Muslim Cemetery' }), result, '2026-09-15T10:00:05.000Z');
    expect(grave).toEqual({
      id: 'grave_id1',
      cemeteryId: 'cem_athlone',
      cemeteryName: 'Athlone Muslim Cemetery',
      personId: 'person_id2',
      graveNumber: '1402',
      latitude: -33.9675,
      longitude: 18.5033,
      positionAccuracyMeters: 4.2,
      positionConfidence: 'MEDIUM',
      orientationDegrees: 62,
      status: 'MAPPED',
      primaryPhotoUrl: UPLOADED.publicUrl,
      photoCount: 1,
      person: {
        id: 'person_id2',
        firstName: 'Abdul',
        middleNames: 'Wahab',
        surname: 'Narker',
        fullName: 'Abdul Wahab Narker',
        nickname: 'Boeta Dul',
        birthDate: '1947-01-28',
        deathDate: undefined,
      },
      createdAt: '2026-09-15T10:00:05.000Z',
      updatedAt: '2026-09-15T10:00:05.000Z',
    });
  });

  it('uses the same accuracy thresholds as the database', () => {
    const at = (gpsAccuracy: number) => buildSavedGrave(input({ telemetry: { ...telemetry, gpsAccuracy } }), result, 'now');
    expect(at(3.5)).toMatchObject({ status: 'MAPPED', positionConfidence: 'HIGH' });
    expect(at(5)).toMatchObject({ status: 'MAPPED', positionConfidence: 'MEDIUM' });
    expect(at(6)).toMatchObject({ status: 'LOW_CONFIDENCE', positionConfidence: 'MEDIUM' });
    expect(at(8)).toMatchObject({ status: 'LOW_CONFIDENCE', positionConfidence: 'LOW' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/save_mapped_grave.test.ts`
Expected: FAIL. `GRAVE_MISSING_MESSAGE` is undefined, the RPC name is still `create_mapped_grave`, and results have no `outcome`.

- [ ] **Step 3: Add the error code**

In `src/lib/supabase/saveGraveErrors.ts`:

Replace:
```ts
  | 'upload-failed'
  | 'unknown';
```
with:
```ts
  | 'upload-failed'
  | 'grave-missing'
  | 'unknown';
```

After the `UNKNOWN_SAVE_MESSAGE` line add:
```ts
export const GRAVE_MISSING_MESSAGE = 'That grave no longer exists. Save this as a new grave instead.';
```

Replace:
```ts
    case 'PGRST202':
      return new SaveGraveError('not-set-up', NOT_SET_UP_MESSAGE);
```
with:
```ts
    case 'P0002':
      return new SaveGraveError('grave-missing', GRAVE_MISSING_MESSAGE);
    case 'PGRST202':
      return new SaveGraveError('not-set-up', NOT_SET_UP_MESSAGE);
```

- [ ] **Step 4: Rewrite the save**

Replace the whole of `src/lib/capture/saveMappedGrave.ts` with:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConfidenceLevel, DeviceTelemetry, Grave, GraveStatus } from '@/types';
import type { NewGraveForm } from './newGrave';
import type { UploadPhotoOptions, UploadPhotoResult } from '../supabase/storage';
import { MatchCandidate, mapMatchCandidate } from '../graves/matchCandidate';
import {
  mapSaveGraveError,
  SaveGraveError,
  OFFLINE_MESSAGE,
  SIGNED_OUT_MESSAGE,
  UNKNOWN_SAVE_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
} from '../supabase/saveGraveErrors';

// One capture's ids and uploaded photo, kept across Save retries. If a response is lost after the database
// saved the grave, the retry sends the same ids (which the database treats as already saved) and reuses the photo.
export interface SaveAttempt {
  graveId: string;
  personId: string;
  upload?: UploadPhotoResult;
}

export function createSaveAttempt(newId: () => string = () => crypto.randomUUID()): SaveAttempt {
  return { graveId: `grave_${newId()}`, personId: `person_${newId()}` };
}

// ask: report a likely match instead of saving (Capture). auto: add the photo to a strong match (surveys).
// new: always create a grave, for example a son buried in his father's grave.
export type MatchMode = 'ask' | 'auto' | 'new';

export interface SaveMappedGraveInput {
  form: NewGraveForm;
  cemeteryName?: string;
  photoDataUrl: string;
  telemetry: DeviceTelemetry;
  attempt: SaveAttempt;
  matchMode: MatchMode;
  // Adds the photo to this grave instead of creating one
  addToGraveId?: string;
}

// Passed in so the save can be tested without Supabase
export interface SaveMappedGraveDeps {
  client: Pick<SupabaseClient, 'rpc' | 'auth'>;
  isOnline: () => boolean;
  uploadPhoto: (options: UploadPhotoOptions) => Promise<UploadPhotoResult | null>;
  deletePhoto: (path: string) => Promise<boolean>;
}

export interface SavedGraveResult {
  outcome: 'created' | 'added-photo';
  graveId: string;
  personId: string;
  photoUrl: string;
}

export interface MatchFoundResult {
  outcome: 'match-found';
  candidate: MatchCandidate;
}

export type SaveMappedGraveResult = SavedGraveResult | MatchFoundResult;

// Only an error the database itself returned proves nothing was saved. A dropped connection or a gateway
// timeout may have happened after the save committed.
function wasRejectedByDatabase(error: unknown, mapped: SaveGraveError): boolean {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && code !== '' && mapped.code !== 'offline';
}

type SaveOutcome = { outcome: 'created' | 'added-photo'; graveId: string } | MatchFoundResult;

function parseSaveOutcome(data: unknown): SaveOutcome | null {
  if (!data || typeof data !== 'object') return null;
  const answer = data as Record<string, unknown>;
  if (answer.outcome === 'match-found') {
    const candidate = mapMatchCandidate(answer.candidate);
    return candidate ? { outcome: 'match-found', candidate } : null;
  }
  if ((answer.outcome === 'created' || answer.outcome === 'added-photo') && typeof answer.grave_id === 'string') {
    return { outcome: answer.outcome, graveId: answer.grave_id };
  }
  return null;
}

// Uploads the photo, then saves the person, grave and photo together, or adds the photo to an existing grave
export async function saveMappedGrave(input: SaveMappedGraveInput, deps: SaveMappedGraveDeps): Promise<SaveMappedGraveResult> {
  const { form, telemetry, photoDataUrl, attempt } = input;
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

  if (!attempt.upload) {
    let upload: UploadPhotoResult | null;
    try {
      upload = await deps.uploadPhoto({ file: photoDataUrl, cemeteryId: form.cemeteryId, graveId: attempt.graveId, upsert: false });
    } catch (err) {
      const mapped = mapSaveGraveError(err, context);
      throw mapped.code === 'offline' ? mapped : new SaveGraveError('upload-failed', UPLOAD_FAILED_MESSAGE);
    }
    if (!upload?.publicUrl || !upload.path) throw new SaveGraveError('upload-failed', UPLOAD_FAILED_MESSAGE);
    attempt.upload = upload;
  }
  const upload = attempt.upload;

  let saveError: unknown = null;
  let answer: unknown = null;
  try {
    const { data, error } = await deps.client.rpc('save_or_add_grave', {
      p_grave_id: attempt.graveId,
      p_person_id: attempt.personId,
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
      p_match_mode: input.matchMode,
      p_add_to_grave_id: input.addToGraveId ?? null,
    });
    answer = data;
    saveError = error;
  } catch (err) {
    saveError = err;
  }

  if (saveError) {
    const mapped = mapSaveGraveError(saveError, context);
    if (wasRejectedByDatabase(saveError, mapped)) {
      // Nothing was saved, so don't leave a photo in storage that no grave points to
      attempt.upload = undefined;
      await deps.deletePhoto(upload.path).catch(() => false);
    }
    throw mapped;
  }

  const outcome = parseSaveOutcome(answer);
  // An answer that can't be read may still mean the grave was saved, so the photo is kept for a retry
  if (!outcome) throw new SaveGraveError('unknown', UNKNOWN_SAVE_MESSAGE);
  // Nothing was written; the uploaded photo stays on the attempt for whichever choice the user makes next
  if (outcome.outcome === 'match-found') return outcome;
  return { outcome: outcome.outcome, graveId: outcome.graveId, personId: attempt.personId, photoUrl: upload.publicUrl };
}

// The grave as the database stored it, for when it can't be read back straight after saving.
// Status and confidence use the same thresholds as save_or_add_grave.
export function buildSavedGrave(
  input: SaveMappedGraveInput,
  result: Pick<SavedGraveResult, 'graveId' | 'personId' | 'photoUrl'>,
  now: string
): Grave {
  const { form, telemetry } = input;
  const accuracy = telemetry.gpsAccuracy;
  const firstName = form.firstName.trim();
  const middleNames = form.middleNames.trim();
  const surname = form.surname.trim();
  const positionConfidence: ConfidenceLevel = accuracy <= 3.5 ? 'HIGH' : accuracy <= 6 ? 'MEDIUM' : 'LOW';
  const status: GraveStatus = accuracy <= 5 ? 'MAPPED' : 'LOW_CONFIDENCE';

  return {
    id: result.graveId,
    cemeteryId: form.cemeteryId,
    cemeteryName: input.cemeteryName,
    personId: result.personId,
    graveNumber: form.graveNumber.trim(),
    latitude: telemetry.latitude,
    longitude: telemetry.longitude,
    positionAccuracyMeters: accuracy,
    positionConfidence,
    orientationDegrees: telemetry.headingDegrees,
    status,
    primaryPhotoUrl: result.photoUrl,
    photoCount: 1,
    person: {
      id: result.personId,
      firstName,
      middleNames: middleNames || undefined,
      surname,
      fullName: [firstName, middleNames, surname].filter(Boolean).join(' '),
      nickname: form.nickname.trim() || undefined,
      birthDate: form.birthDate || undefined,
      deathDate: form.deathDate || undefined,
    },
    createdAt: now,
    updatedAt: now,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/save_mapped_grave.test.ts`
Expected: PASS (22 tests).

- [ ] **Step 6: Update the store**

In `src/lib/data/store.ts`, replace line 17:

```ts
import { buildSavedGrave, saveMappedGrave, SaveMappedGraveInput } from '../capture/saveMappedGrave';
```

with:

```ts
import { buildSavedGrave, MatchFoundResult, saveMappedGrave, SaveMappedGraveInput } from '../capture/saveMappedGrave';
import { findMatchingGraves as lookUpMatchingGraves, MatchCandidate, MatchCheckParams } from '../graves/matchCandidate';
```

Just above `class DataStore {`, after the `MyCemeteryGraveEntry` interface, add:

```ts
export type SaveNewGraveResult = { outcome: 'created' | 'added-photo'; grave: Grave } | MatchFoundResult;
```

Replace the whole `saveNewGrave` method (from the `// Saves a grave captured on this device.` comment to its closing brace, just before `// --- SURVEY SESSIONS ---`) with:

```ts
  // Saves a grave captured on this device, or adds its photo to a grave already mapped. Needs a signed-in user
  // and a connection; throws SaveGraveError.
  async saveNewGrave(input: SaveMappedGraveInput): Promise<SaveNewGraveResult> {
    if (!isSupabaseConfigured || !supabase) throw new SaveGraveError('not-set-up', NOT_SET_UP_MESSAGE);

    const result = await saveMappedGrave(input, {
      client: supabase,
      isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
      uploadPhoto: uploadGravePhoto,
      deletePhoto: deleteGravePhoto,
    });
    if (result.outcome === 'match-found') return result;

    // The grave is saved at this point, so a failed read-back on a weak connection mustn't report a failure
    const fresh = await this.getGraveById(result.graveId).catch(() => undefined);
    const saved = fresh ?? buildSavedGrave(input, result, new Date().toISOString());

    // Another person's grave can't be rebuilt from this form, so only a grave read back from the cloud is cached for it
    if (typeof window !== 'undefined' && (fresh || result.outcome === 'created')) {
      offlineDb.graves.put(saved).catch(() => {});
    }
    return { outcome: result.outcome, grave: saved };
  }

  // Graves already mapped that may be this person. Empty offline or on any failure, because the save checks again.
  async findMatchingGraves(params: MatchCheckParams): Promise<MatchCandidate[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    if (typeof navigator !== 'undefined' && !navigator.onLine) return [];
    return lookUpMatchingGraves(supabase, params);
  }
```

(This drops the two mock `activeSurvey` count increments. Plan 2 removes the rest of the mock survey.)

- [ ] **Step 7: Keep the Confirm screen compiling until Task 6**

In `src/components/screens/ConfirmDetailsScreen.tsx`, add to the imports:

```ts
import { describeMatchCandidate, matchHeading } from '@/lib/graves/matchCandidate';
```

and replace the `try` block inside `handleSave`:

```ts
    try {
      const grave = await dataStore.saveNewGrave({
        form,
        cemeteryName: selectedCemetery?.name,
        photoDataUrl: capturedImage,
        telemetry,
        attempt,
      });
      onSaved(grave);
    } catch (err) {
```

with:

```ts
    try {
      const result = await dataStore.saveNewGrave({
        form,
        cemeteryName: selectedCemetery?.name,
        photoDataUrl: capturedImage,
        telemetry,
        attempt,
        matchMode: 'ask',
      });
      if (result.outcome === 'match-found') {
        // Replaced by the duplicate card in the next task
        setIsSaving(false);
        setError(`${matchHeading(result.candidate)}: ${describeMatchCandidate(result.candidate)}`);
        return;
      }
      onSaved(result.grave);
    } catch (err) {
```

- [ ] **Step 8: Run all tests and the type check**

Run: `npx vitest run`
Expected: all test files pass.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/supabase/saveGraveErrors.ts src/lib/capture/saveMappedGrave.ts src/lib/data/store.ts src/components/screens/ConfirmDetailsScreen.tsx tests/save_mapped_grave.test.ts
git commit -m "feat(capture): save through save_or_add_grave and report likely duplicates

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Duplicate card on the Confirm screen

**Files:**
- Create: `src/components/common/DuplicateMatchCard.tsx`
- Modify: `src/components/screens/ConfirmDetailsScreen.tsx` (whole file)
- Modify: `src/app/page.tsx` (`handleGraveSaved`, around line 277)

**Interfaces:**
- Consumes: `dataStore.saveNewGrave`, `dataStore.findMatchingGraves`, `SaveNewGraveResult` (Task 5); `MatchMode`, `createSaveAttempt` (Task 5); `MatchCandidate`, `matchCheckParams`, `describeMatchCandidate`, `matchHeading` (Task 4); `GRAVE_MISSING_MESSAGE` code `grave-missing` (Task 5).
- Produces:
  - `DuplicateMatchCard` props `{ candidate: MatchCandidate; busy: boolean; onAddPhoto: () => void; onDifferentPerson: () => void }` (Plan 2 reuses it).
  - `ConfirmDetailsScreen` prop `onSaved: (grave: Grave, outcome: 'created' | 'added-photo') => void`. The other props are unchanged.

There is no unit test for these components (the project has no React test setup). The logic they use is tested in Tasks 4 and 5; this task is checked with the type check, the build and a manual read of the flow.

- [ ] **Step 1: Create the card**

Create `src/components/common/DuplicateMatchCard.tsx`:

```tsx
'use client';

import React from 'react';
import { Users } from 'lucide-react';
import { MatchCandidate, describeMatchCandidate, matchHeading } from '@/lib/graves/matchCandidate';

interface DuplicateMatchCardProps {
  candidate: MatchCandidate;
  busy: boolean;
  onAddPhoto: () => void;
  onDifferentPerson: () => void;
}

// Shown when the person being saved may already be mapped, so one grave isn't mapped twice
export const DuplicateMatchCard = React.forwardRef<HTMLDivElement, DuplicateMatchCardProps>(
  ({ candidate, busy, onAddPhoto, onDifferentPerson }, ref) => (
    <div ref={ref} role="status" className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2.5">
      <div className="flex items-start">
        <Users className="w-4 h-4 mr-2 mt-0.5 shrink-0 text-amber-700" />
        <p className="text-xs text-amber-900 leading-relaxed">
          <span className="font-bold">{matchHeading(candidate)}:</span> {describeMatchCandidate(candidate)}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2">
        <button
          onClick={onAddPhoto}
          disabled={busy}
          className="w-full py-2.5 px-3 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold transition-colors disabled:opacity-50"
        >
          Add my photo to this grave
        </button>
        <button
          onClick={onDifferentPerson}
          disabled={busy}
          className="w-full py-2.5 px-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          It&apos;s a different person
        </button>
      </div>
    </div>
  )
);

DuplicateMatchCard.displayName = 'DuplicateMatchCard';
```

- [ ] **Step 2: Rewrite the Confirm screen**

Replace the whole of `src/components/screens/ConfirmDetailsScreen.tsx` with:

```tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { AlertTriangle, ArrowLeft, Calendar, CheckCircle2, Loader2 } from 'lucide-react';
import { AIStructuredExtraction, Cemetery, DeviceTelemetry, Grave } from '@/types';
import { dataStore } from '@/lib/data/store';
import { findCemeteryForLocation } from '@/lib/capture/cemeteryForLocation';
import { NewGraveForm, validateNewGraveForm } from '@/lib/capture/newGrave';
import { SaveGraveError, UNKNOWN_SAVE_MESSAGE } from '@/lib/supabase/saveGraveErrors';
import { createSaveAttempt, MatchMode } from '@/lib/capture/saveMappedGrave';
import { MatchCandidate, MatchCheckParams, matchCheckParams } from '@/lib/graves/matchCandidate';
import { DuplicateMatchCard } from '@/components/common/DuplicateMatchCard';

interface ConfirmDetailsScreenProps {
  initialData: AIStructuredExtraction;
  capturedImage: string;
  telemetry: DeviceTelemetry;
  cemeteries: Cemetery[];
  onSaved: (grave: Grave, outcome: 'created' | 'added-photo') => void;
  onRequireSignIn: () => void;
  onBack: () => void;
}

const labelClass = 'block text-[11px] font-semibold text-slate-500 mb-0.5';
const inputClass =
  'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-brand-forest';

// Typing must pause this long before the duplicate check runs
const MATCH_CHECK_DELAY_MS = 500;

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
    nickname: initialData.nickname || '',
    graveNumber: initialData.graveNumber || '',
    birthDate: initialData.birthDate || '',
    deathDate: initialData.deathDate || '',
    cemeteryId: detectedCemetery?.id || '',
  }));
  // Kept across Save retries, so a retry after a lost response reuses the same photo and grave id
  const [attempt] = useState(createSaveAttempt);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A grave already mapped that may be this person
  const [candidate, setCandidate] = useState<MatchCandidate | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Cemeteries can finish loading after the screen opens
  useEffect(() => {
    if (detectedCemetery) {
      setForm((prev) => (prev.cemeteryId ? prev : { ...prev, cemeteryId: detectedCemetery.id }));
    }
  }, [detectedCemetery]);

  // Checks for the same person nearby when the screen opens and whenever the identifying details change
  const checkParams = matchCheckParams(form, telemetry);
  const checkKey = checkParams ? JSON.stringify(checkParams) : '';
  useEffect(() => {
    if (!checkKey) {
      setCandidate(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      dataStore.findMatchingGraves(JSON.parse(checkKey) as MatchCheckParams).then((matches) => {
        if (!cancelled) setCandidate(matches[0] ?? null);
      });
    }, MATCH_CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [checkKey]);

  const { valid, errors } = validateNewGraveForm(form);
  const selectedCemetery = cemeteries.find((cemetery) => cemetery.id === form.cemeteryId);
  const outsideSelectedBoundary = Boolean(selectedCemetery) && detectedCemetery?.id !== selectedCemetery?.id;
  const confidencePercent = Math.round((initialData.confidence ?? 0) * 100);

  const update =
    (field: keyof NewGraveForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const save = async (matchMode: MatchMode, addToGraveId?: string) => {
    if (!valid || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = await dataStore.saveNewGrave({
        form,
        cemeteryName: selectedCemetery?.name,
        photoDataUrl: capturedImage,
        telemetry,
        attempt,
        matchMode,
        addToGraveId,
      });
      if (result.outcome === 'match-found') {
        // For example someone saved this person moments ago. Nothing was created, so the user chooses.
        setCandidate(result.candidate);
        setIsSaving(false);
        window.setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
        return;
      }
      onSaved(result.grave, result.outcome);
    } catch (err) {
      setIsSaving(false);
      setError(err instanceof SaveGraveError ? err.message : UNKNOWN_SAVE_MESSAGE);
      if (err instanceof SaveGraveError && err.code === 'grave-missing') setCandidate(null);
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
        {/* Same person already mapped nearby */}
        {candidate && (
          <DuplicateMatchCard
            ref={cardRef}
            candidate={candidate}
            busy={isSaving || !valid}
            onAddPhoto={() => save('ask', candidate.graveId)}
            onDifferentPerson={() => save('new')}
          />
        )}

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
          {initialData.otherText.length > 0 && (
            <ul className="mt-2 space-y-0.5 pl-4 list-disc text-[11px] text-slate-600">
              {initialData.otherText.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
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
          onClick={() => save('ask')}
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

- [ ] **Step 3: Pass the outcome to the page**

In `src/app/page.tsx`, replace:

```tsx
  // A saved grave opens on its own details page
  const handleGraveSaved = (saved: Grave) => {
    setSelectedGrave(saved);
```

with:

```tsx
  // A saved grave opens on its own details page
  const handleGraveSaved = (saved: Grave, outcome: 'created' | 'added-photo') => {
    setSelectedGrave(saved);
    // The photo went onto a grave that was already mapped, so its photo carousel must reload
    if (outcome === 'added-photo') setGravePhotosVersion((v) => v + 1);
```

- [ ] **Step 4: Type check, tests and build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: all test files pass.

Run: `npm run build`
Expected: the build succeeds. It must not be run while a `next dev` server is using `.next`; stop any dev server first.

- [ ] **Step 5: Check the flow by reading it**

Confirm each point in the code:
- Opening Confirm with a read name runs one `find_matching_graves` call after 500 ms. Editing middle names or nickname does not run another; editing names, dates, grave number or cemetery does.
- "Add my photo to this grave" calls `saveNewGrave` with `addToGraveId` set, and the page reloads that grave's photos.
- "It's a different person" saves in `new` mode.
- Plain Save uses `ask` mode. A `match-found` answer shows the card and scrolls it into view without leaving the screen.
- The UI copy contains no em dashes.

- [ ] **Step 6: Commit**

```bash
git add src/components/common/DuplicateMatchCard.tsx src/components/screens/ConfirmDetailsScreen.tsx src/app/page.tsx
git commit -m "feat(capture): offer to add the photo when the grave is already mapped

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Final checks and hand-over

**Files:**
- Modify: `C:\Users\rizaa\.claude\projects\d--Development-Projects-QabrMap-Code\memory\deploy-and-database-setup.md` (live schema line)

**Interfaces:**
- Consumes: everything above.
- Produces: a branch that is ready for the user to run the two migrations and then deploy.

- [ ] **Step 1: Run everything**

Run: `npx vitest run`
Expected: all files pass. There are 4 more test files than the 33 at baseline (`duplicate_graves_migration`, `photo_read_limits_migration`, `read_stone_route`, `match_candidate`).

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: success.

- [ ] **Step 2: Search for em dashes in the changed files**

Run: `git diff main --name-only | xargs grep -n $'\xe2\x80\x94' || echo "no em dashes"`
Expected: `no em dashes` (the spec and older plans are not part of this diff unless edited).

- [ ] **Step 3: Update the deploy memory**

Read `C:\Users\rizaa\.claude\projects\d--Development-Projects-QabrMap-Code\memory\deploy-and-database-setup.md` and add, in its existing style, that `20260915180000_duplicate_graves.sql` and `20260915181000_photo_read_limits.sql` must be run in the SQL Editor before deploying any build that calls `save_or_add_grave` or `begin_photo_read`, because the app fails closed without them (Save shows "not set up", reading returns 503). Do not mark them as live until the user confirms they ran them.

- [ ] **Step 4: Report to the user**

Tell the user, without pushing or deploying:
1. Run `supabase/migrations/20260915180000_duplicate_graves.sql`, then `supabase/migrations/20260915181000_photo_read_limits.sql`, in Supabase Dashboard > SQL Editor.
2. Deploying before step 1 breaks saving and photo reading.
3. Set a monthly spending limit on the OpenAI project as a final backstop.
4. After deploying, check on a phone: map a grave, then map the same stone again and expect the "Already mapped nearby" card.
