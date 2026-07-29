import { useState } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductThumb } from "@/components/ProductSearchSheet";
import { useProductSearch } from "@/lib/hooks/use-product-search";
import { useHaptic } from "@/lib/haptics";
import { api } from "@/lib/api";

interface SearchViewProps {
  cartId: string | null;
  onAdded?: () => void;
}

export function SearchView({ cartId, onAdded }: SearchViewProps) {
  const { query, setQuery, results, searching } = useProductSearch(30);
  const [adding, setAdding] = useState<string | null>(null);
  const hapticRef = useHaptic<HTMLButtonElement>();

  async function add(sku: string) {
    if (!cartId || adding) return;
    setAdding(sku);
    try {
      await api(`/api/cart/${cartId}/items`, {
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
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="p-3 bg-white border-b border-aldi-border sticky top-0 z-10">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-aldi-text-muted" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Aldi products…"
            className="h-11 rounded-lg bg-aldi-bg pl-10 pr-10"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-aldi-border text-aldi-text-muted flex items-center justify-center hover:bg-aldi-text-muted hover:text-white transition"
              aria-label="Clear"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-4">
        {query.trim().length < 1 ? (
          <div className="px-6 py-14 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-full bg-aldi-bg border border-aldi-border flex items-center justify-center mb-4">
              <Search className="w-7 h-7 text-aldi-text-muted" strokeWidth={1.5} />
            </div>
            <p className="text-sm font-medium text-aldi-text mb-1">Search the catalogue</p>
            <p className="text-sm text-aldi-text-muted">Type a product name, brand, or category.</p>
          </div>
        ) : searching && results.length === 0 ? (
          <div className="px-6 py-12 text-center text-aldi-text-muted">Searching…</div>
        ) : results.length === 0 ? (
          <div className="px-6 py-12 text-center text-aldi-text-muted">
            No matches for &ldquo;{query}&rdquo;.
          </div>
        ) : (
          <ul className="divide-y divide-aldi-border bg-white">
            {results.map((p) => (
              <li key={p.sku} className="flex items-center gap-3 p-3">
                <ProductThumb image={p.image} className="w-12 h-12" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm leading-snug line-clamp-2">{p.name}</div>
                  <div className="text-xs text-aldi-text-muted mt-0.5">
                    {p.brand}{p.sellingSize ? ` · ${p.sellingSize}` : ""}
                  </div>
                  <div className="text-sm font-semibold text-aldi-blue mt-0.5 tabular-nums">
                    {p.priceDisplay}
                  </div>
                </div>
                <Button
                  ref={hapticRef}
                  size="sm"
                  className="rounded-full"
                  onClick={() => add(p.sku)}
                  disabled={adding === p.sku}
                >
                  {adding === p.sku ? "…" : "Add"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
