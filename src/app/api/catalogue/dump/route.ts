import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { sql } from '@/lib/db';
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
  const products = await sql<{
    sku: string;
    name: string;
    brand_name: string | null;
    selling_size: string | null;
    price_cents: number | null;
    primary_image: string | null;
    slug: string | null;
  }[]>`
    SELECT sku, name, brand_name, selling_size, price_cents, primary_image, slug
    FROM aldi_products
  `;

  // Build a single EAN -> SKU map covering manual + fuzzy matches. Clients
  // only need to know the SKU to look up a product in the products[] array.
  const eanRows = await sql<{ ean: string; aldi_sku: string }[]>`
    SELECT ean, aldi_sku FROM ean_to_aldi
    UNION
    SELECT ean, aldi_sku FROM manual_matches
  `;

  // Compress the EAN map to a single string. The client parses it back.
  // Format: "ean1,sku1;ean2,sku2;..."
  const eanMap = eanRows.map((r) => `${r.ean},${r.aldi_sku}`).join(';');

  const [sync] = await sql<{ last_match: string | null; last_manual: string | null }[]>`
    SELECT
      (SELECT MAX(verified_at) FROM ean_to_aldi) AS last_match,
      (SELECT MAX(created_at) FROM manual_matches) AS last_manual
  `;

  const last_sync = [sync.last_match, sync.last_manual]
    .filter(Boolean)
    .sort()
    .reverse()[0] ?? null;

  return NextResponse.json({
    version: Date.now(),
    product_count: products.length,
    ean_count: eanRows.length,
    last_sync,
    products: products.map(formatProduct),
    ean_map: eanMap,
  }, {
    headers: {
      // Encourage the browser to cache for a short time so rapid re-syncs
      // don't hammer the server. The client uses version + last_sync to
      // decide when to refetch.
      'Cache-Control': 'public, max-age=60',
    },
  });
}
