-- ============================================================
-- QabrMap: whole-grave photos, position observations and visits
-- Run in Supabase Dashboard > SQL Editor > New query. Safe to run more than once.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Whole-grave photos
-- ------------------------------------------------------------

-- stone: the gravestone. grave: a wider shot of the whole grave, taken after a low-accuracy capture
alter table public.grave_photos add column if not exists kind text not null default 'stone';
alter table public.grave_photos drop constraint if exists grave_photos_kind_check;
alter table public.grave_photos add constraint grave_photos_kind_check check (kind in ('stone', 'grave'));

-- The whole-grave photo, shown as "Look for this grave" when navigating
alter table public.graves add column if not exists grave_photo_url text;
-- How many independent position observations the grave's position is built from
alter table public.graves add column if not exists observation_count int not null default 0;

-- Keeps graves.photo_count, primary_photo_url and grave_photo_url in step with grave_photos. App users can't
-- update graves directly, so this runs as the function owner; it only touches the grave the photo belongs to.
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
        order by p.is_primary desc, (p.kind = 'stone') desc, p.created_at asc
        limit 1
      ),
      '/sample-gravestone.svg'
    ),
    grave_photo_url = (
      select p.public_url
      from public.grave_photos p
      where p.grave_id = target_grave_id and p.kind = 'grave'
      order by p.created_at asc
      limit 1
    ),
    updated_at = now()
  where g.id = target_grave_id;
  return null;
end;
$$;

revoke execute on function public.sync_grave_photo_summary() from public, anon, authenticated;

drop trigger if exists grave_photos_sync_summary on public.grave_photos;
create trigger grave_photos_sync_summary
  after insert or delete or update of is_primary, public_url, kind on public.grave_photos
  for each row execute function public.sync_grave_photo_summary();

-- ------------------------------------------------------------
-- 2. Position observations
-- ------------------------------------------------------------

-- Every GPS fix taken at a grave: from a photo, or from someone confirming they found it. Fixes on different
-- days have independent errors, so their weighted mean is better than any one of them.
create table if not exists public.grave_position_observations (
  id uuid primary key default gen_random_uuid(),
  grave_id text not null references public.graves (id) on delete cascade,
  observed_by uuid references auth.users (id) on delete set null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_meters double precision not null check (accuracy_meters > 0 and accuracy_meters <= 25),
  source text not null check (source in ('photo', 'visit')),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists grave_position_observations_grave_id_observed_at_idx
  on public.grave_position_observations (grave_id, observed_at);
create index if not exists grave_position_observations_observed_by_idx
  on public.grave_position_observations (observed_by);

alter table public.grave_position_observations enable row level security;

-- No policies: row level security stays on, so app roles cannot read the visit trail. The security-definer
-- functions below are unaffected, because the owner bypasses row level security.
drop policy if exists "Grave observations are publicly readable" on public.grave_position_observations;

-- Haversine distance in metres; shared by the photo trigger and record_grave_visit
create or replace function public.distance_meters(
  p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  ))
$$;

-- Inverse-variance mean of a grave's observations. A verified grave keeps its position but still counts them.
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
    -- Accuracy is floored at 3 m for weighting, so a fix claiming better than a phone can do cannot outvote the rest
    select latitude, longitude, 1 / greatest(9, accuracy_meters * accuracy_meters) as w
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

-- Adds one observation and recomputes the grave. Fixes taken minutes apart share the same GPS error, so one
-- person's fixes within six hours count once, keeping the most accurate. Safe to call again with the same fix.
create or replace function public.add_grave_position_observation(
  p_grave_id text,
  p_user_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_source text,
  p_observed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_observed_at timestamptz := coalesce(p_observed_at, now());
  v_existing record;
begin
  if p_accuracy_meters is null or p_accuracy_meters <= 0 or p_accuracy_meters > 25 then return; end if;
  if p_latitude is null or p_longitude is null
    or p_latitude < -90 or p_latitude > 90
    or p_longitude < -180 or p_longitude > 180
    or (p_latitude = 0 and p_longitude = 0) then
    return;
  end if;
  if not exists (select 1 from public.graves where id = p_grave_id) then return; end if;

  -- Observations for one grave are added one at a time so two recomputes can't interleave
  perform pg_advisory_xact_lock(hashtext(p_grave_id));

  -- The same fix again (a re-run of the backfill) changes nothing
  if exists (
    select 1 from public.grave_position_observations
    where grave_id = p_grave_id and latitude = p_latitude and longitude = p_longitude
      and accuracy_meters = p_accuracy_meters and observed_at = v_observed_at
  ) then
    return;
  end if;

  if p_user_id is not null then
    select id, accuracy_meters into v_existing
      from public.grave_position_observations
      where grave_id = p_grave_id and observed_by = p_user_id
        and observed_at between v_observed_at - interval '6 hours' and v_observed_at + interval '6 hours'
      order by observed_at desc
      limit 1;
    if found then
      if p_accuracy_meters < v_existing.accuracy_meters then
        update public.grave_position_observations
        set latitude = p_latitude, longitude = p_longitude, accuracy_meters = p_accuracy_meters,
          source = p_source, observed_at = v_observed_at
        where id = v_existing.id;
        perform public.recompute_grave_position(p_grave_id);
      end if;
      return;
    end if;
  end if;

  insert into public.grave_position_observations (grave_id, observed_by, latitude, longitude, accuracy_meters, source, observed_at)
  values (p_grave_id, p_user_id, p_latitude, p_longitude, p_accuracy_meters, p_source, v_observed_at);
  perform public.recompute_grave_position(p_grave_id);
end;
$$;

revoke execute on function public.add_grave_position_observation(text, uuid, double precision, double precision, double precision, text, timestamptz) from public, anon, authenticated;

-- Every photo taken at the grave is an observation: a new grave, a photo added to a match, or a survey match
create or replace function public.record_photo_observation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grave record;
begin
  if new.capture_latitude is null or new.capture_longitude is null or new.gps_accuracy_meters is null then
    return null;
  end if;
  select latitude, longitude into v_grave from public.graves where id = new.grave_id;
  if not found then return null; end if;
  -- A photo taken well away from the grave's position is of something else, so it must not move the grave
  if public.distance_meters(new.capture_latitude, new.capture_longitude, v_grave.latitude, v_grave.longitude)
     > 30 + new.gps_accuracy_meters then
    return null;
  end if;
  perform public.add_grave_position_observation(
    new.grave_id, new.uploaded_by, new.capture_latitude, new.capture_longitude, new.gps_accuracy_meters,
    'photo', coalesce(new.captured_at, new.created_at)
  );
  return null;
end;
$$;

revoke execute on function public.record_photo_observation() from public, anon, authenticated;

drop trigger if exists grave_photos_record_observation on public.grave_photos;
create trigger grave_photos_record_observation
  after insert on public.grave_photos
  for each row execute function public.record_photo_observation();

-- "I found it" from navigation. Runs as the owner, so it checks the caller and the distance itself.
create or replace function public.record_grave_visit(
  p_grave_id text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_grave record;
  v_distance double precision;
begin
  if v_caller is null then
    raise exception 'Sign in to confirm a grave.' using errcode = '42501';
  end if;

  select latitude, longitude into v_grave from public.graves where id = p_grave_id;
  if not found then
    raise exception 'That grave no longer exists.' using errcode = 'P0002';
  end if;

  if p_accuracy_meters is null or p_accuracy_meters <= 0 or p_accuracy_meters > 25 then
    raise exception 'GPS accuracy must be 25 m or better.' using errcode = '22023';
  end if;

  if p_latitude is null or p_longitude is null
    or p_latitude < -90 or p_latitude > 90
    or p_longitude < -180 or p_longitude > 180
    or (p_latitude = 0 and p_longitude = 0) then
    raise exception 'The GPS position is not valid.' using errcode = '22023';
  end if;

  v_distance := public.distance_meters(p_latitude, p_longitude, v_grave.latitude, v_grave.longitude);
  if v_distance > 30 then
    raise exception 'You''re too far from this grave to confirm it.' using errcode = '22023';
  end if;

  perform public.add_grave_position_observation(p_grave_id, v_caller, p_latitude, p_longitude, p_accuracy_meters, 'visit', now());

  select latitude, longitude, position_accuracy_meters, position_confidence, status, observation_count
    into v_grave
    from public.graves
    where id = p_grave_id;

  return jsonb_build_object(
    'latitude', v_grave.latitude,
    'longitude', v_grave.longitude,
    'position_accuracy_meters', v_grave.position_accuracy_meters,
    'position_confidence', v_grave.position_confidence,
    'status', v_grave.status,
    'observation_count', v_grave.observation_count
  );
end;
$$;

revoke execute on function public.record_grave_visit(text, double precision, double precision, double precision) from public, anon;
grant execute on function public.record_grave_visit(text, double precision, double precision, double precision) to authenticated;

-- ------------------------------------------------------------
-- 3. Captures up to 25 m
-- ------------------------------------------------------------

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

-- ------------------------------------------------------------
-- 4. Backfill observations from the photos already taken
-- ------------------------------------------------------------

-- Each grave takes one advisory lock for the whole run; past a few thousand graves with photos, run this loop in batches
do $$
declare
  p record;
begin
  for p in
    select grave_id, uploaded_by, capture_latitude, capture_longitude, gps_accuracy_meters,
           coalesce(captured_at, created_at) as observed_at
    from public.grave_photos
    where capture_latitude is not null and capture_longitude is not null and gps_accuracy_meters is not null
    order by created_at
  loop
    perform public.add_grave_position_observation(
      p.grave_id, p.uploaded_by, p.capture_latitude, p.capture_longitude, p.gps_accuracy_meters, 'photo', p.observed_at
    );
  end loop;
end;
$$;
