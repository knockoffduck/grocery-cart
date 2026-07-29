import { useCallback, useEffect, useRef, useState } from "react";
import { searchCachedProducts } from "@/lib/catalogue";
import { api } from "@/lib/api";

/**
 * Minimal product shape used across the search UIs. Matches both the
 * /api/search response items and the offline catalogue cache.
 */
export interface SearchProduct {
  sku: string;
  name: string;
  brand: string | null;
  sellingSize: string | null;
  priceDisplay: string | null;
  image: string | null;
}

interface ProductSearchState {
  query: string;
  setQuery: (q: string) => void;
  results: SearchProduct[];
  searching: boolean;
}

/**
 * Debounced catalogue search shared by every search surface (Search tab,
 * cart swap sheet, scanner manual-match). Network first; on any network
 * failure it falls back to the offline IndexedDB cache so the app keeps
 * working in-store without a signal. Both paths return the same shape.
 */
export function useProductSearch(limit = 30): ProductSearchState {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(
    async (q: string) => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      setSearching(true);
      try {
        let items: SearchProduct[] | null = null;
        try {
          const res = await api(
            `/api/search?q=${encodeURIComponent(q)}&limit=${limit}`,
            { signal: abortRef.current.signal },
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          items = data.items ?? [];
        } catch (networkErr) {
          if (networkErr instanceof Error && networkErr.name === "AbortError") return;
          // Network unavailable or errored — try the offline cache.
          const cached = await searchCachedProducts(q, limit);
          if (cached.length > 0) items = cached;
        }
        setResults(items ?? []);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [limit],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      setSearching(false);
      return;
    }
    debounceRef.current = setTimeout(() => run(q), 180);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, run]);

  return { query, setQuery, results, searching };
}
