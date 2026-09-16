-- ============================================================
-- QabrMap: graves pinned on the satellite map
-- Run in Supabase Dashboard > SQL Editor > New query. Safe to run more than once.
-- ============================================================
-- After the stone photo the app shows the satellite map at its deepest zoom and asks the user to put a fixed
-- centre pin on the grave. Google's imagery over a cemetery is a few centimetres per pixel and sits within a
-- metre or two of the ground, so a careful pin beats the 5 m to 8 m a phone's GPS manages. The phone's fix is
-- still stored on the photo; the pin is stored next to it, and the grave is placed at the pin.

-- ------------------------------------------------------------
-- 1. The pin on the photo, and 'map' as an observation source
-- ------------------------------------------------------------

alter table public.grave_photos add column if not exists pin_latitude double precision;
alter table public.grave_photos add column if not exists pin_longitude double precision;

alter table public.grave_position_observations drop constraint if exists grave_position_observations_source_check;
alter table public.grave_position_observations
  add constraint grave_position_observations_source_check check (source in ('photo', 'visit', 'map'));

-- ------------------------------------------------------------
-- 2. A pin outweighs GPS fixes when the position is recomputed
-- ------------------------------------------------------------

-- Inverse-variance mean of a grave's observations. A verified grave keeps its position but still counts them.
-- GPS accuracies are floored at 3 m for weighting, so a fix claiming better than a phone can do cannot outvote
-- the rest. A map pin is floored at 1.5 m instead: it takes about ten 5 m visits to pull a grave off its pin.
create or replace function public.recompute_grave_position(p_grave_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
  v_lat double precision;
  v_lng double precision;
  v_accuracy numeric;
begin
  select
    count(*),
    sum(latitude * w) / nullif(sum(w), 0),
    sum(longitude * w) / nullif(sum(w), 0),
    greatest(1.5, sqrt(1 / nullif(sum(w), 0)))
  into v_count, v_lat, v_lng, v_accuracy
  from (
    select latitude, longitude,
      1 / greatest(case when source = 'map' then 2.25 else 9 end, accuracy_meters * accuracy_meters) as w
    from public.grave_position_observations
    where grave_id = p_grave_id
  ) o;

  if v_count = 0 then
    update public.graves set observation_count = 0 where id = p_grave_id;
    return;
  end if;

  v_accuracy := round(v_accuracy, 2);

  -- In an UPDATE, columns on the right-hand side are the values before the update
  update public.graves
  set
    observation_count = v_count,
    latitude = case when status = 'VERIFIED' then latitude else v_lat end,
    longitude = case when status = 'VERIFIED' then longitude else v_lng end,
    position_accuracy_meters = case when status = 'VERIFIED' then position_accuracy_meters else v_accuracy end,
    position_confidence = case
      when status = 'VERIFIED' then position_confidence
      when v_accuracy <= 3.5 then 'HIGH'
      when v_accuracy <= 6 then 'MEDIUM'
      else 'LOW'
    end,
    status = case
      when status in ('MAPPED', 'LOW_CONFIDENCE') then (case when v_accuracy <= 5 then 'MAPPED' else 'LOW_CONFIDENCE' end)
      else status
    end,
    updated_at = case when status = 'VERIFIED' then updated_at else now() end
  where id = p_grave_id;
end;
$$;

revoke execute on function public.recompute_grave_position(text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. A pinned photo records the pin, not the GPS fix
-- ------------------------------------------------------------

-- Every photo taken at the grave is an observation: the pin when the user placed one, else the phone's fix
create or replace function public.record_photo_observation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pin_accuracy constant double precision := 1.5;
  v_grave record;
  v_lat double precision;
  v_lng double precision;
  v_accuracy double precision;
  v_source text;
begin
  if new.pin_latitude is not null and new.pin_longitude is not null then
    v_lat := new.pin_latitude;
    v_lng := new.pin_longitude;
    v_accuracy := v_pin_accuracy;
    v_source := 'map';
  elsif new.capture_latitude is not null and new.capture_longitude is not null and new.gps_accuracy_meters is not null then
    v_lat := new.capture_latitude;
    v_lng := new.capture_longitude;
    v_accuracy := new.gps_accuracy_meters;
    v_source := 'photo';
  else
    return null;
  end if;

  select latitude, longitude into v_grave from public.graves where id = new.grave_id;
  if not found then return null; end if;
  -- A photo taken well away from the grave's position is of something else, so it must not move the grave
  if public.distance_meters(v_lat, v_lng, v_grave.latitude, v_grave.longitude) > 30 + v_accuracy then
    return null;
  end if;
  perform public.add_grave_position_observation(
    new.grave_id, new.uploaded_by, v_lat, v_lng, v_accuracy, v_source, coalesce(new.captured_at, new.created_at)
  );
  return null;
end;
$$;

revoke execute on function public.record_photo_observation() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. Saving a capture with a pin
-- ------------------------------------------------------------

-- The signature gains two parameters, so the old function goes first: two overloads with defaults would leave
-- PostgREST unable to choose between them
drop function if exists public.save_or_add_grave(
  text, text, text, text, text, text, text, text, date, date,
  double precision, double precision, double precision, double precision, timestamptz, text, text, text, text
);

-- Saves a captured grave. Depending on p_match_mode it creates the grave (new), reports a likely match
-- without writing anything (ask), or adds the photo to a strong match (auto). With p_add_to_grave_id it adds
-- the photo to that grave. p_latitude, p_longitude and p_accuracy_meters are the phone's GPS fix; when the
-- user pinned the grave on the map, p_pin_latitude and p_pin_longitude say where, and a new grave is placed
-- there. Matching still searches around the GPS fix, since older graves were placed by GPS. Runs as the owner,
-- so it checks the caller itself.
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
  p_add_to_grave_id text default null,
  p_pin_latitude double precision default null,
  p_pin_longitude double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pin_accuracy constant double precision := 1.5;
  v_caller uuid := (select auth.uid());
  v_first_name text := nullif(btrim(p_first_name), '');
  v_middle_names text := nullif(btrim(p_middle_names), '');
  v_surname text := nullif(btrim(p_surname), '');
  v_nickname text := nullif(btrim(p_nickname), '');
  v_grave_number text := coalesce(btrim(p_grave_number), '');
  v_target_grave_id text := nullif(btrim(p_add_to_grave_id), '');
  v_pinned boolean := p_pin_latitude is not null and p_pin_longitude is not null;
  v_grave_lat double precision;
  v_grave_lng double precision;
  v_grave_accuracy double precision;
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

  if p_accuracy_meters is null or p_accuracy_meters <= 0 or p_accuracy_meters > 25 then
    raise exception 'GPS accuracy must be 25 m or better.' using errcode = '22023';
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

  if v_pinned then
    if p_pin_latitude < -90 or p_pin_latitude > 90
      or p_pin_longitude < -180 or p_pin_longitude > 180
      or (p_pin_latitude = 0 and p_pin_longitude = 0) then
      raise exception 'The map pin is not valid.' using errcode = '22023';
    end if;
    -- A pin far from the phone is on the wrong grave, or the phone is somewhere else entirely
    if public.distance_meters(p_pin_latitude, p_pin_longitude, p_latitude, p_longitude) > 50 then
      raise exception 'The map pin is too far from your GPS position.' using errcode = '22023';
    end if;
    v_grave_lat := p_pin_latitude;
    v_grave_lng := p_pin_longitude;
    v_grave_accuracy := v_pin_accuracy;
  else
    v_grave_lat := p_latitude;
    v_grave_lng := p_longitude;
    v_grave_accuracy := p_accuracy_meters;
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
      ) m
      order by m.match = 'strong' desc, m.distance_meters
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
      captured_at, capture_latitude, capture_longitude, gps_accuracy_meters, heading_degrees,
      pin_latitude, pin_longitude
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
      p_heading_degrees,
      p_pin_latitude,
      p_pin_longitude
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
    v_grave_lat,
    v_grave_lng,
    round(v_grave_accuracy::numeric, 2),
    case
      when v_grave_accuracy <= 3.5 then 'HIGH'
      when v_grave_accuracy <= 6 then 'MEDIUM'
      else 'LOW'
    end,
    round(p_heading_degrees::numeric, 2),
    case when v_grave_accuracy <= 5 then 'MAPPED' else 'LOW_CONFIDENCE' end,
    0,
    v_caller
  );

  -- The grave_photos trigger fills in graves.primary_photo_url and photo_count, and records the observation
  insert into public.grave_photos (
    grave_id, storage_path, public_url, uploaded_by, is_primary,
    captured_at, capture_latitude, capture_longitude, gps_accuracy_meters, heading_degrees,
    pin_latitude, pin_longitude
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
    p_heading_degrees,
    p_pin_latitude,
    p_pin_longitude
  );

  return jsonb_build_object('outcome', 'created', 'grave_id', p_grave_id);
end;
$$;

revoke execute on function public.save_or_add_grave(text, text, text, text, text, text, text, text, date, date, double precision, double precision, double precision, double precision, timestamptz, text, text, text, text, double precision, double precision) from public, anon;
grant execute on function public.save_or_add_grave(text, text, text, text, text, text, text, text, date, date, double precision, double precision, double precision, double precision, timestamptz, text, text, text, text, double precision, double precision) to authenticated;
