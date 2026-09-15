# Burial Sites Import and Nearby Cemeteries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the 47 South African Muslim burial sites in `data/burial-sites/source.csv` into the `cemeteries` table with a located point, an OpenStreetMap outline where one exists, the community name and a status, and make the Explore Cemeteries screen show the five nearest sites, closest first, with a distance on every card.

**Architecture:** An additive migration extends `cemeteries` (site type, status, aliases, address, Google place id, boundary provenance, sources). Two Node scripts under `tools/burial-sites/` do the import in three steps: `resolve.mjs` calls Google Places, Geocoding and Overpass and writes a reviewable `review.json`; a human edits it; `upsert.mjs` writes approved rows to Supabase. The network-free logic lives in `tools/burial-sites/lib/*.mjs` so Vitest covers it. On the client, a pure `nearby.ts` module and a `locateUser` service feed a reworked `CemeterySelectScreen`.

**Tech Stack:** Next.js 14 App Router (client components), React 18, TypeScript, Supabase (Postgres, PostgREST, supabase-js v2), Dexie, Vitest 2, Node 20+ ES modules with built-in `fetch`, Google Places API (New), Google Geocoding API, Overpass API.

**Spec:** `docs/superpowers/specs/2026-09-15-burial-sites-import-design.md`

## Global Constraints

- Never use em dashes in code comments, UI copy, commit messages or docs. Use commas, colons, periods or parentheses.
- Runtime imports inside `src/lib/**` use relative paths (`../geospatial`), because Vitest has no `@/` alias. Type-only imports may use `@/types`. Components may use `@/`.
- Tests import source with relative paths (`../src/lib/...`, `../tools/burial-sites/lib/...`). There is no Vitest config file: the environment is Node, so nothing that needs a DOM is tested through React. Hooks are thin wrappers around tested pure functions.
- `scripts/` is listed in `.gitignore` (its three existing files were force-added). New tooling lives in `tools/burial-sites/`, which is committed. Never add files under `scripts/`.
- No new npm dependencies. `@supabase/supabase-js` is already a dependency and may be imported by the tools.
- Keys come from `.env.local` only: `GOOGLE_PLACES_API_KEY` (new, server-side, Places API (New) and Geocoding API enabled, restricted by API), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Never hard-code a key. `data/burial-sites/cache/` is gitignored.
- Site types: `muslim_cemetery`, `muslim_section`, `shared_cemetery`, `historic_cemetery`. Site statuses: `active`, `closed`, `unknown`. Boundary sources: `osm`, `manual` or null. Copy these strings exactly.
- Distance format: under 1 km whole metres (`850 m`), 1 km to under 10 km one decimal (`2.4 km`), 10 km and over whole km (`38 km`).
- Nearby shows exactly the 5 closest, ascending. All and My cemeteries sort by distance when a position is known, otherwise by name.
- Match the surrounding code: short comments that explain why, 2-space indent, single quotes, Tailwind classes in the existing style.
- Always `git add` explicit paths, never `git add -A` or `git add .`. The main checkout may hold the owner's uncommitted work.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  ```
- Run one test file: `npx vitest run tests/<file>.test.ts`. Run all tests: `npx vitest run`. Type check: `npx tsc --noEmit`. Baseline before this plan: 384 tests passing, type check clean.
- Migrations are applied by the owner in the Supabase SQL Editor. The app must keep working against the old schema until then: the mapper defaults every new column.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/20260916000000_burial_sites.sql` | Create | New `cemeteries` columns, check constraints, partial unique index |
| `tests/burial_sites_migration.test.ts` | Create | Checks the migration text |
| `src/types/index.ts` | Modify | `Cemetery` gains site type, status, aliases, provenance, `distanceMeters`; loses `distanceKm` |
| `src/lib/supabase/mappers.ts` | Modify | Map the new columns with defaults |
| `src/lib/data/mockData.ts` | Modify | Remove `distanceKm`, add new fields, correct the three live names |
| `tests/directions_navigation.test.ts` | Modify | Entrance name becomes "Johnson Road Gate" |
| `tests/cemetery_mappers.test.ts` | Create | Mapper with and without the new columns |
| `src/lib/cemeteries/nearby.ts` | Create | Distances, nearest five, formatting, search, sort |
| `src/lib/cemeteries/tags.ts` | Create | Card tags from site type and status |
| `tests/cemetery_nearby.test.ts` | Create | Tests for both modules above |
| `src/lib/device/userLocation.ts` | Create | `locateUser`: one browser fix mapped to a status |
| `src/lib/device/useUserLocation.ts` | Create | React hook around `locateUser` |
| `tests/user_location.test.ts` | Create | Status mapping with a stubbed geolocation |
| `src/components/screens/CemeterySelectScreen.tsx` | Modify | Nearby five, distances, tags, location states |
| `src/app/page.tsx` | Modify | Ask for location on the Explore screen and pass it down |
| `tools/burial-sites/lib/env.mjs` | Create | Read `.env.local` into `process.env` |
| `tools/burial-sites/lib/csv.mjs` | Create | RFC 4180 parser for the source file |
| `tools/burial-sites/lib/sources.mjs` | Create | Place id and OSM way extraction, category and status mapping, slugs, supplements |
| `tools/burial-sites/lib/score.mjs` | Create | Rank Google candidates against a row |
| `tools/burial-sites/lib/overpass.mjs` | Create | Overpass queries and element to GeoJSON ring |
| `tools/burial-sites/lib/match.mjs` | Create | Match a resolved row to an existing database row |
| `tests/burial_sites_tools.test.ts` | Create | Tests for the five lib modules |
| `tools/burial-sites/resolve.mjs` | Create | Network glue: CSV to `review.json` and `report.md` |
| `tools/burial-sites/upsert.mjs` | Create | `review.json` to Supabase, with dry run and manual outlines |
| `tools/burial-sites/README.md` | Create | How to run the three steps |
| `data/burial-sites/review.json` | Generated, then edited and committed | Reviewer decisions |
| `data/burial-sites/report.md` | Generated and committed | Counts, unlocated rows, outlines still to draw |
| `data/burial-sites/outlines/.gitkeep` | Create | Folder for hand-drawn GeoJSON |
| `src/components/screens/CemeteryMapScreen.tsx` | Modify | OpenStreetMap credit when the outline came from OSM |

---

### Task 1: Migration

**Files:**
- Create: `supabase/migrations/20260916000000_burial_sites.sql`
- Test: `tests/burial_sites_migration.test.ts`

**Interfaces:**
- Produces: columns `site_type`, `site_status`, `aliases`, `address`, `google_place_id`, `boundary_source`, `osm_id`, `verification_status`, `verification_source`, `source_urls` on `public.cemeteries`. Later tasks read and write these exact names.

- [ ] **Step 1: Write the failing test**

```ts
// tests/burial_sites_migration.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20260916000000_burial_sites.sql'),
  'utf8'
);

describe('Burial Sites Migration Tests', () => {
  it('adds the site type and status with defaults the old rows satisfy', () => {
    expect(MIGRATION).toMatch(/alter table public\.cemeteries add column if not exists site_type text not null default 'muslim_cemetery';/);
    expect(MIGRATION).toMatch(/check \(site_type in \('muslim_cemetery', 'muslim_section', 'shared_cemetery', 'historic_cemetery'\)\)/);
    expect(MIGRATION).toMatch(/alter table public\.cemeteries add column if not exists site_status text not null default 'active';/);
    expect(MIGRATION).toMatch(/check \(site_status in \('active', 'closed', 'unknown'\)\)/);
  });

  it('adds names, address, provenance and sources', () => {
    expect(MIGRATION).toMatch(/add column if not exists aliases text\[\] not null default '\{\}';/);
    expect(MIGRATION).toMatch(/add column if not exists address text;/);
    expect(MIGRATION).toMatch(/add column if not exists google_place_id text;/);
    expect(MIGRATION).toMatch(/add column if not exists boundary_source text;/);
    expect(MIGRATION).toMatch(/check \(boundary_source is null or boundary_source in \('osm', 'manual'\)\)/);
    expect(MIGRATION).toMatch(/add column if not exists osm_id text;/);
    expect(MIGRATION).toMatch(/add column if not exists verification_status text;/);
    expect(MIGRATION).toMatch(/add column if not exists verification_source text;/);
    expect(MIGRATION).toMatch(/add column if not exists source_urls text\[\] not null default '\{\}';/);
  });

  it('keeps one row per Google place without indexing the nulls', () => {
    expect(MIGRATION).toMatch(/create unique index if not exists idx_cemeteries_google_place_id on public\.cemeteries \(google_place_id\)\s+where google_place_id is not null;/);
  });

  it('adds every check constraint through a guarded do block, since add constraint has no if not exists', () => {
    expect(MIGRATION).not.toMatch(/add constraint if not exists/);
    const guarded = MIGRATION.match(/if not exists \(\s*select 1 from pg_constraint where conname = '/g) || [];
    expect(guarded.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/burial_sites_migration.test.ts`
Expected: FAIL with `ENOENT` (the migration file does not exist).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260916000000_burial_sites.sql
-- Burial sites import: site type and status, other names, address, Google and OpenStreetMap links, provenance.
-- Every change is additive with a default, so the four live rows and the running app keep working.
-- Applied by hand in the Supabase SQL Editor.

alter table public.cemeteries add column if not exists site_type text not null default 'muslim_cemetery';
alter table public.cemeteries add column if not exists site_status text not null default 'active';
alter table public.cemeteries add column if not exists aliases text[] not null default '{}';
alter table public.cemeteries add column if not exists address text;
alter table public.cemeteries add column if not exists google_place_id text;
alter table public.cemeteries add column if not exists boundary_source text;
alter table public.cemeteries add column if not exists osm_id text;
alter table public.cemeteries add column if not exists verification_status text;
alter table public.cemeteries add column if not exists verification_source text;
alter table public.cemeteries add column if not exists source_urls text[] not null default '{}';

-- Postgres has no "add constraint if not exists", so each check is guarded
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cemeteries_site_type_check'
  ) then
    alter table public.cemeteries add constraint cemeteries_site_type_check
      check (site_type in ('muslim_cemetery', 'muslim_section', 'shared_cemetery', 'historic_cemetery'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cemeteries_site_status_check'
  ) then
    alter table public.cemeteries add constraint cemeteries_site_status_check
      check (site_status in ('active', 'closed', 'unknown'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cemeteries_boundary_source_check'
  ) then
    alter table public.cemeteries add constraint cemeteries_boundary_source_check
      check (boundary_source is null or boundary_source in ('osm', 'manual'));
  end if;
end $$;

-- One row per Google place; rows placed by hand have no place id and stay out of the index
create unique index if not exists idx_cemeteries_google_place_id on public.cemeteries (google_place_id)
  where google_place_id is not null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/burial_sites_migration.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260916000000_burial_sites.sql tests/burial_sites_migration.test.ts
git commit -m "feat(db): add site type, status, aliases and provenance to cemeteries

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Cemetery type, mapper and mock data

**Files:**
- Modify: `src/types/index.ts:20-43`
- Modify: `src/lib/supabase/mappers.ts:3-27`
- Modify: `src/lib/data/mockData.ts` (the four `MOCK_CEMETERIES` entries; `distanceKm` at lines 47, 85, 125, 158)
- Modify: `tests/directions_navigation.test.ts:26`
- Test: `tests/cemetery_mappers.test.ts`

**Interfaces:**
- Produces on `Cemetery`: `siteType: CemeterySiteType`, `siteStatus: CemeterySiteStatus`, `aliases: string[]`, `address?: string`, `googlePlaceId?: string`, `boundarySource?: CemeteryBoundarySource`, `osmId?: string`, `distanceMeters?: number`. Removes `distanceKm`.
- Produces exported types `CemeterySiteType`, `CemeterySiteStatus`, `CemeteryBoundarySource` from `@/types`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/cemetery_mappers.test.ts
import { describe, it, expect } from 'vitest';
import { mapDbCemetery } from '../src/lib/supabase/mappers';

const baseRow = {
  id: 'cem_test',
  name: 'Test Cemetery',
  slug: 'test-cemetery',
  origin_lat: '-33.9',
  origin_lng: '18.5',
};

describe('mapDbCemetery', () => {
  it('defaults the burial-site columns when the migration has not run yet', () => {
    const cemetery = mapDbCemetery(baseRow);
    expect(cemetery.siteType).toBe('muslim_cemetery');
    expect(cemetery.siteStatus).toBe('active');
    expect(cemetery.aliases).toEqual([]);
    expect(cemetery.address).toBeUndefined();
    expect(cemetery.googlePlaceId).toBeUndefined();
    expect(cemetery.boundarySource).toBeUndefined();
    expect(cemetery.osmId).toBeUndefined();
    expect(cemetery.distanceMeters).toBeUndefined();
  });

  it('maps the burial-site columns when present', () => {
    const cemetery = mapDbCemetery({
      ...baseRow,
      site_type: 'muslim_section',
      site_status: 'closed',
      aliases: ['Old Name', 'Google Name'],
      address: '1 Some Road, Town',
      google_place_id: 'ChIJabc',
      boundary_source: 'osm',
      osm_id: 'way/123',
    });
    expect(cemetery.siteType).toBe('muslim_section');
    expect(cemetery.siteStatus).toBe('closed');
    expect(cemetery.aliases).toEqual(['Old Name', 'Google Name']);
    expect(cemetery.address).toBe('1 Some Road, Town');
    expect(cemetery.googlePlaceId).toBe('ChIJabc');
    expect(cemetery.boundarySource).toBe('osm');
    expect(cemetery.osmId).toBe('way/123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cemetery_mappers.test.ts`
Expected: FAIL, `siteType` is `undefined`.

- [ ] **Step 3: Extend the type**

In `src/types/index.ts`, above `export interface Cemetery`, add:

```ts
export type CemeterySiteType = 'muslim_cemetery' | 'muslim_section' | 'shared_cemetery' | 'historic_cemetery';
export type CemeterySiteStatus = 'active' | 'closed' | 'unknown';
export type CemeteryBoundarySource = 'osm' | 'manual';
```

In `Cemetery`, replace the line `distanceKm?: number;` with these fields (keep the rest as is):

```ts
  siteType: CemeterySiteType;
  siteStatus: CemeterySiteStatus;
  // Other names people search for: the old app name, Google's name, the source's name
  aliases: string[];
  address?: string;
  googlePlaceId?: string;
  boundarySource?: CemeteryBoundarySource;
  osmId?: string;
  // Straight-line distance from the phone, computed on the client and never stored
  distanceMeters?: number;
```

- [ ] **Step 4: Extend the mapper**

In `src/lib/supabase/mappers.ts`, inside `mapDbCemetery`, after `thumbnailUrl: ...` add:

```ts
    // The burial-sites migration may not have run yet, so every new column has a default here too
    siteType: row.site_type || 'muslim_cemetery',
    siteStatus: row.site_status || 'active',
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    address: row.address || undefined,
    googlePlaceId: row.google_place_id || undefined,
    boundarySource: row.boundary_source || undefined,
    osmId: row.osm_id || undefined,
```

- [ ] **Step 5: Update the mock data**

In `src/lib/data/mockData.ts`, for each of the four cemeteries delete the `distanceKm: <n>,` line and add, directly after `coveragePercentage: 0,`:

For `cem_athlone` (also change `name` to `'Vygiekraal / Johnson Road Muslim Cemetery'` and `entranceName` to `'Johnson Road Gate'`):
```ts
    siteType: 'muslim_cemetery',
    siteStatus: 'active',
    aliases: ['Athlone Muslim Cemetery', 'Vygiekraal Cemetery', 'Johnson Road Maqbara'],
```

For `cem_mowbray` (change `name` to `'Mowbray Muslim Cemetery / Gamedia Maqbara'`):
```ts
    siteType: 'muslim_cemetery',
    siteStatus: 'active',
    aliases: ['Mowbray Muslim Cemetery', 'Gamedia Maqbara'],
```

For `cem_mountview`:
```ts
    siteType: 'muslim_cemetery',
    siteStatus: 'unknown',
    aliases: [],
```

For `cem_wynberg` (name stays `'Wynberg Muslim Cemetery'` here; the database row gets the community name in Task 10):
```ts
    siteType: 'historic_cemetery',
    siteStatus: 'closed',
    aliases: ['Brodie Road Muslim Cemetery'],
```

In `tests/directions_navigation.test.ts` line 26 change `'Johnstone Road Gate'` to `'Johnson Road Gate'`.

- [ ] **Step 6: Run the tests and the type check**

Run: `npx vitest run tests/cemetery_mappers.test.ts tests/directions_navigation.test.ts tests/cemetery_boundaries.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: one error in `src/components/screens/CemeterySelectScreen.tsx` about `distanceKm` not existing. That screen is rewritten in Task 5. To keep the commit green, change lines 149-153 of that file now to:

```tsx
                    {cem.distanceMeters !== undefined && (
                      <span className="text-xs font-semibold text-slate-500 shrink-0 ml-2">
                        {Math.round(cem.distanceMeters / 100) / 10} km
                      </span>
                    )}
```

Run `npx tsc --noEmit` again. Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/lib/supabase/mappers.ts src/lib/data/mockData.ts tests/directions_navigation.test.ts tests/cemetery_mappers.test.ts src/components/screens/CemeterySelectScreen.tsx
git commit -m "feat(cemeteries): carry site type, status, aliases and provenance through the app

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Nearby list logic and card tags

**Files:**
- Create: `src/lib/cemeteries/nearby.ts`
- Create: `src/lib/cemeteries/tags.ts`
- Test: `tests/cemetery_nearby.test.ts`

**Interfaces:**
- Produces from `nearby.ts`:
  - `interface UserPoint { lat: number; lng: number }`
  - `withDistances(cemeteries: Cemetery[], position: UserPoint): Cemetery[]`
  - `nearestCemeteries(cemeteries: Cemetery[], position: UserPoint, limit = 5): Cemetery[]`
  - `formatDistance(meters: number): string`
  - `matchesCemeterySearch(cemetery: Cemetery, query: string): boolean`
  - `sortCemeteries(cemeteries: Cemetery[], position?: UserPoint): Cemetery[]`
  - `NEARBY_LIMIT = 5`
- Produces from `tags.ts`: `cemeteryTags(cemetery: Pick<Cemetery, 'siteType' | 'siteStatus'>): string[]`
- Consumes: `calculateDistanceMeters` from `src/lib/geospatial/index.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/cemetery_nearby.test.ts
import { describe, it, expect } from 'vitest';
import type { Cemetery } from '../src/types';
import {
  NEARBY_LIMIT,
  formatDistance,
  matchesCemeterySearch,
  nearestCemeteries,
  sortCemeteries,
  withDistances,
} from '../src/lib/cemeteries/nearby';
import { cemeteryTags } from '../src/lib/cemeteries/tags';

function cemetery(id: string, lat: number, lng: number, extra: Partial<Cemetery> = {}): Cemetery {
  return {
    id,
    name: id,
    slug: id,
    description: '',
    country: 'South Africa',
    province: 'Western Cape',
    city: 'Cape Town',
    denomination: 'Muslim',
    originLat: lat,
    originLng: lng,
    totalGravesEstimate: 0,
    mappedGravesCount: 0,
    coveragePercentage: 0,
    siteType: 'muslim_cemetery',
    siteStatus: 'active',
    aliases: [],
    ...extra,
  };
}

// Athlone gate; each site below is a known distance north of it
const here = { lat: -33.967, lng: 18.5265 };
const sites = [
  cemetery('far', -33.867, 18.5265), // about 11.1 km
  cemetery('mid', -33.947, 18.5265), // about 2.2 km
  cemetery('near', -33.9675, 18.5265), // about 56 m
  cemetery('c4', -33.937, 18.5265),
  cemetery('c5', -33.927, 18.5265),
  cemetery('c6', -33.917, 18.5265),
  cemetery('c7', -33.907, 18.5265),
];

describe('withDistances', () => {
  it('adds a straight-line distance in metres without touching the input', () => {
    const result = withDistances(sites, here);
    expect(result.find((c) => c.id === 'near')?.distanceMeters).toBeCloseTo(55.6, 0);
    expect(result.find((c) => c.id === 'mid')?.distanceMeters).toBeCloseTo(2224, -1);
    expect(sites[0].distanceMeters).toBeUndefined();
  });
});

describe('nearestCemeteries', () => {
  it('returns the five closest, closest first', () => {
    const ids = nearestCemeteries(sites, here).map((c) => c.id);
    expect(ids).toEqual(['near', 'mid', 'c4', 'c5', 'c6']);
    expect(NEARBY_LIMIT).toBe(5);
  });

  it('returns everything when there are fewer than five', () => {
    expect(nearestCemeteries(sites.slice(0, 3), here).map((c) => c.id)).toEqual(['near', 'mid', 'far']);
  });

  it('carries the distance on each result', () => {
    expect(nearestCemeteries(sites, here)[0].distanceMeters).toBeDefined();
  });
});

describe('formatDistance', () => {
  it('uses metres under a kilometre, one decimal to ten, whole kilometres beyond', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(849.6)).toBe('850 m');
    expect(formatDistance(999.4)).toBe('999 m');
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(2440)).toBe('2.4 km');
    expect(formatDistance(9949)).toBe('9.9 km');
    expect(formatDistance(10_000)).toBe('10 km');
    expect(formatDistance(38_400)).toBe('38 km');
  });
});

describe('matchesCemeterySearch', () => {
  const athlone = cemetery('cem_athlone', 0, 0, {
    name: 'Vygiekraal / Johnson Road Muslim Cemetery',
    aliases: ['Athlone Muslim Cemetery', 'Johnson Road Maqbara'],
    city: 'Cape Town',
    province: 'Western Cape',
  });

  it('matches the name, any alias, the city and the province, ignoring case', () => {
    expect(matchesCemeterySearch(athlone, 'vygiekraal')).toBe(true);
    expect(matchesCemeterySearch(athlone, 'ATHLONE')).toBe(true);
    expect(matchesCemeterySearch(athlone, 'maqbara')).toBe(true);
    expect(matchesCemeterySearch(athlone, 'cape town')).toBe(true);
    expect(matchesCemeterySearch(athlone, 'western')).toBe(true);
    expect(matchesCemeterySearch(athlone, 'durban')).toBe(false);
  });

  it('matches everything on a blank query', () => {
    expect(matchesCemeterySearch(athlone, '   ')).toBe(true);
  });
});

describe('sortCemeteries', () => {
  it('sorts by distance when a position is known', () => {
    expect(sortCemeteries(sites, here).map((c) => c.id).slice(0, 3)).toEqual(['near', 'mid', 'c4']);
  });

  it('sorts by name when there is no position and shows no distance', () => {
    const sorted = sortCemeteries([cemetery('b', 0, 0, { name: 'Zeerust' }), cemetery('a', 0, 0, { name: 'Atlantis' })]);
    expect(sorted.map((c) => c.name)).toEqual(['Atlantis', 'Zeerust']);
    expect(sorted[0].distanceMeters).toBeUndefined();
  });
});

describe('cemeteryTags', () => {
  it('names the section, historic and shared types and a closed status', () => {
    expect(cemeteryTags({ siteType: 'muslim_cemetery', siteStatus: 'active' })).toEqual([]);
    expect(cemeteryTags({ siteType: 'muslim_section', siteStatus: 'active' })).toEqual(['Muslim section']);
    expect(cemeteryTags({ siteType: 'shared_cemetery', siteStatus: 'unknown' })).toEqual(['Shared cemetery']);
    expect(cemeteryTags({ siteType: 'historic_cemetery', siteStatus: 'closed' })).toEqual(['Historic', 'Closed']);
    expect(cemeteryTags({ siteType: 'muslim_cemetery', siteStatus: 'closed' })).toEqual(['Closed']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cemetery_nearby.test.ts`
Expected: FAIL, cannot find module `../src/lib/cemeteries/nearby`.

- [ ] **Step 3: Write the modules**

```ts
// src/lib/cemeteries/nearby.ts
import type { Cemetery } from '@/types';
import { calculateDistanceMeters } from '../geospatial';

export interface UserPoint {
  lat: number;
  lng: number;
}

// The Nearby chip shows this many sites, closest first
export const NEARBY_LIMIT = 5;

export function withDistances(cemeteries: Cemetery[], position: UserPoint): Cemetery[] {
  return cemeteries.map((cemetery) => ({
    ...cemetery,
    distanceMeters: calculateDistanceMeters(position.lat, position.lng, cemetery.originLat, cemetery.originLng),
  }));
}

function byDistance(a: Cemetery, b: Cemetery): number {
  return (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity);
}

function byName(a: Cemetery, b: Cemetery): number {
  return a.name.localeCompare(b.name);
}

export function nearestCemeteries(cemeteries: Cemetery[], position: UserPoint, limit = NEARBY_LIMIT): Cemetery[] {
  return withDistances(cemeteries, position).sort(byDistance).slice(0, limit);
}

// Under a kilometre people think in metres; past ten kilometres a decimal is noise
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

export function matchesCemeterySearch(cemetery: Cemetery, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const haystack = [cemetery.name, ...cemetery.aliases, cemetery.city, cemetery.province];
  return haystack.some((text) => text.toLowerCase().includes(q));
}

// With a position the list is closest first; without one, alphabetical and no distances shown
export function sortCemeteries(cemeteries: Cemetery[], position?: UserPoint): Cemetery[] {
  if (position) return withDistances(cemeteries, position).sort(byDistance);
  return cemeteries.map((cemetery) => ({ ...cemetery, distanceMeters: undefined })).sort(byName);
}
```

```ts
// src/lib/cemeteries/tags.ts
import type { Cemetery } from '@/types';

const TYPE_TAGS: Record<Cemetery['siteType'], string | null> = {
  muslim_cemetery: null,
  muslim_section: 'Muslim section',
  shared_cemetery: 'Shared cemetery',
  historic_cemetery: 'Historic',
};

// Short labels for the cemetery card; a dedicated active cemetery gets none
export function cemeteryTags(cemetery: Pick<Cemetery, 'siteType' | 'siteStatus'>): string[] {
  const tags: string[] = [];
  const typeTag = TYPE_TAGS[cemetery.siteType];
  if (typeTag) tags.push(typeTag);
  if (cemetery.siteStatus === 'closed') tags.push('Closed');
  return tags;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cemetery_nearby.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cemeteries/nearby.ts src/lib/cemeteries/tags.ts tests/cemetery_nearby.test.ts
git commit -m "feat(cemeteries): nearest-five list, distance formatting, alias search and card tags

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: User location service and hook

**Files:**
- Create: `src/lib/device/userLocation.ts`
- Create: `src/lib/device/useUserLocation.ts`
- Test: `tests/user_location.test.ts`

**Interfaces:**
- Produces from `userLocation.ts`:
  - `type UserLocationStatus = 'idle' | 'locating' | 'ready' | 'denied' | 'unavailable'`
  - `interface UserPosition { lat: number; lng: number; accuracy: number; at: number }`
  - `interface GeolocationLike { getCurrentPosition(success: (p: GeolocationPosition) => void, error: (e: GeolocationPositionError) => void, options?: PositionOptions): void }`
  - `type LocateResult = { status: 'ready'; position: UserPosition } | { status: 'denied' | 'unavailable'; message: string }`
  - `LOCATE_OPTIONS`, `LOCATION_DENIED_MESSAGE`, `LOCATION_UNAVAILABLE_MESSAGE`
  - `locateUser(geolocation: GeolocationLike | undefined): Promise<LocateResult>`
- Produces from `useUserLocation.ts`: `useUserLocation(enabled: boolean): { status: UserLocationStatus; position?: UserPosition; message?: string; retry: () => void }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/user_location.test.ts
import { describe, it, expect } from 'vitest';
import {
  GeolocationLike,
  LOCATE_OPTIONS,
  LOCATION_DENIED_MESSAGE,
  LOCATION_UNAVAILABLE_MESSAGE,
  locateUser,
} from '../src/lib/device/userLocation';

function geolocationThatReturns(lat: number, lng: number, accuracy: number): GeolocationLike {
  return {
    getCurrentPosition(success) {
      success({ coords: { latitude: lat, longitude: lng, accuracy }, timestamp: 1_700_000_000_000 } as GeolocationPosition);
    },
  };
}

function geolocationThatFails(code: number): GeolocationLike {
  return {
    getCurrentPosition(_success, error) {
      error({ code, message: 'x', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
    },
  };
}

describe('locateUser', () => {
  it('returns the fix as a ready position', async () => {
    const result = await locateUser(geolocationThatReturns(-33.9, 18.5, 12));
    expect(result).toEqual({ status: 'ready', position: { lat: -33.9, lng: 18.5, accuracy: 12, at: 1_700_000_000_000 } });
  });

  it('reports a refused permission as denied with a message that says how to fix it', async () => {
    const result = await locateUser(geolocationThatFails(1));
    expect(result).toEqual({ status: 'denied', message: LOCATION_DENIED_MESSAGE });
    expect(LOCATION_DENIED_MESSAGE).toMatch(/allow location/i);
  });

  it('reports a timeout or missing fix as unavailable', async () => {
    expect(await locateUser(geolocationThatFails(2))).toEqual({ status: 'unavailable', message: LOCATION_UNAVAILABLE_MESSAGE });
    expect(await locateUser(geolocationThatFails(3))).toEqual({ status: 'unavailable', message: LOCATION_UNAVAILABLE_MESSAGE });
  });

  it('reports a browser without geolocation as unavailable', async () => {
    expect(await locateUser(undefined)).toEqual({ status: 'unavailable', message: LOCATION_UNAVAILABLE_MESSAGE });
  });

  it('asks for a fresh, accurate fix but gives up after ten seconds', () => {
    expect(LOCATE_OPTIONS).toEqual({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/user_location.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Write the service and the hook**

```ts
// src/lib/device/userLocation.ts
export type UserLocationStatus = 'idle' | 'locating' | 'ready' | 'denied' | 'unavailable';

export interface UserPosition {
  lat: number;
  lng: number;
  accuracy: number;
  // Epoch milliseconds when the browser reported it
  at: number;
}

// The slice of navigator.geolocation this module uses, so tests can hand in a stub
export interface GeolocationLike {
  getCurrentPosition(
    success: (position: GeolocationPosition) => void,
    error: (error: GeolocationPositionError) => void,
    options?: PositionOptions
  ): void;
}

export type LocateResult =
  | { status: 'ready'; position: UserPosition }
  | { status: 'denied' | 'unavailable'; message: string };

// A fix from the last minute is fine for sorting cemeteries kilometres apart; ten seconds is long enough indoors
export const LOCATE_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 };

export const LOCATION_DENIED_MESSAGE = 'Location is off for this site. Allow location in your browser settings to see cemeteries near you.';
export const LOCATION_UNAVAILABLE_MESSAGE = 'Your location could not be found right now.';

export function locateUser(geolocation: GeolocationLike | undefined): Promise<LocateResult> {
  if (!geolocation) return Promise.resolve({ status: 'unavailable', message: LOCATION_UNAVAILABLE_MESSAGE });
  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      (fix) => {
        resolve({
          status: 'ready',
          position: {
            lat: fix.coords.latitude,
            lng: fix.coords.longitude,
            accuracy: fix.coords.accuracy,
            at: fix.timestamp,
          },
        });
      },
      (error) => {
        // Code 1 is a refusal; 2 (no fix) and 3 (timeout) both mean "not right now"
        if (error.code === 1) resolve({ status: 'denied', message: LOCATION_DENIED_MESSAGE });
        else resolve({ status: 'unavailable', message: LOCATION_UNAVAILABLE_MESSAGE });
      },
      LOCATE_OPTIONS
    );
  });
}
```

```ts
// src/lib/device/useUserLocation.ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserLocationStatus, UserPosition, locateUser } from './userLocation';

export interface UseUserLocationResult {
  status: UserLocationStatus;
  position?: UserPosition;
  message?: string;
  retry: () => void;
}

// One fix each time the screen that asks is opened (a fix under a minute old is reused by the browser).
// Retry asks again, for example after the person turned location on. Status is deliberately not a
// dependency: the effect must not re-run and cancel its own request when it moves to "locating".
export function useUserLocation(enabled: boolean): UseUserLocationResult {
  const [status, setStatus] = useState<UserLocationStatus>('idle');
  const [position, setPosition] = useState<UserPosition | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setStatus('locating');
    setMessage(undefined);
    locateUser(typeof navigator !== 'undefined' ? navigator.geolocation : undefined).then((result) => {
      if (cancelled) return;
      if (result.status === 'ready') {
        setPosition(result.position);
        setStatus('ready');
      } else {
        setMessage(result.message);
        setStatus(result.status);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return { status, position, message, retry };
}
```

- [ ] **Step 4: Run tests and the type check**

Run: `npx vitest run tests/user_location.test.ts`
Expected: PASS, 5 tests.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/device/userLocation.ts src/lib/device/useUserLocation.ts tests/user_location.test.ts
git commit -m "feat(device): one-shot user location with denied and unavailable states

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Explore Cemeteries screen shows the nearest five with distances

**Files:**
- Modify: `src/components/screens/CemeterySelectScreen.tsx`
- Modify: `src/app/page.tsx` (imports near the top; the `HomeScreen`/`CemeterySelectScreen` block at lines 448-461)

**Interfaces:**
- Consumes: `nearestCemeteries`, `sortCemeteries`, `matchesCemeterySearch`, `formatDistance` from `@/lib/cemeteries/nearby`; `cemeteryTags` from `@/lib/cemeteries/tags`; `useUserLocation` from `@/lib/device/useUserLocation`.
- Produces new props on `CemeterySelectScreen`: `locationStatus: UserLocationStatus`, `userPosition?: UserPosition`, `locationMessage?: string`, `onRetryLocation: () => void`.

- [ ] **Step 1: Rewrite the list logic in `CemeterySelectScreen.tsx`**

Replace the imports and the props interface at the top of the file with:

```tsx
'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { ArrowLeft, Search, ChevronRight, Heart, LocateFixed } from 'lucide-react';
import { Cemetery } from '@/types';
import { formatGravesMapped } from '@/lib/data/cemeteryStats';
import { formatDistance, matchesCemeterySearch, nearestCemeteries, sortCemeteries } from '@/lib/cemeteries/nearby';
import { cemeteryTags } from '@/lib/cemeteries/tags';
import type { UserLocationStatus, UserPosition } from '@/lib/device/userLocation';

interface CemeterySelectScreenProps {
  cemeteries: Cemetery[];
  selectedCemetery: Cemetery | null;
  initialFilter?: 'nearby' | 'my-cemeteries' | 'recent' | 'all';
  locationStatus: UserLocationStatus;
  userPosition?: UserPosition;
  locationMessage?: string;
  onRetryLocation: () => void;
  isMyCemetery?: (id: string) => boolean;
  onToggleMyCemetery?: (id: string) => void;
  onSelectCemetery: (cemetery: Cemetery) => void;
  onBack: () => void;
}
```

Add the four new props to the destructuring in the component signature (`locationStatus, userPosition, locationMessage, onRetryLocation,`).

Replace the `const filteredCemeteries = cemeteries.filter(...)` block with:

```tsx
  const searched = cemeteries.filter((c) => matchesCemeterySearch(c, searchQuery));

  // Nearby is the five closest and needs a position; the other chips list everything they cover,
  // closest first when the position is known and by name when it is not
  const filteredCemeteries: Cemetery[] = (() => {
    if (activeFilter === 'nearby') {
      return userPosition ? nearestCemeteries(searched, userPosition) : [];
    }
    const scoped = activeFilter === 'my-cemeteries' ? searched.filter((c) => isMyCemetery(c.id)) : searched;
    return sortCemeteries(scoped, userPosition);
  })();

  const nearbyNeedsLocation = activeFilter === 'nearby' && !userPosition;
```

Replace the `{filteredCemeteries.length === 0 ? ( ... ) : (` empty-state block with:

```tsx
        {nearbyNeedsLocation ? (
          <div className="text-center py-12 px-6">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-brand-forest flex items-center justify-center mx-auto mb-3">
              <LocateFixed className={`w-6 h-6 ${locationStatus === 'locating' ? 'animate-pulse' : ''}`} />
            </div>
            {locationStatus === 'locating' || locationStatus === 'idle' ? (
              <h3 className="text-sm font-bold text-slate-800">Finding your location...</h3>
            ) : (
              <>
                <h3 className="text-sm font-bold text-slate-800">Location needed for nearby cemeteries</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto leading-relaxed">{locationMessage}</p>
                <div className="flex items-center justify-center gap-2 mt-4">
                  <button
                    onClick={onRetryLocation}
                    className="px-4 py-2 rounded-full bg-brand-forest text-white text-xs font-semibold"
                  >
                    Try again
                  </button>
                  <button
                    onClick={() => setActiveFilter('all')}
                    className="px-4 py-2 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold"
                  >
                    Show all
                  </button>
                </div>
              </>
            )}
          </div>
        ) : filteredCemeteries.length === 0 ? (
          <div className="text-center py-12 px-6">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center mx-auto mb-3">
              <Heart className="w-6 h-6 fill-rose-400" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">
              {activeFilter === 'my-cemeteries' ? 'No saved cemeteries yet' : 'No cemeteries found'}
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto leading-relaxed">
              {activeFilter === 'my-cemeteries'
                ? 'Tap the heart icon on any cemetery card to add it to My cemeteries for quick access.'
                : 'Try adjusting your search query or filter.'}
            </p>
          </div>
        ) : (
```

Inside the card, replace the name-and-distance row and the city line with:

```tsx
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-900 truncate">{cem.name}</h2>
                    {cem.distanceMeters !== undefined && (
                      <span className="text-xs font-semibold text-slate-500 shrink-0 ml-2">
                        {formatDistance(cem.distanceMeters)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate mt-0.5">
                    {cem.city}, {cem.province}
                  </p>
                  {cemeteryTags(cem).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {cemeteryTags(cem).map((tag) => (
                        <span
                          key={tag}
                          className={`px-1.5 py-px rounded text-[10px] font-semibold ${
                            tag === 'Closed' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
```

- [ ] **Step 2: Wire the hook in `page.tsx`**

Add the import next to the other hooks:

```tsx
import { useUserLocation } from '@/lib/device/useUserLocation';
```

After `const installOffer = useInstallOffer(...)` add:

```tsx
  // Ask for the phone's position only while the Explore screen is open; it drives the Nearby chip and distances
  const exploreLocation = useUserLocation(mounted && currentScreen === 'cemetery-select');
```

Change the `CemeterySelectScreen` element to pass the new props:

```tsx
          <CemeterySelectScreen
            cemeteries={cemeteries}
            selectedCemetery={selectedCemetery}
            initialFilter={cemeteryFilter}
            locationStatus={exploreLocation.status}
            userPosition={exploreLocation.position}
            locationMessage={exploreLocation.message}
            onRetryLocation={exploreLocation.retry}
            isMyCemetery={(id) => dataStore.isMyCemetery(id)}
            onToggleMyCemetery={(id) => {
              dataStore.toggleMyCemetery(id);
              setStoreVersion((v) => v + 1);
            }}
            onSelectCemetery={handleSelectCemetery}
            onBack={() => setCurrentScreen('home')}
          />
```

Leave the hard-coded `userLocation` state alone; the navigation and AR screens still take it as their starting value and fetch their own fixes.

- [ ] **Step 3: Type check and full test run**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npx vitest run`
Expected: all pass (384 baseline plus the new files).

- [ ] **Step 4: Check it in a browser**

Run `npm run dev`, open the app, tap Explore cemeteries. Confirm:
- Nearby shows "Finding your location..." then at most five cards closest first, each with a distance.
- Deny location (browser site settings), tap Try again: the message and the two buttons appear; Show all switches the chip.
- All shows every cemetery with a distance when location was granted, alphabetical without one.
- Search for "athlone" finds the Vygiekraal row through its alias.

- [ ] **Step 5: Commit**

```bash
git add src/components/screens/CemeterySelectScreen.tsx src/app/page.tsx
git commit -m "feat(explore): show the five nearest cemeteries with distances and site tags

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Import tooling, part one: environment, CSV, sources and supplements

**Files:**
- Create: `tools/burial-sites/lib/env.mjs`
- Create: `tools/burial-sites/lib/csv.mjs`
- Create: `tools/burial-sites/lib/sources.mjs`
- Create: `data/burial-sites/outlines/.gitkeep`
- Test: `tests/burial_sites_tools.test.ts`

**Interfaces:**
- Produces from `env.mjs`: `loadEnvLocal(filePath)` (returns the parsed object and fills `process.env` for keys not already set).
- Produces from `csv.mjs`: `parseCsv(text): Array<Record<string, string>>`.
- Produces from `sources.mjs`:
  - `placeIdFromUrl(url: string): string | null`
  - `osmWayFromUrl(url: string): string | null` (returns `'way/227933663'`)
  - `siteTypeFor(category: string): string`
  - `siteStatusFor(status: string): string`
  - `slugify(text: string): string`
  - `cemeteryIdFor(name: string): string` (`'cem_' + slugify(name)`)
  - `mergeSupplements(rows, supplements): rows` (fills coordinates by `cemetery_name`, appends `extra_sites` with `from_supplements: true`)
  - `rowSourceUrls(row): string[]`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/burial_sites_tools.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../tools/burial-sites/lib/csv.mjs';
import {
  cemeteryIdFor,
  mergeSupplements,
  osmWayFromUrl,
  placeIdFromUrl,
  rowSourceUrls,
  siteStatusFor,
  siteTypeFor,
  slugify,
} from '../tools/burial-sites/lib/sources.mjs';
import { loadEnvLocal } from '../tools/burial-sites/lib/env.mjs';

const SOURCE = readFileSync(path.resolve(__dirname, '../data/burial-sites/source.csv'), 'utf8');

describe('parseCsv', () => {
  it('reads quoted fields with commas and keeps curly apostrophes', () => {
    const rows = parseCsv('a,b,c\n1,"x, y",z\n"General Public Cemetery, West Street",Mitchell’s,\n');
    expect(rows).toEqual([
      { a: '1', b: 'x, y', c: 'z' },
      { a: 'General Public Cemetery, West Street', b: 'Mitchell’s', c: '' },
    ]);
  });

  it('unescapes doubled quotes and tolerates CRLF', () => {
    expect(parseCsv('a,b\r\n"say ""hi""",2\r\n')).toEqual([{ a: 'say "hi"', b: '2' }]);
  });

  it('reads the real source file: 47 rows, 16 with coordinates', () => {
    const rows = parseCsv(SOURCE);
    expect(rows).toHaveLength(47);
    expect(rows.filter((r) => r.latitude && r.longitude)).toHaveLength(16);
    expect(rows[1].cemetery_name).toBe('Vygiekraal / Johnson Road Muslim Cemetery');
  });
});

describe('sources', () => {
  it('pulls a Google place id out of a Waze link', () => {
    expect(placeIdFromUrl('https://www.waze.com/live-map/directions/za/kzn/berea/al-hilal-muslim-cemetery?to=place.ChIJvQH8ZE8H9x4RgMx8q9BKmyk')).toBe('ChIJvQH8ZE8H9x4RgMx8q9BKmyk');
    expect(placeIdFromUrl('https://mjc.org.za/community/cemeteries/')).toBeNull();
    expect(placeIdFromUrl('')).toBeNull();
  });

  it('pulls an OSM way out of a Mapcarta link', () => {
    expect(osmWayFromUrl('https://mapcarta.com/W227933663')).toBe('way/227933663');
    expect(osmWayFromUrl('https://mapcarta.com/N123')).toBeNull();
  });

  it('maps the seven CSV categories onto the four site types', () => {
    expect(siteTypeFor('Dedicated Muslim cemetery')).toBe('muslim_cemetery');
    expect(siteTypeFor('Historic Muslim cemetery')).toBe('historic_cemetery');
    expect(siteTypeFor('Muslim section in municipal cemetery')).toBe('muslim_section');
    expect(siteTypeFor('Mixed cemetery with Muslim section')).toBe('muslim_section');
    expect(siteTypeFor('Mixed cemetery with Muslim graves/section')).toBe('muslim_section');
    expect(siteTypeFor('Mixed cemetery with Muslim blocks')).toBe('muslim_section');
    expect(siteTypeFor('Muslim burials / community cemetery')).toBe('muslim_section');
    expect(siteTypeFor('Shared Muslim/Hindu cemetery')).toBe('shared_cemetery');
    expect(() => siteTypeFor('Something else')).toThrow(/unknown category/i);
  });

  it('maps the CSV statuses onto active, closed and unknown', () => {
    expect(siteStatusFor('active')).toBe('active');
    expect(siteStatusFor('historic_or_closed')).toBe('closed');
    expect(siteStatusFor('active_or_burial_site')).toBe('unknown');
    expect(siteStatusFor('historic_or_active')).toBe('unknown');
    expect(() => siteStatusFor('')).toThrow(/unknown status/i);
  });

  it('builds stable ids and slugs from names', () => {
    expect(slugify('Mowbray Muslim Cemetery / Gamedia Maqbara')).toBe('mowbray-muslim-cemetery-gamedia-maqbara');
    expect(slugify("Mitchell’s Plain/Khayelitsha Muslim Cemetery (Swartklip)")).toBe('mitchells-plain-khayelitsha-muslim-cemetery-swartklip');
    expect(cemeteryIdFor('Roshnee Muslim Cemetery')).toBe('cem_roshnee-muslim-cemetery');
  });

  it('collects the non-empty source urls of a row', () => {
    expect(rowSourceUrls({ source_url_1: 'https://a', source_url_2: '' })).toEqual(['https://a']);
    expect(rowSourceUrls({ source_url_1: 'https://a', source_url_2: 'https://b' })).toEqual(['https://a', 'https://b']);
  });

  it('fills blank coordinates and appends extra sites from the supplements', () => {
    const rows = [
      { cemetery_name: 'Tana Baru Cemetery', latitude: '', longitude: '' },
      { cemetery_name: 'Other', latitude: '-1', longitude: '2' },
    ];
    const merged = mergeSupplements(rows, {
      coordinates: [{ cemetery_name: 'Tana Baru Cemetery', latitude: -33.918325, longitude: 18.415158, source_url: 'https://h' }],
      extra_sites: [{ cemetery_name: 'Extra', source_url_1: 'https://x' }],
    });
    expect(merged[0]).toMatchObject({ latitude: '-33.918325', longitude: '18.415158', coordinate_source_url: 'https://h' });
    expect(merged[1]).toMatchObject({ latitude: '-1', longitude: '2' });
    expect(merged[2]).toMatchObject({ cemetery_name: 'Extra', from_supplements: true });
  });
});

describe('loadEnvLocal', () => {
  it('parses KEY=VALUE lines, skips comments and does not overwrite set variables', () => {
    const dir = path.resolve(__dirname, '../data/burial-sites');
    const file = path.join(dir, 'env.test.tmp');
    writeFileSync(file, '# comment\nBS_TEST_A=one\nBS_TEST_B="two words"\n\nBS_TEST_C=x=y\n');
    process.env.BS_TEST_A = 'already';
    try {
      const parsed = loadEnvLocal(file);
      expect(parsed).toEqual({ BS_TEST_A: 'one', BS_TEST_B: 'two words', BS_TEST_C: 'x=y' });
      expect(process.env.BS_TEST_A).toBe('already');
      expect(process.env.BS_TEST_B).toBe('two words');
    } finally {
      unlinkSync(file);
      delete process.env.BS_TEST_A;
      delete process.env.BS_TEST_B;
      delete process.env.BS_TEST_C;
    }
  });

  it('returns an empty object when the file is missing', () => {
    expect(loadEnvLocal(path.resolve(__dirname, '../data/burial-sites/does-not-exist'))).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/burial_sites_tools.test.ts`
Expected: FAIL, cannot find module `../tools/burial-sites/lib/csv.mjs`.

- [ ] **Step 3: Write the three modules and the outlines folder**

```js
// tools/burial-sites/lib/env.mjs
import { existsSync, readFileSync } from 'node:fs';

// Reads a .env file the way Next.js does for the simple cases: KEY=VALUE, optional double quotes, # comments.
// Variables already set in the process win, so CI or a shell export can override the file.
export function loadEnvLocal(filePath) {
  if (!existsSync(filePath)) return {};
  const parsed = {};
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    parsed[key] = value;
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return parsed;
}
```

```js
// tools/burial-sites/lib/csv.mjs
// Minimal RFC 4180 reader: quoted fields may hold commas, newlines and doubled quotes. Header row names the keys.
export function parseCsv(text) {
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    // A trailing newline leaves one empty field; that is not a row
    if (record.length === 1 && record[0] === '') {
      record = [];
      return;
    }
    records.push(record);
    record = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') pushField();
    else if (ch === '\n') {
      pushField();
      pushRecord();
    } else if (ch !== '\r') field += ch;
  }
  if (field !== '' || record.length > 0) {
    pushField();
    pushRecord();
  }
  const [header, ...rows] = records;
  if (!header) return [];
  return rows.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ''])));
}
```

```js
// tools/burial-sites/lib/sources.mjs
// Facts that can be read straight off a CSV row, with no network.

const SITE_TYPES = {
  'Dedicated Muslim cemetery': 'muslim_cemetery',
  'Historic Muslim cemetery': 'historic_cemetery',
  'Muslim section in municipal cemetery': 'muslim_section',
  'Mixed cemetery with Muslim section': 'muslim_section',
  'Mixed cemetery with Muslim graves/section': 'muslim_section',
  'Mixed cemetery with Muslim blocks': 'muslim_section',
  'Muslim burials / community cemetery': 'muslim_section',
  'Shared Muslim/Hindu cemetery': 'shared_cemetery',
};

const SITE_STATUSES = {
  active: 'active',
  historic_or_closed: 'closed',
  active_or_burial_site: 'unknown',
  historic_or_active: 'unknown',
};

export function siteTypeFor(category) {
  const type = SITE_TYPES[category.trim()];
  if (!type) throw new Error(`Unknown category: "${category}"`);
  return type;
}

export function siteStatusFor(status) {
  const mapped = SITE_STATUSES[status.trim()];
  if (!mapped) throw new Error(`Unknown status: "${status}"`);
  return mapped;
}

// Waze links carry the Google place id as ?to=place.<id>
export function placeIdFromUrl(url) {
  const match = /place\.(ChIJ[\w-]+)/.exec(url || '');
  return match ? match[1] : null;
}

// Mapcarta links name the OpenStreetMap way: https://mapcarta.com/W<id>
export function osmWayFromUrl(url) {
  const match = /mapcarta\.com\/W(\d+)/.exec(url || '');
  return match ? `way/${match[1]}` : null;
}

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function cemeteryIdFor(name) {
  return `cem_${slugify(name)}`;
}

export function rowSourceUrls(row) {
  return [row.source_url_1, row.source_url_2].filter((url) => url && url.trim());
}

// Coordinates fill blanks on matching rows; extra sites are appended and marked so they start as needs_review
export function mergeSupplements(rows, supplements) {
  const coordinates = new Map((supplements.coordinates || []).map((c) => [c.cemetery_name, c]));
  const merged = rows.map((row) => {
    const fill = coordinates.get(row.cemetery_name);
    if (!fill || (row.latitude && row.longitude)) return row;
    return {
      ...row,
      latitude: String(fill.latitude),
      longitude: String(fill.longitude),
      coordinate_source_url: fill.source_url,
    };
  });
  for (const site of supplements.extra_sites || []) {
    merged.push({ latitude: '', longitude: '', source_url_2: '', ...site, from_supplements: true });
  }
  return merged;
}
```

Create the empty file `data/burial-sites/outlines/.gitkeep`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/burial_sites_tools.test.ts`
Expected: PASS, 12 tests.

Run: `npx tsc --noEmit`
Expected: clean. JavaScript files are not type-checked (`checkJs` is off), so untyped parameters in the `.mjs` modules are fine. If `tsc` still reports an error inside a `.mjs` file, put `// @ts-nocheck` on its first line.

- [ ] **Step 5: Commit**

```bash
git add tools/burial-sites/lib/env.mjs tools/burial-sites/lib/csv.mjs tools/burial-sites/lib/sources.mjs data/burial-sites/outlines/.gitkeep tests/burial_sites_tools.test.ts
git commit -m "feat(import): read the burial-sites CSV, map categories and statuses, merge supplements

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Import tooling, part two: candidate scoring, Overpass outlines, existing-row matching

**Files:**
- Create: `tools/burial-sites/lib/score.mjs`
- Create: `tools/burial-sites/lib/overpass.mjs`
- Create: `tools/burial-sites/lib/match.mjs`
- Test: `tests/burial_sites_tools.test.ts` (append)

**Interfaces:**
- Produces from `score.mjs`:
  - `haversineMeters(lat1, lng1, lat2, lng2): number`
  - `nameTokens(name): string[]`
  - `scoreCandidate({ csvName, anchor: {lat,lng}, anchorKind: 'row' | 'town', candidate: { displayName, location: {latitude, longitude}, types } }): number | null` (null means rejected)
  - `rankCandidates(row, anchor, anchorKind, candidates): Array<{ candidate, score, distanceMeters }>` sorted best first, rejected ones dropped, at most 3
  - `ANCHOR_LIMITS = { row: 1000, town: 30_000 }`
- Produces from `overpass.mjs`:
  - `aroundQuery(lat, lng, radiusMeters = 400): string`
  - `wayQuery(osmId): string` (`osmId` like `'way/123'`)
  - `elementToRing(element): [number, number][] | null` (closed `[lng, lat]` ring)
  - `ringAreaSquareMeters(ring): number`
  - `chooseOutline(elements, point: {lat,lng}, preferredOsmId?: string): { osmId, ring, areaSquareMeters, containsPoint } | null`
- Produces from `match.mjs`: `matchExisting(existing: Array<{id, google_place_id, origin_lat, origin_lng}>, resolved: { placeId?: string, lat?: number, lng?: number }): row | undefined` with `MATCH_RADIUS_METERS = 300`.
- Consumes: `isPointInPolygon` logic is reimplemented in `overpass.mjs` (tools cannot import TypeScript from `src/`).

- [ ] **Step 1: Append the failing tests**

Add these imports to the top of `tests/burial_sites_tools.test.ts`:

```ts
import { ANCHOR_LIMITS, haversineMeters, nameTokens, rankCandidates, scoreCandidate } from '../tools/burial-sites/lib/score.mjs';
import { aroundQuery, chooseOutline, elementToRing, ringAreaSquareMeters, wayQuery } from '../tools/burial-sites/lib/overpass.mjs';
import { MATCH_RADIUS_METERS, matchExisting } from '../tools/burial-sites/lib/match.mjs';
```

Append:

```ts
describe('score', () => {
  const anchor = { lat: -33.93908, lng: 18.46112 };
  const google = (displayName: string, lat: number, lng: number, types: string[] = ['cemetery']) => ({
    displayName,
    location: { latitude: lat, longitude: lng },
    types,
  });

  it('measures distance with the haversine formula', () => {
    expect(haversineMeters(-33.967, 18.5265, -33.9675, 18.5265)).toBeCloseTo(55.6, 0);
  });

  it('drops filler words from names before comparing', () => {
    expect(nameTokens('Mowbray Muslim Cemetery / Gamedia Maqbara')).toEqual(['mowbray', 'gamedia']);
    expect(nameTokens('Klip Road North Muslim Cemetery')).toEqual(['klip', 'north']);
  });

  it('rejects a candidate beyond the anchor limit and scores closer, better-named cemeteries higher', () => {
    expect(ANCHOR_LIMITS).toEqual({ row: 1000, town: 30_000 });
    const far = google('Mowbray Cemetery', -33.95, 18.46112);
    expect(scoreCandidate({ csvName: 'Mowbray Muslim Cemetery', anchor, anchorKind: 'row', candidate: far })).toBeNull();
    const exact = google('Mowbray Muslim Cemetery', -33.93908, 18.46112);
    const vague = google('Mowbray Park', -33.9392, 18.4612, ['park']);
    const exactScore = scoreCandidate({ csvName: 'Mowbray Muslim Cemetery', anchor, anchorKind: 'row', candidate: exact });
    const vagueScore = scoreCandidate({ csvName: 'Mowbray Muslim Cemetery', anchor, anchorKind: 'row', candidate: vague });
    expect(exactScore).toBeGreaterThan(vagueScore as number);
    expect(exactScore).toBeCloseTo(2.5, 5);
  });

  it('ranks candidates best first and keeps at most three', () => {
    const ranked = rankCandidates(
      { cemetery_name: 'Mowbray Muslim Cemetery' },
      anchor,
      'town',
      [
        google('Mowbray Park', -33.9392, 18.4612, ['park']),
        google('Mowbray Muslim Cemetery', -33.93908, 18.46112),
        google('Somewhere', -33.939, 18.461, ['store']),
        google('Another Cemetery', -33.94, 18.462),
        google('Too Far', -34.5, 18.46112),
      ]
    );
    expect(ranked).toHaveLength(3);
    expect(ranked[0].candidate.displayName).toBe('Mowbray Muslim Cemetery');
    expect(ranked[0].distanceMeters).toBeCloseTo(0, 0);
  });
});

describe('overpass', () => {
  it('asks for cemetery ways and relations around a point, with geometry', () => {
    const q = aroundQuery(-33.9, 18.5, 400);
    expect(q).toContain('way["landuse"="cemetery"](around:400,-33.9,18.5)');
    expect(q).toContain('way["amenity"="grave_yard"](around:400,-33.9,18.5)');
    expect(q).toContain('relation["landuse"="cemetery"](around:400,-33.9,18.5)');
    expect(q).toContain('out geom;');
    expect(wayQuery('way/227933663')).toContain('way(227933663);');
  });

  it('turns a way into a closed [lng, lat] ring', () => {
    const ring = elementToRing({
      type: 'way',
      id: 1,
      geometry: [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
        { lat: 1, lon: 1 },
        { lat: 1, lon: 0 },
      ],
    });
    expect(ring).toEqual([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
  });

  it('takes the largest outer ring of a multipolygon relation', () => {
    const small = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.1 }, { lat: 0.1, lon: 0.1 }, { lat: 0, lon: 0 }];
    const big = [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 0, lon: 0 }];
    const ring = elementToRing({
      type: 'relation',
      id: 2,
      members: [
        { type: 'way', role: 'outer', geometry: small },
        { type: 'way', role: 'inner', geometry: big },
        { type: 'way', role: 'outer', geometry: big },
      ],
    });
    expect(ring).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]]);
  });

  it('returns null for an element without usable geometry', () => {
    expect(elementToRing({ type: 'way', id: 3, geometry: [{ lat: 0, lon: 0 }] })).toBeNull();
    expect(elementToRing({ type: 'node', id: 4 })).toBeNull();
  });

  it('measures ring area roughly in square metres', () => {
    // A 100 m by 100 m square near Cape Town
    const dLat = 100 / 111_320;
    const dLng = 100 / (111_320 * Math.cos((-33.9 * Math.PI) / 180));
    const ring: [number, number][] = [[18.5, -33.9], [18.5 + dLng, -33.9], [18.5 + dLng, -33.9 + dLat], [18.5, -33.9 + dLat], [18.5, -33.9]];
    expect(ringAreaSquareMeters(ring)).toBeGreaterThan(9_500);
    expect(ringAreaSquareMeters(ring)).toBeLessThan(10_500);
  });

  it('prefers the named way, then the ring that contains the point, then the nearest', () => {
    const near = { type: 'way', id: 10, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 1, lon: 0 }] };
    const containing = { type: 'way', id: 11, geometry: [{ lat: 2, lon: 2 }, { lat: 2, lon: 4 }, { lat: 4, lon: 4 }, { lat: 4, lon: 2 }] };
    const point = { lat: 3, lng: 3 };
    expect(chooseOutline([near, containing], point)?.osmId).toBe('way/11');
    expect(chooseOutline([near, containing], point)?.containsPoint).toBe(true);
    expect(chooseOutline([near, containing], point, 'way/10')?.osmId).toBe('way/10');
    expect(chooseOutline([near], { lat: 10, lng: 10 })?.osmId).toBe('way/10');
    expect(chooseOutline([near], { lat: 10, lng: 10 })?.containsPoint).toBe(false);
    expect(chooseOutline([], point)).toBeNull();
  });
});

describe('matchExisting', () => {
  const existing = [
    { id: 'cem_athlone', google_place_id: null, origin_lat: -33.96813, origin_lng: 18.52682 },
    { id: 'cem_mowbray', google_place_id: 'ChIJmow', origin_lat: -33.93908, origin_lng: 18.46112 },
  ];

  it('matches by place id first, then by a point within 300 m', () => {
    expect(MATCH_RADIUS_METERS).toBe(300);
    expect(matchExisting(existing, { placeId: 'ChIJmow', lat: 0, lng: 0 })?.id).toBe('cem_mowbray');
    expect(matchExisting(existing, { lat: -33.9685, lng: 18.5270 })?.id).toBe('cem_athlone');
    expect(matchExisting(existing, { lat: -33.99, lng: 18.5270 })).toBeUndefined();
    expect(matchExisting(existing, {})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/burial_sites_tools.test.ts`
Expected: FAIL, cannot find module `score.mjs`.

- [ ] **Step 3: Write the three modules**

```js
// tools/burial-sites/lib/score.mjs
// Ranks Google Places candidates for one CSV row. No network.

const EARTH_RADIUS_M = 6_371_000;
// A row's own coordinates are trusted to a kilometre; a town centre only to thirty
export const ANCHOR_LIMITS = { row: 1000, town: 30_000 };
const FILLER = new Set(['muslim', 'cemetery', 'maqbara', 'road', 'street', 'the', 'of', 'and', 'in', 'municipal', 'public', 'old', 'new']);

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function nameTokens(name) {
  return name
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !FILLER.has(token));
}

// Score: up to 1 for closeness, up to 1 for shared name words, 0.5 for being a cemetery. Null when too far.
export function scoreCandidate({ csvName, anchor, anchorKind, candidate }) {
  const limit = ANCHOR_LIMITS[anchorKind];
  const distance = haversineMeters(anchor.lat, anchor.lng, candidate.location.latitude, candidate.location.longitude);
  if (distance > limit) return null;
  const wanted = nameTokens(csvName);
  const got = new Set(nameTokens(candidate.displayName || ''));
  const overlap = wanted.length ? wanted.filter((t) => got.has(t)).length / wanted.length : 0;
  const isCemetery = (candidate.types || []).includes('cemetery') ? 0.5 : 0;
  return 1 - distance / limit + overlap + isCemetery;
}

export function rankCandidates(row, anchor, anchorKind, candidates) {
  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate({ csvName: row.cemetery_name, anchor, anchorKind, candidate }),
      distanceMeters: haversineMeters(anchor.lat, anchor.lng, candidate.location.latitude, candidate.location.longitude),
    }))
    .filter((entry) => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
```

```js
// tools/burial-sites/lib/overpass.mjs
// Overpass queries and conversion of OSM elements into GeoJSON rings. No network.

export function aroundQuery(lat, lng, radiusMeters = 400) {
  const around = `(around:${radiusMeters},${lat},${lng})`;
  return `[out:json][timeout:25];
(
  way["landuse"="cemetery"]${around};
  way["amenity"="grave_yard"]${around};
  relation["landuse"="cemetery"]${around};
  relation["amenity"="grave_yard"]${around};
);
out geom;`;
}

export function wayQuery(osmId) {
  const id = osmId.replace(/^way\//, '');
  return `[out:json][timeout:25];
way(${id});
out geom;`;
}

function closeRing(points) {
  const ring = points.map((p) => [p.lon, p.lat]);
  const [first] = ring;
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return ring;
}

// Planar shoelace on a ring in degrees; the sign is dropped
function shoelace(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(sum) / 2;
}

export function elementToRing(element) {
  if (element.type === 'way') {
    if (!Array.isArray(element.geometry) || element.geometry.length < 3) return null;
    return closeRing(element.geometry);
  }
  if (element.type === 'relation') {
    const outers = (element.members || [])
      .filter((m) => m.role === 'outer' && Array.isArray(m.geometry) && m.geometry.length >= 3)
      .map((m) => closeRing(m.geometry));
    if (outers.length === 0) return null;
    // A cemetery relation with several outers is rare; the biggest one is the cemetery
    return outers.sort((a, b) => shoelace(b) - shoelace(a))[0];
  }
  return null;
}

// Equirectangular scaling at the ring's mean latitude is accurate enough to spot a wrong outline
export function ringAreaSquareMeters(ring) {
  const meanLat = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((meanLat * Math.PI) / 180);
  const projected = ring.map(([lng, lat]) => [lng * mPerDegLng, lat * mPerDegLat]);
  return shoelace(projected);
}

function ringContains(ring, lng, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function ringCentroidDistance(ring, lng, lat) {
  const cx = ring.reduce((s, [x]) => s + x, 0) / ring.length;
  const cy = ring.reduce((s, [, y]) => s + y, 0) / ring.length;
  return Math.hypot(cx - lng, cy - lat);
}

export function chooseOutline(elements, point, preferredOsmId) {
  const outlines = elements
    .map((element) => ({ osmId: `${element.type}/${element.id}`, ring: elementToRing(element) }))
    .filter((o) => o.ring)
    .map((o) => ({
      ...o,
      areaSquareMeters: Math.round(ringAreaSquareMeters(o.ring)),
      containsPoint: ringContains(o.ring, point.lng, point.lat),
    }));
  if (outlines.length === 0) return null;
  const preferred = preferredOsmId && outlines.find((o) => o.osmId === preferredOsmId);
  if (preferred) return preferred;
  const containing = outlines.find((o) => o.containsPoint);
  if (containing) return containing;
  return outlines.sort(
    (a, b) => ringCentroidDistance(a.ring, point.lng, point.lat) - ringCentroidDistance(b.ring, point.lng, point.lat)
  )[0];
}
```

```js
// tools/burial-sites/lib/match.mjs
import { haversineMeters } from './score.mjs';

// Two records of the same cemetery are never further apart than this
export const MATCH_RADIUS_METERS = 300;

export function matchExisting(existing, resolved) {
  if (resolved.placeId) {
    const byPlace = existing.find((row) => row.google_place_id && row.google_place_id === resolved.placeId);
    if (byPlace) return byPlace;
  }
  if (typeof resolved.lat !== 'number' || typeof resolved.lng !== 'number') return undefined;
  return existing.find(
    (row) => haversineMeters(resolved.lat, resolved.lng, Number(row.origin_lat), Number(row.origin_lng)) <= MATCH_RADIUS_METERS
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/burial_sites_tools.test.ts`
Expected: PASS, 23 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/burial-sites/lib/score.mjs tools/burial-sites/lib/overpass.mjs tools/burial-sites/lib/match.mjs tests/burial_sites_tools.test.ts
git commit -m "feat(import): rank Google candidates, read OSM outlines, match live cemetery rows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `resolve.mjs`: CSV to review file

**Files:**
- Create: `tools/burial-sites/resolve.mjs`
- Create: `tools/burial-sites/README.md`
- Generated: `data/burial-sites/review.json`, `data/burial-sites/report.md`, `data/burial-sites/cache/**` (ignored)

**Interfaces:**
- Consumes every export from Task 6 and Task 7.
- Produces `review.json` entries with this shape (later tasks depend on the names):

```json
{
  "key": "vygiekraal-johnson-road-muslim-cemetery",
  "status": "auto | needs_review | approved | skip",
  "existing_id": "cem_athlone",
  "id": "cem_athlone",
  "name": "Vygiekraal / Johnson Road Muslim Cemetery",
  "aliases": ["Google Display Name"],
  "site_type": "muslim_cemetery",
  "site_status": "unknown",
  "province": "Western Cape",
  "city": "Rylands",
  "address": "Johnson Road, Rylands, Cape Town",
  "point": { "lat": -33.968, "lng": 18.527 },
  "point_source": "csv | supplement | place_id | places | geocoded | none",
  "google_place_id": "ChIJ...",
  "google_candidates": [{ "placeId": "", "displayName": "", "formattedAddress": "", "lat": 0, "lng": 0, "score": 0, "distanceMeters": 0 }],
  "outline": { "osm_id": "way/1", "area_square_meters": 0, "contains_point": true, "ring": [[18.5, -33.9]] },
  "verification_status": "Verified",
  "verification_source": "MJC",
  "source_urls": ["https://..."],
  "overrides": {},
  "notes": []
}
```

- [ ] **Step 1: Write the script**

```js
// tools/burial-sites/resolve.mjs
// Step 1 of the burial-sites import: turn data/burial-sites/source.csv into a reviewable review.json.
// Google Places gives points and names, Overpass gives outlines. Every response is cached so re-runs are free.
// Usage: node tools/burial-sites/resolve.mjs [--only <key>] [--dry-run]

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadEnvLocal } from './lib/env.mjs';
import { parseCsv } from './lib/csv.mjs';
import { cemeteryIdFor, mergeSupplements, osmWayFromUrl, placeIdFromUrl, rowSourceUrls, siteStatusFor, siteTypeFor, slugify } from './lib/sources.mjs';
import { rankCandidates } from './lib/score.mjs';
import { aroundQuery, chooseOutline, wayQuery } from './lib/overpass.mjs';
import { matchExisting } from './lib/match.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'data/burial-sites');
const CACHE = path.join(DATA, 'cache');
const REVIEW = path.join(DATA, 'review.json');
const REPORT = path.join(DATA, 'report.md');
const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.viewport,places.types';
const PLACE_FIELDS = 'id,displayName,formattedAddress,location,viewport,types';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const dryRun = args.includes('--dry-run');

loadEnvLocal(path.join(ROOT, '.env.local'));
const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!GOOGLE_KEY) {
  console.error('GOOGLE_PLACES_API_KEY is not set in .env.local');
  process.exit(1);
}

mkdirSync(CACHE, { recursive: true });

// Every request is cached by a hash of its url and body, so the review file is regenerated without new calls
async function cachedJson(name, url, init) {
  const hash = createHash('sha1').update(url + (init?.body || '')).digest('hex').slice(0, 16);
  const file = path.join(CACHE, `${name}-${hash}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  if (dryRun) return null;
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} ${response.status}: ${text.slice(0, 300)}`);
  writeFileSync(file, text);
  return JSON.parse(text);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function placeDetails(placeId) {
  const data = await cachedJson('place', `https://places.googleapis.com/v1/places/${placeId}?fields=${PLACE_FIELDS}&regionCode=ZA`, {
    headers: { 'X-Goog-Api-Key': GOOGLE_KEY },
  });
  return data;
}

async function placesSearch(textQuery, anchor, includedType) {
  const body = {
    textQuery,
    regionCode: 'ZA',
    maxResultCount: 5,
    locationBias: { circle: { center: { latitude: anchor.lat, longitude: anchor.lng }, radius: 15_000 } },
  };
  if (includedType) body.includedType = includedType;
  const data = await cachedJson('search', 'https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': FIELD_MASK },
    body: JSON.stringify(body),
  });
  return data?.places || [];
}

async function geocode(address) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=za&key=${GOOGLE_KEY}`;
  const data = await cachedJson('geocode', url);
  const first = data?.results?.[0];
  if (!first) return null;
  return { lat: first.geometry.location.lat, lng: first.geometry.location.lng, formatted: first.formatted_address };
}

async function overpass(query) {
  const data = await cachedJson('overpass', 'https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  await sleep(1000);
  return data?.elements || [];
}

async function loadExisting() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  const supabase = createClient(url, key);
  const { data, error } = await supabase.from('cemeteries').select('id, name, google_place_id, origin_lat, origin_lng');
  if (error) throw new Error(`Could not read cemeteries: ${error.message}`);
  return data;
}

function candidateSummary(entry) {
  return {
    placeId: entry.candidate.id,
    displayName: entry.candidate.displayName?.text || '',
    formattedAddress: entry.candidate.formattedAddress || '',
    lat: entry.candidate.location.latitude,
    lng: entry.candidate.location.longitude,
    score: Math.round(entry.score * 100) / 100,
    distanceMeters: Math.round(entry.distanceMeters),
  };
}

async function resolveRow(row, existing, townCentres) {
  const key = slugify(row.cemetery_name);
  const notes = [];
  const entry = {
    key,
    status: 'needs_review',
    existing_id: null,
    id: cemeteryIdFor(row.cemetery_name),
    name: row.cemetery_name,
    aliases: [],
    site_type: siteTypeFor(row.qabrmap_category),
    site_status: siteStatusFor(row.site_status),
    province: row.province,
    city: row.city_or_area,
    address: row.location,
    point: null,
    point_source: 'none',
    google_place_id: null,
    google_candidates: [],
    outline: null,
    verification_status: row.verification_status,
    verification_source: row.verification_source,
    source_urls: rowSourceUrls(row),
    overrides: {},
    notes,
  };
  if (row.from_supplements) notes.push('From the earlier CSV, not the production file: accept or skip.');

  // 1. A point from the row itself, or the supplements
  if (row.latitude && row.longitude) {
    entry.point = { lat: Number(row.latitude), lng: Number(row.longitude) };
    entry.point_source = row.coordinate_source_url ? 'supplement' : 'csv';
  }

  // 2. A place id embedded in a source link goes straight to Place Details
  const embeddedPlaceId = entry.source_urls.map(placeIdFromUrl).find(Boolean);
  if (embeddedPlaceId) {
    const place = await placeDetails(embeddedPlaceId);
    if (place) {
      entry.google_place_id = place.id;
      entry.aliases.push(place.displayName?.text || '');
      entry.google_candidates = [candidateSummary({ candidate: place, score: 3, distanceMeters: 0 })];
      if (!entry.point) {
        entry.point = { lat: place.location.latitude, lng: place.location.longitude };
        entry.point_source = 'place_id';
      }
    }
  }

  // 3. Otherwise search Places around the row's point or the town centre
  if (!entry.google_place_id) {
    let anchor = entry.point;
    let anchorKind = 'row';
    if (!anchor) {
      const town = `${row.city_or_area}, ${row.province}, South Africa`;
      if (!townCentres.has(town)) townCentres.set(town, await geocode(town));
      anchor = townCentres.get(town);
      anchorKind = 'town';
    }
    if (anchor) {
      let places = await placesSearch(`${row.cemetery_name}, ${row.location}`, anchor, 'cemetery');
      if (places.length === 0) places = await placesSearch(`${row.cemetery_name}, ${row.location}`, anchor, null);
      const ranked = rankCandidates(row, anchor, anchorKind, places);
      entry.google_candidates = ranked.map(candidateSummary);
      if (ranked.length > 0) {
        entry.google_place_id = ranked[0].candidate.id;
        entry.aliases.push(ranked[0].candidate.displayName?.text || '');
        if (!entry.point) {
          entry.point = { lat: ranked[0].candidate.location.latitude, lng: ranked[0].candidate.location.longitude };
          entry.point_source = 'places';
        }
      } else {
        notes.push('No Google Places candidate within range.');
      }
    } else {
      notes.push('Town could not be geocoded, so Places was not searched.');
    }
  }

  // 4. Geocode the address as a last resort
  if (!entry.point) {
    const geocoded = await geocode(`${row.location}, South Africa`);
    if (geocoded) {
      entry.point = { lat: geocoded.lat, lng: geocoded.lng };
      entry.point_source = 'geocoded';
      notes.push(`Point is the geocoded address: ${geocoded.formatted}`);
    } else {
      notes.push('No point found: place it by hand in review.json.');
    }
  }

  // 5. Outline from OpenStreetMap
  if (entry.point) {
    const namedWay = entry.source_urls.map(osmWayFromUrl).find(Boolean);
    let elements = await overpass(aroundQuery(entry.point.lat, entry.point.lng, 400));
    if (namedWay && !elements.some((e) => `${e.type}/${e.id}` === namedWay)) {
      elements = elements.concat(await overpass(wayQuery(namedWay)));
    }
    const chosen = chooseOutline(elements, entry.point, namedWay || undefined);
    if (chosen) {
      entry.outline = { osm_id: chosen.osmId, area_square_meters: chosen.areaSquareMeters, contains_point: chosen.containsPoint, ring: chosen.ring };
      if (!chosen.containsPoint) notes.push('Nearest OSM outline does not contain the point: check it.');
      if (chosen.areaSquareMeters > 400_000) notes.push('Outline is over 40 ha; for a Muslim section this is the whole municipal cemetery.');
    } else {
      notes.push('No OSM outline within 400 m: draw one in data/burial-sites/outlines/<id>.geojson.');
    }
  }

  // 6. Existing row
  const match = matchExisting(existing, { placeId: entry.google_place_id, lat: entry.point?.lat, lng: entry.point?.lng });
  if (match) {
    entry.existing_id = match.id;
    entry.id = match.id;
    if (match.name && match.name !== entry.name) entry.aliases.push(match.name);
    notes.push(`Updates live row ${match.id} ("${match.name}").`);
  }

  entry.aliases = [...new Set(entry.aliases.filter((a) => a && a !== entry.name))];
  entry.status = !row.from_supplements && ['csv', 'supplement', 'place_id'].includes(entry.point_source) ? 'auto' : 'needs_review';
  return entry;
}

function writeReport(entries, existing) {
  const count = (fn) => entries.filter(fn).length;
  const lines = [
    '# Burial sites resolve report',
    '',
    `Generated ${new Date().toISOString()}`,
    '',
    `| Rows | ${entries.length} |`,
    '|---|---|',
    `| Point from CSV or supplement | ${count((e) => e.point_source === 'csv' || e.point_source === 'supplement')} |`,
    `| Point from a place id | ${count((e) => e.point_source === 'place_id')} |`,
    `| Point from Places search | ${count((e) => e.point_source === 'places')} |`,
    `| Point from geocoding | ${count((e) => e.point_source === 'geocoded')} |`,
    `| No point | ${count((e) => e.point_source === 'none')} |`,
    `| OSM outline found | ${count((e) => e.outline)} |`,
    `| Updates a live row | ${count((e) => e.existing_id)} |`,
    `| Needs review | ${count((e) => e.status === 'needs_review')} |`,
    '',
    '## Rows without a point',
    '',
    ...entries.filter((e) => e.point_source === 'none').map((e) => `- ${e.name} (${e.city})`),
    '',
    '## Rows without an outline',
    '',
    ...entries.filter((e) => e.point && !e.outline).map((e) => `- ${e.id}: ${e.name}`),
    '',
    '## Live rows not in the source data',
    '',
    ...existing.filter((row) => !entries.some((e) => e.existing_id === row.id)).map((row) => `- ${row.id}: ${row.name} (verify it is a real site)`),
    '',
  ];
  writeFileSync(REPORT, lines.join('\n'));
}

async function main() {
  const rows = mergeSupplements(
    parseCsv(readFileSync(path.join(DATA, 'source.csv'), 'utf8')),
    JSON.parse(readFileSync(path.join(DATA, 'supplements.json'), 'utf8'))
  );
  const existing = await loadExisting();
  const previous = existsSync(REVIEW) ? JSON.parse(readFileSync(REVIEW, 'utf8')) : [];
  const decided = new Map(previous.filter((e) => e.status === 'approved' || e.status === 'skip').map((e) => [e.key, e]));
  const townCentres = new Map();
  const entries = [];
  for (const row of rows) {
    const key = slugify(row.cemetery_name);
    if (only && key !== only) {
      const kept = previous.find((e) => e.key === key);
      if (kept) entries.push(kept);
      continue;
    }
    // Reviewed decisions are never regenerated
    if (decided.has(key)) {
      entries.push(decided.get(key));
      continue;
    }
    console.log(`Resolving ${row.cemetery_name}`);
    try {
      entries.push(await resolveRow(row, existing, townCentres));
    } catch (error) {
      console.error(`  failed: ${error.message}`);
      entries.push({ key, status: 'needs_review', id: cemeteryIdFor(row.cemetery_name), name: row.cemetery_name, point: null, point_source: 'none', outline: null, notes: [`Failed: ${error.message}`] });
    }
  }
  if (dryRun) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  writeFileSync(REVIEW, JSON.stringify(entries, null, 2) + '\n');
  writeReport(entries, existing);
  console.log(`Wrote ${entries.length} entries to ${REVIEW} and a summary to ${REPORT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Write the README**

```markdown
# Burial sites import

Three steps turn `data/burial-sites/source.csv` into rows in the `cemeteries` table.

1. `node tools/burial-sites/resolve.mjs` reads the CSV and `supplements.json`, asks Google Places for points and names and Overpass for outlines, and writes `review.json` plus `report.md`. Responses are cached under `data/burial-sites/cache/` (ignored by git). Add `--only <key>` to redo one row, `--dry-run` to print without writing.
2. Edit `review.json`: check `name`, pick a Google candidate by copying its `placeId` into `google_place_id` (or set it to null), delete `outline` to reject it, add column values under `overrides`, then set `status` to `approved` or `skip`. Rows already `approved` or `skip` are never regenerated.
3. `node tools/burial-sites/upsert.mjs --dry-run` prints what would change; `node tools/burial-sites/upsert.mjs` writes approved rows. A file at `data/burial-sites/outlines/<id>.geojson` (a Polygon or a Feature holding one) replaces any OSM outline for that id.

Keys in `.env.local`: `GOOGLE_PLACES_API_KEY` (Places API (New) and Geocoding API), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

The migration `supabase/migrations/20260916000000_burial_sites.sql` must be applied before the upsert.
```

- [ ] **Step 3: Dry run without a key to check the script loads**

Run: `node tools/burial-sites/resolve.mjs --dry-run`
Expected: exits with `GOOGLE_PLACES_API_KEY is not set in .env.local` if the owner has not added the key yet. If the key is present, expected output is the JSON entries printed to the console with no files written (cache misses return null in dry run, so most entries show `point_source: "none"`; that is fine for a load check).

- [ ] **Step 4: Owner adds the key, then run for real**

The owner creates a Google Cloud API key with Places API (New) and Geocoding API enabled, restricted to those two APIs, and adds `GOOGLE_PLACES_API_KEY=<key>` to `.env.local`.

Run: `node tools/burial-sites/resolve.mjs`
Expected: one "Resolving ..." line per row (56: 47 CSV rows plus 9 supplements), then `Wrote 56 entries to ... review.json`. Open `report.md` and confirm the counts look like: at least 16 points from CSV or supplement, 5 from a place id, 3 live rows updated (`cem_athlone`, `cem_mowbray`, `cem_wynberg`), and `cem_mountview` listed under "Live rows not in the source data".

- [ ] **Step 5: Commit the script, README, and the generated files**

```bash
git add tools/burial-sites/resolve.mjs tools/burial-sites/README.md data/burial-sites/review.json data/burial-sites/report.md
git commit -m "feat(import): resolve burial sites to points, names and OSM outlines for review

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Review checkpoint (owner)

**Files:**
- Modify: `data/burial-sites/review.json`

This task is done by the owner, with the implementer's help on request. Nothing is automated.

- [ ] **Step 1: Apply the decided edits from the spec**

- Entry `key: "vygiekraal-johnson-road-muslim-cemetery"` (`existing_id: cem_athlone`): confirm `name` is `Vygiekraal / Johnson Road Muslim Cemetery`; set `aliases` to include `Athlone Muslim Cemetery`, `Vygiekraal Cemetery`, `Johnson Road Maqbara` and the Google name; set `"overrides": { "entrance_name": "Johnson Road Gate" }`.
- Entry for Mowbray (`existing_id: cem_mowbray`): `aliases` include `Mowbray Muslim Cemetery`, `Gamedia Maqbara`.
- Entry for Brodie Road (`existing_id: cem_wynberg`): `site_status` is `closed`, `site_type` is `historic_cemetery`, `aliases` include `Wynberg Muslim Cemetery`, `"overrides": { "total_graves_estimate": 0 }`.
- Entry for Lenasia: set `name` to `Lenasia Cemetery`, add `Avalon` and `Lenasia Cemetery / Avalon` to `aliases`.

- [ ] **Step 2: Decide every other row**

For each entry: read `notes`, check `google_candidates` against the CSV address, keep or delete `outline`, then set `status` to `approved` or `skip`. Rows with `point_source: "none"` either get a hand-placed `point` (from Google Maps, right-click, copy coordinates) or `skip`.

- [ ] **Step 3: Verify the file still parses and no entry is undecided**

Run: `node -e "const r=require('./data/burial-sites/review.json');const u=r.filter(e=>!['approved','skip'].includes(e.status));console.log('undecided',u.map(e=>e.key));if(u.length)process.exit(1)"`
Expected: `undecided []`.

- [ ] **Step 4: Commit**

```bash
git add data/burial-sites/review.json
git commit -m "data(cemeteries): review decisions for the burial-sites import

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `upsert.mjs`: review file to Supabase

**Files:**
- Create: `tools/burial-sites/upsert.mjs`
- Modify: `data/burial-sites/report.md` (appended by the script)

**Interfaces:**
- Consumes `review.json` entries from Task 8 and the column names from Task 1.
- Reads `data/burial-sites/outlines/<id>.geojson` when present.

- [ ] **Step 1: Write the script**

```js
// tools/burial-sites/upsert.mjs
// Step 3 of the burial-sites import: write approved review.json entries to the cemeteries table.
// Usage: node tools/burial-sites/upsert.mjs [--dry-run]

import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadEnvLocal } from './lib/env.mjs';
import { slugify } from './lib/sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'data/burial-sites');
const dryRun = process.argv.includes('--dry-run');

loadEnvLocal(path.join(ROOT, '.env.local'));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

// A hand-drawn outline wins over OSM. The file holds a Polygon, or a Feature or FeatureCollection with one.
function manualOutline(id) {
  const file = path.join(DATA, 'outlines', `${id}.geojson`);
  if (!existsSync(file)) return null;
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const geometry = json.type === 'FeatureCollection' ? json.features[0]?.geometry : json.type === 'Feature' ? json.geometry : json;
  if (!geometry || geometry.type !== 'Polygon') throw new Error(`${file} must hold one Polygon`);
  return geometry;
}

function payloadFor(entry, isNew) {
  if (!entry.point) throw new Error(`${entry.key} is approved but has no point`);
  const manual = manualOutline(entry.id);
  const payload = {
    id: entry.id,
    name: entry.name,
    province: entry.province,
    city: entry.city,
    address: entry.address || null,
    origin_lat: entry.point.lat,
    origin_lng: entry.point.lng,
    site_type: entry.site_type,
    site_status: entry.site_status,
    aliases: entry.aliases || [],
    google_place_id: entry.google_place_id || null,
    verification_status: entry.verification_status || null,
    verification_source: entry.verification_source || null,
    source_urls: entry.source_urls || [],
    updated_at: new Date().toISOString(),
    ...(entry.overrides || {}),
  };
  if (manual) {
    payload.boundary = manual;
    payload.boundary_source = 'manual';
    payload.osm_id = null;
  } else if (entry.outline) {
    payload.boundary = { type: 'Polygon', coordinates: [entry.outline.ring] };
    payload.boundary_source = 'osm';
    payload.osm_id = entry.outline.osm_id;
  }
  // New rows need the columns the table requires; existing rows keep their slug, description and counts
  if (isNew) {
    payload.slug = slugify(entry.name);
    payload.description = '';
    payload.country = 'South Africa';
    payload.denomination = 'Muslim';
  }
  return payload;
}

async function main() {
  const entries = JSON.parse(readFileSync(path.join(DATA, 'review.json'), 'utf8'));
  const approved = entries.filter((e) => e.status === 'approved');
  const { data: existingRows, error } = await supabase.from('cemeteries').select('id, name, boundary_source');
  if (error) throw new Error(`Could not read cemeteries: ${error.message}`);
  const existingIds = new Set(existingRows.map((r) => r.id));

  const summary = [];
  for (const entry of approved) {
    const isNew = !existingIds.has(entry.id);
    const payload = payloadFor(entry, isNew);
    const action = isNew ? 'insert' : 'update';
    const outline = payload.boundary_source || 'none';
    summary.push({ id: entry.id, name: entry.name, action, outline });
    if (dryRun) {
      console.log(`${action} ${entry.id}: ${entry.name} (outline: ${outline})`);
      continue;
    }
    // One row per call: PostgREST needs every object in a batch to carry the same keys, and these differ
    const { error: upsertError } = await supabase.from('cemeteries').upsert(payload, { onConflict: 'id' });
    if (upsertError) {
      console.error(`Failed on ${entry.id}: ${upsertError.message}`);
      console.error(JSON.stringify(payload, null, 2));
      process.exit(1);
    }
    console.log(`${action} ${entry.id}: ${entry.name}`);
  }

  if (dryRun) {
    console.log(`Dry run: ${summary.length} rows would be written.`);
    return;
  }
  const lines = [
    '',
    `## Upsert ${new Date().toISOString()}`,
    '',
    `| Id | Name | Action | Outline |`,
    '|---|---|---|---|',
    ...summary.map((s) => `| ${s.id} | ${s.name} | ${s.action} | ${s.outline} |`),
    '',
    '### Outlines still to draw',
    '',
    ...summary.filter((s) => s.outline === 'none').map((s) => `- ${s.id}: ${s.name}`),
    '',
  ];
  appendFileSync(path.join(DATA, 'report.md'), lines.join('\n'));
  console.log(`Wrote ${summary.length} rows and appended the summary to report.md`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Owner applies the migration**

The owner runs `supabase/migrations/20260916000000_burial_sites.sql` in the Supabase SQL Editor. Check it took: in the SQL Editor run `select site_type, site_status, aliases from public.cemeteries limit 1;` and expect four columns without an error.

- [ ] **Step 3: Dry run**

Run: `node tools/burial-sites/upsert.mjs --dry-run`
Expected: one line per approved entry, `update` for `cem_athlone`, `cem_mowbray`, `cem_wynberg` and `insert` for the rest, ending with `Dry run: N rows would be written.` Nothing in the database changes.

- [ ] **Step 4: Real run**

Run: `node tools/burial-sites/upsert.mjs`
Expected: the same lines, then `Wrote N rows and appended the summary to report.md`. Then in the SQL Editor:

```sql
select count(*) filter (where boundary is not null) as with_outline, count(*) as total from public.cemeteries;
select id, name, site_status, total_graves_estimate from public.cemeteries where id in ('cem_athlone', 'cem_wynberg');
```

Expected: `total` equals 4 minus the live rows updated plus N; `cem_wynberg` shows `closed` and `0`; `cem_athlone` shows the Vygiekraal name.

- [ ] **Step 5: Check the app against the live data**

Run `npm run dev`, open Explore cemeteries, allow location. Expected: the Nearby chip shows five sites closest first; searching "athlone" finds the Vygiekraal row; the Brodie Road card shows the Historic and Closed tags; opening a Gauteng site with an OSM outline draws the boundary on the map.

- [ ] **Step 6: Commit**

```bash
git add tools/burial-sites/upsert.mjs data/burial-sites/report.md
git commit -m "feat(import): upsert approved burial sites into Supabase with OSM or hand-drawn outlines

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: OpenStreetMap credit on the map

**Files:**
- Modify: `src/components/screens/CemeteryMapScreen.tsx:530-533`

**Interfaces:**
- Consumes `cemetery.boundarySource` from Task 2.

- [ ] **Step 1: Add the credit next to the Google attribution**

Replace the attribution block with:

```tsx
        {/* Google Maps logo and imagery copyright, required by the Map Tiles API terms; OSM credit when the outline is theirs */}
        <div className="absolute bottom-14 left-3.5 z-10 pointer-events-none flex flex-col items-start gap-1">
          <GoogleMapsAttribution map={mapInstanceRef.current} mapType={mapType} isMapReady={isMapReady} />
          {cemetery.boundary && cemetery.boundarySource === 'osm' && (
            <span className="px-1.5 py-px rounded bg-black/45 text-[9px] leading-tight text-white/90 font-medium">
              Boundary © OpenStreetMap contributors
            </span>
          )}
        </div>
```

- [ ] **Step 2: Type check and look at it**

Run: `npx tsc --noEmit`
Expected: clean.

Run `npm run dev`, open a cemetery whose outline came from OSM (any Gauteng row after Task 10, or Mowbray if its review entry kept the OSM outline). Expected: the credit line sits under the Google logo. Open Mountview (no `boundary_source`): no credit line.

- [ ] **Step 3: Commit**

```bash
git add src/components/screens/CemeteryMapScreen.tsx
git commit -m "feat(map): credit OpenStreetMap when the cemetery outline came from it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Release

**Files:** none new.

- [ ] **Step 1: Full verification**

Run: `npx vitest run`
Expected: all pass (baseline 384 plus the new tests: 4 migration, 2 mapper, 10 nearby, 5 location, 23 tools).

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run build`
Expected: builds without errors.

- [ ] **Step 2: Confirm the migration is live before deploying**

The app tolerates the old schema, but the imported rows only exist after Task 10, which needs the migration. Confirm with the owner that Task 10 Step 2 was done.

- [ ] **Step 3: Deploy from a clean worktree**

Per the project memory, production deploys with the Vercel CLI from committed code:

```bash
git worktree add ../qabrmap-release main
cd ../qabrmap-release
npm ci
vercel --prod
cd -
git worktree remove ../qabrmap-release
```

Expected: a production URL, and https://qabrmap.vercel.app shows the new Explore screen on a phone.

- [ ] **Step 4: Reminder for the owner (not a code task)**

`scripts/seed_all_to_supabase.mjs` is tracked in git with a service-role key in it. Rotate that key in the Supabase dashboard (Project Settings, API) and update `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` and Vercel. Optionally `git rm` the three files under `scripts/` in a separate commit.

---

## Self-review notes

- Spec section 4 columns: all ten are in Task 1 and mapped in Task 2. `source_urls` is written by Task 10.
- Spec section 5 names: Task 2 (mock data), Task 9 (review edits), Task 10 (database).
- Spec section 6.1 steps 1 to 9: Task 8 `resolveRow` follows the same order; supplements in Task 6; place id, search, geocode, Overpass, match in Tasks 7 and 8.
- Spec section 6.3 overrides and manual outlines: Task 10.
- Spec section 8: Tasks 3, 4, 5. `sortCemeteries` returns no distances without a position, matching 8.3.
- Spec section 3 OSM attribution: Task 11.
- Spec section 12 decision 5 (key rotation): Task 12 Step 4.
- Names used across tasks were checked: `distanceMeters`, `siteType`, `siteStatus`, `aliases`, `boundarySource`, `nearestCemeteries`, `sortCemeteries`, `matchesCemeterySearch`, `formatDistance`, `cemeteryTags`, `locateUser`, `useUserLocation`, `parseCsv`, `mergeSupplements`, `rankCandidates`, `chooseOutline`, `matchExisting`.
