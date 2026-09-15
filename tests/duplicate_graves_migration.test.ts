import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20260915180000_duplicate_graves.sql'),
  'utf8'
);

describe('Duplicate Graves Migration Tests', () => {
  it('lets one numbered grave hold several burials', () => {
    expect(MIGRATION).toMatch(/drop index if exists public\.graves_cemetery_grave_number_unique_idx;/);
    expect(MIGRATION).toMatch(
      /create index if not exists graves_cemetery_grave_number_idx\s+on public\.graves \(cemetery_id, grave_number\)\s+where grave_number <> '';/
    );
    expect(MIGRATION).not.toMatch(/create unique index/i);
  });

  it('enables trigram matching in the extensions schema', () => {
    expect(MIGRATION).toMatch(/create extension if not exists pg_trgm with schema extensions;/);
    expect(MIGRATION).toMatch(/extensions\.similarity\(/);
  });

  it('finds matches with a read-only function that signed-in users can call', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.find_matching_graves\(/);
    expect(MIGRATION).toMatch(/stable\s+security invoker\s+set search_path = ''/);
    expect(MIGRATION).toMatch(/revoke execute on function public\.find_matching_graves\([^)]*\) from public, anon;/);
    expect(MIGRATION).toMatch(/grant execute on function public\.find_matching_graves\([^)]*\) to authenticated;/);
  });

  it('matches by GPS radius or grave number, name similarity, then date of birth and date of death', () => {
    expect(MIGRATION).toMatch(/least\(20, greatest\(10, coalesce\(p_accuracy_meters, 0\) \+ c\.existing_accuracy\)\)/);
    expect(MIGRATION).toMatch(/extensions\.similarity\([^;]*\) >= 0\.85/);
    expect(MIGRATION).toMatch(/when p_birth_date is not null and c\.birth_date is not null then c\.birth_date = p_birth_date/);
    expect(MIGRATION).toMatch(/when p_death_date is not null and c\.death_date is not null then c\.death_date = p_death_date/);
    expect(MIGRATION).toMatch(/limit 3/);
  });

  it('saves through a locked-down security definer that checks the caller', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.save_or_add_grave\(/);
    expect(MIGRATION).toMatch(/returns jsonb\s+language plpgsql\s+security definer\s+set search_path = ''/);
    expect(MIGRATION).toMatch(/v_caller uuid := \(select auth\.uid\(\)\);/);
    expect(MIGRATION).toMatch(/if v_caller is null then\s+raise exception '[^']+' using errcode = '42501';/);
    expect(MIGRATION).toMatch(/revoke execute on function public\.save_or_add_grave\([^)]*\) from public, anon;/);
    expect(MIGRATION).toMatch(/grant execute on function public\.save_or_add_grave\([^)]*\) to authenticated;/);
  });

  it('serialises saves in a cemetery and treats retries as already saved', () => {
    expect(MIGRATION).toMatch(/perform pg_advisory_xact_lock\(hashtext\(p_cemetery_id\)\);/);
    expect(MIGRATION).toMatch(/if exists \(select 1 from public\.graves where id = p_grave_id and created_by = v_caller\) then/);
    expect(MIGRATION).toMatch(/where public_url = p_photo_public_url and uploaded_by = v_caller/);
  });

  it('asks about any match, auto-adds only strong matches, and never makes an added photo primary', () => {
    expect(MIGRATION).toMatch(/p_match_mode not in \('ask', 'auto', 'new'\)/);
    expect(MIGRATION).toMatch(/if p_match_mode = 'auto' and v_match\.match = 'strong' then/);
    expect(MIGRATION).toMatch(/'outcome', 'match-found'/);
    expect(MIGRATION).toMatch(/v_target_grave_id,\s+nullif\(p_photo_storage_path, ''\),\s+p_photo_public_url,\s+v_caller,\s+false,/);
  });

  it('keeps create_mapped_grave for the app that is still live', () => {
    expect(MIGRATION).not.toMatch(/drop function/i);
  });

  it('calls auth.uid() once, wrapped in a select', () => {
    expect(MIGRATION.replace(/\(select auth\.uid\(\)\)/g, '')).not.toMatch(/auth\.uid\(\)/);
  });
});
