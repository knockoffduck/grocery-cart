"use client";

import { useState, useRef, useEffect } from "react";
import { searchCachedProducts, getCachedStatus } from "@/lib/client/catalogue";

interface Product {
  sku: string;
  name: string;
  brand: string | null;
  sellingSize: string | null;
  priceDisplay: string | null;
  image: string | null;
  priceCents?: number | null;
}

interface SearchViewProps {
  cartId: string | null;
  onAdded?: () => void;
}

export function SearchView({ cartId, onAdded }: SearchViewProps) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const query = q.trim();
    if (query.length < 1) {
      setItems([]);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(query), 180);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function runSearch(query: string) {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    try {
      // Try network first; if the fetch fails, fall back to the offline
      // cache. This is invisible to the user — both paths return the same
      // shape of data and the UI doesn't care which one served it.
      let data: { items: Product[] } | null = null;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=30`, {
          signal: abortRef.current.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      } catch (networkErr) {
        if (networkErr instanceof Error && networkErr.name === "AbortError") return;
        // Network unavailable or errored — try offline cache.
        const cached = await searchCachedProducts(query, 30);
        if (cached.length > 0) {
          data = { items: cached as Product[] };
        }
      }
      if (data) setItems(data.items);
      else setItems([]);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function add(sku: string) {
    if (!cartId || adding) return;
    setAdding(sku);
    try {
      await fetch(`/api/cart/${cartId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, quantity: 1 }),
      });
      onAdded?.();
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="p-3 bg-white border-b border-aldi-border sticky top-0 z-10">
        <div className="relative">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-aldi-text-muted">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Aldi products…"
            className="w-full pl-10 pr-10 py-3 rounded-lg bg-aldi-bg border border-aldi-border focus:border-aldi-blue focus:ring-2 focus:ring-aldi-blue/20 outline-none transition"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-aldi-border text-aldi-text-muted flex items-center justify-center hover:bg-aldi-text-muted hover:text-white transition"
              aria-label="Clear"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-4">
        {q.trim().length < 1 ? (
          <div className="px-6 py-12 text-center text-aldi-text-muted">
            Type a product name, brand, or category.
          </div>
        ) : loading && items.length === 0 ? (
          <div className="px-6 py-12 text-center text-aldi-text-muted">Searching…</div>
        ) : items.length === 0 ? (
          <div className="px-6 py-12 text-center text-aldi-text-muted">
            No matches for &ldquo;{q}&rdquo;.
          </div>
        ) : (
          <ul className="divide-y divide-aldi-border bg-white">
            {items.map((p) => (
              <li key={p.sku} className="flex items-center gap-3 p-3">
                {p.image ? (
                  <img
                    src={p.image}
                    alt=""
                    className="w-12 h-12 object-contain rounded bg-aldi-bg shrink-0"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
                  />
                ) : (
                  <div className="w-12 h-12 rounded bg-aldi-bg shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm leading-snug line-clamp-2">{p.name}</div>
                  <div className="text-xs text-aldi-text-muted mt-0.5">
                    {p.brand}{p.sellingSize ? ` · ${p.sellingSize}` : ""}
                  </div>
                  <div className="text-sm font-semibold text-aldi-blue mt-0.5 tabular-nums">
                    {p.priceDisplay}
                  </div>
                </div>
                <button
                  onClick={() => add(p.sku)}
                  disabled={adding === p.sku}
                  className="px-3 py-1.5 rounded-full bg-aldi-blue text-white text-sm font-semibold hover:bg-aldi-blue-dark active:scale-95 transition disabled:opacity-50"
                >
                  {adding === p.sku ? "…" : "Add"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
