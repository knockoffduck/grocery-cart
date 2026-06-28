// Sync runner for the Aldi v3 catalogue.
//
// Wraps scripts/sync-aldi.ts's logic so the admin page can trigger a
// background sync, poll progress, and chain an OFF->Aldi match after
// completion. The CLI `npm run sync:aldi` still works and uses the
// same code path.
//
// Progress is written to the `meta` table:
//   - aldi_sync_status       ∈ 'running' | 'done' | 'error'
//   - aldi_sync_started_at   ISO timestamp
//   - aldi_sync_processed    integer count of products written so far
//   - aldi_sync_total        integer total from the first page
//   - aldi_sync_completed_at ISO timestamp (set on success)
//   - aldi_sync_error        string message (set on failure)
//
// `runAldiSync` is non-blocking from the caller's perspective: it
// writes status='running', then awaits the work. The admin server
// action calls it via `void` (fire-and-forget) so the HTTP response
// returns immediately.

import { sql, setMeta } from './db.js';
import {
  searchProducts,
  pickPrimaryImage,
  type AldiProduct,
} from './aldi.js';
import { runMatch } from './match-runner.js';

const CONCURRENCY = 4;
const BATCH_SIZE = 60;
const MAX_RETRIES = 4;

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

const insertBatch = async (
  rows: ReturnType<typeof toRow>[],
  s?: any,
): Promise<void> => {
  const db = s ?? sql;
  for (const row of rows) {
    await db`
      INSERT INTO aldi_products
        (sku, name, brand_name, slug, selling_size, price_cents, price_comparison_cents,
         price_comparison_display, currency, categories_json, primary_image, assets_json,
         not_for_sale, discontinued, weight_type, raw_json, synced_at)
      VALUES
        (${row.sku}, ${row.name}, ${row.brand_name}, ${row.slug}, ${row.selling_size},
         ${row.price_cents}, ${row.price_comparison_cents},
         ${row.price_comparison_display}, ${row.currency}, ${row.categories_json},
         ${row.primary_image}, ${row.assets_json},
         ${row.not_for_sale}, ${row.discontinued}, ${row.weight_type}, ${row.raw_json},
         NOW())
      ON CONFLICT (sku) DO UPDATE SET
        name = EXCLUDED.name,
        brand_name = EXCLUDED.brand_name,
        slug = EXCLUDED.slug,
        selling_size = EXCLUDED.selling_size,
        price_cents = EXCLUDED.price_cents,
        price_comparison_cents = EXCLUDED.price_comparison_cents,
        price_comparison_display = EXCLUDED.price_comparison_display,
        currency = EXCLUDED.currency,
        categories_json = EXCLUDED.categories_json,
        primary_image = EXCLUDED.primary_image,
        assets_json = EXCLUDED.assets_json,
        not_for_sale = EXCLUDED.not_for_sale,
        discontinued = EXCLUDED.discontinued,
        weight_type = EXCLUDED.weight_type,
        raw_json = EXCLUDED.raw_json,
        synced_at = NOW()
    `;
  }
};

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const backoff = 500 * Math.pow(2, i);
      console.warn(
        `  [${label}] attempt ${i + 1} failed: ${e.message}; retrying in ${backoff}ms`,
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

async function fetchPage(offset: number): Promise<{ items: AldiProduct[]; total: number }> {
  const res = await withRetry(
    () => searchProducts({ offset, limit: BATCH_SIZE, sort: 'name_asc' }),
    `offset=${offset}`,
  );
  return { items: res.data, total: res.meta.pagination.totalCount };
}

export type SyncProgress = {
  status: 'idle' | 'running' | 'done' | 'error';
  processed: number;
  total: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
};

/** Read the current sync progress from the meta table. */
export async function getSyncProgress(): Promise<SyncProgress> {
  const rows = await sql<{ key: string; value: string }[]>`
    SELECT key, value FROM meta WHERE key IN (
      'aldi_sync_status',
      'aldi_sync_processed',
      'aldi_sync_total',
      'aldi_sync_started_at',
      'aldi_sync_completed_at',
      'aldi_sync_error'
    )
  `;
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.key, r.value);
  return {
    status: (map.get('aldi_sync_status') as SyncProgress['status']) ?? 'idle',
    processed: parseInt(map.get('aldi_sync_processed') ?? '0', 10),
    total: parseInt(map.get('aldi_sync_total') ?? '0', 10),
    startedAt: map.get('aldi_sync_started_at') ?? null,
    completedAt: map.get('aldi_sync_completed_at') ?? null,
    error: map.get('aldi_sync_error') ?? null,
  };
}

/**
 * Run a full Aldi catalogue sync, writing progress to `meta` so the
 * admin UI can poll. Throws on failure (the caller decides whether
 * to log, retry, or chain a match pass).
 *
 * After successful completion, the function ALSO triggers a
 * `runMatch()` pass (which preserves manual matches). Pass
 * `runMatchAfter: false` to opt out (e.g. from the dedicated
 * `npm run match` CLI).
 */
export async function runAldiSync(
  opts: { runMatchAfter?: boolean; log?: (msg: string) => void } = {},
): Promise<{ total: number; pages: number; elapsedMs: number; matched: number | null }> {
  const log = opts.log ?? ((m) => console.log(m));
  const startedAt = new Date().toISOString();
  await setMeta('aldi_sync_status', 'running');
  await setMeta('aldi_sync_started_at', startedAt);
  await setMeta('aldi_sync_processed', '0');
  await setMeta('aldi_sync_total', '0');
  await setMeta('aldi_sync_error', '');
  await setMeta('aldi_sync_completed_at', '');

  const start = Date.now();
  try {
    const first = await fetchPage(0);
    const total = first.total;
    const totalPages = Math.ceil(total / BATCH_SIZE);
    await setMeta('aldi_sync_total', String(total));
    log(`[aldi-sync] total products: ${total} across ${totalPages} pages`);

    let processed = 0;

    const writeMany = (rows: ReturnType<typeof toRow>[]) =>
      sql.begin((s) => insertBatch(rows, s));

    await writeMany(first.items.map(toRow));
    processed += first.items.length;
    await setMeta('aldi_sync_processed', String(processed));
    log(`[aldi-sync] page 1/${totalPages} -> ${first.items.length} items`);

    const queue: number[] = [];
    for (let o = BATCH_SIZE; o < total; o += BATCH_SIZE) queue.push(o);

    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const offset = queue.shift();
        if (offset === undefined) return;
        const { items } = await fetchPage(offset);
        await writeMany(items.map(toRow));
        processed += items.length;
        await setMeta('aldi_sync_processed', String(processed));
        if (processed % 300 < BATCH_SIZE) {
          const pct = ((processed / total) * 100).toFixed(1);
          log(`[aldi-sync] ${processed}/${total} (${pct}%)`);
        }
      }
    });
    await Promise.all(workers);

    const completedAt = new Date().toISOString();
    await setMeta('aldi_sync_completed_at', completedAt);
    await setMeta('aldi_sync_status', 'done');
    log(`[aldi-sync] done: ${processed} products in ${((Date.now() - start) / 1000).toFixed(1)}s`);

    let matched: number | null = null;
    if (opts.runMatchAfter !== false) {
      log('[aldi-sync] chaining OFF->Aldi match pass');
      try {
        const result = await runMatch({ log });
        matched = result.matches;
      } catch (e: any) {
        // Match is best-effort here. We log but don't fail the sync
        // status; an admin can re-run match from the CLI if needed.
        log(`[aldi-sync] match pass failed: ${e.message}`);
      }
    }
    return { total: processed, pages: totalPages, elapsedMs: Date.now() - start, matched };
  } catch (e: any) {
    await setMeta('aldi_sync_status', 'error');
    await setMeta('aldi_sync_error', e?.message ?? String(e));
    log(`[aldi-sync] FAILED: ${e?.message ?? e}`);
    throw e;
  }
}

// Re-export the OFF->Aldi matcher from this module so the admin
// trigger (and the CLI) have a single import.
export { runMatch } from './match-runner.js';
