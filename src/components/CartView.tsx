"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { searchCachedProducts } from "@/lib/client/catalogue";

interface CartItem {
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

// Shape returned by /api/search (see src/lib/format.ts::formatProduct).
// We only need a few fields to render the swap list.
interface SwapProduct {
  sku: string;
  name: string;
  brand: string | null;
  sellingSize: string | null;
  priceDisplay: string | null;
  image: string | null;
}

interface CartViewProps {
  cartId: string | null;
  refreshKey: number;
  onChange?: () => void;
}

export function CartView({ cartId, refreshKey, onChange }: CartViewProps) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [subtotal, setSubtotal] = useState(0);
  const [itemCount, setItemCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two-step clear: tap "Clear" once to show the confirm, tap "Confirm" to wipe.
  // Avoids the mistake of accidentally emptying a half-scanned cart.
  const [confirmingClear, setConfirmingClear] = useState(false);

  // Per-line actions. The kebab toggles a small inline disclosure so the
  // row stays tappable without crowding the +/- controls.
  const [expandedSku, setExpandedSku] = useState<string | null>(null);

  // Replace-this-line overlay state. When `swapTarget` is set, we render a
  // modal-ish panel over the cart with a product search; picking one runs
  // the swap. EAN is unknown from a cart line (we don't store it), so this
  // path only fixes the current cart — it doesn't update the EAN mapping.
  const [swapTarget, setSwapTarget] = useState<CartItem | null>(null);
  const [swapQuery, setSwapQuery] = useState("");
  const [swapResults, setSwapResults] = useState<SwapProduct[]>([]);
  const [swapSearching, setSwapSearching] = useState(false);
  const [swapAdding, setSwapAdding] = useState(false);
  const swapAbortRef = useRef<AbortController | null>(null);
  const swapDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!cartId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cart/${cartId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items);
      setSubtotal(data.subtotal_cents);
      setItemCount(data.item_count);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cart");
    } finally {
      setLoading(false);
    }
  }, [cartId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const setQty = async (sku: string, qty: number) => {
    if (!cartId) return;
    await fetch(`/api/cart/${cartId}/items/${sku}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: qty }),
    });
    onChange?.();
  };

  // Remove one line. Surfaces the existing single-item DELETE route that
  // was previously un-wired in the UI.
  const removeItem = async (sku: string) => {
    if (!cartId) return;
    setExpandedSku(null);
    await fetch(`/api/cart/${cartId}/items/${encodeURIComponent(sku)}`, {
      method: "DELETE",
    });
    onChange?.();
  };

  // Clear-all uses a dedicated endpoint that keeps the cart row. We just
  // re-load (or let refreshKey fire) to see the empty state.
  const clearCart = async () => {
    if (!cartId || !confirmingClear) return;
    setConfirmingClear(false);
    try {
      await fetch(`/api/cart/${cartId}/items`, { method: "DELETE" });
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear cart");
    }
  };

  // Swap a wrong cart line for the right product. We don't know the EAN
  // that originally produced this SKU (cart lines don't store it) so we
  // can only fix the cart — the EAN mapping is left alone. (If the user
  // catches it at scan time, the Scanner path records the correction.)
  const swapLine = async (wrongSku: string, rightSku: string) => {
    if (!cartId || swapAdding) return;
    setSwapAdding(true);
    try {
      if (wrongSku !== rightSku) {
        await fetch(`/api/cart/${cartId}/items/${encodeURIComponent(wrongSku)}`, {
          method: "DELETE",
        });
      }
      await fetch(`/api/cart/${cartId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: rightSku, quantity: 1 }),
      });
      setSwapTarget(null);
      setSwapQuery("");
      setSwapResults([]);
      onChange?.();
    } finally {
      setSwapAdding(false);
    }
  };

  // Debounced search feeding the swap overlay. Mirrors SearchView's
  // network-first / offline-fallback behavior so it works without a signal.
  useEffect(() => {
    if (swapDebounceRef.current) clearTimeout(swapDebounceRef.current);
    const q = swapQuery.trim();
    if (!swapTarget) {
      setSwapResults([]);
      setSwapSearching(false);
      return;
    }
    if (q.length < 1) {
      setSwapResults([]);
      setSwapSearching(false);
      return;
    }
    swapDebounceRef.current = setTimeout(() => runSwapSearch(q), 180);
    return () => {
      if (swapDebounceRef.current) clearTimeout(swapDebounceRef.current);
    };
  }, [swapQuery, swapTarget]);

  async function runSwapSearch(query: string) {
    if (swapAbortRef.current) swapAbortRef.current.abort();
    swapAbortRef.current = new AbortController();
    setSwapSearching(true);
    try {
      let data: { items: SwapProduct[] } | null = null;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=30`, {
          signal: swapAbortRef.current.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      } catch (networkErr) {
        if (networkErr instanceof Error && networkErr.name === "AbortError") return;
        const cached = await searchCachedProducts(query, 30);
        if (cached.length > 0) {
          data = {
            items: cached.map((p) => ({
              sku: p.sku,
              name: p.name,
              brand: p.brand,
              sellingSize: p.sellingSize,
              priceDisplay: p.priceDisplay,
              image: p.image,
            })),
          };
        }
      }
      setSwapResults(data?.items ?? []);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setSwapResults([]);
    } finally {
      setSwapSearching(false);
    }
  }

  function openSwap(target: CartItem) {
    setExpandedSku(null);
    setSwapTarget(target);
    setSwapQuery("");
    setSwapResults([]);
  }

  function closeSwap() {
    setSwapTarget(null);
    setSwapQuery("");
    setSwapResults([]);
  }

  const fmt = (cents: number | null) => cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;

  return (
    <div className="flex-1 flex flex-col relative">
      <div className="px-4 py-3 bg-white border-b border-aldi-border">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-aldi-text-muted">
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </span>
          <span className="text-2xl font-bold tabular-nums text-aldi-blue">
            {fmt(subtotal)}
          </span>
        </div>
        {items.length > 0 && (
          <div className="mt-2 flex items-center justify-end">
            {confirmingClear ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-aldi-danger font-medium">
                  Clear all {itemCount}?
                </span>
                <button
                  onClick={clearCart}
                  className="px-3 py-1 rounded-full bg-aldi-danger text-white text-xs font-semibold active:scale-95 transition"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmingClear(false)}
                  className="px-3 py-1 rounded-full border border-aldi-border text-xs font-medium text-aldi-text-muted hover:bg-aldi-bg transition"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingClear(true)}
                className="text-xs text-aldi-text-muted hover:text-aldi-danger transition"
              >
                Clear cart
              </button>
            )}
          </div>
        )}
      </div>

      {loading && items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-aldi-text-muted">
          Loading…
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center text-aldi-danger px-6 text-center">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12 text-aldi-text-muted">
          <div className="w-16 h-16 rounded-full bg-aldi-bg border border-aldi-border flex items-center justify-center mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-aldi-blue">
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-aldi-text mb-1">Your cart is empty</h2>
          <p>Scan a barcode or search the catalogue to start.</p>
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-aldi-border bg-white">
          {items.map((it) => {
            const open = expandedSku === it.aldi_sku;
            return (
              <li key={it.aldi_sku} className="px-3 pt-3 pb-1">
                <div className="flex items-center gap-3">
                  {it.primary_image ? (
                    <img
                      src={it.primary_image}
                      alt=""
                      className="w-14 h-14 object-contain rounded bg-aldi-bg shrink-0"
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
                    />
                  ) : (
                    <div className="w-14 h-14 rounded bg-aldi-bg shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm leading-snug line-clamp-2">{it.name}</div>
                    <div className="text-xs text-aldi-text-muted mt-0.5">
                      {it.brand_name}{it.selling_size ? ` · ${it.selling_size}` : ""}
                    </div>
                    <div className="text-xs text-aldi-text-muted mt-0.5 tabular-nums">
                      {fmt(it.unit_price_cents)} each
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setQty(it.aldi_sku, it.quantity - 1)}
                      className="w-8 h-8 rounded-full border border-aldi-border text-aldi-text hover:bg-aldi-bg active:scale-95 transition"
                      aria-label="Decrease"
                    >
                      −
                    </button>
                    <span className="w-6 text-center font-semibold tabular-nums">{it.quantity}</span>
                    <button
                      onClick={() => setQty(it.aldi_sku, it.quantity + 1)}
                      className="w-8 h-8 rounded-full border border-aldi-border text-aldi-text hover:bg-aldi-bg active:scale-95 transition"
                      aria-label="Increase"
                    >
                      +
                    </button>
                    {/* Per-line actions disclosure. Tapping it expands an
                        inline strip below the row with Wrong scan? and
                        Remove. We keep the affordance small so the +/- 
                        controls stay the dominant interaction. */}
                    <button
                      onClick={() => setExpandedSku(open ? null : it.aldi_sku)}
                      className={`w-8 h-8 rounded-full border flex items-center justify-center active:scale-95 transition ${
                        open
                          ? "border-aldi-blue bg-aldi-bg text-aldi-blue"
                          : "border-aldi-border text-aldi-text-muted hover:bg-aldi-bg"
                      }`}
                      aria-label="More actions"
                      aria-expanded={open}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                        <circle cx="6" cy="12" r="1.6" />
                        <circle cx="12" cy="12" r="1.6" />
                        <circle cx="18" cy="12" r="1.6" />
                      </svg>
                    </button>
                  </div>
                </div>
                {open && (
                  <div className="flex items-center gap-2 mt-2 mb-2 pl-[68px]">
                    <button
                      onClick={() => openSwap(it)}
                      className="px-3 py-1.5 rounded-full border border-aldi-border text-xs font-medium text-aldi-text-muted hover:border-aldi-danger hover:text-aldi-danger transition"
                    >
                      Wrong scan? Replace…
                    </button>
                    <button
                      onClick={() => removeItem(it.aldi_sku)}
                      className="px-3 py-1.5 rounded-full border border-aldi-border text-xs font-medium text-aldi-text-muted hover:border-aldi-danger hover:text-aldi-danger transition"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Replace-this-line overlay. Sits above the cart list (absolute,
          in-flow so it still scrolls with the page if the list is short).
          The header restates which item we're replacing; the search box
          and product list mirror SearchView's behavior. Picking one runs
          swapLine(). */}
      {swapTarget && (
        <div className="absolute inset-0 z-30 bg-aldi-bg flex flex-col">
          <div className="p-3 bg-white border-b border-aldi-border">
            <div className="flex items-center gap-3">
              <button
                onClick={closeSwap}
                className="w-9 h-9 rounded-full border border-aldi-border text-aldi-text-muted hover:bg-aldi-bg active:scale-95 transition shrink-0"
                aria-label="Cancel replace"
              >
                ←
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-aldi-danger uppercase tracking-wider">
                  Replacing
                </div>
                <div className="text-sm font-medium line-clamp-1">{swapTarget.name}</div>
              </div>
            </div>
            <div className="relative mt-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-aldi-text-muted">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="search"
                value={swapQuery}
                onChange={(e) => setSwapQuery(e.target.value)}
                placeholder="Search Aldi products…"
                className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-aldi-bg border border-aldi-border focus:border-aldi-blue focus:ring-2 focus:ring-aldi-blue/20 outline-none transition"
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto pb-4">
            {swapQuery.trim().length < 1 ? (
              <div className="px-6 py-12 text-center text-aldi-text-muted text-sm">
                Type a product name to find the right item.
              </div>
            ) : swapSearching && swapResults.length === 0 ? (
              <div className="px-6 py-12 text-center text-aldi-text-muted text-sm">Searching…</div>
            ) : swapResults.length === 0 ? (
              <div className="px-6 py-12 text-center text-aldi-text-muted text-sm">
                No matches for &ldquo;{swapQuery}&rdquo;.
              </div>
            ) : (
              <ul className="divide-y divide-aldi-border bg-white">
                {swapResults.map((p) => {
                  const isCurrent = p.sku === swapTarget.aldi_sku;
                  return (
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
                        onClick={() => swapLine(swapTarget.aldi_sku, p.sku)}
                        disabled={swapAdding || isCurrent}
                        className="px-3 py-1.5 rounded-full bg-aldi-blue text-white text-sm font-semibold hover:bg-aldi-blue-dark active:scale-95 transition disabled:opacity-50"
                      >
                        {isCurrent ? "Current" : swapAdding ? "…" : "Use"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
