// PostgreSQL connection + schema bootstrap.
//
// Migrated from better-sqlite3 to postgres.js. The public API surface
// (sql template tag, getMeta, setMeta, tx, closeDb) is kept narrow so
// route handlers and sync scripts have minimal churn.
//
// Connection is established lazily on first query so a missing
// DATABASE_URL at import time doesn't crash `next build` (which
// collects page data without runtime env vars). The first request
// without DATABASE_URL throws — which is what you want for visibility
// in container logs.

import postgres from 'postgres';

let _sql: ReturnType<typeof postgres> | null = null;

function getSql(): ReturnType<typeof postgres> {
  if (_sql) return _sql;
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required (e.g. postgres://user:pass@host:5432/db)');
  }
  // Single-replica app: pool up to 10 connections, idle timeout 30s.
  // If you ever scale horizontally, tune `max` down to avoid
  // exhausting Postgres max_connections.
  _sql = postgres(DATABASE_URL, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });
  return _sql;
}

// `sql` is a callable Proxy that lazily resolves to the real postgres
// instance. Call sites keep using `sql\`SELECT ...\`` and `sql.array(...)`
// without needing to call getSql() first.
export const sql = new Proxy(function () {} as unknown as ReturnType<typeof postgres>, {
  get(_t, prop) {
    return (getSql() as any)[prop];
  },
  apply(_t, _this, args) {
    return (getSql() as any)(...args);
  },
}) as ReturnType<typeof postgres>;

// ----- Schema bootstrap -----
// CREATE TABLE IF NOT EXISTS is idempotent so this is safe to call on
// every cold start. Schema matches the SQLite version 1:1 with:
//   TEXT          -> TEXT
//   INTEGER       -> INTEGER
//   REAL          -> DOUBLE PRECISION
//   datetime('now') -> NOW()
//   ON DELETE CASCADE is native in PG.

const SCHEMA = `
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
  synced_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aldi_name ON aldi_products(name);
CREATE INDEX IF NOT EXISTS idx_aldi_brand ON aldi_products(brand_name);
CREATE INDEX IF NOT EXISTS idx_aldi_slug ON aldi_products(slug);

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

CREATE TABLE IF NOT EXISTS ean_to_aldi (
  ean TEXT NOT NULL,
  aldi_sku TEXT NOT NULL,
  score DOUBLE PRECISION NOT NULL,
  method TEXT NOT NULL,
  verified_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (ean, aldi_sku)
);
CREATE INDEX IF NOT EXISTS idx_ean_to_aldi_ean ON ean_to_aldi(ean);

CREATE TABLE IF NOT EXISTS manual_matches (
  ean TEXT PRIMARY KEY,
  aldi_sku TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Audit trail of on-the-fly corrections. Write-only: every time a user
-- swaps a wrongly auto-matched scan for the right product we append a row.
-- Lets later bulk jobs re-score systematically-wrong ean_to_aldi rows in
-- scripts/match.ts. No foreign keys — carts/skus may be gone by audit time.
CREATE TABLE IF NOT EXISTS corrections (
  ean TEXT,
  was_sku TEXT NOT NULL,
  now_sku TEXT NOT NULL,
  cart_id TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_corrections_ean ON corrections(ean);
CREATE INDEX IF NOT EXISTS idx_corrections_created ON corrections(created_at);

CREATE TABLE IF NOT EXISTS carts (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cart_items (
  cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  aldi_sku TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  manual_price_cents INTEGER,
  added_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (cart_id, aldi_sku)
);
CREATE INDEX IF NOT EXISTS idx_cart_items_sku ON cart_items(aldi_sku);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);
`;

let schemaReady: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = sql.unsafe(SCHEMA).then(async () => {
      // Bootstrap admin (no-op unless ADMIN_EMAIL/ADMIN_PASSWORD are
      // set). Imported lazily to keep the cold-start graph small.
      // Any error here is non-fatal — the bootstrap must never reject
      // the schema promise or every DB query will permanently fail.
      try {
        const { ensureBootstrapAdmin } = await import('./bootstrap-admin.js');
        await ensureBootstrapAdmin();
      } catch (e: any) {
        console.warn('[schema] bootstrap admin skipped:', e?.message ?? e);
      }
    });
  }
  return schemaReady;
}

async function withSchema<T>(fn: (s: ReturnType<typeof postgres>) => Promise<T> | T): Promise<T> {
  await ensureSchema();
  return fn(getSql());
}

/** Read a metadata key. Returns the value or undefined. */
export async function getMeta(key: string): Promise<string | undefined> {
  return withSchema(async (s) => {
    const rows = await s`SELECT value FROM meta WHERE key = ${key}`;
    return rows[0]?.value;
  });
}

/** Upsert a metadata key. */
export async function setMeta(key: string, value: string): Promise<void> {
  await withSchema(async (s) => {
    await s`
      INSERT INTO meta (key, value, updated_at)
      VALUES (${key}, ${value}, NOW())
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = NOW()
    `;
  });
}

/** Run a callback inside a transaction. Rolls back on throw.
 *  Use this in sync scripts for bulk inserts/updates.
 */
export const tx = <T>(fn: (s: postgres.TransactionSql) => Promise<T> | T): Promise<T> =>
  withSchema((s) => s.begin(fn) as Promise<T>);

/** Graceful shutdown. Call from SIGTERM/SIGINT handlers. */
export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
  }
}
