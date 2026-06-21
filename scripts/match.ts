// Match Open Food Facts EANs to Aldi products.
//
// Strategy:
//   1. For each OFF product, derive a normalized (brand, name) pair.
//   2. Group OFF products by normalized brand.
//   3. For each brand group, pull the candidate Aldi products with the same brand.
//   4. Score each (OFF, Aldi) pair by name-token Jaccard + size bonus + selling-size token match.
//   5. Persist the top matches into ean_to_aldi (the scanner lookup table).
//
// Idempotent: clears ean_to_aldi and rebuilds on each run.

import { db, setMeta } from '../src/lib/db.js';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'with', 'of', 'for', 'in', 'on', 'at',
  'pack', 'pk', 'x', 'new', 'fresh', 'value', 'family', 'size', 'large',
  'small', 'mini', 'big', 'extra', 'free', 'range', 'brand', 'premium',
]);

function tokenize(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s\-/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function normalizeBrand(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Compare two brands loosely: split into tokens, check subset overlap.
function brandScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const at = new Set(a.split(' ').filter(Boolean));
  const bt = new Set(b.split(' ').filter(Boolean));
  let inter = 0;
  for (const t of at) if (bt.has(t)) inter++;
  const union = new Set([...at, ...bt]).size;
  return union === 0 ? 0 : inter / union;
}

// Extract numeric size from strings like "200 g", "1.5L", "6 x 250ml"
function extractSize(s: string | null | undefined): { value: number; unit: string } | null {
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*(kg|g|mg|l|ml|cl)/i);
  if (!m) return null;
  return { value: parseFloat(m[1]), unit: m[2].toLowerCase() };
}

function sizeMatchBonus(off: string | null, aldi: string | null): number {
  const a = extractSize(off);
  const b = extractSize(aldi);
  if (!a || !b) return 0;
  if (a.unit !== b.unit) return 0;
  // Exact match -> 0.3, within 20% -> 0.15
  if (a.value === b.value) return 0.3;
  const diff = Math.abs(a.value - b.value) / Math.max(a.value, b.value);
  return diff < 0.2 ? 0.15 : 0;
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

type OffRow = { ean: string; product_name: string | null; brand: string | null; quantity: string | null };
type AldiRow = { sku: string; name: string; brand_name: string | null; selling_size: string | null };

console.log('[match] starting OFF->Aldi matcher');

const off = db.prepare('SELECT ean, product_name, brand, quantity FROM off_products').all() as OffRow[];
const aldi = db.prepare('SELECT sku, name, brand_name, selling_size FROM aldi_products').all() as AldiRow[];

console.log(`[match] OFF rows: ${off.length}, Aldi rows: ${aldi.length}`);

// Index Aldi by brand tokens (we'll match brands loosely)
const aldiByBrandKey = new Map<string, AldiRow[]>();
for (const a of aldi) {
  const key = normalizeBrand(a.brand_name);
  if (!key) continue;
  const arr = aldiByBrandKey.get(key) ?? [];
  arr.push(a);
  aldiByBrandKey.set(key, arr);
}

const insert = db.prepare(`
  INSERT INTO ean_to_aldi (ean, aldi_sku, score, method) VALUES (?, ?, ?, ?)
  ON CONFLICT(ean, aldi_sku) DO UPDATE SET score = excluded.score, method = excluded.method
`);

const clear = db.prepare('DELETE FROM ean_to_aldi');
const insertMany = db.transaction((rows: [string, string, number, string][]) => {
  clear.run();
  for (const r of rows) insert.run(...r);
});

const start = Date.now();
const matches: [string, string, number, string][] = [];
let exact = 0, fuzzy = 0, noMatch = 0;

for (const o of off) {
  if (!o.ean) continue;
  const offBrand = normalizeBrand(o.brand);
  const offTokens = tokenize(o.product_name);
  if (!offTokens.length) { noMatch++; continue; }

  // Find Aldi candidates with overlapping brand
  const candidates: { row: AldiRow; bScore: number }[] = [];
  for (const [aldiKey, rows] of aldiByBrandKey) {
    const bs = brandScore(offBrand, aldiKey);
    if (bs >= 0.5) {
      for (const r of rows) candidates.push({ row: r, bScore: bs });
    }
  }

  if (!candidates.length) { noMatch++; continue; }

  // Score each candidate
  let best: { row: AldiRow; score: number; method: string } | null = null;
  for (const { row, bScore } of candidates) {
    const aTokens = tokenize(row.name);
    const nameScore = jaccard(offTokens, aTokens);
    const sizeBonus = sizeMatchBonus(o.quantity, row.selling_size);
    // Brand weight 0.4, name 0.5, size 0.1; brandScore already 0-1
    const score = bScore * 0.4 + nameScore * 0.5 + sizeBonus;
    const method =
      bScore === 1 && nameScore > 0.6 ? 'exact_brand_name' :
      bScore === 1 ? 'exact_brand_partial_name' :
      nameScore > 0.5 ? 'fuzzy_brand_strong_name' : 'fuzzy';
    if (!best || score > best.score) best = { row, score, method };
  }

  if (best && best.score >= 0.4) {
    matches.push([o.ean, best.row.sku, best.score, best.method]);
    if (best.method === 'exact_brand_name') exact++;
    else fuzzy++;
  } else {
    noMatch++;
  }
}

insertMany(matches);
setMeta('match_completed_at', new Date().toISOString());
setMeta('match_total', String(matches.length));
setMeta('match_exact', String(exact));
setMeta('match_fuzzy', String(fuzzy));
setMeta('match_unmatched', String(noMatch));

const elapsedMs = Date.now() - start;
console.log(`[match] done in ${(elapsedMs / 1000).toFixed(1)}s`);
console.log(`[match] ${matches.length} EANs matched (${exact} exact, ${fuzzy} fuzzy), ${noMatch} unmatched`);

// Show some examples
const sample = db.prepare(`
  SELECT e2a.ean, e2a.score, e2a.method, op.product_name AS off_name, op.brand AS off_brand, op.quantity,
         ap.sku AS aldi_sku, ap.name AS aldi_name, ap.brand_name AS aldi_brand, ap.selling_size
  FROM ean_to_aldi e2a
  JOIN off_products op ON op.ean = e2a.ean
  JOIN aldi_products ap ON ap.sku = e2a.aldi_sku
  ORDER BY e2a.score DESC LIMIT 8
`).all();
console.log('\n[match] top matches:');
console.table(sample);
