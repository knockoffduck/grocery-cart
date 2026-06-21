// Minimal client for the public Aldi v3 product-search API.
// Docs: https://api.aldi.com.au/v3/product-search
// Auth: none. Bot protection: requires a real browser User-Agent + Origin/Referer.

import { proxyFetch } from './proxy.js';

const ALDI_BASE = 'https://api.aldi.com.au';
const SERVICE_POINT = process.env.ALDI_SERVICE_POINT || 'G452';
const CURRENCY = 'AUD';

const DEFAULT_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-AU,en;q=0.9',
  'Origin': 'https://www.aldi.com.au',
  'Referer': 'https://www.aldi.com.au/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Linux"',
} as const;

export type AldiProduct = {
  sku: string;
  name: string;
  brandName: string | null;
  urlSlugText: string;
  sellingSize: string | null;
  price: {
    amount: number;             // cents
    amountRelevant: number;
    amountRelevantDisplay: string;
    comparison: number | null;  // cents per unit
    comparisonDisplay: string | null;
    currencyCode: string;
  } | null;
  categories: { id: string; name: string; urlSlugText: string }[];
  assets: { url: string; maxWidth: number; maxHeight: number; assetType: string }[];
  notForSale: boolean;
  discontinued: boolean;
  weightType: string | null;
  [k: string]: any;
};

export type SearchResponse = {
  meta: { pagination: { offset: number; limit: number; totalCount: number } };
  data: AldiProduct[];
};

export async function searchProducts(opts: {
  offset?: number;
  limit?: 12 | 16 | 24 | 30 | 32 | 48 | 60;
  sort?: 'relevance' | 'name_asc' | 'name_desc' | 'price_asc' | 'price_desc';
  signal?: AbortSignal;
} = {}): Promise<SearchResponse> {
  const params = new URLSearchParams({
    currency: CURRENCY,
    serviceType: 'walk-in',
    servicePoint: SERVICE_POINT,
    offset: String(opts.offset ?? 0),
    limit: String(opts.limit ?? 60),
    sort: opts.sort ?? 'relevance',
  });
  const url = `${ALDI_BASE}/v3/product-search?${params}`;
  const res = await proxyFetch(url, { headers: DEFAULT_HEADERS, signal: opts.signal, maxProxyRetries: 3 });
  if (!res.ok) {
    throw new Error(`Aldi API ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<SearchResponse>;
}

// Pick the first image asset (FR01 = front, NU01 = nutrition panel, etc.)
export function pickPrimaryImage(p: AldiProduct): string | null {
  const front = p.assets.find((a) => a.assetType === 'FR01') ?? p.assets[0];
  if (!front) return null;
  return front.url.replace('{width}', '600').replace('{slug}', encodeURIComponent(p.urlSlugText));
}
