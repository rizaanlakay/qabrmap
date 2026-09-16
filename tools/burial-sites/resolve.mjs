// tools/burial-sites/resolve.mjs
// Step 1 of the burial-sites import: turn data/burial-sites/source.csv into a reviewable review.json.
// Google Places gives points and names, Overpass gives outlines. Every response is cached so re-runs are free.
// Usage: node tools/burial-sites/resolve.mjs [--only <key>] [--dry-run]

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadEnvLocal } from './lib/env.mjs';
import { parseCsv } from './lib/csv.mjs';
import { cemeteryIdFor, mergeSupplements, osmWayFromUrl, placeIdFromUrl, rowSourceUrls, siteStatusFor, siteTypeFor, slugify } from './lib/sources.mjs';
import { haversineMeters, rankCandidates } from './lib/score.mjs';
import { aroundManyQuery, aroundQuery, chooseOutline, elementToRing, ringCentroid, wayQuery } from './lib/overpass.mjs';
import { matchExisting } from './lib/match.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'data/burial-sites');
const CACHE = path.join(DATA, 'cache');
const REVIEW = path.join(DATA, 'review.json');
const REPORT = path.join(DATA, 'report.md');
const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.viewport,places.types';
const PLACE_FIELDS = 'id,displayName,formattedAddress,location,viewport,types';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const dryRun = args.includes('--dry-run');
// Overpass can be down or queueing for minutes. This resolves points and names now and leaves outlines for later.
const noOutlines = args.includes('--no-outlines');
// Fetch only the missing outlines, leaving reviewed names and statuses untouched
const outlinesOnly = args.includes('--outlines-only');

loadEnvLocal(path.join(ROOT, '.env.local'));
// A dedicated server key is preferred. The public maps key is accepted as a fallback, but it only works
// once Places API (New) and Geocoding are enabled on the project and its HTTP referrer lock is lifted.
const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
if (!GOOGLE_KEY) {
  console.error('Set GOOGLE_PLACES_API_KEY in .env.local, or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to reuse the maps key');
  process.exit(1);
}

mkdirSync(CACHE, { recursive: true });

// No request may hang: undici only bounds the connect, so a server that accepts and stalls would block the run
const REQUEST_TIMEOUT_MS = 30_000;

async function fetchJsonText(url, init, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { response, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

// Every request is cached by a hash of its url and body, so the review file is regenerated without new calls.
// cacheKey overrides that when the same logical request may go to more than one host, as Overpass mirrors do.
async function cachedJson(name, url, init, validate, cacheKey, timeoutMs) {
  const hash = createHash('sha1').update(cacheKey ?? url + (init?.body || '')).digest('hex').slice(0, 16);
  const file = path.join(CACHE, `${name}-${hash}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  if (dryRun) return null;
  const { response, text } = await fetchJsonText(url, init, timeoutMs);
  if (!response.ok) throw new Error(`${name} ${response.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  if (validate) {
    const problem = validate(data);
    if (problem) throw new Error(problem);
  }
  writeFileSync(file, text);
  return data;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function placeDetails(placeId) {
  const data = await cachedJson('place', `https://places.googleapis.com/v1/places/${placeId}?fields=${PLACE_FIELDS}&regionCode=ZA`, {
    headers: { 'X-Goog-Api-Key': GOOGLE_KEY },
  });
  return data;
}

async function placesSearch(textQuery, anchor, includedType) {
  const body = {
    textQuery,
    regionCode: 'ZA',
    maxResultCount: 5,
    locationBias: { circle: { center: { latitude: anchor.lat, longitude: anchor.lng }, radius: 15_000 } },
  };
  if (includedType) body.includedType = includedType;
  const data = await cachedJson('search', 'https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': FIELD_MASK },
    body: JSON.stringify(body),
  });
  return data?.places || [];
}

async function geocode(address) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=za&key=${GOOGLE_KEY}`;
  const data = await cachedJson('geocode', url, undefined, (data) =>
    data.status === 'OK' || data.status === 'ZERO_RESULTS'
      ? null
      : `Geocoding refused the request: ${data.status}${data.error_message ? ' (' + data.error_message + ')' : ''}`
  );
  const first = data?.results?.[0];
  if (!first) return null;
  return { lat: first.geometry.location.lat, lng: first.geometry.location.lng, formatted: first.formatted_address };
}

// The main Overpass host goes down for hours at a time, so fall through to a mirror before giving up.
// The cache key is the query alone, so a later run reads an outline whichever mirror first answered for it.
// Only worldwide mirrors belong here: a regional one (overpass.osm.ch, Switzerland) answers 200 with zero
// elements outside its extract, which reads as "this cemetery has no outline" instead of as a failure.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
// The mirrors queue requests under load and have answered this query in 39 s, so allow well beyond that
const OVERPASS_TIMEOUT_MS = 90_000;
const deadEndpoints = new Set();

async function overpass(query) {
  const init = {
    method: 'POST',
    // Overpass answers 406 to a request with no User-Agent, so identify the tool as their usage policy asks
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'QabrMap burial-sites import (https://qabrmap.vercel.app)',
      Accept: 'application/json',
    },
    body: `data=${encodeURIComponent(query)}`,
  };
  const validate = (data) => (data.remark ? `Overpass returned a remark: ${data.remark}` : null);
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    // A host that was unreachable once is unreachable for the rest of the run: retrying it per row would
    // spend ten seconds a time waiting on a connection that never opens
    if (deadEndpoints.has(endpoint)) continue;
    try {
      const data = await cachedJson('overpass', endpoint, init, validate, `overpass:${query}`, OVERPASS_TIMEOUT_MS);
      await sleep(1000);
      return data?.elements || [];
    } catch (error) {
      lastError = error;
      const cause = error && error.cause && error.cause.code;
      if (cause === 'UND_ERR_CONNECT_TIMEOUT' || cause === 'ECONNREFUSED' || cause === 'ENOTFOUND' || cause === 'CERT_HAS_EXPIRED') {
        deadEndpoints.add(endpoint);
        console.warn(`  ${endpoint} is unreachable (${cause}); skipping it for the rest of this run`);
      }
    }
  }
  throw new Error(`every Overpass endpoint failed: ${lastError ? lastError.message : 'unknown'}`);
}

async function loadExisting() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  const supabase = createClient(url, key);
  const { data, error } = await supabase.from('cemeteries').select('id, name, google_place_id, origin_lat, origin_lng');
  if (error) throw new Error(`Could not read cemeteries: ${error.message}`);
  return data;
}

function candidateSummary(entry) {
  return {
    placeId: entry.candidate.id,
    displayName: entry.candidate.displayName?.text || '',
    formattedAddress: entry.candidate.formattedAddress || '',
    lat: entry.candidate.location.latitude,
    lng: entry.candidate.location.longitude,
    score: Math.round(entry.score * 100) / 100,
    distanceMeters: Math.round(entry.distanceMeters),
  };
}

async function resolveRow(row, existing, townCentres) {
  const key = slugify(row.cemetery_name);
  const notes = [];
  const entry = {
    key,
    status: 'needs_review',
    existing_id: null,
    id: cemeteryIdFor(row.cemetery_name),
    name: row.cemetery_name,
    aliases: [],
    site_type: siteTypeFor(row.qabrmap_category),
    site_status: siteStatusFor(row.site_status),
    province: row.province,
    city: row.city_or_area,
    address: row.location,
    point: null,
    point_source: 'none',
    google_place_id: null,
    google_candidates: [],
    outline: null,
    verification_status: row.verification_status,
    verification_source: row.verification_source,
    source_urls: rowSourceUrls(row),
    overrides: {},
    notes,
  };
  if (row.from_supplements) notes.push('From the earlier CSV, not the production file: accept or skip.');

  // 1. A point from the row itself, or the supplements
  if (row.latitude && row.longitude) {
    entry.point = { lat: Number(row.latitude), lng: Number(row.longitude) };
    entry.point_source = row.coordinate_source_url ? 'supplement' : 'csv';
  }

  // 2. A place id embedded in a source link goes straight to Place Details
  const embeddedPlaceId = entry.source_urls.map(placeIdFromUrl).find(Boolean);
  if (embeddedPlaceId) {
    const place = await placeDetails(embeddedPlaceId);
    if (place) {
      entry.google_place_id = place.id;
      entry.aliases.push(place.displayName?.text || '');
      entry.google_candidates = [candidateSummary({ candidate: place, score: 3, distanceMeters: 0 })];
      if (!entry.point) {
        entry.point = { lat: place.location.latitude, lng: place.location.longitude };
        entry.point_source = 'place_id';
      }
    }
  }

  // 3. Otherwise search Places around the row's point or the town centre
  if (!entry.google_place_id) {
    let anchor = entry.point;
    let anchorKind = 'row';
    if (!anchor) {
      const town = `${row.city_or_area}, ${row.province}, South Africa`;
      if (!townCentres.has(town)) townCentres.set(town, await geocode(town));
      anchor = townCentres.get(town);
      anchorKind = 'town';
    }
    if (anchor) {
      let places = await placesSearch(`${row.cemetery_name}, ${row.location}`, anchor, 'cemetery');
      if (places.length === 0) places = await placesSearch(`${row.cemetery_name}, ${row.location}`, anchor, null);
      const ranked = rankCandidates(row, anchor, anchorKind, places);
      entry.google_candidates = ranked.map(candidateSummary);
      if (ranked.length > 0) {
        entry.google_place_id = ranked[0].candidate.id;
        entry.aliases.push(ranked[0].candidate.displayName?.text || '');
        if (!entry.point) {
          entry.point = { lat: ranked[0].candidate.location.latitude, lng: ranked[0].candidate.location.longitude };
          entry.point_source = 'places';
        }
      } else {
        notes.push('No Google Places candidate within range.');
      }
    } else {
      notes.push('Town could not be geocoded, so Places was not searched.');
    }
  }

  // 4. Geocode the address as a last resort
  if (!entry.point) {
    const geocoded = await geocode(`${row.location}, South Africa`);
    if (geocoded) {
      entry.point = { lat: geocoded.lat, lng: geocoded.lng };
      entry.point_source = 'geocoded';
      notes.push(`Point is the geocoded address: ${geocoded.formatted}`);
    } else {
      notes.push('No point found: place it by hand in review.json.');
    }
  }

  // 5. Outline from OpenStreetMap
  if (entry.point && noOutlines) {
    notes.push('Outline not looked up: this run used --no-outlines. Re-run without it while the row is still needs_review.');
  } else if (entry.point) {
    const namedWay = entry.source_urls.map(osmWayFromUrl).find(Boolean);
    let elements = await overpass(aroundQuery(entry.point.lat, entry.point.lng, 400));
    if (namedWay && !elements.some((e) => `${e.type}/${e.id}` === namedWay)) {
      elements = elements.concat(await overpass(wayQuery(namedWay)));
    }
    const chosen = chooseOutline(elements, entry.point, namedWay || undefined);
    if (chosen) {
      entry.outline = { osm_id: chosen.osmId, area_square_meters: chosen.areaSquareMeters, contains_point: chosen.containsPoint, ring: chosen.ring };
      if (!chosen.containsPoint) notes.push('Nearest OSM outline does not contain the point: check it.');
      if (chosen.areaSquareMeters > 400_000) notes.push('Outline is over 40 ha; for a Muslim section this is the whole municipal cemetery.');
    } else {
      notes.push('No OSM outline within 400 m: draw one in data/burial-sites/outlines/<id>.geojson.');
    }
  }

  // 6. Existing row
  const match = matchExisting(existing, { placeId: entry.google_place_id, lat: entry.point?.lat, lng: entry.point?.lng });
  if (match) {
    entry.existing_id = match.id;
    entry.id = match.id;
    if (match.name && match.name !== entry.name) entry.aliases.push(match.name);
    notes.push(`Updates live row ${match.id} ("${match.name}").`);
  }

  entry.aliases = [...new Set(entry.aliases.filter((a) => a && a !== entry.name))];
  entry.status = !row.from_supplements && ['csv', 'supplement', 'place_id'].includes(entry.point_source) ? 'auto' : 'needs_review';
  return entry;
}

function failedEntry(row, key, message) {
  return {
    key,
    status: 'needs_review',
    existing_id: null,
    id: cemeteryIdFor(row.cemetery_name),
    name: row.cemetery_name,
    aliases: [],
    site_type: null,
    site_status: null,
    province: row.province || null,
    city: row.city_or_area || null,
    address: row.location || null,
    point: null,
    point_source: 'none',
    google_place_id: null,
    google_candidates: [],
    outline: null,
    verification_status: row.verification_status || null,
    verification_source: row.verification_source || null,
    source_urls: rowSourceUrls(row),
    overrides: {},
    notes: [`Failed: ${message}`],
  };
}

function writeReport(entries, existing) {
  const count = (fn) => entries.filter(fn).length;
  const lines = [
    '# Burial sites resolve report',
    '',
    `Generated ${new Date().toISOString()}`,
    '',
    `| Rows | ${entries.length} |`,
    '|---|---|',
    `| Point from CSV or supplement | ${count((e) => e.point_source === 'csv' || e.point_source === 'supplement')} |`,
    `| Point from a place id | ${count((e) => e.point_source === 'place_id')} |`,
    `| Point from Places search | ${count((e) => e.point_source === 'places')} |`,
    `| Point from geocoding | ${count((e) => e.point_source === 'geocoded')} |`,
    `| No point | ${count((e) => e.point_source === 'none')} |`,
    `| OSM outline found | ${count((e) => e.outline)} |`,
    `| Updates a live row | ${count((e) => e.existing_id)} |`,
    `| Needs review | ${count((e) => e.status === 'needs_review')} |`,
    '',
    '## Rows without a point',
    '',
    ...entries.filter((e) => e.point_source === 'none').map((e) => `- ${e.name} (${e.city})`),
    '',
    '## Rows without an outline',
    '',
    ...entries.filter((e) => e.point && !e.outline).map((e) => `- ${e.id}: ${e.name}`),
    '',
    '## Live rows not in the source data',
    '',
    ...existing.filter((row) => !entries.some((e) => e.existing_id === row.id)).map((row) => `- ${row.id}: ${row.name} (verify it is a real site)`),
    '',
  ];
  writeFileSync(REPORT, lines.join('\n'));
}

// Fill in outlines for entries that already have a point but no outline, whatever their review status.
// Approved entries are otherwise never regenerated, so this is the only way to add outlines after a review.
async function backfillOutlines() {
  if (!existsSync(REVIEW)) {
    console.error('No review.json to backfill: run the resolver first');
    process.exit(1);
  }
  const entries = JSON.parse(readFileSync(REVIEW, 'utf8'));
  const pending = entries.filter((entry) => entry.point && !entry.outline);
  console.log(`${pending.length} of ${entries.length} entries have a point and no outline`);
  if (dryRun) {
    // A dry run never calls out, so every lookup would report "none" whether or not an outline exists
    console.log('Dry run: listing what would be looked up, without calling Overpass');
    for (const entry of pending) console.log(`  would look up ${entry.name}`);
    return;
  }
  const wanted = only ? pending.filter((e) => e.key === only) : pending;
  // One request per batch rather than per site: a loaded mirror charges by the turn, not by the clause
  const BATCH = 14;
  const elementsFor = new Map();
  for (let i = 0; i < wanted.length; i += BATCH) {
    const batch = wanted.slice(i, i + BATCH);
    console.log(`Asking Overpass about ${batch.length} sites (${i + batch.length} of ${wanted.length})`);
    let elements = [];
    try {
      elements = await overpass(aroundManyQuery(batch.map((e) => e.point), 400));
    } catch (error) {
      console.error(`  batch failed: ${error.message}`);
    }
    // Each returned outline belongs to whichever site it contains, or the nearest one within reach
    for (const entry of batch) {
      const near = elements.filter((element) => {
        const ring = elementToRing(element);
        if (!ring) return false;
        const c = ringCentroid(ring);
        return haversineMeters(entry.point.lat, entry.point.lng, c.lat, c.lng) <= 1500;
      });
      elementsFor.set(entry.key, near);
    }
  }

  let found = 0;
  for (const entry of wanted) {
    console.log(`Outline for ${entry.name}`);
    try {
      const namedWay = (entry.source_urls || []).map(osmWayFromUrl).find(Boolean);
      let elements = elementsFor.get(entry.key) || [];
      if (namedWay && !elements.some((e) => `${e.type}/${e.id}` === namedWay)) {
        elements = elements.concat(await overpass(wayQuery(namedWay)));
      }
      const chosen = chooseOutline(elements, entry.point, namedWay || undefined);
      if (chosen) {
        entry.outline = {
          osm_id: chosen.osmId,
          area_square_meters: chosen.areaSquareMeters,
          contains_point: chosen.containsPoint,
          ring: chosen.ring,
        };
        entry.notes = (entry.notes || []).filter((n) => !n.startsWith('Outline not looked up'));
        found++;
        console.log(`  ${chosen.osmId}, ${chosen.areaSquareMeters} m2${chosen.containsPoint ? '' : ', does not contain the point'}`);
      } else {
        console.log('  no outline within 400 m');
      }
    } catch (error) {
      console.error(`  failed: ${error.message}`);
    }
  }
  if (dryRun) {
    console.log(`Dry run: ${found} outlines would be written`);
    return;
  }
  writeFileSync(REVIEW, JSON.stringify(entries, null, 2) + '\n');
  console.log(`Added ${found} outlines to ${REVIEW}`);
}

async function main() {
  if (outlinesOnly) return backfillOutlines();
  const rows = mergeSupplements(
    parseCsv(readFileSync(path.join(DATA, 'source.csv'), 'utf8')),
    JSON.parse(readFileSync(path.join(DATA, 'supplements.json'), 'utf8'))
  );
  const existing = await loadExisting();
  const previous = existsSync(REVIEW) ? JSON.parse(readFileSync(REVIEW, 'utf8')) : [];
  if (only && previous.length === 0) {
    console.error('--only needs an existing review.json: run once without --only first');
    process.exit(1);
  }
  const decided = new Map(previous.filter((e) => e.status === 'approved' || e.status === 'skip').map((e) => [e.key, e]));
  const townCentres = new Map();
  const entries = [];
  for (const row of rows) {
    const key = slugify(row.cemetery_name);
    if (only && key !== only) {
      const kept = previous.find((e) => e.key === key);
      if (kept) entries.push(kept);
      continue;
    }
    // Reviewed decisions are never regenerated
    if (decided.has(key)) {
      entries.push(decided.get(key));
      continue;
    }
    console.log(`Resolving ${row.cemetery_name}`);
    try {
      entries.push(await resolveRow(row, existing, townCentres));
    } catch (error) {
      console.error(`  failed: ${error.message}`);
      entries.push(failedEntry(row, key, error.message));
    }
  }
  if (dryRun) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  writeFileSync(REVIEW, JSON.stringify(entries, null, 2) + '\n');
  writeReport(entries, existing);
  console.log(`Wrote ${entries.length} entries to ${REVIEW} and a summary to ${REPORT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
