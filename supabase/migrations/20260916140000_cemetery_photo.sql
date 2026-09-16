-- A community photograph for each cemetery card.
-- Google allows their imagery to be cached temporarily, not kept indefinitely, so the fetch date is
-- recorded and a refresh re-fetches anything older than the caching window. The photo's resource name is
-- an identifier, like a place id, and is kept so the same photograph can be fetched again.
-- The photographer's attribution is stored because Google requires it to be shown wherever the photo is.
-- Applied by hand in the Supabase SQL Editor.

alter table public.cemeteries add column if not exists photo_url text;
alter table public.cemeteries add column if not exists photo_attribution text;
alter table public.cemeteries add column if not exists photo_source text;
alter table public.cemeteries add column if not exists photo_reference text;
alter table public.cemeteries add column if not exists photo_fetched_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cemeteries_photo_source_check'
  ) then
    alter table public.cemeteries add constraint cemeteries_photo_source_check
      check (photo_source is null or photo_source in ('places', 'contributor'));
  end if;
end $$;

-- The refresh job looks for the oldest cached photos, so it reads this index rather than the whole table
create index if not exists idx_cemeteries_photo_fetched_at on public.cemeteries (photo_fetched_at)
  where photo_url is not null;
