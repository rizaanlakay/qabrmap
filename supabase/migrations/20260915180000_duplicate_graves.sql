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
