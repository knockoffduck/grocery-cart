// Smart Open Food Facts sync: only fetch products whose brand matches an Aldi brand.
// Iterates the Aldi brand list, queries OFF for that brand, and persists results.
// Private-label Aldi brands (which OFF won't have) are silently skipped.

import { db, setMeta } from '../src/lib/db.js';
import { readFileSync } from 'node:fs';
import { proxyFetch } from '../src/lib/proxy.js';

const OFF_BASE = 'https://world.openfoodfacts.org';
const PAGE_SIZE = 100;
const RATE_LIMIT_MS = 200;     // proxies are fast; a small delay is enough
const BRAND_REQUEST_CAP = 50;  // OFF often returns <page_size for small brands; cap pages per brand

const insert = db.prepare(`
  INSERT INTO off_products (ean, product_name, brand, quantity, categories, image_url, countries)
  VALUES (@ean, @product_name, @brand, @quantity, @categories, @image_url, @countries)
  ON CONFLICT(ean) DO UPDATE SET
    product_name = excluded.product_name,
    brand = excluded.brand,
    quantity = excluded.quantity,
    categories = excluded.categories,
    image_url = excluded.image_url,
    countries = excluded.countries
`);

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

async function fetchByBrand(brand: string, page: number): Promise<{ products: OffRow[]; count: number }> {
  // OFF uses brands_tags like "haribo" (slug form). The `brands` field is free-text.
  // Filter by brands_tags to be precise; we also constrain to AU for relevance.
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
  // proxyFetch already retries on 429/502/503 and OFF's HTML 200 ban page,
  // and rotates through the proxy pool. Direct fallback happens inside it.
  const res = await proxyFetch(url, {
    headers: { 'User-Agent': 'aldi-cart/0.1 (homelab price tracker)' },
    maxProxyRetries: 5,
  });
  if (!res.ok) {
    // OFF's 503 page is a giant HTML document. Don't dump it.
    throw new Error(`OFF ${res.status} (body suppressed; content-type: ${res.headers.get('content-type') || 'unset'})`);
  }
  // Belt-and-braces: if a 200 response is HTML, OFF is throttling us with a
  // ban page even though proxyFetch let it through (race: it could be a content-type
  // header mis-set). Bail out gracefully rather than crashing on JSON parse.
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('json')) {
    throw new Error(`OFF returned non-JSON (content-type: ${ct || 'unset'})`);
  }
  const data = await res.json();
  return { products: (data.products ?? []) as OffRow[], count: data.count ?? 0 };
}

function toRow(p: OffRow) {
  return {
    ean: p.code ?? '',
    product_name: p.product_name ?? p.product_name_en ?? null,
    brand: p.brands ?? (p.brands_tags?.[0] ?? null),
    quantity: p.quantity ?? null,
    categories: p.categories ?? (p.categories_tags ?? []).join(','),
    image_url: p.image_small_url ?? p.image_url ?? null,
    countries: (p.countries_tags ?? []).join(','),
  };
}

async function syncOffByBrand(): Promise<{ brands: number; products: number; elapsedMs: number }> {
  const start = Date.now();
  console.log('[off-sync] starting brand-targeted AU sync');

  const brands: string[] = JSON.parse(
    readFileSync('./aldi-brands.json', 'utf-8')
  );
  console.log(`[off-sync] querying ${brands.length} Aldi brands`);

  const writeMany = db.transaction((rows: ReturnType<typeof toRow>[]) => {
    for (const r of rows) if (r.ean) insert.run(r);
  });

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
        writeMany(rows);
        brandTotal += rows.length;
        if (products.length < PAGE_SIZE) break;
        await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
      }
      if (brandTotal > 0) successfulBrands++;
      totalProducts += brandTotal;
      if ((i + 1) % 10 === 0 || i === brands.length - 1) {
        const pct = (((i + 1) / brands.length) * 100).toFixed(1);
        console.log(
          `[off-sync] ${i + 1}/${brands.length} brands (${pct}%) | ${successfulBrands} hit | ${totalProducts} products`
        );
      }
    } catch (e: any) {
      failures.push(`${brand}: ${e.message}`);
      console.warn(`[off-sync] brand "${brand}" failed: ${e.message}`);
    }
    if (i < brands.length - 1) await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }

  setMeta('off_sync_completed_at', new Date().toISOString());
  setMeta('off_sync_total', String(totalProducts));
  setMeta('off_sync_brands_hit', String(successfulBrands));
  const elapsedMs = Date.now() - start;
  console.log(`[off-sync] done: ${totalProducts} products from ${successfulBrands}/${brands.length} brands in ${(elapsedMs / 1000).toFixed(1)}s`);
  if (failures.length) {
    console.log(`[off-sync] ${failures.length} brand failures (logged above)`);
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
