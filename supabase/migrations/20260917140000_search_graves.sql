-- ============================================================
-- QabrMap: search graves in the database, a page at a time
-- Run in Supabase Dashboard > SQL Editor > New query. Safe to run more than once.
-- ============================================================

-- The app used to download every grave and filter on the phone. That stops working as the map fills up, and
-- PostgREST answers with at most 1000 rows, so beyond that a search would quietly miss people.

create extension if not exists pg_trgm with schema extensions;

-- Trigram indexes serve "contains" matches (ILIKE '%jones%') on three letters or more. The name index is on
-- the name and nickname together, written exactly as the function below writes it, or it would not be used.
create index if not exists persons_search_name_trgm_idx on public.persons
  using gin ((coalesce(full_name, '') || ' ' || coalesce(nickname, '')) extensions.gin_trgm_ops);
create index if not exists graves_grave_number_trgm_idx on public.graves using gin (grave_number extensions.gin_trgm_ops);

-- p_kind: 'all' (names and grave numbers), 'names', or 'numbers'.
-- Every word typed must appear in the person's name or nickname, in any order, so "jones naqeeb" finds
-- Naqeeb Jones. A grave number matches on the whole text typed.
-- Each row is the grave as PostgREST would return it with its person embedded, so the app maps it the same way.
create or replace function public.search_graves(
  p_query text,
  p_kind text default 'all',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (grave jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_query text := btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'));
  v_kind text := coalesce(p_kind, 'all');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_escaped text;
  v_patterns text[];
  v_longest text;
begin
  if v_kind not in ('all', 'names', 'numbers') then
    raise exception 'Unknown search kind.' using errcode = '22023';
  end if;

  -- One letter matches nearly everyone, so it is not worth a trip
  if char_length(v_query) < 2 then
    return;
  end if;

  -- What was typed is text to find, not a pattern
  v_escaped := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_');
  select array_agg('%' || word || '%'), (array_agg('%' || word || '%' order by char_length(word) desc))[1]
    into v_patterns, v_longest
    from unnest(string_to_array(v_escaped, ' ')) as word
    where word <> '';

  return query
    select to_jsonb(g) || jsonb_build_object('person', to_jsonb(p))
    from public.graves g
    left join public.persons p on p.id = g.person_id
    where
      (v_kind in ('all', 'names')
        and p.id is not null
        -- The index can only serve a single pattern, so the longest word narrows the rows and the rest filter them
        and (coalesce(p.full_name, '') || ' ' || coalesce(p.nickname, '')) ilike v_longest
        and (coalesce(p.full_name, '') || ' ' || coalesce(p.nickname, '')) ilike all (v_patterns))
      or (v_kind in ('all', 'numbers') and g.grave_number <> '' and g.grave_number ilike '%' || v_escaped || '%')
    order by
      -- The exact grave number, then numbers that contain it, then names that start with it, then the closest names
      (lower(g.grave_number) = lower(v_query)) desc,
      (g.grave_number <> '' and g.grave_number ilike '%' || v_escaped || '%') desc,
      (coalesce(p.full_name, '') ilike v_escaped || '%') desc,
      extensions.similarity(coalesce(p.full_name, ''), v_query) desc,
      p.full_name,
      g.id
    limit v_limit
    offset v_offset;
end;
$$;

-- Graves and persons are publicly readable, and so is searching them
grant execute on function public.search_graves(text, text, integer, integer) to anon, authenticated;
