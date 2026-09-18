-- ============================================================
-- QabrMap: let the person who mapped a grave correct its details
-- Run in Supabase Dashboard > SQL Editor > New query. Safe to run more than once.
-- ============================================================

-- graves and persons have no update policies, so this is the only way to change a grave's details. It runs as
-- the owner, so it checks the caller itself. Unlike a delete it is allowed after other people have added
-- photos or saved the grave: a corrected name or date helps them too, and every edit is written to the
-- grave's provenance log. The position, the photos and the cemetery are not changed here.
create or replace function public.update_mapped_grave(
  p_grave_id text,
  p_first_name text,
  p_middle_names text,
  p_surname text,
  p_nickname text,
  p_grave_number text,
  p_birth_date date,
  p_death_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_grave public.graves%rowtype;
  v_first_name text := btrim(coalesce(p_first_name, ''));
  v_middle_names text := nullif(btrim(coalesce(p_middle_names, '')), '');
  v_surname text := btrim(coalesce(p_surname, ''));
  v_nickname text := nullif(btrim(coalesce(p_nickname, '')), '');
  v_grave_number text := btrim(coalesce(p_grave_number, ''));
  v_full_name text;
  v_person_id text;
begin
  if v_caller is null then
    raise exception 'Sign in to edit a grave.' using errcode = '42501';
  end if;

  select * into v_grave from public.graves where id = p_grave_id for update;
  if not found then
    raise exception 'This grave no longer exists.' using errcode = 'P0002';
  end if;

  if v_grave.created_by is distinct from v_caller then
    raise exception 'Only the person who mapped this grave can edit it.';
  end if;

  if v_first_name = '' or v_surname = '' then
    raise exception 'First name and surname are required.' using errcode = '22023';
  end if;

  if p_birth_date is not null and p_death_date is not null and p_death_date < p_birth_date then
    raise exception 'The date of death is before the date of birth.' using errcode = '22023';
  end if;

  v_full_name := concat_ws(' ', v_first_name, v_middle_names, v_surname);

  if v_grave.person_id is null then
    -- Seeded graves can lack a person; a grave mapped in the app always has one
    v_person_id := 'person_' || gen_random_uuid()::text;
    insert into public.persons (id, first_name, middle_names, surname, full_name, nickname, birth_date, death_date, created_by)
      values (v_person_id, v_first_name, v_middle_names, v_surname, v_full_name, v_nickname, p_birth_date, p_death_date, v_caller);
  else
    v_person_id := v_grave.person_id;
    -- A person record someone else made, or one shared with another grave, is not this caller's to rewrite
    if exists (select 1 from public.persons where id = v_person_id and created_by is distinct from v_caller)
      or exists (select 1 from public.graves where person_id = v_person_id and id <> p_grave_id) then
      raise exception 'This person''s record is shared, so it can''t be edited here. Use Report incorrect info instead.'
        using errcode = '55000';
    end if;

    update public.persons
      set first_name = v_first_name,
          middle_names = v_middle_names,
          surname = v_surname,
          full_name = v_full_name,
          nickname = v_nickname,
          birth_date = p_birth_date,
          death_date = p_death_date
      where id = v_person_id;
  end if;

  update public.graves
    set person_id = v_person_id,
        grave_number = v_grave_number,
        updated_at = now()
    where id = p_grave_id;

  insert into public.provenance_logs (id, grave_id, contributor, action, source, details)
    values (
      'prov_' || gen_random_uuid()::text,
      p_grave_id,
      'Grave mapper',
      'Details edited',
      'MANUAL',
      'The person who mapped this grave corrected its details.'
    );
end;
$$;

revoke execute on function public.update_mapped_grave(text, text, text, text, text, text, date, date) from public, anon;
grant execute on function public.update_mapped_grave(text, text, text, text, text, text, date, date) to authenticated;
