import { Hono } from 'hono';
import { ensureAdminAuth } from '../lib/pb';
import { formatProduct } from '@aldi-cart/shared';
import { rateLimit } from '../lib/rateLimit';

const catalogue = new Hono();

// GET /api/catalogue/dump
// Returns the entire Aldi catalogue + every EAN->SKU mapping. Used by the
// client to populate the offline IndexedDB cache. Heavy response (1-3 MB)
// but only fetched when the client detects the cache is stale or empty.
catalogue.get('/catalogue/dump', async (c) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const limit = rateLimit(`dump:${ip}`, { capacity: 3, refillPerSec: 0.1 });
  if (!limit.allowed) {
    return c.json(
      { error: 'rate limited', retryAfterMs: limit.retryAfterMs },
      429,
    );
  }

  const pb = await ensureAdminAuth();

  // Fetch all products (paginated)
  const products: any[] = [];
  let page = 1;
  const perPage = 500;
  while (true) {
    const result = await pb.collection('aldi_products').getList(page, perPage, {
      fields: 'sku,name,brand_name,selling_size,price_cents,primary_image,slug',
    });
    products.push(...result.items);
    if (page >= result.totalPages) break;
    page++;
  }

  // Fetch all EAN mappings (fuzzy + manual)
  const eanPairs: string[] = [];

  // ean_to_aldi
  page = 1;
  while (true) {
    const result = await pb.collection('ean_to_aldi').getList(page, perPage, {
      fields: 'ean,aldi_sku',
    });
    for (const r of result.items) {
      eanPairs.push(`${r.ean},${r.aldi_sku}`);
    }
    if (page >= result.totalPages) break;
    page++;
  }

  // manual_matches
  page = 1;
  while (true) {
    const result = await pb.collection('manual_matches').getList(page, perPage, {
      fields: 'ean,aldi_sku',
    });
    for (const r of result.items) {
      eanPairs.push(`${r.ean},${r.aldi_sku}`);
    }
    if (page >= result.totalPages) break;
    page++;
  }

  // Deduplicate EAN pairs (manual matches may overlap with fuzzy)
  const eanMap = [...new Set(eanPairs)].join(';');

  // Get last sync timestamp
  let last_sync: string | null = null;
  try {
    const latestMatch = await pb.collection('ean_to_aldi').getList(1, 1, {
      sort: '-verified_at',
      fields: 'verified_at',
    });
    const latestManual = await pb.collection('manual_matches').getList(1, 1, {
      sort: '-created_at',
      fields: 'created_at',
    });
    const timestamps = [
      latestMatch.items[0]?.verified_at as string | undefined,
      latestManual.items[0]?.created_at as string | undefined,
    ].filter(Boolean).sort().reverse();
    last_sync = timestamps[0] ?? null;
  } catch { /* ignore */ }

  return c.json({
    version: Date.now(),
    product_count: products.length,
    ean_count: eanMap ? eanMap.split(';').length : 0,
    last_sync,
    products: products.map(formatProduct),
    ean_map: eanMap,
  }, 200, {
    'Cache-Control': 'public, max-age=60',
  });
});

// GET /api/catalogue/status
// Lightweight endpoint to check whether the server catalogue is newer than
// the client's cached version.
catalogue.get('/catalogue/status', async (c) => {
  const pb = await ensureAdminAuth();

  const [productRes, fuzzyRes, manualRes] = await Promise.all([
    pb.collection('aldi_products').getList(1, 1, { fields: 'id' }),
    pb.collection('ean_to_aldi').getList(1, 1, { fields: 'id' }),
    pb.collection('manual_matches').getList(1, 1, { fields: 'id' }),
  ]);

  // Get last sync timestamps
  let lastMatch: string | null = null;
  let lastManual: string | null = null;

  try {
    const latestMatch = await pb.collection('ean_to_aldi').getList(1, 1, {
      sort: '-verified_at',
      fields: 'verified_at',
    });
    if (latestMatch.items.length) lastMatch = latestMatch.items[0].verified_at as string;
  } catch { /* ignore */ }

  try {
    const latestManual = await pb.collection('manual_matches').getList(1, 1, {
      sort: '-created_at',
      fields: 'created_at',
    });
    if (latestManual.items.length) lastManual = latestManual.items[0].created_at as string;
  } catch { /* ignore */ }

  const last_sync = [lastMatch, lastManual]
    .filter(Boolean)
    .sort()
    .reverse()[0] ?? null;

  return c.json({
    product_count: productRes.totalItems,
    ean_count: fuzzyRes.totalItems + manualRes.totalItems,
    last_sync,
  }, 200, {
    'Cache-Control': 'no-store',
  });
});

export { catalogue as catalogueRoutes };
