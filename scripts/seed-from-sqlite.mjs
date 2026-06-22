// One-time seed: read the local SQLite catalogue and write it into the
// remote Postgres database. Idempotent — uses ON CONFLICT DO NOTHING so
// re-running after a partial failure is safe. Skips the carts and
// cart_items tables (user-session data, not catalogue).
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/seed-from-sqlite.mjs [SQLITE_PATH]
//
// Defaults to data/aldi.db if no path is given.

import Database from 'better-sqlite3';
import postgres from 'postgres';

const SQLITE_PATH = process.argv[2] || 'data/aldi.db';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL env var is required');
  process.exit(1);
}

console.log(`[seed] reading from ${SQLITE_PATH}`);
const sqlite = new Database(SQLITE_PATH, { readonly: true });

console.log(`[seed] connecting to Postgres`);
const sql = postgres(DATABASE_URL, { max: 4, connect_timeout: 10 });

async function copyTable(sqliteTable, pgTable, columns, transform) {
  const rows = sqlite.prepare(`SELECT ${columns.join(', ')} FROM ${sqliteTable}`).all();
  if (rows.length === 0) {
    console.log(`[seed] ${sqliteTable} -> ${pgTable}: 0 rows, skipping`);
    return 0;
  }
  const transformed = transform ? rows.map(transform) : rows;
  // Chunk to avoid huge single queries (1.3 MB worth of data is fine
  // in one shot, but we chunk anyway for safety).
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < transformed.length; i += CHUNK) {
    const slice = transformed.slice(i, i + CHUNK);
    // postgres.js takes an array of objects with sql`...`, columns
    // are inferred from the object keys.
    if (sqliteTable === 'aldi_products') {
      await sql`
        INSERT INTO aldi_products ${sql(slice, 'sku', 'name', 'brand_name', 'slug', 'selling_size', 'price_cents', 'price_comparison_cents', 'price_comparison_display', 'currency', 'categories_json', 'primary_image', 'assets_json', 'not_for_sale', 'discontinued', 'weight_type', 'raw_json')}
        ON CONFLICT (sku) DO NOTHING
      `;
    } else if (sqliteTable === 'off_products') {
      await sql`
        INSERT INTO off_products ${sql(slice, 'ean', 'product_name', 'brand', 'quantity', 'categories', 'image_url', 'countries')}
        ON CONFLICT (ean) DO NOTHING
      `;
    } else if (sqliteTable === 'ean_to_aldi') {
      await sql`
        INSERT INTO ean_to_aldi ${sql(slice, 'ean', 'aldi_sku', 'score', 'method', 'verified_at')}
        ON CONFLICT (ean, aldi_sku) DO NOTHING
      `;
    } else if (sqliteTable === 'manual_matches') {
      await sql`
        INSERT INTO manual_matches ${sql(slice, 'ean', 'aldi_sku', 'created_at')}
        ON CONFLICT (ean) DO NOTHING
      `;
    } else if (sqliteTable === 'meta') {
      await sql`
        INSERT INTO meta ${sql(slice, 'key', 'value', 'updated_at')}
        ON CONFLICT (key) DO NOTHING
      `;
    }
    inserted += slice.length;
  }
  console.log(`[seed] ${sqliteTable} -> ${pgTable}: ${inserted} rows`);
  return inserted;
}

async function main() {
  const start = Date.now();
  await copyTable('aldi_products', 'aldi_products', [
    'sku', 'name', 'brand_name', 'slug', 'selling_size',
    'price_cents', 'price_comparison_cents', 'price_comparison_display',
    'currency', 'categories_json', 'primary_image', 'assets_json',
    'not_for_sale', 'discontinued', 'weight_type', 'raw_json', 'synced_at',
  ]);
  await copyTable('off_products', 'off_products', [
    'ean', 'product_name', 'brand', 'quantity', 'categories', 'image_url', 'countries',
  ]);
  await copyTable('ean_to_aldi', 'ean_to_aldi', [
    'ean', 'aldi_sku', 'score', 'method', 'verified_at',
  ]);
  await copyTable('manual_matches', 'manual_matches', [
    'ean', 'aldi_sku', 'created_at',
  ]);
  await copyTable('meta', 'meta', [
    'key', 'value', 'updated_at',
  ]);
  console.log(`[seed] done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  // Verify
  const counts = await sql`
    SELECT
      (SELECT COUNT(*) FROM aldi_products) AS products,
      (SELECT COUNT(*) FROM off_products) AS off,
      (SELECT COUNT(*) FROM ean_to_aldi) AS matches,
      (SELECT COUNT(*) FROM manual_matches) AS manual,
      (SELECT COUNT(*) FROM meta) AS meta_rows
  `;
  console.log('[seed] post-seed counts:', counts[0]);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[seed] FAILED:', e);
    process.exit(1);
  })
  .finally(() => {
    sqlite.close();
    sql.end();
  });
