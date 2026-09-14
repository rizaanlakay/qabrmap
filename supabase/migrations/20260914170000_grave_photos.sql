-- ============================================================
-- QabrMap: multiple photos per grave
-- Run in Supabase Dashboard > SQL Editor > New query. Safe to run more than once.
-- ============================================================

create table if not exists public.grave_photos (
  id uuid primary key default gen_random_uuid(),
  grave_id text not null references public.graves (id) on delete cascade,
  storage_path text,
  public_url text not null,
  uploaded_by uuid default auth.uid() references auth.users (id) on delete set null,
  is_primary boolean not null default false,
  captured_at timestamptz,
  capture_latitude double precision,
  capture_longitude double precision,
  gps_accuracy_meters double precision,
  heading_degrees double precision,
  created_at timestamptz not null default now()
);

-- Photos are always read per grave in upload order; also covers the grave_id foreign key
create index if not exists grave_photos_grave_id_created_at_idx on public.grave_photos (grave_id, created_at);
-- Used by the insert/delete policies and by ON DELETE SET NULL when an account is removed
create index if not exists grave_photos_uploaded_by_idx on public.grave_photos (uploaded_by);
-- At most one primary photo per grave
create unique index if not exists grave_photos_one_primary_per_grave_idx
  on public.grave_photos (grave_id)
  where is_primary;

alter table public.grave_photos enable row level security;

drop policy if exists "Grave photos are publicly readable" on public.grave_photos;
create policy "Grave photos are publicly readable"
  on public.grave_photos for select
  to anon, authenticated
  using (true);

drop policy if exists "Signed-in users can add grave photos" on public.grave_photos;
create policy "Signed-in users can add grave photos"
  on public.grave_photos for insert
  to authenticated
  with check (uploaded_by = (select auth.uid()));

drop policy if exists "Users can delete their own grave photos" on public.grave_photos;
create policy "Users can delete their own grave photos"
  on public.grave_photos for delete
  to authenticated
  using (uploaded_by = (select auth.uid()));

-- Keeps graves.photo_count and graves.primary_photo_url in step with grave_photos, so search results and
-- My Cemeteries show real counts and thumbnails. App users can't update graves directly, so this runs as
-- the function owner; it only ever touches the grave that the changed photo belongs to.
create or replace function public.sync_grave_photo_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_grave_id text := coalesce(new.grave_id, old.grave_id);
begin
  update public.graves g
  set
    photo_count = (select count(*) from public.grave_photos p where p.grave_id = target_grave_id),
    primary_photo_url = coalesce(
      (
        select p.public_url
        from public.grave_photos p
        where p.grave_id = target_grave_id
        order by p.is_primary desc, p.created_at asc
        limit 1
      ),
      '/sample-gravestone.svg'
    ),
    updated_at = now()
  where g.id = target_grave_id;
  return null;
end;
$$;

revoke execute on function public.sync_grave_photo_summary() from public, anon, authenticated;

drop trigger if exists grave_photos_sync_summary on public.grave_photos;
create trigger grave_photos_sync_summary
  after insert or delete or update of is_primary, public_url on public.grave_photos
  for each row execute function public.sync_grave_photo_summary();

-- Seeded photo counts described photos that never existed; count what is really there (none yet)
update public.graves g
set photo_count = (select count(*) from public.grave_photos p where p.grave_id = g.id)
where g.photo_count is distinct from (select count(*) from public.grave_photos p where p.grave_id = g.id);

-- Signed-in users may upload into the public grave-photos bucket; reading its files is already public
drop policy if exists "Signed-in users can upload grave photos" on storage.objects;
create policy "Signed-in users can upload grave photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'grave-photos');
