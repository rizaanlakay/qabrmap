import { describe, it, expect } from 'vitest';
import { buildGraveShareUrl, getGraveIdFromUrl, withGraveParam } from '../src/lib/share/graveLink';

describe('Grave Share Deep Link Tests', () => {
  it('builds a share URL pointing at the grave details view', () => {
    expect(buildGraveShareUrl('https://qabrmap.vercel.app', 'grave_8660')).toBe(
      'https://qabrmap.vercel.app/?grave=grave_8660'
    );
  });

  it('encodes grave ids that contain special characters', () => {
    const url = buildGraveShareUrl('http://localhost:3000', 'a b&c');
    expect(getGraveIdFromUrl(url)).toBe('a b&c');
  });

  it('round-trips a UUID grave id', () => {
    const id = '3f2b8c1e-9d4a-4e7b-8f21-0c5d6a7b8e9f';
    expect(getGraveIdFromUrl(buildGraveShareUrl('https://qabrmap.vercel.app', id))).toBe(id);
  });

  it('returns null when the URL has no usable grave param', () => {
    expect(getGraveIdFromUrl('https://qabrmap.vercel.app/#')).toBeNull();
    expect(getGraveIdFromUrl('https://qabrmap.vercel.app/?grave=')).toBeNull();
    expect(getGraveIdFromUrl('https://qabrmap.vercel.app/?grave=%20%20')).toBeNull();
    expect(getGraveIdFromUrl('not a url')).toBeNull();
  });

  it('sets and removes the grave param while keeping other params', () => {
    expect(withGraveParam('https://qabrmap.vercel.app/?ref=x', 'grave_8660')).toBe(
      '/?ref=x&grave=grave_8660'
    );
    expect(withGraveParam('https://qabrmap.vercel.app/?ref=x&grave=grave_8660', null)).toBe('/?ref=x');
    expect(withGraveParam('https://qabrmap.vercel.app/?grave=grave_8660', null)).toBe('/');
  });
});
