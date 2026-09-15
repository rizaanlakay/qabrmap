import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20260916000000_burial_sites.sql'),
  'utf8'
);

describe('Burial Sites Migration Tests', () => {
  it('adds the site type and status with defaults the old rows satisfy', () => {
    expect(MIGRATION).toMatch(/alter table public\.cemeteries add column if not exists site_type text not null default 'muslim_cemetery';/);
    expect(MIGRATION).toMatch(/check \(site_type in \('muslim_cemetery', 'muslim_section', 'shared_cemetery', 'historic_cemetery'\)\)/);
    expect(MIGRATION).toMatch(/alter table public\.cemeteries add column if not exists site_status text not null default 'active';/);
    expect(MIGRATION).toMatch(/check \(site_status in \('active', 'closed', 'unknown'\)\)/);
  });

  it('adds names, address, provenance and sources', () => {
    expect(MIGRATION).toMatch(/add column if not exists aliases text\[\] not null default '\{\}';/);
    expect(MIGRATION).toMatch(/add column if not exists address text;/);
    expect(MIGRATION).toMatch(/add column if not exists google_place_id text;/);
    expect(MIGRATION).toMatch(/add column if not exists boundary_source text;/);
    expect(MIGRATION).toMatch(/check \(boundary_source is null or boundary_source in \('osm', 'manual'\)\)/);
    expect(MIGRATION).toMatch(/add column if not exists osm_id text;/);
    expect(MIGRATION).toMatch(/add column if not exists verification_status text;/);
    expect(MIGRATION).toMatch(/add column if not exists verification_source text;/);
    expect(MIGRATION).toMatch(/add column if not exists source_urls text\[\] not null default '\{\}';/);
  });

  it('keeps one row per Google place without indexing the nulls', () => {
    expect(MIGRATION).toMatch(/create unique index if not exists idx_cemeteries_google_place_id on public\.cemeteries \(google_place_id\)\s+where google_place_id is not null;/);
  });

  it('adds every check constraint through a guarded do block, since add constraint has no if not exists', () => {
    expect(MIGRATION).not.toMatch(/add constraint if not exists/);
    const guarded = MIGRATION.match(/if not exists \(\s*select 1 from pg_constraint where conname = '/g) || [];
    expect(guarded.length).toBe(3);
  });

  it('credits OpenStreetMap for the outlines already in the table', () => {
    expect(MIGRATION).toMatch(/update public\.cemeteries set boundary_source = 'osm'\s+where boundary is not null and boundary_source is null;/);
  });
});
