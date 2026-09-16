import { describe, it, expect } from 'vitest';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../tools/burial-sites/lib/csv.mjs';
import {
  cemeteryIdFor,
  mergeSupplements,
  osmWayFromUrl,
  placeIdFromUrl,
  rowSourceUrls,
  siteStatusFor,
  siteTypeFor,
  slugify,
} from '../tools/burial-sites/lib/sources.mjs';
import { loadEnvLocal } from '../tools/burial-sites/lib/env.mjs';
import { ANCHOR_LIMITS, displayNameText, haversineMeters, nameTokens, rankCandidates, scoreCandidate } from '../tools/burial-sites/lib/score.mjs';
import { aroundQuery, chooseOutline, elementToRing, ringAreaSquareMeters, wayQuery } from '../tools/burial-sites/lib/overpass.mjs';
import { MATCH_RADIUS_METERS, matchExisting } from '../tools/burial-sites/lib/match.mjs';

const SOURCE = readFileSync(path.resolve(__dirname, '../data/burial-sites/source.csv'), 'utf8');

describe('parseCsv', () => {
  it('reads quoted fields with commas and keeps curly apostrophes', () => {
    const rows = parseCsv('a,b,c\n1,"x, y",z\n"General Public Cemetery, West Street",Mitchell’s,\n');
    expect(rows).toEqual([
      { a: '1', b: 'x, y', c: 'z' },
      { a: 'General Public Cemetery, West Street', b: 'Mitchell’s', c: '' },
    ]);
  });

  it('unescapes doubled quotes and tolerates CRLF', () => {
    expect(parseCsv('a,b\r\n"say ""hi""",2\r\n')).toEqual([{ a: 'say "hi"', b: '2' }]);
  });

  it('reads the real source file: 47 rows, 16 with coordinates', () => {
    const rows = parseCsv(SOURCE);
    expect(rows).toHaveLength(47);
    expect(rows.filter((r) => r.latitude && r.longitude)).toHaveLength(16);
    expect(rows[1].cemetery_name).toBe('Vygiekraal / Johnson Road Muslim Cemetery');
  });
});

describe('sources', () => {
  it('pulls a Google place id out of a Waze link', () => {
    expect(placeIdFromUrl('https://www.waze.com/live-map/directions/za/kzn/berea/al-hilal-muslim-cemetery?to=place.ChIJvQH8ZE8H9x4RgMx8q9BKmyk')).toBe('ChIJvQH8ZE8H9x4RgMx8q9BKmyk');
    expect(placeIdFromUrl('https://mjc.org.za/community/cemeteries/')).toBeNull();
    expect(placeIdFromUrl('')).toBeNull();
  });

  it('pulls an OSM way out of a Mapcarta link', () => {
    expect(osmWayFromUrl('https://mapcarta.com/W227933663')).toBe('way/227933663');
    expect(osmWayFromUrl('https://mapcarta.com/N123')).toBeNull();
  });

  it('maps the seven CSV categories onto the four site types', () => {
    expect(siteTypeFor('Dedicated Muslim cemetery')).toBe('muslim_cemetery');
    expect(siteTypeFor('Historic Muslim cemetery')).toBe('historic_cemetery');
    expect(siteTypeFor('Muslim section in municipal cemetery')).toBe('muslim_section');
    expect(siteTypeFor('Mixed cemetery with Muslim section')).toBe('muslim_section');
    expect(siteTypeFor('Mixed cemetery with Muslim graves/section')).toBe('muslim_section');
    expect(siteTypeFor('Mixed cemetery with Muslim blocks')).toBe('muslim_section');
    expect(siteTypeFor('Muslim burials / community cemetery')).toBe('muslim_section');
    expect(siteTypeFor('Shared Muslim/Hindu cemetery')).toBe('shared_cemetery');
    expect(() => siteTypeFor('Something else')).toThrow(/unknown category/i);
  });

  it('maps the CSV statuses onto active, closed and unknown', () => {
    expect(siteStatusFor('active')).toBe('active');
    expect(siteStatusFor('historic_or_closed')).toBe('closed');
    expect(siteStatusFor('active_or_burial_site')).toBe('unknown');
    expect(siteStatusFor('historic_or_active')).toBe('unknown');
    expect(() => siteStatusFor('')).toThrow(/unknown status/i);
  });

  it('builds stable ids and slugs from names', () => {
    expect(slugify('Mowbray Muslim Cemetery / Gamedia Maqbara')).toBe('mowbray-muslim-cemetery-gamedia-maqbara');
    expect(slugify("Mitchell’s Plain/Khayelitsha Muslim Cemetery (Swartklip)")).toBe('mitchells-plain-khayelitsha-muslim-cemetery-swartklip');
    expect(cemeteryIdFor('Roshnee Muslim Cemetery')).toBe('cem_roshnee-muslim-cemetery');
  });

  it('collects the non-empty source urls of a row', () => {
    expect(rowSourceUrls({ source_url_1: 'https://a', source_url_2: '' })).toEqual(['https://a']);
    expect(rowSourceUrls({ source_url_1: 'https://a', source_url_2: 'https://b' })).toEqual(['https://a', 'https://b']);
  });

  it('fills blank coordinates and appends extra sites from the supplements', () => {
    const rows = [
      { cemetery_name: 'Tana Baru Cemetery', latitude: '', longitude: '' },
      { cemetery_name: 'Other', latitude: '-1', longitude: '2' },
    ];
    const merged = mergeSupplements(rows, {
      coordinates: [{ cemetery_name: 'Tana Baru Cemetery', latitude: -33.918325, longitude: 18.415158, source_url: 'https://h' }],
      extra_sites: [{ cemetery_name: 'Extra', source_url_1: 'https://x' }],
    });
    expect(merged[0]).toMatchObject({ latitude: '-33.918325', longitude: '18.415158', coordinate_source_url: 'https://h' });
    expect(merged[1]).toMatchObject({ latitude: '-1', longitude: '2' });
    expect(merged[2]).toMatchObject({ cemetery_name: 'Extra', from_supplements: true });
  });
});

describe('loadEnvLocal', () => {
  it('parses KEY=VALUE lines, skips comments and does not overwrite set variables', () => {
    const dir = path.resolve(__dirname, '../data/burial-sites');
    const file = path.join(dir, 'env.test.tmp');
    writeFileSync(file, '# comment\nBS_TEST_A=one\nBS_TEST_B="two words"\n\nBS_TEST_C=x=y\n');
    process.env.BS_TEST_A = 'already';
    try {
      const parsed = loadEnvLocal(file);
      expect(parsed).toEqual({ BS_TEST_A: 'one', BS_TEST_B: 'two words', BS_TEST_C: 'x=y' });
      expect(process.env.BS_TEST_A).toBe('already');
      expect(process.env.BS_TEST_B).toBe('two words');
    } finally {
      unlinkSync(file);
      delete process.env.BS_TEST_A;
      delete process.env.BS_TEST_B;
      delete process.env.BS_TEST_C;
    }
  });

  it('returns an empty object when the file is missing', () => {
    expect(loadEnvLocal(path.resolve(__dirname, '../data/burial-sites/does-not-exist'))).toEqual({});
  });
});

describe('score', () => {
  const anchor = { lat: -33.93908, lng: 18.46112 };
  const google = (displayName: string, lat: number, lng: number, types: string[] = ['cemetery']) => ({
    displayName,
    location: { latitude: lat, longitude: lng },
    types,
  });

  it('measures distance with the haversine formula', () => {
    expect(haversineMeters(-33.967, 18.5265, -33.9675, 18.5265)).toBeCloseTo(55.6, 0);
  });

  it('drops filler words from names before comparing', () => {
    expect(nameTokens('Mowbray Muslim Cemetery / Gamedia Maqbara')).toEqual(['mowbray', 'gamedia']);
    expect(nameTokens('Klip Road North Muslim Cemetery')).toEqual(['klip', 'north']);
    expect(nameTokens('Mitchell’s Plain/Khayelitsha Muslim Cemetery (Swartklip)')).toContain('mitchells');
  });

  it('rejects a candidate beyond the anchor limit and scores closer, better-named cemeteries higher', () => {
    expect(ANCHOR_LIMITS).toEqual({ row: 1000, town: 30_000 });
    const far = google('Mowbray Cemetery', -33.95, 18.46112);
    expect(scoreCandidate({ csvName: 'Mowbray Muslim Cemetery', anchor, anchorKind: 'row', candidate: far })).toBeNull();
    const exact = google('Mowbray Muslim Cemetery', -33.93908, 18.46112);
    const vague = google('Mowbray Park', -33.9392, 18.4612, ['park']);
    const exactScore = scoreCandidate({ csvName: 'Mowbray Muslim Cemetery', anchor, anchorKind: 'row', candidate: exact });
    const vagueScore = scoreCandidate({ csvName: 'Mowbray Muslim Cemetery', anchor, anchorKind: 'row', candidate: vague });
    expect(exactScore).toBeGreaterThan(vagueScore as number);
    expect(exactScore).toBeCloseTo(2.5, 5);
  });

  it('ranks candidates best first and keeps at most three', () => {
    const ranked = rankCandidates(
      { cemetery_name: 'Mowbray Muslim Cemetery' },
      anchor,
      'town',
      [
        google('Mowbray Park', -33.9392, 18.4612, ['park']),
        google('Mowbray Muslim Cemetery', -33.93908, 18.46112),
        google('Somewhere', -33.939, 18.461, ['store']),
        google('Another Cemetery', -33.94, 18.462),
        google('Too Far', -34.5, 18.46112),
      ]
    );
    expect(ranked).toHaveLength(3);
    expect(ranked[0].candidate.displayName).toBe('Mowbray Muslim Cemetery');
    expect(ranked[0].distanceMeters).toBeCloseTo(0, 0);
  });

  it('skips a candidate without a location instead of throwing', () => {
    const good = google('Mowbray Muslim Cemetery', -33.93908, 18.46112);
    const broken = { displayName: 'No Location', types: ['cemetery'] } as unknown as ReturnType<typeof google>;
    expect(scoreCandidate({ csvName: 'Mowbray Muslim Cemetery', anchor, anchorKind: 'row', candidate: broken })).toBeNull();
    const ranked = rankCandidates({ cemetery_name: 'Mowbray Muslim Cemetery' }, anchor, 'row', [broken, good]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].candidate.displayName).toBe('Mowbray Muslim Cemetery');
  });

  // Places API (New) really returns displayName as an object; a string fixture hid this and every live row failed
  it('reads the name when Places returns displayName as an object', () => {
    expect(displayNameText({ text: 'Vygiekraal Cemetery', languageCode: 'en' })).toBe('Vygiekraal Cemetery');
    expect(displayNameText('Vygiekraal Cemetery')).toBe('Vygiekraal Cemetery');
    expect(displayNameText(undefined)).toBe('');

    const real = {
      displayName: { text: 'Mowbray Muslim Cemetery', languageCode: 'en' },
      location: { latitude: -33.93908, longitude: 18.46112 },
      types: ['cemetery'],
    };
    const vague = {
      displayName: { text: 'Mowbray Park', languageCode: 'en' },
      location: { latitude: -33.9392, longitude: 18.4612 },
      types: ['park'],
    };
    const score = scoreCandidate({ csvName: 'Mowbray Muslim Cemetery', anchor, anchorKind: 'row', candidate: real });
    expect(score).toBeCloseTo(2.5, 5);
    const ranked = rankCandidates({ cemetery_name: 'Mowbray Muslim Cemetery' }, anchor, 'row', [vague, real]);
    expect(ranked[0].candidate.displayName.text).toBe('Mowbray Muslim Cemetery');
  });
});

describe('overpass', () => {
  it('asks for cemetery ways and relations around a point, with geometry', () => {
    const q = aroundQuery(-33.9, 18.5, 400);
    expect(q).toContain('way["landuse"="cemetery"](around:400,-33.9,18.5)');
    expect(q).toContain('way["amenity"="grave_yard"](around:400,-33.9,18.5)');
    expect(q).toContain('relation["landuse"="cemetery"](around:400,-33.9,18.5)');
    expect(q).toContain('out geom;');
    expect(wayQuery('way/227933663')).toContain('way(227933663);');
  });

  it('turns a way into a closed [lng, lat] ring', () => {
    const ring = elementToRing({
      type: 'way',
      id: 1,
      geometry: [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
        { lat: 1, lon: 1 },
        { lat: 1, lon: 0 },
      ],
    });
    expect(ring).toEqual([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
  });

  it('takes the largest outer ring of a multipolygon relation', () => {
    const small = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.1 }, { lat: 0.1, lon: 0.1 }, { lat: 0, lon: 0 }];
    const big = [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 0, lon: 0 }];
    const ring = elementToRing({
      type: 'relation',
      id: 2,
      members: [
        { type: 'way', role: 'outer', geometry: small },
        { type: 'way', role: 'inner', geometry: big },
        { type: 'way', role: 'outer', geometry: big },
      ],
    });
    expect(ring).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]]);
  });

  it('returns null for an element without usable geometry', () => {
    expect(elementToRing({ type: 'way', id: 3, geometry: [{ lat: 0, lon: 0 }] })).toBeNull();
    expect(elementToRing({ type: 'node', id: 4 })).toBeNull();
  });

  it('measures ring area roughly in square metres', () => {
    // A 100 m by 100 m square near Cape Town
    const dLat = 100 / 111_320;
    const dLng = 100 / (111_320 * Math.cos((-33.9 * Math.PI) / 180));
    const ring: [number, number][] = [[18.5, -33.9], [18.5 + dLng, -33.9], [18.5 + dLng, -33.9 + dLat], [18.5, -33.9 + dLat], [18.5, -33.9]];
    expect(ringAreaSquareMeters(ring)).toBeGreaterThan(9_500);
    expect(ringAreaSquareMeters(ring)).toBeLessThan(10_500);
  });

  it('prefers the named way, then the ring that contains the point, then the nearest', () => {
    const near = { type: 'way', id: 10, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 1, lon: 0 }] };
    const containing = { type: 'way', id: 11, geometry: [{ lat: 2, lon: 2 }, { lat: 2, lon: 4 }, { lat: 4, lon: 4 }, { lat: 4, lon: 2 }] };
    const point = { lat: 3, lng: 3 };
    expect(chooseOutline([near, containing], point)?.osmId).toBe('way/11');
    expect(chooseOutline([near, containing], point)?.containsPoint).toBe(true);
    expect(chooseOutline([near, containing], point, 'way/10')?.osmId).toBe('way/10');
    expect(chooseOutline([near], { lat: 10, lng: 10 })?.osmId).toBe('way/10');
    expect(chooseOutline([near], { lat: 10, lng: 10 })?.containsPoint).toBe(false);
    expect(chooseOutline([], point)).toBeNull();
  });
});

describe('matchExisting', () => {
  const existing = [
    { id: 'cem_athlone', google_place_id: null, origin_lat: -33.96813, origin_lng: 18.52682 },
    { id: 'cem_mowbray', google_place_id: 'ChIJmow', origin_lat: -33.93908, origin_lng: 18.46112 },
  ];

  it('matches by place id first, then by a point within 300 m', () => {
    expect(MATCH_RADIUS_METERS).toBe(300);
    expect(matchExisting(existing, { placeId: 'ChIJmow', lat: 0, lng: 0 })?.id).toBe('cem_mowbray');
    expect(matchExisting(existing, { lat: -33.9685, lng: 18.5270 })?.id).toBe('cem_athlone');
    expect(matchExisting(existing, { lat: -33.99, lng: 18.5270 })).toBeUndefined();
    expect(matchExisting(existing, {})).toBeUndefined();
  });
});
