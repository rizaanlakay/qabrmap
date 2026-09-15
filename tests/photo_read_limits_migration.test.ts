import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20260915181000_photo_read_limits.sql'),
  'utf8'
);

describe('Photo Read Limits Migration Tests', () => {
  it('records reads in a table no client can touch directly', () => {
    expect(MIGRATION).toMatch(/create table if not exists public\.photo_reads \(/);
    expect(MIGRATION).toMatch(/user_id uuid not null references auth\.users \(id\) on delete cascade/);
    expect(MIGRATION).toMatch(/alter table public\.photo_reads enable row level security;/);
    expect(MIGRATION).toMatch(/revoke all on table public\.photo_reads from anon, authenticated;/);
    expect(MIGRATION).not.toMatch(/create policy/i);
  });

  it('indexes reads by user and time, and by user and photo', () => {
    expect(MIGRATION).toMatch(/on public\.photo_reads \(user_id, created_at desc\)/);
    expect(MIGRATION).toMatch(/on public\.photo_reads \(user_id, photo_hash, created_at desc\)/);
  });

  it('runs both functions as locked-down security definers that check the caller', () => {
    for (const name of ['begin_photo_read', 'finish_photo_read']) {
      expect(MIGRATION).toMatch(new RegExp(`create or replace function public\\.${name}\\(`));
      expect(MIGRATION).toMatch(new RegExp(`revoke execute on function public\\.${name}\\([^)]*\\) from public, anon;`));
      expect(MIGRATION).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated;`));
    }
    expect(MIGRATION.match(/security definer\s+set search_path = ''/g)).toHaveLength(2);
    expect(MIGRATION.match(/if v_caller is null then\s+raise exception '[^']+' using errcode = '42501';/g)).toHaveLength(2);
  });

  it('reuses a reading of the same photo from the last 24 hours before checking limits', () => {
    expect(MIGRATION).toMatch(/photo_hash = p_photo_hash and reading is not null and created_at > now\(\) - interval '24 hours'/);
    expect(MIGRATION.indexOf("'cached'")).toBeLessThan(MIGRATION.indexOf("errcode = '53400'"));
  });

  it('allows 60 reads in 10 minutes and 500 in a day', () => {
    expect(MIGRATION).toMatch(/interval '10 minutes'\) >= 60/);
    expect(MIGRATION).toMatch(/interval '24 hours'\) >= 500/);
    expect(MIGRATION).toMatch(/raise exception 'Too many photos read\. Try again later\.' using errcode = '53400';/);
  });

  it("serialises one user's reads so parallel requests can't pass the limits", () => {
    expect(MIGRATION).toMatch(/perform pg_advisory_xact_lock\(hashtext\('photo_reads:' \|\| v_caller::text\)\);/);
  });

  it("only stores a reading on the caller's own row", () => {
    expect(MIGRATION).toMatch(/update public\.photo_reads set reading = p_reading where id = p_read_id and user_id = v_caller;/);
  });

  it('calls auth.uid() once per function, wrapped in a select', () => {
    expect(MIGRATION.replace(/\(select auth\.uid\(\)\)/g, '')).not.toMatch(/auth\.uid\(\)/);
  });
});
