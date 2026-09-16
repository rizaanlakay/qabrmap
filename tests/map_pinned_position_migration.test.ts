import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The map pin step was removed from the app (pinning a grave on zoomed-in imagery did not work in the field),
// but this migration is live in production. The function keeps its two optional pin parameters, which the
// app no longer sends, so the values below only need to match the migration itself.
const MAP_PIN_ACCURACY_M = 1.5;
const MAX_PIN_DISTANCE_M = 50;

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20260916150000_map_pinned_position.sql'),
  'utf8'
);

describe('Map Pinned Position Migration Tests', () => {
  it('stores the pin on the photo next to the GPS fix and allows map observations', () => {
    expect(MIGRATION).toMatch(/alter table public\.grave_photos add column if not exists pin_latitude double precision;/);
    expect(MIGRATION).toMatch(/alter table public\.grave_photos add column if not exists pin_longitude double precision;/);
    expect(MIGRATION).toMatch(/drop constraint if exists grave_position_observations_source_check;/);
    expect(MIGRATION).toMatch(/check \(source in \('photo', 'visit', 'map'\)\)/);
  });

  it('uses one pin accuracy and distance limit throughout', () => {
    const pinAccuracy = MIGRATION.match(/v_pin_accuracy constant double precision := [\d.]+;/g) ?? [];
    expect(pinAccuracy).toHaveLength(2);
    for (const line of pinAccuracy) expect(line).toContain(`:= ${MAP_PIN_ACCURACY_M};`);
    expect(MIGRATION).toMatch(
      new RegExp(`distance_meters\\(p_pin_latitude, p_pin_longitude, p_latitude, p_longitude\\) > ${MAX_PIN_DISTANCE_M} then`)
    );
    // The weighting floor is the pin accuracy squared
    expect(MIGRATION).toMatch(new RegExp(`case when source = 'map' then ${MAP_PIN_ACCURACY_M ** 2} else 9 end`));
  });

  it('records the pin as the photo observation when there is one, else the GPS fix', () => {
    expect(MIGRATION).toMatch(/create or replace function public\.record_photo_observation\(\)/);
    expect(MIGRATION).toMatch(/if new\.pin_latitude is not null and new\.pin_longitude is not null then/);
    expect(MIGRATION).toMatch(/v_source := 'map';/);
    expect(MIGRATION).toMatch(/v_source := 'photo';/);
    expect(MIGRATION).toMatch(/> 30 \+ v_accuracy then/);
  });

  it('replaces save_or_add_grave with two optional pin parameters', () => {
    expect(MIGRATION).toMatch(
      /drop function if exists public\.save_or_add_grave\(\s*text, text, text, text, text, text, text, text, date, date,\s*double precision, double precision, double precision, double precision, timestamptz, text, text, text, text\s*\);/
    );
    expect(MIGRATION).toMatch(
      /p_add_to_grave_id text default null,\s*p_pin_latitude double precision default null,\s*p_pin_longitude double precision default null\s*\)/
    );
    expect(MIGRATION).toMatch(/raise exception 'The map pin is not valid\.'/);
    expect(MIGRATION).toMatch(/raise exception 'The map pin is too far from your GPS position\.'/);
    // Matching still searches around the phone's fix
    expect(MIGRATION).toMatch(/p_cemetery_id, p_latitude, p_longitude, p_accuracy_meters,\s*v_first_name, v_surname/);
    // The grave is created at the pin with the pin accuracy
    expect(MIGRATION).toMatch(/v_grave_lat := p_pin_latitude;/);
    expect(MIGRATION).toMatch(/v_grave_accuracy := v_pin_accuracy;/);
    expect(MIGRATION).toMatch(/when v_grave_accuracy <= 3\.5 then 'HIGH'/);
    expect(MIGRATION).toMatch(/case when v_grave_accuracy <= 5 then 'MAPPED' else 'LOW_CONFIDENCE' end/);
    // Both photo inserts carry the pin
    expect(MIGRATION.match(/pin_latitude, pin_longitude\s*\)\s*values/g)).toHaveLength(2);
    expect(MIGRATION).toMatch(
      /grant execute on function public\.save_or_add_grave\([^)]*double precision, double precision\) to authenticated;/
    );
  });
});
