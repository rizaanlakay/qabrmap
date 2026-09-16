// Official Google Map Tiles API for QabrMap's MapLibre maps.
// Tiles load through a gmaptiles:// protocol that creates and caches a Map Tiles session (valid about two
// weeks) before fetching tile.googleapis.com. This replaces the unofficial mt*.google.com tile URLs.

import type { AddProtocolAction, StyleSpecification } from 'maplibre-gl';

export type GoogleMapType = 'satellite' | 'roadmap';

export interface TileSession {
  session: string;
  expiryMs: number;
  tileWidth: number;
}

export interface MapLocale {
  language: string;
  region: string;
}

export interface ViewportBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export const GOOGLE_TILES_PROTOCOL = 'gmaptiles';
export const MISSING_KEY_MESSAGE = 'Google Maps API key missing: set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY';
// Replace a session a day before Google's roughly two-week expiry so a long visit never hits a dead one
export const SESSION_REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;
// A session Google rejects is only replaced once it is this old, so a bad key can't loop creating sessions
export const MIN_SESSION_AGE_BEFORE_RETRY_MS = 60 * 1000;
// After Google refuses to create a session, fail fast for this long instead of asking again for every tile
export const SESSION_FAILURE_COOLDOWN_MS = 30 * 1000;

const TILE_API = 'https://tile.googleapis.com';
const SESSION_STORAGE_PREFIX = 'qabrmap_gmaps_tile_session_';
const SESSION_FAILED_PREFIX = 'Google Map Tiles session failed';
// Statuses worth one retry with a fresh session, since an expired session is rejected rather than 404ed
const SESSION_REJECTED_STATUSES = new Set([400, 401, 403]);

export function getGoogleMapsApiKey(): string | undefined {
  // Referenced in full so Next.js inlines it into the client bundle
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || undefined;
}

// True for failures that stop every tile loading (missing key, API disabled, key restrictions), not one bad tile
export function isImageryUnavailableError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === MISSING_KEY_MESSAGE || error.message.startsWith(SESSION_FAILED_PREFIX))
  );
}

export function localeFromLanguageTag(tag: string | undefined): MapLocale {
  if (!tag) return { language: 'en-US', region: 'US' };
  const region = tag
    .split('-')
    .slice(1)
    .find((part) => /^[A-Za-z]{2}$/.test(part));
  return { language: tag, region: region ? region.toUpperCase() : 'US' };
}

// Google's imagery over Cape Town cemeteries is about 7 cm per pixel, and the deepest tiles it serves are
// zoom 22. Requesting them at twice the pixel size keeps that detail sharp on phone screens; a plain 256 px
// tile stretched three-fold on a modern phone is what made kerbs and headstones blur into one another.
export const TILE_SCALE = 'scaleFactor2x';
export const MAX_TILE_ZOOM = 22;

export function buildSessionRequest(mapType: GoogleMapType, locale: MapLocale) {
  return {
    mapType,
    language: locale.language,
    region: locale.region,
    scale: TILE_SCALE,
    highDpi: true,
    // Road names and places drawn over the imagery, like the hybrid tiles the app showed before
    ...(mapType === 'satellite' ? { layerTypes: ['layerRoadmap'], overlay: false } : {}),
  };
}

export function parseSessionResponse(json: unknown): TileSession | null {
  if (!json || typeof json !== 'object') return null;
  const { session, expiry, tileWidth } = json as { session?: unknown; expiry?: unknown; tileWidth?: unknown };
  const expirySeconds = Number(expiry);
  if (typeof session !== 'string' || !session || !Number.isFinite(expirySeconds)) return null;
  return { session, expiryMs: expirySeconds * 1000, tileWidth: Number(tileWidth) || 256 };
}

export function isSessionUsable(session: TileSession | null | undefined, now: number): session is TileSession {
  return !!session && !!session.session && session.expiryMs - now > SESSION_REFRESH_MARGIN_MS;
}

export function parseProtocolTileUrl(url: string): { mapType: GoogleMapType; z: number; x: number; y: number } | null {
  const match = new RegExp(`^${GOOGLE_TILES_PROTOCOL}://(satellite|roadmap)/(\\d+)/(\\d+)/(\\d+)$`).exec(url);
  if (!match) return null;
  return { mapType: match[1] as GoogleMapType, z: Number(match[2]), x: Number(match[3]), y: Number(match[4]) };
}

export function googleTileUrl(session: string, apiKey: string, z: number, x: number, y: number): string {
  return `${TILE_API}/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(apiKey)}`;
}

const normalizeLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;
const clampLat = (lat: number) => Math.max(-90, Math.min(90, lat));

// The pitched driving camera can report bounds past the poles or antimeridian, which the API rejects
export function buildViewportUrl(session: string, apiKey: string, bounds: ViewportBounds, zoom: number): string {
  const params = new URLSearchParams({
    session,
    key: apiKey,
    zoom: String(Math.max(0, Math.min(22, Math.round(zoom)))),
    north: String(clampLat(bounds.north)),
    south: String(clampLat(bounds.south)),
    east: String(normalizeLng(bounds.east)),
    west: String(normalizeLng(bounds.west)),
  });
  return `${TILE_API}/tile/v1/viewport?${params.toString()}`;
}

export function googleRasterStyle(mapType: GoogleMapType): StyleSpecification {
  return {
    version: 8,
    sources: {
      'google-tiles': {
        type: 'raster',
        tiles: [`${GOOGLE_TILES_PROTOCOL}://${mapType}/{z}/{x}/{y}`],
        // Each tile is 512 px but covers 256 CSS px, so every screen pixel gets its own imagery pixel
        tileSize: 256,
        maxzoom: MAX_TILE_ZOOM,
      },
    },
    layers: [{ id: 'google-tiles-layer', type: 'raster', source: 'google-tiles', minzoom: 0, maxzoom: MAX_TILE_ZOOM }],
  };
}

// --- Session cache: in memory for this page, in localStorage across visits ---

const sessions = new Map<string, TileSession>();
const pendingSessions = new Map<string, Promise<TileSession>>();
const sessionCreatedAt = new Map<string, number>();
const sessionFailures = new Map<string, { error: Error; until: number }>();

function currentLocale(): MapLocale {
  return localeFromLanguageTag(typeof navigator !== 'undefined' ? navigator.language : undefined);
}

// The scale is part of the key, so a session created for plain tiles is never reused for high-DPI ones
const cacheKey = (mapType: GoogleMapType, locale: MapLocale) =>
  `${mapType}_${TILE_SCALE}_${locale.language}_${locale.region}`;

function readStoredSession(key: string): TileSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(SESSION_STORAGE_PREFIX + key);
    if (!stored) return null;
    const { session, expiryMs, tileWidth } = JSON.parse(stored) as Partial<TileSession>;
    if (typeof session !== 'string' || typeof expiryMs !== 'number') return null;
    return { session, expiryMs, tileWidth: Number(tileWidth) || 256 };
  } catch {
    return null;
  }
}

function storeSession(key: string, session: TileSession | null) {
  if (typeof window === 'undefined') return;
  try {
    if (session) window.localStorage.setItem(SESSION_STORAGE_PREFIX + key, JSON.stringify(session));
    else window.localStorage.removeItem(SESSION_STORAGE_PREFIX + key);
  } catch {
    // Storage blocked: the session still lives in memory for this page
  }
}

async function createSession(mapType: GoogleMapType, locale: MapLocale): Promise<TileSession> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) throw new Error(MISSING_KEY_MESSAGE);

  const response = await fetch(`${TILE_API}/v1/createSession?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSessionRequest(mapType, locale)),
  });
  const json: unknown = await response.json().catch(() => null);
  const session = response.ok ? parseSessionResponse(json) : null;
  if (!session) {
    const message = (json as { error?: { message?: string } } | null)?.error?.message ?? 'unexpected response';
    throw new Error(`${SESSION_FAILED_PREFIX} (${response.status}): ${message}`);
  }
  return session;
}

export async function getTileSession(mapType: GoogleMapType): Promise<TileSession> {
  const locale = currentLocale();
  const key = cacheKey(mapType, locale);

  const known = sessions.get(key) ?? readStoredSession(key);
  if (isSessionUsable(known, Date.now())) {
    sessions.set(key, known);
    return known;
  }

  const failure = sessionFailures.get(key);
  if (failure && failure.until > Date.now()) throw failure.error;

  // Tiles load in parallel; make sure they share one createSession call
  const pending = pendingSessions.get(key);
  if (pending) return pending;

  const request = createSession(mapType, locale)
    .then((session) => {
      sessions.set(key, session);
      sessionCreatedAt.set(key, Date.now());
      sessionFailures.delete(key);
      storeSession(key, session);
      return session;
    })
    .catch((error: Error) => {
      sessionFailures.set(key, { error, until: Date.now() + SESSION_FAILURE_COOLDOWN_MS });
      throw error;
    })
    .finally(() => pendingSessions.delete(key));
  pendingSessions.set(key, request);
  return request;
}

// Returns whether a retry is worthwhile: true when the rejected session is gone or already replaced
export function discardTileSession(mapType: GoogleMapType, rejectedSession: string): boolean {
  const key = cacheKey(mapType, currentLocale());
  const current = sessions.get(key) ?? readStoredSession(key);
  if (!current || current.session !== rejectedSession) return true;
  if (Date.now() - (sessionCreatedAt.get(key) ?? 0) < MIN_SESSION_AGE_BEFORE_RETRY_MS) return false;
  sessions.delete(key);
  storeSession(key, null);
  return true;
}

const loadGoogleTile: AddProtocolAction = async (params, abortController) => {
  const tile = parseProtocolTileUrl(params.url);
  if (!tile) throw new Error(`Unrecognised Google tile URL: ${params.url}`);
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) throw new Error(MISSING_KEY_MESSAGE);

  const requestTile = (session: string) =>
    fetch(googleTileUrl(session, apiKey, tile.z, tile.x, tile.y), { signal: abortController.signal });

  let { session } = await getTileSession(tile.mapType);
  let response = await requestTile(session);
  if (SESSION_REJECTED_STATUSES.has(response.status) && discardTileSession(tile.mapType, session)) {
    ({ session } = await getTileSession(tile.mapType));
    response = await requestTile(session);
  }
  if (!response.ok) throw new Error(`Google tile ${tile.z}/${tile.x}/${tile.y} failed (${response.status})`);

  return {
    data: await response.arrayBuffer(),
    // Passed through so MapLibre honours Google's cache headers, as the Map Tiles policies require
    cacheControl: response.headers.get('Cache-Control'),
    expires: response.headers.get('Expires'),
  };
};

// Sessions saved before the scale was part of the key would serve plain tiles for another two weeks
export function discardStaleTileSessions(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>) {
  const stale: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith(SESSION_STORAGE_PREFIX) && !key.includes(`_${TILE_SCALE}_`)) stale.push(key);
  }
  for (const key of stale) storage.removeItem(key);
}

let protocolRegistered = false;

export function registerGoogleTilesProtocol(maplibregl: {
  addProtocol: (protocol: string, loadFn: AddProtocolAction) => void;
}) {
  if (protocolRegistered) return;
  try {
    if (typeof window !== 'undefined') discardStaleTileSessions(window.localStorage);
  } catch {
    // Storage blocked: nothing stale to clear
  }
  maplibregl.addProtocol(GOOGLE_TILES_PROTOCOL, loadGoogleTile);
  protocolRegistered = true;
}

// Copyright text for the tiles in view; Google requires showing it in full next to the map
export async function fetchViewportCopyright(
  mapType: GoogleMapType,
  bounds: ViewportBounds,
  zoom: number,
  signal?: AbortSignal
): Promise<string> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) throw new Error(MISSING_KEY_MESSAGE);
  const { session } = await getTileSession(mapType);
  const response = await fetch(buildViewportUrl(session, apiKey, bounds, zoom), { signal });
  if (!response.ok) throw new Error(`Google viewport attribution failed (${response.status})`);
  const json = (await response.json()) as { copyright?: unknown };
  return typeof json.copyright === 'string' ? json.copyright : '';
}
