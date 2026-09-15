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
