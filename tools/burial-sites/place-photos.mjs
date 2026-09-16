// Collects Google Places community photo candidates for every cemetery, for the approval page.
// Only identifiers and attributions are written here: the photo resource name is an identifier, like a
// place id. Nothing is displayed or stored until a human approves it.
// Usage: node tools/burial-sites/place-photos.mjs [--max <n>]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvLocal } from './lib/env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'data/burial-sites');
const OUT = path.join(DATA, 'photo-candidates.json');

const args = process.argv.slice(2);
const MAX_PER_SITE = args.includes('--max') ? Number(args[args.indexOf('--max') + 1]) : 4;

loadEnvLocal(path.join(ROOT, '.env.local'));
const KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!KEY) {
  console.error('GOOGLE_PLACES_API_KEY is not set in .env.local');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function photosFor(placeId) {
  const url = `https://places.googleapis.com/v1/places/${placeId}?fields=photos,displayName&key=${KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.error) throw new Error(`${data.error.status}: ${data.error.message}`);
  return data.photos || [];
}

async function main() {
  const review = JSON.parse(readFileSync(path.join(DATA, 'review.json'), 'utf8'));
  mkdirSync(DATA, { recursive: true });
  const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
  const decided = new Map(previous.filter((e) => e.status && e.status !== 'undecided').map((e) => [e.key, e]));

  const out = [];
  let withPhotos = 0;
  for (const entry of review) {
    if (decided.has(entry.key)) {
      out.push(decided.get(entry.key));
      continue;
    }
    const record = {
      key: entry.key,
      id: entry.id,
      name: entry.name,
      city: entry.city,
      province: entry.province,
      status: 'undecided',
      chosen: null,
      candidates: [],
    };
    if (!entry.google_place_id) {
      record.note = 'No Google place, so no community photos to offer';
      out.push(record);
      continue;
    }
    try {
      const photos = await photosFor(entry.google_place_id);
      record.candidates = photos.slice(0, MAX_PER_SITE).map((photo) => ({
        // The resource name is an identifier and safe to keep; the image itself is fetched on demand
        name: photo.name,
        widthPx: photo.widthPx,
        heightPx: photo.heightPx,
        attribution: (photo.authorAttributions || [])
          .map((a) => a.displayName)
          .filter(Boolean)
          .join(', '),
        attributionUri: (photo.authorAttributions || [])[0]?.uri || '',
      }));
      if (record.candidates.length) withPhotos++;
      console.log(`${entry.name.slice(0, 44).padEnd(46)} ${record.candidates.length} candidate(s)`);
    } catch (problem) {
      record.note = `Lookup failed: ${problem.message}`;
      console.error(`${entry.name.slice(0, 44).padEnd(46)} ${problem.message.slice(0, 60)}`);
    }
    out.push(record);
    await sleep(120);
  }

  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log('');
  console.log(`${withPhotos} of ${review.length} cemeteries have at least one community photo`);
  console.log(`Wrote ${OUT}`);
}

main().catch((problem) => {
  console.error(problem);
  process.exit(1);
});
