// Sync runner for the Aldi v3 catalogue.
// Wraps the Aldi API fetch logic so the admin page can trigger a
// background sync, poll progress, and chain an OFF->Aldi match after completion.

import { ensureAdminAuth, setMeta, getMeta } from './pb';
import { searchProducts, pickPrimaryImage, type AldiProduct } from './aldi';
import { runMatch } from './match-runner';
import type { SyncProgress } from '@aldi-cart/shared';

const CONCURRENCY = 4;
const BATCH_SIZE = 60;
const MAX_RETRIES = 4;

function toRow(p: AldiProduct) {
  return {
    sku: p.sku,
    name: p.name,
    brand_name: p.brandName ?? '',
    slug: p.urlSlugText ?? '',
    selling_size: p.sellingSize ?? '',
    price_cents: p.price?.amount ?? null,
    price_comparison_cents: p.price?.comparison ?? null,
    price_comparison_display: p.price?.comparisonDisplay ?? '',
    currency: p.price?.currencyCode ?? 'AUD',
    categories_json: JSON.stringify(p.categories ?? []),
    primary_image: pickPrimaryImage(p) ?? '',
    assets_json: JSON.stringify(p.assets ?? []),
    not_for_sale: p.notForSale ? true : false,
    discontinued: p.discontinued ? true : false,
    weight_type: p.weightType ?? '',
    raw_json: JSON.stringify(p),
    synced_at: new Date().toISOString(),
  };
}

const upsertBatch = async (rows: ReturnType<typeof toRow>[]): Promise<void> => {
  const pb = await ensureAdminAuth();
  if (!rows.length) return;

  const skus = rows.map((r) => r.sku);
  const existingMap = new Map<string, string>();
  const chunks: string[][] = [];
  for (let i = 0; i < skus.length; i += 50) chunks.push(skus.slice(i, i + 50));
  for (const chunk of chunks) {
    const filter = chunk.map((s) => `sku="${s}"`).join('||');
    const result = await pb.collection('aldi_products').getList(1, 50, { filter, fields: 'id,sku' });
    for (const r of result.items) existingMap.set(r.sku as string, r.id);
  }

  const requests = rows.map((row) => {
    const existingId = existingMap.get(row.sku);
    if (existingId) {
      return { method: 'PATCH', url: `/api/collections/aldi_products/records/${existingId}`, body: row };
    }
    return { method: 'POST', url: '/api/collections/aldi_products/records', body: row };
  });

  for (let i = 0; i < requests.length; i += 100) {
    const batch = requests.slice(i, i + 100);
    await pb.send('/api/batch', { method: 'POST', body: { requests: batch } });
  }
};

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
    `offset=${offset}`,
  );
  return { items: res.data, total: res.meta.pagination.totalCount };
}

/** Read the current sync progress from the meta collection. */
export async function getSyncProgress(): Promise<SyncProgress> {
  const [status, processed, total, startedAt, completedAt, error] = await Promise.all([
    getMeta('aldi_sync_status'),
    getMeta('aldi_sync_processed'),
    getMeta('aldi_sync_total'),
    getMeta('aldi_sync_started_at'),
    getMeta('aldi_sync_completed_at'),
    getMeta('aldi_sync_error'),
  ]);
  return {
    status: (status as SyncProgress['status']) ?? 'idle',
    processed: parseInt(processed ?? '0', 10),
    total: parseInt(total ?? '0', 10),
    startedAt: startedAt ?? null,
    completedAt: completedAt ?? null,
    error: error ?? null,
  };
}

/**
 * Run a full Aldi catalogue sync, writing progress to `meta` so the
 * admin UI can poll. After successful completion, also triggers runMatch().
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

    await upsertBatch(first.items.map(toRow));
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
        await upsertBatch(items.map(toRow));
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

export { runMatch } from './match-runner';
