import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20260915120000_create_mapped_grave.sql'),
  'utf8'
);

describe('Create Mapped Grave Migration Tests', () => {
  it('adds nickname and records who created each grave and person', () => {
    expect(MIGRATION).toMatch(/alter table public\.persons add column if not exists nickname text;/);
    expect(MIGRATION).toMatch(/alter table public\.persons add column if not exists created_by uuid/);
    expect(MIGRATION).toMatch(/alter table public\.graves add column if not exists created_by uuid/);
    expect(MIGRATION).toMatch(/create index if not exists persons_created_by_idx on public\.persons \(created_by\);/);
    expect(MIGRATION).toMatch(/create index if not exists graves_created_by_idx on public\.graves \(created_by\);/);
  });

  it('keeps direct writes to graves and persons closed so the function is the only way in', () => {
    expect(MIGRATION).not.toMatch(/on public\.(graves|persons)\s+for\s+(insert|update|delete|all)/i);
  });

  it('only checks graves that have a number for duplicates', () => {
    expect(MIGRATION).toMatch(
      /create unique index if not exists graves_cemetery_grave_number_unique_idx\s+on public\.graves \(cemetery_id, grave_number\)\s+where grave_number <> '';/
    );
  });

  it('runs create_mapped_grave as a locked-down security definer that checks the caller', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.create_mapped_grave\(/);
    expect(MIGRATION).toMatch(/security definer\s+set search_path = ''/);
    expect(MIGRATION).toMatch(/v_caller uuid := \(select auth\.uid\(\)\);/);
    expect(MIGRATION).toMatch(/if v_caller is null then\s+raise exception '[^']+' using errcode = '42501';/);
    expect(MIGRATION).toMatch(/revoke execute on function public\.create_mapped_grave\([^)]*\) from public, anon;/);
    expect(MIGRATION).toMatch(/grant execute on function public\.create_mapped_grave\([^)]*\) to authenticated;/);
  });

  it('returns the existing grave when the same user retries a save with the same id', () => {
    expect(MIGRATION).toMatch(
      /if exists \(select 1 from public\.graves where id = p_grave_id and created_by = v_caller\) then\s+return p_grave_id;\s+end if;/
    );
  });

  it('validates required names, GPS accuracy and heading in the database', () => {
    expect(MIGRATION).toMatch(/if v_first_name is null or v_surname is null then/);
    expect(MIGRATION).toMatch(/p_accuracy_meters > 10/);
    expect(MIGRATION).toMatch(/p_heading_degrees > 360/);
  });

  it('sets status and position confidence from GPS accuracy instead of trusting the client', () => {
    expect(MIGRATION).toMatch(/when p_accuracy_meters <= 5 then 'MAPPED' else 'LOW_CONFIDENCE'/);
    expect(MIGRATION).toMatch(/when p_accuracy_meters <= 3\.5 then 'HIGH'\s+when p_accuracy_meters <= 6 then 'MEDIUM'\s+else 'LOW'/);
  });

  it('saves the first photo as the primary grave photo', () => {
    expect(MIGRATION).toMatch(/insert into public\.grave_photos \([^)]*is_primary[^)]*\)/);
  });

  it('lets signed-in users delete only their own photo files', () => {
    expect(MIGRATION).toMatch(/on storage\.objects for delete\s+to authenticated\s+using \(bucket_id = 'grave-photos' and owner_id = \(select auth\.uid\(\)::text\)\);/);
  });

  it('calls auth.uid() once per statement, wrapped in a select', () => {
    const withoutWrapped = MIGRATION.replace(/\(select auth\.uid\(\)(::text)?\)/g, '').replace(/default auth\.uid\(\)/g, '');
    expect(withoutWrapped).not.toMatch(/auth\.uid\(\)/);
  });
});
