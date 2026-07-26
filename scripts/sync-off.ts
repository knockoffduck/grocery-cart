// Smart Open Food Facts sync: only fetch products whose brand matches an Aldi brand.
// Iterates the Aldi brand list, queries OFF for that brand, and persists results.
// Private-label Aldi brands (which OFF won't have) are silently skipped.

import { ensureAdminAuth, setMeta } from '../packages/api/src/lib/pb';
import { proxyFetch } from '../packages/api/src/lib/proxy';

const OFF_BASE = 'https://world.openfoodfacts.org';
const PAGE_SIZE = 100;
const RATE_LIMIT_MS = 200;     // proxies are fast; a small delay is enough
const BRAND_REQUEST_CAP = 50;  // OFF often returns <page_size for small brands; cap pages per brand

type OffRow = {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  brands?: string;
  brands_tags?: string[];
  quantity?: string;
  categories?: string;
  categories_tags?: string[];
  image_url?: string;
  image_small_url?: string;
  countries_tags?: string[];
};

function toRow(p: OffRow) {
  return {
    ean: p.code ?? '',
    product_name: p.product_name ?? p.product_name_en ?? '',
    brand: p.brands ?? (p.brands_tags?.[0] ?? ''),
    quantity: p.quantity ?? '',
    categories: p.categories ?? (p.categories_tags ?? []).join(','),
    image_url: p.image_small_url ?? p.image_url ?? '',
    countries: (p.countries_tags ?? []).join(','),
  };
}

const upsert = async (row: ReturnType<typeof toRow>) => {
  const pb = await ensureAdminAuth();
  let existing: any = null;
  try {
    existing = await pb.collection('off_products').getFirstListItem(`ean="${row.ean}"`);
  } catch {
    // Not found
  }

  if (existing) {
    await pb.collection('off_products').update(existing.id, row);
  } else {
    await pb.collection('off_products').create(row);
  }
};

const upsertBatchOff = async (rows: ReturnType<typeof toRow>[]) => {
  if (!rows.length) return;
  const pb = await ensureAdminAuth();

  // Find which EANs already exist
  const eans = rows.map((r) => r.ean);
  const existingMap = new Map<string, string>();
  const chunks: string[][] = [];
  for (let i = 0; i < eans.length; i += 50) chunks.push(eans.slice(i, i + 50));
  for (const chunk of chunks) {
    const filter = chunk.map((e) => `ean="${e}"`).join('||');
    const result = await pb.collection('off_products').getList(1, 50, { filter, fields: 'id,ean' });
    for (const r of result.items) existingMap.set(r.ean as string, r.id);
  }

  // Build batch requests
  const requests = rows.map((row) => {
    const existingId = existingMap.get(row.ean);
    if (existingId) {
      return { method: 'PATCH', url: `/api/collections/off_products/records/${existingId}`, body: row };
    }
    return { method: 'POST', url: '/api/collections/off_products/records', body: row };
  });

  for (let i = 0; i < requests.length; i += 100) {
    const batch = requests.slice(i, i + 100);
    await pb.send('/api/batch', { method: 'POST', body: { requests: batch } });
  }
};

async function fetchByBrand(brand: string, page: number): Promise<{ products: OffRow[]; count: number }> {
  const params = new URLSearchParams({
    action: 'process',
    json: '1',
    page_size: String(PAGE_SIZE),
    page: String(page),
    brands_tags: brand.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    countries_tags: 'en:australia',
    fields: 'code,product_name,brands,brands_tags,quantity,categories,categories_tags,image_url,countries_tags',
  });
  const url = `${OFF_BASE}/api/v2/search?${params}`;
  const res = await proxyFetch(url, {
    headers: { 'User-Agent': 'aldi-cart/0.1 (homelab price tracker)' },
    maxProxyRetries: 5,
  });
  if (!res.ok) {
    throw new Error(`OFF ${res.status} (body suppressed; content-type: ${res.headers.get('content-type') || 'unset'})`);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('json')) {
    throw new Error(`OFF returned non-JSON (content-type: ${ct || 'unset'})`);
  }
  const data = await res.json();
  return { products: (data.products ?? []) as OffRow[], count: data.count ?? 0 };
}

async function loadBrands(): Promise<string[]> {
  const pb = await ensureAdminAuth();
  const brands = new Set<string>();
  let page = 1;
  while (true) {
    const result = await pb.collection('aldi_products').getList(page, 500, {
      fields: 'brand_name',
      filter: 'brand_name != ""',
    });
    for (const r of result.items) {
      const b = (r.brand_name as string)?.trim();
      if (b) brands.add(b);
    }
    if (page >= result.totalPages) break;
    page++;
  }
  const sorted = [...brands].sort();
  if (sorted.length === 0) {
    throw new Error('No brands in aldi_products collection. Run `npm run sync:aldi` first.');
  }
  return sorted;
}

export async function syncOffByBrand(opts: { log?: (msg: string) => void } = {}): Promise<{ brands: number; products: number; elapsedMs: number }> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const start = Date.now();
  log('[off-sync] starting brand-targeted AU sync');

  const brands = await loadBrands();
  log(`[off-sync] querying ${brands.length} Aldi brands`);

  let totalProducts = 0;
  let successfulBrands = 0;
  const failures: string[] = [];

  for (let i = 0; i < brands.length; i++) {
    const brand = brands[i];
    let brandTotal = 0;
    try {
      for (let page = 1; page <= BRAND_REQUEST_CAP; page++) {
        const { products, count } = await fetchByBrand(brand, page);
        if (page === 1 && count === 0) break; // brand not in OFF, skip
        const rows = products
          .map(toRow)
          .filter((r) => r.ean && r.ean.length >= 8 && r.ean.length <= 14);
        await upsertBatchOff(rows);
        brandTotal += rows.length;
        if (products.length < PAGE_SIZE) break;
        await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
      }
      if (brandTotal > 0) successfulBrands++;
      totalProducts += brandTotal;
      if ((i + 1) % 10 === 0 || i === brands.length - 1) {
        const pct = (((i + 1) / brands.length) * 100).toFixed(1);
        log(
          `[off-sync] ${i + 1}/${brands.length} brands (${pct}%) | ${successfulBrands} hit | ${totalProducts} products`
        );
      }
    } catch (e: any) {
      failures.push(`${brand}: ${e.message}`);
      log(`[off-sync] brand "${brand}" failed: ${e.message}`);
    }
    if (i < brands.length - 1) await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }

  await setMeta('off_sync_completed_at', new Date().toISOString());
  await setMeta('off_sync_total', String(totalProducts));
  await setMeta('off_sync_brands_hit', String(successfulBrands));
  const elapsedMs = Date.now() - start;
  log(`[off-sync] done: ${totalProducts} products from ${successfulBrands}/${brands.length} brands in ${(elapsedMs / 1000).toFixed(1)}s`);
  if (failures.length) {
    log(`[off-sync] ${failures.length} brand failures (logged above)`);
  }
  return { brands: brands.length, products: totalProducts, elapsedMs };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  syncOffByBrand()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[off-sync] FAILED:', e);
      process.exit(1);
    });
}
