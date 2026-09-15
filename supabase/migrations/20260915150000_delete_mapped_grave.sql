-- ============================================================
-- QabrMap: let the person who mapped a grave delete it
-- Run in Supabase Dashboard > SQL Editor > New query. Safe to run more than once.
-- ============================================================

-- graves and persons have no delete policies, so this is the only way to remove a grave. It runs as the owner,
-- so it checks the caller itself, and refuses once other people have added to the grave.
create or replace function public.delete_mapped_grave(p_grave_id text)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_grave public.graves%rowtype;
  v_paths text[];
begin
  if v_caller is null then
    raise exception 'Sign in to delete a grave.' using errcode = '42501';
  end if;

  select * into v_grave from public.graves where id = p_grave_id for update;
  if not found then
    raise exception 'This grave no longer exists.' using errcode = 'P0002';
  end if;

  if v_grave.created_by is distinct from v_caller then
    raise exception 'Only the person who mapped this grave can delete it.';
  end if;

  -- Another family's photo or saved loved one must not disappear with someone else's mistake
  if exists (select 1 from public.grave_photos where grave_id = p_grave_id and uploaded_by is distinct from v_caller)
    or exists (select 1 from public.saved_graves where grave_id = p_grave_id and user_id <> v_caller) then
    raise exception 'Other people have added to this grave, so it can''t be deleted. Use Report incorrect info instead.'
      using errcode = '55000';
  end if;

  -- The app removes these files from storage once the rows are gone
  select coalesce(array_agg(storage_path) filter (where storage_path is not null), '{}')
    into v_paths
    from public.grave_photos
    where grave_id = p_grave_id;

  -- Photos, saved copies, history and correction reports go with the grave (on delete cascade)
  delete from public.graves where id = p_grave_id;

  if v_grave.person_id is not null
    and not exists (select 1 from public.graves where person_id = v_grave.person_id) then
    delete from public.persons where id = v_grave.person_id and created_by = v_caller;
  end if;

  return v_paths;
end;
$$;

revoke execute on function public.delete_mapped_grave(text) from public, anon;
grant execute on function public.delete_mapped_grave(text) to authenticated;
