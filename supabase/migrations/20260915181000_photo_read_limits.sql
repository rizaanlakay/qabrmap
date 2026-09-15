-- ============================================================
-- QabrMap: limits on reading grave photos with the AI model
-- Run in Supabase Dashboard > SQL Editor > New query. Safe to run more than once.
-- ============================================================

-- One row per photo sent to the model. Only the functions below read or write it.
create table if not exists public.photo_reads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  photo_hash text not null,
  reading jsonb,
  created_at timestamptz not null default now()
);

create index if not exists photo_reads_user_created_idx on public.photo_reads (user_id, created_at desc);
create index if not exists photo_reads_user_hash_idx on public.photo_reads (user_id, photo_hash, created_at desc);

alter table public.photo_reads enable row level security;
revoke all on table public.photo_reads from anon, authenticated;

-- Called by the read-stone route before it pays for a read. Returns the earlier reading of the same photo,
-- refuses when the user is over the limits, or records the read and returns its id.
create or replace function public.begin_photo_read(p_photo_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_cached jsonb;
  v_read_id uuid;
begin
  if v_caller is null then
    raise exception 'Sign in to read a photo.' using errcode = '42501';
  end if;

  if p_photo_hash is null or p_photo_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A photo hash is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('photo_reads:' || v_caller::text));

  -- Only the last day matters, so older rows are cleared as the user reads
  delete from public.photo_reads where user_id = v_caller and created_at < now() - interval '2 days';

  -- The same photo sent again, for example after the app closed mid-read, costs nothing
  select reading into v_cached
    from public.photo_reads
    where user_id = v_caller and photo_hash = p_photo_hash and reading is not null and created_at > now() - interval '24 hours'
    order by created_at desc
    limit 1;
  if v_cached is not null then
    return jsonb_build_object('cached', v_cached);
  end if;

  if (select count(*) from public.photo_reads where user_id = v_caller and created_at > now() - interval '10 minutes') >= 60
    or (select count(*) from public.photo_reads where user_id = v_caller and created_at > now() - interval '24 hours') >= 500 then
    raise exception 'Too many photos read. Try again later.' using errcode = '53400';
  end if;

  -- Recorded before the model is called, so a failed read still counts toward the limits
  insert into public.photo_reads (user_id, photo_hash) values (v_caller, p_photo_hash) returning id into v_read_id;
  return jsonb_build_object('read_id', v_read_id);
end;
$$;

-- Stores what the model returned, so the same photo can be answered from the cache
create or replace function public.finish_photo_read(p_read_id uuid, p_reading jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null then
    raise exception 'Sign in to read a photo.' using errcode = '42501';
  end if;

  update public.photo_reads set reading = p_reading where id = p_read_id and user_id = v_caller;
end;
$$;

revoke execute on function public.begin_photo_read(text) from public, anon;
grant execute on function public.begin_photo_read(text) to authenticated;
revoke execute on function public.finish_photo_read(uuid, jsonb) from public, anon;
grant execute on function public.finish_photo_read(uuid, jsonb) to authenticated;
