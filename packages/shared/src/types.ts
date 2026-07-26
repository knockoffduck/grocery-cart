// Shared types used across the API and web packages.

export interface Product {
  sku: string;
  name: string;
  brand: string | null;
  sellingSize: string | null;
  priceDisplay: string | null;
  image: string | null;
  priceCents: number | null;
}

export interface CartItem {
  aldi_sku: string;
  quantity: number;
  unit_price_cents: number | null;
  line_total_cents: number;
  name: string;
  brand_name: string | null;
  selling_size: string | null;
  primary_image: string | null;
  manual_price_cents: number | null;
}

export interface SwapProduct {
  sku: string;
  name: string;
  brand: string | null;
  sellingSize: string | null;
  priceDisplay: string | null;
  image: string | null;
}

export interface EanMatch {
  matched: boolean;
  ean: string;
  source?: string;
  best?: Product;
  off?: OffProduct;
  candidates?: { score: number; method: string; product: Product }[];
  reason?: string;
  canManualMatch?: boolean;
}

export interface OffProduct {
  ean: string;
  name: string | null;
  brand: string | null;
  quantity: string | null;
  categories: string | null;
  image: string | null;
}

export interface CatalogueStatus {
  productCount: number;
  eanCount: number;
  lastSync: string | null;
}

export interface DumpResponse {
  version: number;
  product_count: number;
  ean_count: number;
  last_sync: string | null;
  products: Product[];
  ean_map: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: 'user' | 'admin' | null;
}

export interface SyncProgress {
  status: 'idle' | 'running' | 'done' | 'error';
  processed: number;
  total: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}
