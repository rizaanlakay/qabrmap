// Downloads each Places photo candidate once, at thumbnail size, so a human can approve it on a page.
// These files are working copies for the approval step only: they live in the scratch folder, are
// gitignored, and only an approved image is kept, under the caching window the terms allow.
// Usage: node tools/burial-sites/fetch-candidate-images.mjs <outputDir> [--height 320]

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadEnvLocal } from './lib/env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'data/burial-sites');

const args = process.argv.slice(2);
const OUT_DIR = args.find((a) => !a.startsWith('--'));
const HEIGHT = args.includes('--height') ? Number(args[args.indexOf('--height') + 1]) : 320;
if (!OUT_DIR) {
  console.error('Give an output directory');
  process.exit(1);
}

loadEnvLocal(path.join(ROOT, '.env.local'));
const KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!KEY) {
  console.error('GOOGLE_PLACES_API_KEY is not set in .env.local');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
mkdirSync(OUT_DIR, { recursive: true });

function fileNameFor(photoName) {
  return createHash('sha1').update(photoName).digest('hex').slice(0, 16) + '.jpg';
}

async function main() {
  const sites = JSON.parse(readFileSync(path.join(DATA, 'photo-candidates.json'), 'utf8'));
  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  for (const site of sites) {
    for (const candidate of site.candidates) {
      const file = path.join(OUT_DIR, fileNameFor(candidate.name));
      candidate.file = path.basename(file);
      if (existsSync(file)) {
        skipped++;
        continue;
      }
      const url = `https://places.googleapis.com/v1/${candidate.name}/media?maxHeightPx=${HEIGHT}&key=${KEY}`;
      try {
        const response = await fetch(url, { redirect: 'follow' });
        if (!response.ok) throw new Error('http ' + response.status);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length < 500) throw new Error('response too small to be an image');
        writeFileSync(file, bytes);
        fetched++;
      } catch (problem) {
        failed++;
        candidate.fetchError = problem.message;
        console.error(`${site.name.slice(0, 34).padEnd(36)} ${problem.message}`);
      }
      await sleep(120);
    }
  }
  writeFileSync(path.join(DATA, 'photo-candidates.json'), JSON.stringify(sites, null, 2) + '\n');
  console.log(`fetched ${fetched}, already had ${skipped}, failed ${failed}`);
  console.log(`images in ${OUT_DIR}`);
}

main().catch((problem) => {
  console.error(problem);
  process.exit(1);
});
