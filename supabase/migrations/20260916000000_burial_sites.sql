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

-- Each check constraint is guarded with an existence check since conditional constraint creation is not available in Postgres
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
