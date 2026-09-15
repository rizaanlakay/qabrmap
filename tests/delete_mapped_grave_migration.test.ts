import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20260915150000_delete_mapped_grave.sql'),
  'utf8'
);

describe('Delete Mapped Grave Migration Tests', () => {
  it('runs as a locked-down security definer that checks the caller', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.delete_mapped_grave\(p_grave_id text\)/);
    expect(MIGRATION).toMatch(/security definer\s+set search_path = ''/);
    expect(MIGRATION).toMatch(/v_caller uuid := \(select auth\.uid\(\)\);/);
    expect(MIGRATION).toMatch(/if v_caller is null then\s+raise exception '[^']+' using errcode = '42501';/);
    expect(MIGRATION).toMatch(/revoke execute on function public\.delete_mapped_grave\(text\) from public, anon;/);
    expect(MIGRATION).toMatch(/grant execute on function public\.delete_mapped_grave\(text\) to authenticated;/);
  });

  it('only lets the person who mapped the grave delete it', () => {
    expect(MIGRATION).toMatch(/if v_grave\.created_by is distinct from v_caller then/);
  });

  it('refuses when someone else added a photo or saved the grave', () => {
    expect(MIGRATION).toMatch(/from public\.grave_photos where grave_id = p_grave_id and uploaded_by is distinct from v_caller/);
    expect(MIGRATION).toMatch(/from public\.saved_graves where grave_id = p_grave_id and user_id <> v_caller/);
    expect(MIGRATION).toMatch(/errcode = '55000'/);
  });

  it('deletes the grave and a person no other grave uses, returning the photo paths', () => {
    expect(MIGRATION).toMatch(/returns text\[\]/);
    expect(MIGRATION).toMatch(/delete from public\.graves where id = p_grave_id;/);
    expect(MIGRATION).toMatch(/not exists \(select 1 from public\.graves where person_id = v_grave\.person_id\)/);
    expect(MIGRATION).toMatch(/delete from public\.persons where id = v_grave\.person_id and created_by = v_caller;/);
  });

  it('calls auth.uid() once, wrapped in a select', () => {
    expect(MIGRATION.replace(/\(select auth\.uid\(\)\)/g, '')).not.toMatch(/auth\.uid\(\)/);
  });
});
