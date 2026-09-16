import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  STREET_VIEW_ENDPOINT,
  headingToCemetery,
  streetViewThumbnailUrl,
} from '../src/lib/cemeteries/streetView';

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20260916120000_cemetery_street_view.sql'),
  'utf8'
);

describe('headingToCemetery', () => {
  // The camera stands on the road; the heading must turn it towards the burial ground, not along the street
  it('points due north when the cemetery is directly north of the camera', () => {
    expect(headingToCemetery({ lat: -33.94, lng: 18.46 }, { lat: -33.93, lng: 18.46 })).toBeCloseTo(0, 0);
  });

  it('points due east, south and west for the other quarters', () => {
    expect(headingToCemetery({ lat: -33.94, lng: 18.46 }, { lat: -33.94, lng: 18.47 })).toBeCloseTo(90, 0);
    expect(headingToCemetery({ lat: -33.94, lng: 18.46 }, { lat: -33.95, lng: 18.46 })).toBeCloseTo(180, 0);
    expect(headingToCemetery({ lat: -33.94, lng: 18.46 }, { lat: -33.94, lng: 18.45 })).toBeCloseTo(270, 0);
  });

  it('always returns a bearing inside the range the database accepts', () => {
    const camera = { lat: -33.93860108174151, lng: 18.46046642497594 };
    const cemetery = { lat: -33.93908, lng: 18.46112 };
    const heading = headingToCemetery(camera, cemetery);
    expect(heading).toBeGreaterThanOrEqual(0);
    expect(heading).toBeLessThan(360);
    // Camera sits north west of the cemetery, so the view looks south east
    expect(heading).toBeGreaterThan(90);
    expect(heading).toBeLessThan(180);
  });

  it('returns 0 rather than NaN when the camera sits on the cemetery point', () => {
    expect(headingToCemetery({ lat: -33.94, lng: 18.46 }, { lat: -33.94, lng: 18.46 })).toBe(0);
  });
});

describe('streetViewThumbnailUrl', () => {
  const cemetery = { streetViewPanoId: 'abc123', streetViewHeading: 137.5 };

  it('builds a Street View Static request for the stored panorama and heading', () => {
    const url = streetViewThumbnailUrl(cemetery, 'KEY', 160);
    expect(url).toBeTruthy();
    const parsed = new URL(url as string);
    expect(parsed.origin + parsed.pathname).toBe(STREET_VIEW_ENDPOINT);
    expect(parsed.searchParams.get('pano')).toBe('abc123');
    expect(parsed.searchParams.get('heading')).toBe('137.5');
    expect(parsed.searchParams.get('size')).toBe('160x160');
    expect(parsed.searchParams.get('key')).toBe('KEY');
    // A slight downward tilt frames a gate better than the horizon
    expect(parsed.searchParams.get('pitch')).toBe('0');
    expect(parsed.searchParams.get('fov')).toBe('80');
  });

  it('returns null when the site has no panorama, so the card keeps its placeholder', () => {
    expect(streetViewThumbnailUrl({ streetViewHeading: 10 }, 'KEY', 160)).toBeNull();
    expect(streetViewThumbnailUrl({ streetViewPanoId: 'abc123' }, 'KEY', 160)).toBeNull();
  });

  it('returns null without an api key rather than requesting an unauthenticated image', () => {
    expect(streetViewThumbnailUrl(cemetery, '', 160)).toBeNull();
  });
});

describe('Street View migration', () => {
  it('stores only identifiers and our own arithmetic, never the imagery', () => {
    expect(MIGRATION).toMatch(/add column if not exists street_view_pano_id text;/);
    expect(MIGRATION).toMatch(/add column if not exists street_view_heading numeric\(6,2\);/);
    expect(MIGRATION).toMatch(/add column if not exists street_view_captured text;/);
  });

  it('keeps the heading a real bearing', () => {
    expect(MIGRATION).toMatch(/street_view_heading >= 0 and street_view_heading < 360/);
    expect(MIGRATION).not.toMatch(/add constraint if not exists/);
  });
});
