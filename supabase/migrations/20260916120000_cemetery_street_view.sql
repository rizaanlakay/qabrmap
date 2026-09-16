-- Street View reference for a cemetery card thumbnail.
-- Only identifiers and our own arithmetic are stored: the panorama id, where its camera stands, and the
-- bearing from that camera to the cemetery. Google's terms forbid storing the imagery itself, so the app
-- renders each thumbnail live from the Street View Static endpoint using these values.
-- Applied by hand in the Supabase SQL Editor.

alter table public.cemeteries add column if not exists street_view_pano_id text;
alter table public.cemeteries add column if not exists street_view_heading numeric(6,2);
alter table public.cemeteries add column if not exists street_view_captured text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cemeteries_street_view_heading_check'
  ) then
    alter table public.cemeteries add constraint cemeteries_street_view_heading_check
      check (street_view_heading is null or (street_view_heading >= 0 and street_view_heading < 360));
  end if;
end $$;
