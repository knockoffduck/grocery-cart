import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { ensureAdminAuth } from '@/lib/pb';
import { formatProduct } from '@/lib/format';
import { rateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// GET /api/catalogue/dump
// Returns the entire Aldi catalogue + every EAN->SKU mapping. Used by the
// client to populate the offline IndexedDB cache. Heavy response (1-3 MB)
// but only fetched when the client detects the cache is stale or empty.
export async function GET() {
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const limit = rateLimit(`dump:${ip}`, { capacity: 3, refillPerSec: 0.1 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate limited', retryAfterMs: limit.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)) } },
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

  return NextResponse.json({
    version: Date.now(),
    product_count: products.length,
    ean_count: eanMap ? eanMap.split(';').length : 0,
    last_sync,
    products: products.map(formatProduct),
    ean_map: eanMap,
  }, {
    headers: {
      'Cache-Control': 'public, max-age=60',
    },
  });
}
