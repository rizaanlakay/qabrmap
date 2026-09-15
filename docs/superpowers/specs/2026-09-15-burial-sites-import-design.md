# Burial Sites Import, Boundaries, Naming and Nearby List: Design

**Status:** Approved for planning on 2026-09-15 (owner said "Go" after the data review)
**Date:** 2026-09-15
**Input data:** `data/burial-sites/source.csv` (production CSV v1.1: 47 rows, 16 with coordinates, 5 with a Google place ID inside a Waze link) plus `data/burial-sites/supplements.json` (one coordinate and nine sites kept from the earlier, wider CSV for the reviewer to accept or drop)

## 1. Goal

Get every burial site in the CSV into the `cemeteries` table with a reliable point, the best available outline, the name the community uses and the site's status, then make the Explore Cemeteries screen show the five nearest sites, closest first, with a distance on every card.

## 2. What exists today

- `cemeteries` table (migration `001_initial_schema.sql`, text ids such as `cem_athlone`, `boundary` as a GeoJSON polygon in JSONB). Four rows live: Athlone, Mowbray, Mountview, Wynberg. Graves reference these ids, so they must not be replaced.
- The four live outlines were traced from OpenStreetMap (the CSV cites OSM way ids for eight sites). Nothing in the app draws or edits boundaries.
- `CemeterySelectScreen` has a Nearby chip that filters nothing and sorts nothing. It shows `distanceKm` only when set, and only the mock data sets it. Rows loaded from Supabase never show a distance.
- `userLocation` in `page.tsx` is hard-coded to a point near Athlone. Only the capture, survey and navigation screens ask the browser for a real position.
- `calculateDistanceMeters` (haversine) and `isPointInPolygon` already exist in `src/lib/geospatial`.
- Google is used for map tiles through `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (a browser key). No server-side Google key exists.
- `scripts/seed_all_to_supabase.mjs` has a Supabase service-role key committed in plain text. The new scripts read keys from the environment only. Rotating that key is the owner's action in the Supabase dashboard; the plan reminds them.

## 3. What Google can and cannot do

Places API (New) Text Search (`POST https://places.googleapis.com/v1/places:searchText`) returns, per field mask: `places.id`, `places.displayName`, `places.formattedAddress`, `places.location`, `places.viewport`, `places.types`. It accepts `regionCode: "ZA"`, `includedType: "cemetery"` and a `locationBias` circle. Place Details (`GET https://places.googleapis.com/v1/places/{id}`) returns the same fields for a known place ID.

- It **does** give a stable `place_id`, Google's display name, a formatted address and a centre point. That solves the missing coordinates.
- It **does not** give an outline. `viewport` is a bounding rectangle sized for a map view, usually much larger than the site. Google has no polygon product for cemeteries.
- Geocoding API is a fallback for rows Places cannot match by name (it geocodes the street address).

Outlines therefore come from OpenStreetMap through the Overpass API (`landuse=cemetery` and `amenity=grave_yard` ways and relations within a few hundred metres of the point). Where OSM has no outline, the boundary stays empty and is drawn by hand later. A Google viewport is never stored as a boundary, because `findCemeteryForLocation` would then assign captures to the wrong site.

OSM data is ODbL. Storing OSM-derived outlines is fine with attribution: the map screen must credit "© OpenStreetMap contributors" wherever an outline is drawn, next to the existing Google attribution.

## 4. Data model changes

One migration, `supabase/migrations/20260916000000_burial_sites.sql`, run by hand in the Supabase SQL Editor (as all migrations are). All columns are additive; nothing existing changes type.

| Column | Type | Purpose |
|---|---|---|
| `site_type` | `TEXT NOT NULL DEFAULT 'muslim_cemetery'` with a CHECK | `muslim_cemetery`, `muslim_section`, `shared_cemetery`, `historic_cemetery`. Drives the card tag. |
| `site_status` | `TEXT NOT NULL DEFAULT 'active'` with a CHECK | `active`, `closed`, `unknown`. Closed sites get a "Closed" tag; nothing else changes yet. |
| `aliases` | `TEXT[] NOT NULL DEFAULT '{}'` | Other names people search for: the Google name, the old app name, the CSV name when it differs from the display name. Search matches these too. |
| `address` | `TEXT` | Street address for the card and directions. |
| `google_place_id` | `TEXT UNIQUE` | Stable link back to Google; lets a re-run update rather than duplicate. |
| `boundary_source` | `TEXT` | `osm`, `manual` or `NULL`. Tells the UI and the capture flow how much to trust the outline. |
| `osm_id` | `TEXT` | The OSM way or relation the outline came from, for attribution and refresh. |
| `verification_status`, `verification_source`, `source_urls` | `TEXT`, `TEXT`, `TEXT[]` | From the CSV, so the admin screen can show where a row came from. |

Category mapping from the CSV's seven values:

| CSV `qabrmap_category` | `site_type` |
|---|---|
| Dedicated Muslim cemetery | `muslim_cemetery` |
| Historic Muslim cemetery | `historic_cemetery` |
| Muslim section in municipal cemetery, Mixed cemetery with Muslim section, Mixed cemetery with Muslim graves/section, Mixed cemetery with Muslim blocks, Muslim burials / community cemetery | `muslim_section` |
| Shared Muslim/Hindu cemetery (supplements only) | `shared_cemetery` |

Status mapping from `site_status`: `active` stays `active`; `historic_or_closed` becomes `closed`; `active_or_burial_site` and `historic_or_active` become `unknown`.

`origin_lat` and `origin_lng` stay `NOT NULL`. A row that cannot be located by CSV coordinates, a place ID, Places search or Geocoding is not inserted; it is listed in the import report for manual placement.

`Cemetery` in `src/types/index.ts`, `mapDbCemetery` and the Dexie table pick up the new fields. `distanceKm` on the type is replaced by `distanceMeters?: number`, computed on the client and never stored.

Ids: existing rows keep their ids. New rows get `cem_<slug>` where the slug is derived from the display name and town.

## 5. Naming rule

`name` is the community name: the name the Muslim Judicial Council or the local community uses, taken from the CSV and edited during review. Everything else goes into `aliases`.

Decided names for the live rows (the MJC directory was checked on 2026-09-15 and spells the road "Johnson"):

| Live id | New `name` | `aliases` |
|---|---|---|
| `cem_athlone` | Vygiekraal / Johnson Road Muslim Cemetery | Athlone Muslim Cemetery, Vygiekraal Cemetery, Johnson Road Maqbara, plus Google's display name |
| `cem_mowbray` | Mowbray Muslim Cemetery / Gamedia Maqbara | Mowbray Muslim Cemetery, Gamedia Maqbara, plus Google's display name |
| `cem_wynberg` | Brodie Road Muslim Cemetery | Wynberg Muslim Cemetery, plus Google's display name. `site_status = 'closed'`, `site_type = 'historic_cemetery'`. Its seeded `total_graves_estimate` is cleared to 0 so the coverage line disappears. |
| `cem_mountview` | unchanged | Not in the CSV and not on the MJC page. Flagged in the report for the owner to verify. |

"Lenasia Cemetery / Avalon" is stored as `name = 'Lenasia Cemetery'` with `Avalon` in aliases, because Avalon is a separate Johannesburg cemetery. The seed's entrance name "Johnstone Road Gate" becomes "Johnson Road Gate".

Search in the Explore screen matches `name`, `aliases`, `city` and `province`. The card shows `name` only.

## 6. Import pipeline (three steps, two scripts, one human review)

All scripts live in `scripts/burial-sites/` as plain Node ES modules with no new dependencies. The logic that does not touch the network lives in `scripts/burial-sites/lib/*.mjs` so Vitest can test it. Keys come from `.env.local`: a new server-side `GOOGLE_PLACES_API_KEY` (Places API (New) and Geocoding API enabled, restricted by API not by referrer) and `SUPABASE_SERVICE_ROLE_KEY`. Nothing is hard-coded.

### 6.1 Resolve: `resolve.mjs` (CSV in, review JSON out)

For each CSV row (and each `extra_sites` entry from the supplements file):

1. **Fill from supplements.** If the row has no coordinates and `supplements.coordinates` has a matching `cemetery_name`, use those.
2. **Embedded place ID.** If a source URL contains `place.ChIJ...`, call Place Details for that ID and skip the search. Five rows take this path.
3. **Anchor point.** If the row has coordinates, use them as the anchor. Otherwise geocode `city_or_area + ", " + province + ", South Africa"` once (cached per town) to get a town centre for the location bias.
4. **Places Text Search.** Query `"<cemetery_name>, <location>"` with `regionCode: "ZA"`, `includedType: "cemetery"` (dropped for a second attempt when the first returns nothing), `locationBias` circle of 15 km around the anchor, `maxResultCount: 5`.
5. **Score candidates.** Distance from the anchor (row coordinates: reject beyond 1 km; town centre: reject beyond 30 km), name token overlap with the CSV name, and whether `types` contains `cemetery`. Keep the top three with scores so the reviewer sees the alternatives.
6. **Geocoding fallback.** If no candidate survives, geocode `location` and record it as a `geocoded` point with lower confidence.
7. **Overpass outline.** Around the chosen point, fetch `landuse=cemetery` and `amenity=grave_yard` ways and multipolygon relations within 400 m (`out geom`). If a source URL names an OSM way (`mapcarta.com/W<id>`), prefer that way. Otherwise prefer the one containing the point, else the nearest. Convert to a closed GeoJSON polygon ring `[lng, lat]`. Record the OSM id and the polygon area so an implausibly large outline is visible.
8. **Existing-row match.** Compare against the live `cemeteries` table by `google_place_id`, then by point within 300 m of an existing origin. Matches are reported as updates of that id (`cem_athlone`, `cem_mowbray`, `cem_wynberg` are expected).
9. Write `data/burial-sites/review.json`: one entry per row with the proposed `name`, `aliases`, `site_type`, `site_status`, point, `point_source` (`csv`, `supplement`, `place_id`, `places`, `geocoded`, `none`), Google candidates, outline candidates, existing-id match, and a `status` of `auto` or `needs_review`. Supplement sites always start as `needs_review`. Also write `report.md` with counts and the rows that could not be located.

The script is idempotent and caches every API response under `data/burial-sites/cache/` (gitignored) keyed by request, so re-runs cost nothing and the review JSON is regenerated deterministically. It never overwrites a `review.json` entry whose status is `approved` or `skip`. It supports `--only <slug>` and `--dry-run`.

Expected cost: about 60 Places calls and at most 60 Geocoding calls, well inside the monthly free allowance. Overpass is free; the script waits one second between calls.

### 6.2 Review (human, in the JSON file)

The reviewer opens `review.json` and, per row: confirms or edits `name`, picks the Google candidate (or none), accepts or rejects the outline, and sets `status: "approved"` or `"skip"`. Rows the script flags:

- Mixed municipal cemeteries (Westpark, Maitland, Delft, Lenasia ...) get the whole cemetery outline from OSM. The Muslim section is not distinguishable in OSM; the outline is kept and `site_type = 'muslim_section'` makes the card say "Muslim section".
- Rows with no usable address (Durban General Public Cemetery, Mthatha, Mbombela with coordinates only, Mountain Rise "Northdale") may need a hand-placed point.
- The nine supplement sites: accept or skip each.
- Mountview: the report lists it as "live row not in the source data" for the owner to verify.

The review file is committed so the decisions are recorded and a re-run does not undo them.

### 6.3 Upsert: `upsert.mjs` (review JSON in, database out)

Reads approved rows and upserts into `cemeteries` with the service-role key, keyed on the existing id when matched, otherwise on the generated id. Only the columns in section 4 plus `name`, `slug`, `city`, `province`, `address`, `origin_lat`, `origin_lng`, `entrance_name`, `boundary` are written. Existing rows keep `description`, contact fields, entrance coordinates and grave counts unless the review entry sets them. `--dry-run` prints the per-row diff and writes nothing. Mountview stays as it is.

It also reads `data/burial-sites/outlines/<id>.geojson` and, when present, stores that polygon with `boundary_source = 'manual'`, overriding any OSM outline.

After the upsert, `report.md` lists every site with its `boundary_source` so the outlines still to draw are visible in one place.

## 7. Hand-drawn outlines (for sites OSM does not have)

Out of scope for the scripts beyond reading the folder. The intended path: draw the polygon in geojson.io over satellite imagery, save the GeoJSON into `data/burial-sites/outlines/<id>.geojson`, and re-run `upsert.mjs`. An in-app admin drawing tool is a later feature if the manual path proves too slow.

## 8. Explore Cemeteries: Nearby and distance

### 8.1 Real location

New hook `src/lib/device/useUserLocation.ts`: asks once with `getCurrentPosition` (high accuracy, 10 s timeout, 60 s maximum age) and exposes `{ status: 'idle' | 'locating' | 'ready' | 'denied' | 'unavailable', position?: { lat, lng, accuracy }, retry }`. `page.tsx` calls it when the Explore screen opens and passes the result to `CemeterySelectScreen`. The hard-coded Athlone default in `page.tsx` stays only as the initial value for the navigation and AR screens, which already ask for a position themselves; it is never used to compute distances.

### 8.2 Pure list logic: `src/lib/cemeteries/nearby.ts`

- `withDistances(cemeteries, position)`: returns copies with `distanceMeters` from the haversine helper.
- `nearestCemeteries(cemeteries, position, limit = 5)`: sorted ascending, first five.
- `formatDistance(meters)`: under 1 km shows whole metres (`850 m`), 1 to 10 km one decimal (`2.4 km`), over 10 km whole km (`38 km`).
- `matchesCemeterySearch(cemetery, query)`: name, aliases, city, province.
- `sortCemeteries(cemeteries, position?)`: by distance when a position is known, otherwise by name.

Unit tests cover ordering, the five limit with fewer than five sites, formatting bands, alias search and the sort fallback.

### 8.3 Screen behaviour

- **Nearby chip:** shows the five nearest, closest first. While `locating`, a small inline state ("Finding your location..."). When `denied` or `unavailable`, a message with a Retry button and a link to the All chip; no list, because a nearby list without a location would be wrong.
- **All and My cemeteries chips:** every card shows its distance when a position is known, and the list is sorted by distance; without a position the list is sorted by name and no distance is shown.
- **Recent chip:** unchanged (it currently shows everything; that is a separate feature).
- **Card:** the distance replaces the `distanceKm` slot. A small tag shows "Muslim section", "Historic" or "Closed" where relevant; dedicated active cemeteries show no tag.
- The `cem.distanceKm &&` truthiness check goes; `distanceMeters` is checked against `undefined` so a site 0 m away still shows.

## 9. Error handling

- Scripts: any HTTP error is recorded on the row and the run continues; the row ends in `needs_review`. The upsert stops on the first database error and prints the row.
- App: cemeteries with no boundary are already skipped by `findCemeteryForLocation`; the map screen draws no outline for them. Location errors never block the other chips.

## 10. Testing

- `tests/burial_sites_migration.test.ts`: the migration text adds each column and the CHECKs, following the existing migration-text tests.
- `tests/burial_sites_resolve.test.ts`: CSV parsing (quoted commas, curly apostrophes), place-ID extraction from URLs, OSM way extraction from Mapcarta URLs, category and status mapping, candidate scoring, Overpass-to-GeoJSON conversion with ring closure, existing-row matching, supplement merging. API calls are injected so the tests run offline.
- `tests/cemetery_nearby.test.ts`: section 8.2.
- `tests/use_user_location.test.ts`: the status machine with a stubbed `navigator.geolocation`.
- Manual: run `resolve.mjs` against the CSV, review, `upsert.mjs --dry-run`, then the real upsert; open the app on a phone, allow location, check the Nearby chip shows five sites closest first with distances; deny location and check the message.

## 11. Delivery order

1. Migration plus type and mapper changes (no behaviour change yet).
2. Nearby list and distances (independent of the import; can ship first with the four live sites).
3. `resolve.mjs` and tests, run it, review the JSON.
4. `upsert.mjs`, dry run, real run against production.
5. OSM attribution on the map screen.
6. Hand-drawn outlines for the remaining sites (ongoing).

Each step is its own commit. Production deploys with `vercel --prod` from a clean worktree after the migration has been run in the SQL Editor.

## 12. Decisions taken (previously open questions)

1. **Kramats:** out. The production CSV dropped them; nothing in this design imports a kramat.
2. **Athlone display name:** "Vygiekraal / Johnson Road Muslim Cemetery", per the MJC directory.
3. **Mixed municipal cemeteries:** keep the whole OSM outline, tagged "Muslim section".
4. **All chip:** sorted by distance when a location is known, otherwise by name.
5. **Service-role key in the old seed script:** the new scripts use the environment. Rotating the key and removing the old script is the owner's call and is listed in the plan as a reminder, not a task.
