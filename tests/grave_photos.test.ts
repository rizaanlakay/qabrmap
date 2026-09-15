import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mapDbGravePhoto } from '../src/lib/supabase/mappers';
import { isMissingTableError } from '../src/lib/supabase/errors';

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20260914170000_grave_photos.sql'),
  'utf8'
);

describe('Grave Photos Tests', () => {
  it('maps a grave_photos row into the app photo shape', () => {
    expect(
      mapDbGravePhoto({
        id: 'p1',
        grave_id: 'grave_8660',
        public_url: 'https://example.supabase.co/storage/v1/object/public/grave-photos/cem_athlone/grave_8660_1.jpg',
        storage_path: 'cem_athlone/grave_8660_1.jpg',
        uploaded_by: 'user-1',
        is_primary: true,
        kind: 'grave',
        captured_at: '2026-09-14T10:00:00Z',
        created_at: '2026-09-14T10:00:01Z',
      })
    ).toEqual({
      id: 'p1',
      graveId: 'grave_8660',
      url: 'https://example.supabase.co/storage/v1/object/public/grave-photos/cem_athlone/grave_8660_1.jpg',
      storagePath: 'cem_athlone/grave_8660_1.jpg',
      uploadedBy: 'user-1',
      isPrimary: true,
      kind: 'grave',
      capturedAt: '2026-09-14T10:00:00Z',
      createdAt: '2026-09-14T10:00:01Z',
    });
    expect(mapDbGravePhoto({ id: 'p2', grave_id: 'g', public_url: 'u', is_primary: null, created_at: 't' })).toMatchObject({
      isPrimary: false,
      storagePath: undefined,
    });
  });

  it('treats an older photo row without a kind as a stone photo', () => {
    expect(
      mapDbGravePhoto({ id: 'p2', grave_id: 'g', public_url: 'https://x/p2.jpg', is_primary: false, created_at: '2026-09-15T00:00:00Z' }).kind
    ).toBe('stone');
  });

  it('treats a table that has not been created yet as missing rather than broken', () => {
    expect(isMissingTableError({ code: 'PGRST205' })).toBe(true);
    expect(isMissingTableError({ code: '42P01' })).toBe(true);
    expect(isMissingTableError({ code: '42501' })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });

  it('protects grave photos with row level security and cached auth checks', () => {
    expect(MIGRATION).toMatch(/alter table public\.grave_photos enable row level security/);
    expect(MIGRATION).toMatch(/with check \(uploaded_by = \(select auth\.uid\(\)\)\)/);
    // Every auth.uid() in a policy is wrapped in a select so it runs once per query, not per row
    expect(MIGRATION.replace(/\(select auth\.uid\(\)\)/g, '').replace(/default auth\.uid\(\)/g, '')).not.toMatch(/auth\.uid\(\)/);
    expect(MIGRATION).toMatch(/security definer\s+set search_path = ''/);
  });
});
