# Burial sites import

Three steps turn `data/burial-sites/source.csv` into rows in the `cemeteries` table.

1. `node tools/burial-sites/resolve.mjs` reads the CSV and `supplements.json`, asks Google Places for points and names and Overpass for outlines, and writes `review.json` plus `report.md`. Responses are cached under `data/burial-sites/cache/` (ignored by git). Add `--only <key>` to redo one row, `--dry-run` to print without writing.
2. Edit `review.json`: check `name`, pick a Google candidate by copying its `placeId` into `google_place_id` (or set it to null), delete `outline` to reject it, add column values under `overrides`, then set `status` to `approved` or `skip`. Rows already `approved` or `skip` are never regenerated.
3. `node tools/burial-sites/upsert.mjs --dry-run` prints what would change; `node tools/burial-sites/upsert.mjs` writes approved rows. A file at `data/burial-sites/outlines/<id>.geojson` (a Polygon or a Feature holding one) replaces any OSM outline for that id.

Keys in `.env.local`: `GOOGLE_PLACES_API_KEY` (Places API (New) and Geocoding API), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

The migration `supabase/migrations/20260916000000_burial_sites.sql` must be applied before the upsert.
