/**
 * scripts/build-strains-db.js
 *
 * Merges strains-leafly-raw.json with the existing strains.json to produce
 * a comprehensive database. Preserves any hand-written descriptions, genetics
 * notes, or custom fields already in strains.json.
 *
 * Run AFTER scrape-leafly.js:
 *   node scripts/build-strains-db.js
 *
 * Output: strains.json (replaces existing — make sure git is clean first)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const RAW_FILE    = path.join(ROOT, 'strains-leafly-raw.json');
const CURRENT_DB  = path.join(ROOT, 'strains.json');
const OUTPUT_FILE = path.join(ROOT, 'strains.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function formatThc(p25, p50, p75) {
  if (p50 == null) return null;
  const lo = p25 != null ? Math.round(p25) : Math.round(p50 - 2);
  const hi = p75 != null ? Math.round(p75) : Math.round(p50 + 2);
  return `${lo}–${hi}%`;
}

function capitalize(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function build() {
  // Load raw Leafly data
  if (!fs.existsSync(RAW_FILE)) {
    console.error('❌ strains-leafly-raw.json not found. Run scrape-leafly.js first.');
    process.exit(1);
  }

  const leaflyRaw = JSON.parse(fs.readFileSync(RAW_FILE, 'utf8'));
  console.log(`Loaded ${leaflyRaw.length} strains from Leafly raw data`);

  // Load existing hand-crafted DB (preserve custom descriptions/genetics)
  let existing = [];
  if (fs.existsSync(CURRENT_DB)) {
    existing = JSON.parse(fs.readFileSync(CURRENT_DB, 'utf8'));
    console.log(`Loaded ${existing.length} strains from existing strains.json`);
  }

  // Index existing by slug for fast lookup
  const existingBySlug = {};
  existing.forEach(s => {
    const slug = s.slug || slugify(s.name);
    existingBySlug[slug] = s;
  });

  // Build merged database
  const merged = [];
  const seenSlugs = new Set();

  leaflyRaw.forEach(raw => {
    if (seenSlugs.has(raw.slug)) return;
    seenSlugs.add(raw.slug);

    const existing = existingBySlug[raw.slug] || existingBySlug[slugify(raw.name)] || null;

    const strain = {
      // ── Identity ──
      name: raw.name,
      slug: raw.slug,
      leaflyUrl: raw.leaflyUrl,
      weedmapsUrl: `https://weedmaps.com/strains/${raw.slug}`,

      // ── Type ──
      type: capitalize(raw.category || 'hybrid'),
      subcategory: raw.subcategory || null,

      // ── Cannabinoids ──
      thc_min: raw.thc_p25 != null ? Math.round(raw.thc_p25) : (existing?.thc_min ?? null),
      thc_max: raw.thc_p75 != null ? Math.round(raw.thc_p75) : (existing?.thc_max ?? null),
      thc:     formatThc(raw.thc_p25, raw.thc_p50, raw.thc_p75) || existing?.thc || null,
      cbd:     raw.cbd_p50 != null ? parseFloat(raw.cbd_p50.toFixed(2)) : (existing?.cbd ?? null),

      // ── Terpenes ── (Leafly data takes priority; fallback to existing)
      terpenes:    raw.terpenes?.length   ? raw.terpenes   : (existing?.terpenes   || []),
      topTerpene:  raw.topTerpene         || (existing?.topTerpene || null),

      // ── Effects & Flavors ──
      effects: raw.effects?.length  ? raw.effects  : (existing?.effects  || []),
      flavors: raw.flavors?.length  ? raw.flavors  : (existing?.flavors  || []),

      // ── Genetics / Lineage ──
      parents:  raw.parents?.length  ? raw.parents  : (existing?.parents  || []),
      children: raw.children?.length ? raw.children : (existing?.children || []),
      genetics: existing?.genetics   // preserve any hand-written genetics strings
        || (raw.parents?.length ? raw.parents.join(' × ') : null),

      // ── Community Stats ──
      avgRating:   raw.avgRating   ?? existing?.rating ?? null,
      reviewCount: raw.reviewCount ?? 0,
      rating:      raw.avgRating   ?? existing?.rating ?? null,

      // ── Editorial (preserve if hand-written; empty otherwise — write your own!) ──
      description: existing?.description || null,
      medical:     existing?.medical     || [],
      bestFor:     existing?.bestFor     || null,
      funFact:     existing?.funFact     || null,
      tags:        existing?.tags        || [],

      // ── Photo ──
      photoUrl: raw.photoUrl || existing?.photoUrl || null,
    };

    merged.push(strain);
  });

  // Also include any existing strains that weren't in the Leafly data
  existing.forEach(s => {
    const slug = s.slug || slugify(s.name);
    if (!seenSlugs.has(slug)) {
      merged.push({ ...s, slug });
      seenSlugs.add(slug);
    }
  });

  // Sort: by rating desc, then alphabetically
  merged.sort((a, b) => {
    const ra = a.avgRating || 0, rb = b.avgRating || 0;
    if (rb !== ra) return rb - ra;
    return a.name.localeCompare(b.name);
  });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(merged, null, 2));

  const withDesc  = merged.filter(s => s.description).length;
  const withTerps = merged.filter(s => s.terpenes?.length).length;
  const withGen   = merged.filter(s => s.genetics || s.parents?.length).length;

  console.log(`\n✅ Built database:`);
  console.log(`   Total strains:        ${merged.length}`);
  console.log(`   With descriptions:    ${withDesc} (${merged.length - withDesc} still need writing)`);
  console.log(`   With terpenes:        ${withTerps}`);
  console.log(`   With genetics/lineage:${withGen}`);
  console.log(`\nSaved to strains.json — restart your server to pick up changes.`);
}

build();
