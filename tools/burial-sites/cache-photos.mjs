// Caches the approved community photograph for each cemetery, and refreshes any that have aged out.
//
// Google allows their imagery to be cached temporarily rather than kept, so nothing here is permanent:
// each file records when it was fetched, and --refresh re-fetches anything older than the window below.
// The photo's resource name is an identifier and is kept so the same photograph can be fetched again.
//
// Usage:
//   node tools/burial-sites/cache-photos.mjs <picksFile>   first run, from the approval decisions
//   node tools/burial-sites/cache-photos.mjs --refresh     re-fetch anything past the caching window
//   add --dry-run to either

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadEnvLocal } from './lib/env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PHOTO_BUCKET = 'cemetery-photos';
// Google's terms allow temporary caching only. Refreshing well inside the window keeps us honest.
export const CACHE_DAYS = 30;
const REFRESH_AFTER_DAYS = 25;
const WIDTH_PX = 800;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const refresh = args.includes('--refresh');
const picksFile = args.find((a) => !a.startsWith('--'));

loadEnvLocal(path.join(ROOT, '.env.local'));
const KEY = process.env.GOOGLE_PLACES_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY || !SUPABASE_URL || !SERVICE_KEY) {
  console.error('Need GOOGLE_PLACES_API_KEY, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
if (!refresh && !picksFile) {
  console.error('Give a picks file, or pass --refresh');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureBucket() {
  const { data } = await supabase.storage.listBuckets();
  if ((data || []).some((b) => b.name === PHOTO_BUCKET)) return;
  if (dryRun) {
    console.log(`would create the ${PHOTO_BUCKET} bucket`);
    return;
  }
  const { error } = await supabase.storage.createBucket(PHOTO_BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message)) throw new Error(`Could not create bucket: ${error.message}`);
  console.log(`created the ${PHOTO_BUCKET} bucket`);
}

async function downloadPhoto(photoName) {
  const url = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${WIDTH_PX}&key=${KEY}`;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`photo fetch failed: http ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 500) throw new Error('response too small to be an image');
  return bytes;
}

async function store(cemeteryId, photoName, attribution) {
  const bytes = await downloadPhoto(photoName);
  // A fresh name each time, so a refreshed photo is never served from a stale CDN copy
  const objectPath = `${cemeteryId}/${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(objectPath, bytes, { contentType: 'image/jpeg', upsert: true });
  if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(objectPath);
  const { error: writeError } = await supabase
    .from('cemeteries')
    .update({
      photo_url: data.publicUrl,
      photo_attribution: attribution || null,
      photo_source: 'places',
      photo_reference: photoName,
      photo_fetched_at: new Date().toISOString(),
    })
    .eq('id', cemeteryId);
  if (writeError) throw new Error(`database write failed: ${writeError.message}`);
  return { objectPath, bytes: bytes.length };
}

// Old objects for a cemetery are removed once the new one is recorded, so the bucket does not grow forever
async function pruneOlder(cemeteryId, keepPath) {
  const { data } = await supabase.storage.from(PHOTO_BUCKET).list(cemeteryId);
  const stale = (data || []).map((f) => `${cemeteryId}/${f.name}`).filter((p) => p !== keepPath);
  if (stale.length) await supabase.storage.from(PHOTO_BUCKET).remove(stale);
  return stale.length;
}

async function runFirstPass() {
  const picks = JSON.parse(readFileSync(picksFile, 'utf8'));
  console.log(`${picks.length} approved photographs`);
  let done = 0;
  for (const pick of picks) {
    if (dryRun) {
      console.log(`would cache ${pick.key} by ${pick.attribution || 'uncredited'}`);
      continue;
    }
    try {
      const { objectPath, bytes } = await store(pick.id, pick.photoName, pick.attribution);
      const pruned = await pruneOlder(pick.id, objectPath);
      done++;
      console.log(`${pick.name.slice(0, 40).padEnd(42)} ${(bytes / 1024).toFixed(0)} KB${pruned ? `, removed ${pruned} older` : ''}`);
    } catch (problem) {
      console.error(`${pick.name.slice(0, 40).padEnd(42)} ${problem.message}`);
    }
    await sleep(150);
  }
  console.log(`cached ${done} of ${picks.length}`);
}

async function runRefresh() {
  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 86400000).toISOString();
  const { data, error } = await supabase
    .from('cemeteries')
    .select('id, name, photo_reference, photo_attribution, photo_fetched_at')
    .not('photo_reference', 'is', null)
    .lt('photo_fetched_at', cutoff)
    .order('photo_fetched_at');
  if (error) throw new Error(`Could not read cemeteries: ${error.message}`);
  console.log(`${data.length} cached photographs are older than ${REFRESH_AFTER_DAYS} days`);
  let done = 0;
  for (const row of data) {
    if (dryRun) {
      console.log(`would refresh ${row.id}, last fetched ${row.photo_fetched_at}`);
      continue;
    }
    try {
      const { objectPath } = await store(row.id, row.photo_reference, row.photo_attribution);
      await pruneOlder(row.id, objectPath);
      done++;
      console.log(`refreshed ${row.name}`);
    } catch (problem) {
      console.error(`${row.name}: ${problem.message}`);
    }
    await sleep(150);
  }
  console.log(`refreshed ${done} of ${data.length}`);
}

async function main() {
  await ensureBucket();
  if (refresh) return runRefresh();
  return runFirstPass();
}

main().catch((problem) => {
  console.error(problem);
  process.exit(1);
});
