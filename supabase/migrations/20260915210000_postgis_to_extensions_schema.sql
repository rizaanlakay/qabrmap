-- ============================================================
-- QabrMap: move PostGIS out of the public schema
-- Run in Supabase Dashboard > SQL Editor > New query. Safe to run more than once.
-- ============================================================

-- 001_initial_schema.sql created PostGIS without a schema, so it landed in
-- public along with its own table, spatial_ref_sys. That table has no
-- row-level security and Supabase's advisor flags it as "Table publicly
-- accessible" (rls_disabled_in_public). It cannot be fixed with
-- "alter table ... enable row level security" because the extension owns it.
--
-- Nothing live depends on PostGIS (graves store plain latitude and
-- longitude), so dropping and recreating it in the unexposed extensions
-- schema is safe. Applied by hand on 2026-09-15.

drop extension if exists postgis;
create extension if not exists postgis with schema extensions;
