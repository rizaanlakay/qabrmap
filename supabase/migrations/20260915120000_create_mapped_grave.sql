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
