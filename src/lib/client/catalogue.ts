// Offline catalogue cache using IndexedDB.
//
// The app fetches the full product list + EAN->SKU map from the server once
// (or whenever the user pulls-to-refresh) and stores it locally. After that,
// the scan flow can resolve any EAN without any network round-trip.
//
// The cart itself is *not* cached offline (it's a server-side SQLite row). If
// the user is offline and tries to add an item, the request fails — and the
// UI surfaces that. This is a deliberate trade-off: a stale local cart with
// wrong prices is worse than knowing the add failed.

const DB_NAME = "aldi-cart";
const DB_VERSION = 1;
const STORE_PRODUCTS = "products";
const STORE_EANS = "eans";
const STORE_META = "meta";

export interface Product {
  sku: string;
  name: string;
  brand: string | null;
  sellingSize: string | null;
  priceDisplay: string | null;
  image: string | null;
  priceCents: number | null;
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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
        const s = db.createObjectStore(STORE_PRODUCTS, { keyPath: "sku" });
        s.createIndex("name", "name", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_EANS)) {
        db.createObjectStore(STORE_EANS);
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db: IDBDatabase, stores: string[], mode: IDBTransactionMode) {
  return db.transaction(stores, mode);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Transaction aborted"));
  });
}

export async function getMeta(key: string): Promise<any> {
  const db = await openDb();
  try {
    return await reqToPromise(tx(db, [STORE_META], "readonly").objectStore(STORE_META).get(key));
  } finally {
    db.close();
  }
}

export async function setMeta(key: string, value: any): Promise<void> {
  const db = await openDb();
  try {
    await reqToPromise(tx(db, [STORE_META], "readwrite").objectStore(STORE_META).put(value, key));
  } finally {
    db.close();
  }
}

export async function getCachedStatus(): Promise<CatalogueStatus | null> {
  const meta = await getMeta("status");
  return meta ?? null;
}

export async function fetchServerStatus(): Promise<CatalogueStatus> {
  const res = await fetch("/api/catalogue/status", { cache: "no-store" });
  if (!res.ok) throw new Error(`Status check failed: HTTP ${res.status}`);
  return res.json();
}

// Decide whether the local cache is stale relative to the server.
// If we have no cache at all, we definitely need a sync.
// If the server's last_sync is newer than ours, we need a sync.
export async function isCacheStale(): Promise<{ stale: boolean; reason: string }> {
  let cached: CatalogueStatus | null = null;
  try {
    cached = await getCachedStatus();
  } catch {
    return { stale: true, reason: "cache error" };
  }
  if (!cached) return { stale: true, reason: "no cache" };
  let server: CatalogueStatus;
  try {
    server = await fetchServerStatus();
  } catch {
    // If we can't reach the server, assume the cache is fine.
    return { stale: false, reason: "offline" };
  }
  if (!server.lastSync) return { stale: false, reason: "server empty" };
  if (!cached.lastSync) return { stale: true, reason: "missing local lastSync" };
  return {
    stale: new Date(server.lastSync) > new Date(cached.lastSync),
    reason: new Date(server.lastSync) > new Date(cached.lastSync) ? "server newer" : "fresh",
  };
}

// Download the full dump and replace the local cache.
export async function syncFromServer(onProgress?: (msg: string) => void): Promise<CatalogueStatus> {
  onProgress?.("Downloading catalogue…");
  const res = await fetch("/api/catalogue/dump", { cache: "no-store" });
  if (!res.ok) throw new Error(`Sync failed: HTTP ${res.status}`);
  const dump: DumpResponse = await res.json();

  onProgress?.(`Indexing ${dump.products.length.toLocaleString()} products…`);
  const db = await openDb();
  try {
    const productsTx = tx(db, [STORE_PRODUCTS], "readwrite");
    const productsStore = productsTx.objectStore(STORE_PRODUCTS);
    productsStore.clear();
    for (const p of dump.products) {
      productsStore.put(p);
    }
    await txDone(productsTx);

    onProgress?.(`Indexing ${dump.ean_count.toLocaleString()} barcodes…`);
    const eansTx = tx(db, [STORE_EANS], "readwrite");
    const eansStore = eansTx.objectStore(STORE_EANS);
    eansStore.clear();
    if (dump.ean_map) {
      // ean_map is "ean1,sku1;ean2,sku2;...". Bulk put is faster than per-row.
      const entries = dump.ean_map.split(";").map((pair) => {
        const i = pair.indexOf(",");
        return i < 0 ? null : [pair.slice(0, i), pair.slice(i + 1)] as [string, string];
      }).filter((e): e is [string, string] => e !== null);
      for (const [ean, sku] of entries) {
        eansStore.put(sku, ean);
      }
    }
    await txDone(eansTx);

    const status: CatalogueStatus = {
      productCount: dump.product_count,
      eanCount: dump.ean_count,
      lastSync: dump.last_sync,
    };
    await setMeta("status", status);
    return status;
  } finally {
    db.close();
  }
}

export interface CachedEanMatch {
  matched: boolean;
  ean: string;
  best?: Product;
  reason?: string;
  canManualMatch?: boolean;
}

// Resolve an EAN using only the local cache. Used as the offline-first path
// after sync. Returns matched:false with canManualMatch:true so the UI can
// show the same flow as the online unmatched path.
export async function lookupEanOffline(ean: string): Promise<CachedEanMatch | null> {
  const db = await openDb();
  try {
    const sku = await reqToPromise<string | undefined>(
      tx(db, [STORE_EANS], "readonly").objectStore(STORE_EANS).get(ean),
    );
    if (!sku) return null; // no local data at all
    const product = await reqToPromise<Product | undefined>(
      tx(db, [STORE_PRODUCTS], "readonly").objectStore(STORE_PRODUCTS).get(sku),
    );
    if (!product) {
      return {
        matched: false,
        ean,
        reason: "EAN indexed but product not in cache",
        canManualMatch: true,
      };
    }
    return { matched: true, ean, best: product };
  } finally {
    db.close();
  }
}

export async function searchCachedProducts(query: string, limit = 30): Promise<Product[]> {
  const db = await openDb();
  try {
    const q = query.toLowerCase();
    const txr = tx(db, [STORE_PRODUCTS], "readonly");
    const store = txr.objectStore(STORE_PRODUCTS);
    // IndexedDB has no full-text search. For 3k products a full scan is
    // ~10ms on a modern phone. Acceptable for an offline-fallback path.
    const all = await reqToPromise<Product[]>(store.getAll() as IDBRequest<Product[]>);
    const filtered = all
      .filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.brand?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, limit);
    return filtered;
  } finally {
    db.close();
  }
}
