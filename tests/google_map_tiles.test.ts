import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

type TilesModule = typeof import('../src/lib/map/googleMapTiles');
type LoadFn = (params: { url: string }, abortController: AbortController) => Promise<any>;

const NOW = Date.UTC(2026, 8, 14, 12);
const DAY = 24 * 60 * 60 * 1000;

// Fresh module per test so the session cache and protocol registration start empty
async function loadModule(): Promise<TilesModule> {
  vi.resetModules();
  return import('../src/lib/map/googleMapTiles');
}

async function registerLoader(tiles: TilesModule): Promise<LoadFn> {
  let loadFn: LoadFn | undefined;
  tiles.registerGoogleTilesProtocol({
    addProtocol: (_protocol, fn) => {
      loadFn = fn as unknown as LoadFn;
    },
  });
  return loadFn!;
}

const sessionResponse = (session: string) =>
  new Response(
    JSON.stringify({ session, expiry: String(Math.floor((NOW + 14 * DAY) / 1000)), tileWidth: 256, tileHeight: 256 }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
const tileResponse = () =>
  new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Cache-Control': 'private, max-age=3600' } });

describe('Google Map Tiles Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-key');
    vi.stubGlobal('navigator', { language: 'en-ZA' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('derives the session language and region from the browser locale', async () => {
    const tiles = await loadModule();
    expect(tiles.localeFromLanguageTag('en-ZA')).toEqual({ language: 'en-ZA', region: 'ZA' });
    expect(tiles.localeFromLanguageTag('zh-Hant-TW')).toEqual({ language: 'zh-Hant-TW', region: 'TW' });
    expect(tiles.localeFromLanguageTag('ar')).toEqual({ language: 'ar', region: 'US' });
    expect(tiles.localeFromLanguageTag(undefined)).toEqual({ language: 'en-US', region: 'US' });
  });

  it('requests labelled satellite imagery and a plain roadmap', async () => {
    const tiles = await loadModule();
    const locale = { language: 'en-ZA', region: 'ZA' };
    expect(tiles.buildSessionRequest('satellite', locale)).toEqual({
      mapType: 'satellite',
      language: 'en-ZA',
      region: 'ZA',
      scale: 'scaleFactor2x',
      highDpi: true,
      layerTypes: ['layerRoadmap'],
      overlay: false,
    });
    expect(tiles.buildSessionRequest('roadmap', locale)).toEqual({
      mapType: 'roadmap',
      language: 'en-ZA',
      region: 'ZA',
      scale: 'scaleFactor2x',
      highDpi: true,
    });
  });

  it('clears sessions saved for plain tiles when the protocol is registered', async () => {
    const tiles = await loadModule();
    const items = new Map<string, string>([
      ['qabrmap_gmaps_tile_session_satellite_en-ZA_ZA', '{"session":"old"}'],
      ['qabrmap_gmaps_tile_session_roadmap_en-ZA_ZA', '{"session":"old"}'],
      ['qabrmap_gmaps_tile_session_satellite_scaleFactor2x_en-ZA_ZA', '{"session":"new"}'],
      ['qabrmap_other', 'keep'],
    ]);
    const storage = {
      get length() {
        return items.size;
      },
      key: (i: number) => Array.from(items.keys())[i] ?? null,
      removeItem: (key: string) => void items.delete(key),
    };
    vi.stubGlobal('window', { localStorage: storage });
    await registerLoader(tiles);
    expect(Array.from(items.keys())).toEqual(['qabrmap_gmaps_tile_session_satellite_scaleFactor2x_en-ZA_ZA', 'qabrmap_other']);
  });

  it('requests tiles no deeper than zoom 21 and enlarges them for the last map zoom level', async () => {
    const tiles = await loadModule();
    const style = tiles.googleRasterStyle('satellite');
    const source = style.sources['google-tiles'] as { tileSize: number; maxzoom: number };
    expect(source.tileSize).toBe(256);
    expect(source.maxzoom).toBe(21);
    expect(style.layers[0]).toMatchObject({ maxzoom: 22 });
    expect(tiles.MAX_MAP_ZOOM).toBe(22);
  });

  it('parses sessions and treats nearly expired ones as unusable', async () => {
    const tiles = await loadModule();
    const session = tiles.parseSessionResponse({ session: 'abc', expiry: '1790000000', tileWidth: 256 });
    expect(session).toEqual({ session: 'abc', expiryMs: 1790000000 * 1000, tileWidth: 256 });
    expect(tiles.parseSessionResponse({ error: { message: 'bad key' } })).toBeNull();

    expect(tiles.isSessionUsable({ session: 'abc', expiryMs: NOW + 3 * DAY, tileWidth: 256 }, NOW)).toBe(true);
    expect(tiles.isSessionUsable({ session: 'abc', expiryMs: NOW + DAY - 1, tileWidth: 256 }, NOW)).toBe(false);
    expect(tiles.isSessionUsable(null, NOW)).toBe(false);
  });

  it('builds tile, protocol and viewport URLs', async () => {
    const tiles = await loadModule();
    expect(tiles.parseProtocolTileUrl('gmaptiles://satellite/18/144545/157397')).toEqual({
      mapType: 'satellite',
      z: 18,
      x: 144545,
      y: 157397,
    });
    expect(tiles.parseProtocolTileUrl('https://mt0.google.com/vt/lyrs=y&x=1&y=2&z=3')).toBeNull();
    expect(tiles.googleTileUrl('s/1', 'k&2', 3, 4, 5)).toBe(
      'https://tile.googleapis.com/v1/2dtiles/3/4/5?session=s%2F1&key=k%262'
    );

    const viewport = new URL(tiles.buildViewportUrl('s1', 'k1', { north: 95, south: -33.97, east: 190, west: 18.49 }, 17.6));
    expect(viewport.pathname).toBe('/tile/v1/viewport');
    expect(viewport.searchParams.get('zoom')).toBe('18');
    expect(viewport.searchParams.get('north')).toBe('90');
    expect(Number(viewport.searchParams.get('east'))).toBeCloseTo(-170);
    expect(Number(viewport.searchParams.get('west'))).toBeCloseTo(18.49);
  });

  it('shares one session across parallel tile loads and passes cache headers through', async () => {
    const tiles = await loadModule();
    const fetchMock = vi.fn(async (url: string) => (url.includes('createSession') ? sessionResponse('s1') : tileResponse()));
    vi.stubGlobal('fetch', fetchMock);
    const load = await registerLoader(tiles);

    const [first, second] = await Promise.all([
      load({ url: 'gmaptiles://satellite/18/1/2' }, new AbortController()),
      load({ url: 'gmaptiles://satellite/18/1/3' }, new AbortController()),
    ]);

    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls.filter((url) => url.includes('createSession'))).toHaveLength(1);
    expect(urls).toContain('https://tile.googleapis.com/v1/2dtiles/18/1/2?session=s1&key=test-key');
    expect(new Uint8Array(first.data)).toEqual(new Uint8Array([1, 2, 3]));
    expect(second.cacheControl).toBe('private, max-age=3600');
  });

  it('replaces a session Google rejects and retries the tile once', async () => {
    const tiles = await loadModule();
    let sessionCount = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('createSession')) return sessionResponse(`s${++sessionCount}`);
      return url.includes('session=s1') && sessionCount === 1 && Date.now() > NOW
        ? new Response('{"error":{"message":"session expired"}}', { status: 401 })
        : tileResponse();
    });
    vi.stubGlobal('fetch', fetchMock);
    const load = await registerLoader(tiles);

    await load({ url: 'gmaptiles://roadmap/16/1/1' }, new AbortController());
    vi.setSystemTime(NOW + 2 * 60 * 1000);
    const result = await load({ url: 'gmaptiles://roadmap/16/1/2' }, new AbortController());

    expect(sessionCount).toBe(2);
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('does not keep creating sessions when a brand new one is rejected', async () => {
    const tiles = await loadModule();
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('createSession') ? sessionResponse('s1') : new Response('{}', { status: 403 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const load = await registerLoader(tiles);

    await expect(load({ url: 'gmaptiles://satellite/18/1/2' }, new AbortController())).rejects.toThrow('403');
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('createSession'))).toHaveLength(1);
  });

  it('stops asking Google for sessions for a while after one is refused', async () => {
    const tiles = await loadModule();
    const fetchMock = vi.fn(
      async () =>
        new Response('{"error":{"message":"Map Tiles API has not been used in project 1 before or it is disabled."}}', {
          status: 403,
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const load = await registerLoader(tiles);

    await expect(load({ url: 'gmaptiles://satellite/18/1/2' }, new AbortController())).rejects.toThrow('disabled');
    await expect(load({ url: 'gmaptiles://satellite/18/1/3' }, new AbortController())).rejects.toThrow('disabled');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW + tiles.SESSION_FAILURE_COOLDOWN_MS + 1);
    await expect(load({ url: 'gmaptiles://satellite/18/1/4' }, new AbortController())).rejects.toThrow('disabled');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recognises errors that mean no imagery can load at all', async () => {
    const tiles = await loadModule();
    expect(tiles.isImageryUnavailableError(new Error(tiles.MISSING_KEY_MESSAGE))).toBe(true);
    expect(tiles.isImageryUnavailableError(new Error('Google Map Tiles session failed (403): disabled'))).toBe(true);
    expect(tiles.isImageryUnavailableError(new Error('Google tile 18/1/2 failed (500)'))).toBe(false);
    expect(tiles.isImageryUnavailableError('not an error')).toBe(false);
  });

  it('refuses to load tiles without an API key', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', '');
    const tiles = await loadModule();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const load = await registerLoader(tiles);

    await expect(load({ url: 'gmaptiles://satellite/18/1/2' }, new AbortController())).rejects.toThrow(
      tiles.MISSING_KEY_MESSAGE
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves no screen on the unofficial mt*.google.com tile URLs', () => {
    const srcDir = path.resolve(__dirname, '../src');
    const offenders = (readdirSync(srcDir, { recursive: true }) as string[])
      .filter((file) => /\.(tsx?|jsx?)$/.test(file))
      .filter((file) => /mt[0-3]?\.google\.com\/vt/.test(readFileSync(path.join(srcDir, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
