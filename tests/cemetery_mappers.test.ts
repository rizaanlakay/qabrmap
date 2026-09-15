import { describe, it, expect } from 'vitest';
import { mapDbCemetery } from '../src/lib/supabase/mappers';

const baseRow = {
  id: 'cem_test',
  name: 'Test Cemetery',
  slug: 'test-cemetery',
  origin_lat: '-33.9',
  origin_lng: '18.5',
};

describe('mapDbCemetery', () => {
  it('defaults the burial-site columns when the migration has not run yet', () => {
    const cemetery = mapDbCemetery(baseRow);
    expect(cemetery.siteType).toBe('muslim_cemetery');
    expect(cemetery.siteStatus).toBe('active');
    expect(cemetery.aliases).toEqual([]);
    expect(cemetery.address).toBeUndefined();
    expect(cemetery.googlePlaceId).toBeUndefined();
    expect(cemetery.boundarySource).toBeUndefined();
    expect(cemetery.osmId).toBeUndefined();
    expect(cemetery.distanceMeters).toBeUndefined();
  });

  it('maps the burial-site columns when present', () => {
    const cemetery = mapDbCemetery({
      ...baseRow,
      site_type: 'muslim_section',
      site_status: 'closed',
      aliases: ['Old Name', 'Google Name'],
      address: '1 Some Road, Town',
      google_place_id: 'ChIJabc',
      boundary_source: 'osm',
      osm_id: 'way/123',
    });
    expect(cemetery.siteType).toBe('muslim_section');
    expect(cemetery.siteStatus).toBe('closed');
    expect(cemetery.aliases).toEqual(['Old Name', 'Google Name']);
    expect(cemetery.address).toBe('1 Some Road, Town');
    expect(cemetery.googlePlaceId).toBe('ChIJabc');
    expect(cemetery.boundarySource).toBe('osm');
    expect(cemetery.osmId).toBe('way/123');
  });
});
