// One-shot sync of the full Aldi catalogue into SQLite.
// Run: npx tsx src/sync-aldi.ts
// Idempotent: REPLACES rows in place using sku as PK.

import { db, setMeta } from '../src/lib/db.js';
import { searchProducts, pickPrimaryImage, type AldiProduct } from '../src/lib/aldi.js';

const CONCURRENCY = 4;       // parallel in-flight requests
const BATCH_SIZE = 60;       // max page size Aldi accepts
const MAX_RETRIES = 4;

const insert = db.prepare(`
  INSERT INTO aldi_products
    (sku, name, brand_name, slug, selling_size, price_cents, price_comparison_cents,
     price_comparison_display, currency, categories_json, primary_image, assets_json,
     not_for_sale, discontinued, weight_type, raw_json, synced_at)
  VALUES
    (@sku, @name, @brand_name, @slug, @selling_size, @price_cents, @price_comparison_cents,
     @price_comparison_display, @currency, @categories_json, @primary_image, @assets_json,
     @not_for_sale, @discontinued, @weight_type, @raw_json, datetime('now'))
  ON CONFLICT(sku) DO UPDATE SET
    name = excluded.name,
    brand_name = excluded.brand_name,
    slug = excluded.slug,
    selling_size = excluded.selling_size,
    price_cents = excluded.price_cents,
    price_comparison_cents = excluded.price_comparison_cents,
    price_comparison_display = excluded.price_comparison_display,
    currency = excluded.currency,
    categories_json = excluded.categories_json,
    primary_image = excluded.primary_image,
    assets_json = excluded.assets_json,
    not_for_sale = excluded.not_for_sale,
    discontinued = excluded.discontinued,
    weight_type = excluded.weight_type,
    raw_json = excluded.raw_json,
    synced_at = datetime('now')
`);

function toRow(p: AldiProduct) {
  return {
    sku: p.sku,
    name: p.name,
    brand_name: p.brandName ?? null,
    slug: p.urlSlugText,
    selling_size: p.sellingSize ?? null,
    price_cents: p.price?.amount ?? null,
    price_comparison_cents: p.price?.comparison ?? null,
    price_comparison_display: p.price?.comparisonDisplay ?? null,
    currency: p.price?.currencyCode ?? 'AUD',
    categories_json: JSON.stringify(p.categories ?? []),
    primary_image: pickPrimaryImage(p),
    assets_json: JSON.stringify(p.assets ?? []),
    not_for_sale: p.notForSale ? 1 : 0,
    discontinued: p.discontinued ? 1 : 0,
    weight_type: p.weightType ?? null,
    raw_json: JSON.stringify(p),
  };
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const backoff = 500 * Math.pow(2, i);
      console.warn(`  [${label}] attempt ${i + 1} failed: ${e.message}; retrying in ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

async function fetchPage(offset: number): Promise<{ items: AldiProduct[]; total: number }> {
  const res = await withRetry(
    () => searchProducts({ offset, limit: BATCH_SIZE, sort: 'name_asc' }),
    `offset=${offset}`
  );
  return { items: res.data, total: res.meta.pagination.totalCount };
}

export async function syncAldi(): Promise<{ total: number; pages: number; elapsedMs: number }> {
  const start = Date.now();
  console.log('[aldi-sync] starting full catalogue sync');

  // First page to learn the total
  const first = await fetchPage(0);
  const total = first.total;
  const totalPages = Math.ceil(total / BATCH_SIZE);
  console.log(`[aldi-sync] total products: ${total} across ${totalPages} pages`);

  let processed = 0;
  const writeMany = db.transaction((rows: ReturnType<typeof toRow>[]) => {
    for (const r of rows) insert.run(r);
  });

  // Workers pull offsets from a shared cursor
  let nextOffset = BATCH_SIZE;
  const offsets: number[] = [];
  for (let o = BATCH_SIZE; o < total; o += BATCH_SIZE) offsets.push(o);

  // Seed the first page immediately
  writeMany(first.items.map(toRow));
  processed += first.items.length;
  console.log(`[aldi-sync] page 1/${totalPages} -> ${first.items.length} items`);

  // Parallel pages with bounded concurrency
  const queue = [...offsets];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const offset = queue.shift();
      if (offset === undefined) return;
      const { items } = await fetchPage(offset);
      writeMany(items.map(toRow));
      processed += items.length;
      if (processed % 300 < BATCH_SIZE) {
        const pct = ((processed / total) * 100).toFixed(1);
        console.log(`[aldi-sync] ${processed}/${total} (${pct}%)`);
      }
    }
  });
  await Promise.all(workers);

  setMeta('aldi_sync_completed_at', new Date().toISOString());
  setMeta('aldi_sync_total', String(processed));
  const elapsedMs = Date.now() - start;
  console.log(`[aldi-sync] done: ${processed} products in ${(elapsedMs / 1000).toFixed(1)}s`);
  return { total: processed, pages: totalPages, elapsedMs };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  syncAldi()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[aldi-sync] FAILED:', e);
      process.exit(1);
    });
}
