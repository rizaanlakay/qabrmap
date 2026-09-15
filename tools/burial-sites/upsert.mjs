// tools/burial-sites/upsert.mjs
// Step 3 of the burial-sites import: write approved review.json entries to the cemeteries table.
// Usage: node tools/burial-sites/upsert.mjs [--dry-run]

import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadEnvLocal } from './lib/env.mjs';
import { slugify } from './lib/sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'data/burial-sites');
const dryRun = process.argv.includes('--dry-run');

loadEnvLocal(path.join(ROOT, '.env.local'));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

// A hand-drawn outline wins over OSM. The file holds a Polygon, or a Feature or FeatureCollection with one.
function manualOutline(id) {
  const file = path.join(DATA, 'outlines', `${id}.geojson`);
  if (!existsSync(file)) return null;
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const geometry = json.type === 'FeatureCollection' ? json.features[0]?.geometry : json.type === 'Feature' ? json.geometry : json;
  if (!geometry || geometry.type !== 'Polygon') throw new Error(`${file} must hold one Polygon`);
  return geometry;
}

function payloadFor(entry, isNew) {
  if (!entry.point) throw new Error(`${entry.key} is approved but has no point`);
  const manual = manualOutline(entry.id);
  const payload = {
    id: entry.id,
    name: entry.name,
    province: entry.province,
    city: entry.city,
    address: entry.address || null,
    origin_lat: entry.point.lat,
    origin_lng: entry.point.lng,
    site_type: entry.site_type,
    site_status: entry.site_status,
    aliases: entry.aliases || [],
    google_place_id: entry.google_place_id || null,
    verification_status: entry.verification_status || null,
    verification_source: entry.verification_source || null,
    source_urls: entry.source_urls || [],
    updated_at: new Date().toISOString(),
    ...(entry.overrides || {}),
  };
  // The row id is never an override: a stray "id" in review.json must not redirect the write
  payload.id = entry.id;
  if (manual) {
    payload.boundary = manual;
    payload.boundary_source = 'manual';
    payload.osm_id = null;
  } else if (entry.outline) {
    payload.boundary = { type: 'Polygon', coordinates: [entry.outline.ring] };
    payload.boundary_source = 'osm';
    payload.osm_id = entry.outline.osm_id;
  }
  // New rows need the columns the table requires; existing rows keep their slug, description and counts
  if (isNew) {
    payload.slug = slugify(entry.name);
    payload.description = '';
    payload.country = 'South Africa';
    payload.denomination = 'Muslim';
  }
  return payload;
}

async function main() {
  const entries = JSON.parse(readFileSync(path.join(DATA, 'review.json'), 'utf8'));
  const approved = entries.filter((e) => e.status === 'approved');
  const { data: existingRows, error } = await supabase.from('cemeteries').select('id, name, boundary_source');
  if (error) throw new Error(`Could not read cemeteries: ${error.message}`);
  const existingIds = new Set(existingRows.map((r) => r.id));

  const summary = [];
  for (const entry of approved) {
    const isNew = !existingIds.has(entry.id);
    const payload = payloadFor(entry, isNew);
    const action = isNew ? 'insert' : 'update';
    const outline = payload.boundary_source || 'none';
    summary.push({ id: entry.id, name: entry.name, action, outline });
    if (dryRun) {
      console.log(`${action} ${entry.id}: ${entry.name} (outline: ${outline})`);
      continue;
    }
    // One row per call: PostgREST needs every object in a batch to carry the same keys, and these differ
    const { error: upsertError } = await supabase.from('cemeteries').upsert(payload, { onConflict: 'id' });
    if (upsertError) {
      console.error(`Failed on ${entry.id}: ${upsertError.message}`);
      console.error(JSON.stringify(payload, null, 2));
      process.exit(1);
    }
    console.log(`${action} ${entry.id}: ${entry.name}`);
  }

  if (dryRun) {
    console.log(`Dry run: ${summary.length} rows would be written.`);
    return;
  }
  const lines = [
    '',
    `## Upsert ${new Date().toISOString()}`,
    '',
    `| Id | Name | Action | Outline |`,
    '|---|---|---|---|',
    ...summary.map((s) => `| ${s.id} | ${s.name} | ${s.action} | ${s.outline} |`),
    '',
    '### Outlines still to draw',
    '',
    ...summary.filter((s) => s.outline === 'none').map((s) => `- ${s.id}: ${s.name}`),
    '',
  ];
  appendFileSync(path.join(DATA, 'report.md'), lines.join('\n'));
  console.log(`Wrote ${summary.length} rows and appended the summary to report.md`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
