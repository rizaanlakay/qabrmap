import { describe, it, expect } from 'vitest';
import type { Grave } from '../src/types';
import { applyVisitResult, canConfirmVisit, describeVisit, parseVisitResult } from '../src/lib/graves/visits';
import { mapDbGrave } from '../src/lib/supabase/mappers';

const grave: Grave = {
  id: 'grave_1',
  cemeteryId: 'cem_athlone',
  graveNumber: '1402',
  latitude: -33.9675,
  longitude: 18.5033,
  positionAccuracyMeters: 12,
  positionConfidence: 'LOW',
  status: 'LOW_CONFIDENCE',
  photoCount: 1,
  observationCount: 1,
  createdAt: '2026-09-15T00:00:00Z',
  updatedAt: '2026-09-15T00:00:00Z',
};

const answer = {
  latitude: -33.96751,
  longitude: 18.50331,
  position_accuracy_meters: 3.2,
  position_confidence: 'HIGH',
  status: 'MAPPED',
  observation_count: 4,
};

describe('Grave Visit Tests', () => {
  it('reads the record_grave_visit answer', () => {
    expect(parseVisitResult(answer)).toEqual({
      latitude: -33.96751,
      longitude: 18.50331,
      positionAccuracyMeters: 3.2,
      positionConfidence: 'HIGH',
      status: 'MAPPED',
      observationCount: 4,
    });
    expect(parseVisitResult(null)).toBeNull();
    expect(parseVisitResult({ latitude: 'x' })).toBeNull();
  });

  it('applies the new position to the grave without touching anything else', () => {
    const updated = applyVisitResult(grave, parseVisitResult(answer)!);
    expect(updated).toMatchObject({ id: 'grave_1', graveNumber: '1402', latitude: -33.96751, positionAccuracyMeters: 3.2, status: 'MAPPED', observationCount: 4 });
    expect(grave.latitude).toBe(-33.9675);
  });

  it('describes the improved position', () => {
    expect(describeVisit({ ...grave, positionAccuracyMeters: 3.2, observationCount: 4 })).toBe('Thanks. Position now ± 3.2 m from 4 visits.');
    expect(describeVisit({ ...grave, positionAccuracyMeters: 8, observationCount: 1 })).toBe('Thanks. Position now ± 8 m from 1 visit.');
  });

  it('only confirms with a usable fix', () => {
    expect(canConfirmVisit(null)).toBe(false);
    expect(canConfirmVisit({ lat: 1, lng: 1, accuracy: 25 })).toBe(true);
    expect(canConfirmVisit({ lat: 1, lng: 1, accuracy: 25.1 })).toBe(false);
  });

  it('maps the observation count and whole-grave photo from the graves row', () => {
    const mapped = mapDbGrave({
      id: 'g', cemetery_id: 'c', grave_number: '', latitude: 1, longitude: 2,
      grave_photo_url: 'https://x/grave.jpg', observation_count: 3, created_at: 't', updated_at: 't',
    });
    expect(mapped.gravePhotoUrl).toBe('https://x/grave.jpg');
    expect(mapped.observationCount).toBe(3);
  });
});
