import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = readFileSync(path.resolve(__dirname, '../supabase/migrations/20260917140000_search_graves.sql'), 'utf8');

// The name and nickname as one searchable text; the index and the function must write it identically
const NAME_TEXT = "(coalesce(p.full_name, '') || ' ' || coalesce(p.nickname, ''))";

describe('Search Graves Migration Tests', () => {
  it('is a read-only function anyone can call, since graves are publicly readable', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.search_graves\(\s+p_query text,\s+p_kind text default 'all',\s+p_limit integer default 20,\s+p_offset integer default 0\s+\)/);
    expect(MIGRATION).toMatch(/stable\s+security invoker\s+set search_path = ''/);
    expect(MIGRATION).toContain('grant execute on function public.search_graves(text, text, integer, integer) to anon, authenticated;');
    expect(MIGRATION).not.toMatch(/\b(insert into|update public|delete from)\b/i);
  });

  it('returns each grave with its person embedded, the shape the app already maps', () => {
    expect(MIGRATION).toMatch(/returns table \(grave jsonb\)/);
    expect(MIGRATION).toContain("to_jsonb(g) || jsonb_build_object('person', to_jsonb(p))");
  });

  it('has trigram indexes, with the name index written exactly as the function searches', () => {
    expect(MIGRATION).toContain('create extension if not exists pg_trgm with schema extensions;');
    expect(MIGRATION).toContain("using gin ((coalesce(full_name, '') || ' ' || coalesce(nickname, '')) extensions.gin_trgm_ops);");
    expect(MIGRATION).toContain('using gin (grave_number extensions.gin_trgm_ops);');
    expect(MIGRATION.split(NAME_TEXT).length - 1).toBeGreaterThanOrEqual(2);
  });

  it('matches every word typed against the name and nickname, and the whole text against the grave number', () => {
    expect(MIGRATION).toContain(`${NAME_TEXT} ilike v_longest`);
    expect(MIGRATION).toContain(`${NAME_TEXT} ilike all (v_patterns)`);
    expect(MIGRATION).toContain("g.grave_number ilike '%' || v_escaped || '%'");
  });

  it('treats what was typed as text, not as a pattern', () => {
    expect(MIGRATION).toContain("replace(replace(replace(v_query, '\\', '\\\\'), '%', '\\%'), '_', '\\_')");
  });

  it('skips one-letter searches, limits the page size, and refuses an unknown kind', () => {
    expect(MIGRATION).toMatch(/if char_length\(v_query\) < 2 then\s+return;/);
    expect(MIGRATION).toContain('least(greatest(coalesce(p_limit, 20), 1), 50)');
    expect(MIGRATION).toContain('greatest(coalesce(p_offset, 0), 0)');
    expect(MIGRATION).toMatch(/if v_kind not in \('all', 'names', 'numbers'\) then\s+raise exception '[^']+' using errcode = '22023';/);
  });

  it('orders pages the same way every time, so they never overlap', () => {
    expect(MIGRATION).toMatch(/order by[\s\S]+p\.full_name,\s+g\.id\s+limit v_limit\s+offset v_offset;/);
  });
});
