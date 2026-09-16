// Records a Street View reference for each cemetery so the app can show an entrance thumbnail.
// Only identifiers and our own arithmetic are stored. The imagery is never downloaded: Google's terms
// allow displaying it live, not keeping it, so the app requests each thumbnail from their endpoint.
// The metadata endpoint used here is free.
// Usage: node tools/burial-sites/street-view.mjs [--dry-run]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadEnvLocal } from './lib/env.mjs';
import { haversineMeters } from './lib/score.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dryRun = process.argv.includes('--dry-run');
// Beyond this the camera is looking at something else entirely, so no thumbnail is better than a wrong one
const MAX_CAMERA_DISTANCE_M = 200;

loadEnvLocal(path.join(ROOT, '.env.local'));
// The browser key is referrer locked, so metadata is read with the server key. Enable Street View Static
// on it as well, or set GOOGLE_STREET_VIEW_API_KEY to a key that has it.
const KEY = process.env.GOOGLE_STREET_VIEW_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY || !SUPABASE_URL || !SERVICE_KEY) {
  console.error('Need GOOGLE_PLACES_API_KEY (or GOOGLE_STREET_VIEW_API_KEY), NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

// Bearing from the camera to the cemetery, matching headingToCemetery in src/lib/cemeteries/streetView.ts
function bearing(from, to) {
  if (from.lat === to.lat && from.lng === to.lng) return 0;
  const phi1 = toRad(from.lat);
  const phi2 = toRad(to.lat);
  const dLambda = toRad(to.lng - from.lng);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const deg = toDeg(Math.atan2(y, x)) % 360;
  return Math.round((deg < 0 ? deg + 360 : deg) * 10) / 10;
}

async function metadata(lat, lng) {
  const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&radius=150&source=outdoor&key=${KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(`${data.status}${data.error_message ? ': ' + data.error_message : ''}`);
  }
  return data;
}

async function main() {
  const { data: cemeteries, error } = await supabase
    .from('cemeteries')
    .select('id, name, origin_lat, origin_lng')
    .order('id');
  if (error) throw new Error(`Could not read cemeteries: ${error.message}`);

  let withView = 0;
  let without = 0;
  const writes = [];
  for (const row of cemeteries) {
    const cemetery = { lat: Number(row.origin_lat), lng: Number(row.origin_lng) };
    let found;
    try {
      found = await metadata(cemetery.lat, cemetery.lng);
    } catch (problem) {
      console.error(`${row.id}: ${problem.message}`);
      continue;
    }
    if (found.status !== 'OK' || !found.location) {
      without++;
      console.log(`${row.id}: no imagery`);
      writes.push({ id: row.id, street_view_pano_id: null, street_view_heading: null, street_view_captured: null });
      continue;
    }
    const camera = { lat: found.location.lat, lng: found.location.lng };
    const away = Math.round(haversineMeters(camera.lat, camera.lng, cemetery.lat, cemetery.lng));
    if (away > MAX_CAMERA_DISTANCE_M) {
      without++;
      console.log(`${row.id}: camera is ${away} m away, too far to show the cemetery`);
      writes.push({ id: row.id, street_view_pano_id: null, street_view_heading: null, street_view_captured: null });
      continue;
    }
    const heading = bearing(camera, cemetery);
    withView++;
    console.log(`${row.id}: ${found.pano_id} facing ${heading} degrees, camera ${away} m away, captured ${found.date || 'unknown'}`);
    writes.push({
      id: row.id,
      street_view_pano_id: found.pano_id,
      street_view_heading: heading,
      street_view_captured: found.date || null,
    });
  }

  console.log('');
  console.log(`${withView} cemeteries get a thumbnail, ${without} keep the placeholder`);
  if (dryRun) {
    console.log('Dry run: nothing written');
    return;
  }
  for (const write of writes) {
    const { id, ...fields } = write;
    const { error: writeError } = await supabase.from('cemeteries').update(fields).eq('id', id);
    if (writeError) {
      console.error(`Failed on ${id}: ${writeError.message}`);
      process.exit(1);
    }
  }
  console.log(`Updated ${writes.length} rows`);
}

main().catch((problem) => {
  console.error(problem);
  process.exit(1);
});
