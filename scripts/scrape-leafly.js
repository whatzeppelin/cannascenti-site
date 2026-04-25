/**
 * scripts/scrape-leafly.js
 *
 * Scrapes Leafly's public internal API for comprehensive strain data.
 * Uses only factual/scientific data (name, genetics, terpenes, THC%, effects) —
 * NOT Leafly's written descriptions, which are their copyrightable content.
 *
 * Run:  node scripts/scrape-leafly.js
 * Output: strains-leafly-raw.json  (raw API data)
 *
 * Then run: node scripts/build-strains-db.js
 * To merge into the final strains.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUTPUT_FILE = path.join(ROOT, 'strains-leafly-raw.json');
const PAGE_SIZE = 100;
const DELAY_MS = 600; // be respectful — don't hammer their server

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://www.leafly.com',
  'Referer': 'https://www.leafly.com/strains',
};

async function fetchPage(page) {
  const params = new URLSearchParams({
    ranked_only: 'true',
    page: String(page),
    take: String(PAGE_SIZE),
  });

  const url = `https://consumer-api.leafly.com/api/strain_playlists/v2?${params}`;

  const res = await fetch(url, { headers: HEADERS });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on page ${page}: ${await res.text()}`);
  }

  return res.json();
}

function normalizeStrain(raw) {
  // Pull only factual/scientific data — no Leafly editorial descriptions
  const thc = raw.cannabinoids?.thc;
  const cbd = raw.cannabinoids?.cbd;

  return {
    // Identity
    name: raw.name,
    slug: raw.slug,
    leaflyUrl: `https://www.leafly.com/strains/${raw.slug}`,

    // Type
    category: raw.category || 'hybrid',           // indica / sativa / hybrid
    subcategory: raw.subcategory || null,          // indica-dominant, etc.

    // Cannabinoids (factual lab data)
    thc_p50: thc?.percentile50 ?? null,           // median THC%
    thc_p25: thc?.percentile25 ?? null,           // low end
    thc_p75: thc?.percentile75 ?? null,           // high end
    cbd_p50: cbd?.percentile50 ?? null,

    // Terpenes (ordered by dominance)
    terpenes: (raw.terpenes || [])
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .map(t => t.name)
      .filter(Boolean),

    topTerpene: raw.most_common_terpene || null,

    // Effects & flavors (community-reported, factual aggregations)
    effects: raw.top_effects || [],
    flavors: (raw.flavors || []).map(f => typeof f === 'string' ? f : f.name).filter(Boolean),

    // Genetics / lineage
    parents: (raw.strain_playlist_details?.parents || []).map(p => p.name || p).filter(Boolean),
    children: (raw.strain_playlist_details?.children || []).map(c => c.name || c).filter(Boolean),

    // Community data
    avgRating: raw.strain_reviews?.averageStarRating ?? null,
    reviewCount: raw.strain_reviews?.count ?? 0,

    // Photo
    photoUrl: raw.strain_thumbnail || null,
  };
}

async function scrape() {
  // Resume from existing file if present
  let existing = [];
  let startPage = 0;
  if (fs.existsSync(OUTPUT_FILE)) {
    existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    startPage = Math.floor(existing.length / PAGE_SIZE);
    console.log(`Resuming from page ${startPage} (${existing.length} strains already saved)`);
  }

  let allStrains = [...existing];
  let totalCount = Infinity;
  let page = startPage;
  let consecutiveErrors = 0;

  while (allStrains.length < totalCount) {
    process.stdout.write(`\rPage ${page} — ${allStrains.length}/${totalCount === Infinity ? '?' : totalCount} strains...`);

    try {
      const data = await fetchPage(page);
      totalCount = data.total_count;

      const strains = data.strain_playlist?.strains || [];
      if (!strains.length) {
        console.log('\nNo more strains returned — done.');
        break;
      }

      strains.forEach(s => allStrains.push(normalizeStrain(s)));
      consecutiveErrors = 0;
      page++;

      // Save progress every 5 pages
      if (page % 5 === 0) {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allStrains, null, 2));
      }

    } catch (err) {
      consecutiveErrors++;
      console.error(`\nError on page ${page}: ${err.message}`);
      if (consecutiveErrors >= 5) {
        console.error('Too many consecutive errors — saving and stopping.');
        break;
      }
      console.log(`Retrying page ${page} in 3 seconds...`);
      await sleep(3000);
      continue;
    }

    await sleep(DELAY_MS);
  }

  // Final save
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allStrains, null, 2));
  console.log(`\n\n✅ Done! Saved ${allStrains.length} strains to strains-leafly-raw.json`);
  console.log(`Next step: run  node scripts/build-strains-db.js`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

scrape().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
