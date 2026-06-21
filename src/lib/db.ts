import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB_PATH = process.env.ALDI_DB_PATH || resolve(process.cwd(), 'data/aldi.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// Full Aldi product table (1:1 with the v3 API `data[]` items, plus raw JSON)
db.exec(`
  CREATE TABLE IF NOT EXISTS aldi_products (
    sku TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    brand_name TEXT,
    slug TEXT,
    selling_size TEXT,
    price_cents INTEGER,
    price_comparison_cents INTEGER,
    price_comparison_display TEXT,
    currency TEXT DEFAULT 'AUD',
    categories_json TEXT,
    primary_image TEXT,
    assets_json TEXT,
    not_for_sale INTEGER DEFAULT 0,
    discontinued INTEGER DEFAULT 0,
    weight_type TEXT,
    raw_json TEXT NOT NULL,
    synced_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_aldi_name ON aldi_products(name);
  CREATE INDEX IF NOT EXISTS idx_aldi_brand ON aldi_products(brand_name);
  CREATE INDEX IF NOT EXISTS idx_aldi_slug ON aldi_products(slug);

  -- Open Food Facts EAN -> product (subset of fields we need for matching)
  CREATE TABLE IF NOT EXISTS off_products (
    ean TEXT PRIMARY KEY,
    product_name TEXT,
    brand TEXT,
    quantity TEXT,
    categories TEXT,
    image_url TEXT,
    countries TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_off_brand ON off_products(brand);
  CREATE INDEX IF NOT EXISTS idx_off_name ON off_products(product_name);

  -- Many-to-many: an OFF EAN can match multiple Aldi products with a score
  CREATE TABLE IF NOT EXISTS ean_to_aldi (
    ean TEXT NOT NULL,
    aldi_sku TEXT NOT NULL,
    score REAL NOT NULL,
    method TEXT NOT NULL,
    verified_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (ean, aldi_sku)
  );

  CREATE INDEX IF NOT EXISTS idx_ean_to_aldi_ean ON ean_to_aldi(ean);

  -- User-created EAN -> Aldi matches (verified by scanning in store, not from OFF)
  CREATE TABLE IF NOT EXISTS manual_matches (
    ean TEXT PRIMARY KEY,
    aldi_sku TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Shopping carts (per session)
  CREATE TABLE IF NOT EXISTS carts (
    id TEXT PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cart_items (
    cart_id TEXT NOT NULL,
    aldi_sku TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    manual_price_cents INTEGER,
    added_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (cart_id, aldi_sku),
    FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

export function getMeta(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setMeta(key: string, value: string) {
  db.prepare(
    'INSERT INTO meta (key, value, updated_at) VALUES (?, ?, datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime(\'now\')'
  ).run(key, value);
}
