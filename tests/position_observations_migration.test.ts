import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20260915200000_position_observations.sql'),
  'utf8'
);

describe('Position Observations Migration Tests', () => {
  it('adds the photo kind and the whole-grave photo url', () => {
    expect(MIGRATION).toMatch(/alter table public\.grave_photos add column if not exists kind text not null default 'stone';/);
    expect(MIGRATION).toMatch(/check \(kind in \('stone', 'grave'\)\)/);
    expect(MIGRATION).toMatch(/alter table public\.graves add column if not exists grave_photo_url text;/);
    expect(MIGRATION).toMatch(/alter table public\.graves add column if not exists observation_count int not null default 0;/);
    expect(MIGRATION).toMatch(/where p\.grave_id = target_grave_id and p\.kind = 'grave'/);
    expect(MIGRATION).toMatch(/after insert or delete or update of is_primary, public_url, kind on public\.grave_photos/);
  });

  it('creates a locked-down observations table', () => {
    expect(MIGRATION).toMatch(/create table if not exists public\.grave_position_observations/);
    expect(MIGRATION).toMatch(/accuracy_meters double precision not null check \(accuracy_meters > 0 and accuracy_meters <= 25\)/);
    expect(MIGRATION).toMatch(/source text not null check \(source in \('photo', 'visit'\)\)/);
    expect(MIGRATION).toMatch(/alter table public\.grave_position_observations enable row level security;/);
    expect(MIGRATION).toMatch(/on public\.grave_position_observations for select/);
    expect(MIGRATION).not.toMatch(/on public\.grave_position_observations for (insert|update|delete)/);
  });

  it('recomputes the position with an inverse-variance mean, a 1.5 m floor and the save thresholds', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.recompute_grave_position\(p_grave_id text\)/);
    expect(MIGRATION).toMatch(/1 \/ greatest\(0\.25, accuracy_meters \* accuracy_meters\)/);
    expect(MIGRATION).toMatch(/greatest\(1\.5, sqrt\(1 \/ nullif\(sum\(w\), 0\)\)\)/);
    expect(MIGRATION).toMatch(/when v_accuracy <= 3\.5 then 'HIGH'/);
    expect(MIGRATION).toMatch(/when v_accuracy <= 6 then 'MEDIUM'/);
    expect(MIGRATION).toMatch(/when v_accuracy <= 5 then 'MAPPED' else 'LOW_CONFIDENCE'/);
    expect(MIGRATION).toMatch(/when status = 'VERIFIED' then latitude else v_lat/);
  });

  it('counts one observation per user per grave per six hours', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.add_grave_position_observation\(/);
    expect(MIGRATION).toMatch(/interval '6 hours'/);
    expect(MIGRATION).toMatch(/if p_accuracy_meters < v_existing\.accuracy_meters then/);
    expect(MIGRATION).toMatch(/pg_advisory_xact_lock\(hashtext\(p_grave_id\)\)/);
  });

  it('turns every photo with a position into an observation', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.record_photo_observation\(\)/);
    expect(MIGRATION).toMatch(/create trigger grave_photos_record_observation\s+after insert on public\.grave_photos/);
    expect(MIGRATION).toMatch(/coalesce\(new\.captured_at, now\(\)\)/);
    expect(MIGRATION).toMatch(/> 30 \+ new\.gps_accuracy_meters then/);
  });

  it('measures distance with one shared haversine function', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.distance_meters\(/);
    expect(MIGRATION).toMatch(/v_distance := public\.distance_meters\(p_latitude, p_longitude, v_grave\.latitude, v_grave\.longitude\);/);
  });

  it('records visits from signed-in users within 30 m', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.record_grave_visit\(/);
    expect(MIGRATION).toMatch(/if v_distance > 30 then/);
    expect(MIGRATION).toMatch(/'observation_count', v_grave\.observation_count/);
    expect(MIGRATION).toMatch(/revoke execute on function public\.record_grave_visit\([^)]*\) from public, anon;/);
    expect(MIGRATION).toMatch(/grant execute on function public\.record_grave_visit\([^)]*\) to authenticated;/);
  });

  it('keeps the internal functions away from app roles', () => {
    expect(MIGRATION).toMatch(/revoke execute on function public\.recompute_grave_position\(text\) from public, anon, authenticated;/);
    expect(MIGRATION).toMatch(/revoke execute on function public\.add_grave_position_observation\([^)]*\) from public, anon, authenticated;/);
  });

  it('accepts captures up to 25 m', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.save_or_add_grave\(/);
    expect(MIGRATION).toMatch(/p_accuracy_meters > 25 then\s+raise exception 'GPS accuracy must be 25 m or better\.'/);
    expect(MIGRATION).not.toMatch(/p_accuracy_meters > 10 then/);
  });

  it('backfills observations from existing photos', () => {
    expect(MIGRATION).toMatch(/for p in\s+select grave_id, uploaded_by, capture_latitude, capture_longitude, gps_accuracy_meters/);
  });
});
