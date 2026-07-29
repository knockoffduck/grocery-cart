import { useCallback, useEffect, useState } from "react";
import { Ellipsis, Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ProductSearchSheet, ProductThumb } from "@/components/ProductSearchSheet";
import { useProductSearch } from "@/lib/hooks/use-product-search";
import { useHaptic } from "@/lib/haptics";
import { api } from "@/lib/api";

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

interface CartViewProps {
  cartId: string | null;
  refreshKey: number;
  onChange?: () => void;
  onCountChange?: (count: number) => void;
}

export function CartView({ cartId, refreshKey, onChange, onCountChange }: CartViewProps) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [subtotal, setSubtotal] = useState(0);
  const [itemCount, setItemCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two-step clear: tap "Clear" once to show the confirm, tap "Confirm" to wipe.
  // Avoids the mistake of accidentally emptying a half-scanned cart.
  const [confirmingClear, setConfirmingClear] = useState(false);
  const hapticRef = useHaptic<HTMLButtonElement>();

  // Per-line actions. The kebab toggles a small inline disclosure so the
  // row stays tappable without crowding the +/- controls.
  const [expandedSku, setExpandedSku] = useState<string | null>(null);

  // Replace-this-line flow. When `swapTarget` is set we open the shared
  // product search sheet; picking a product runs the swap. EAN is unknown
  // from a cart line (we don't store it), so this path only fixes the
  // current cart — it doesn't update the EAN mapping.
  const [swapTarget, setSwapTarget] = useState<CartItem | null>(null);
  const [swapAdding, setSwapAdding] = useState(false);
  const swapSearch = useProductSearch(30);

  const load = useCallback(async () => {
    if (!cartId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api(`/api/cart/${cartId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items);
      setSubtotal(data.subtotal_cents);
      setItemCount(data.item_count);
      onCountChange?.(data.item_count);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cart");
    } finally {
      setLoading(false);
    }
  }, [cartId]);

  useEffect(() => { load(); }, [load, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setQty = async (sku: string, qty: number) => {
    if (!cartId) return;
    await api(`/api/cart/${cartId}/items/${sku}`, {
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
    await api(`/api/cart/${cartId}/items/${encodeURIComponent(sku)}`, {
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
      await api(`/api/cart/${cartId}/items`, { method: "DELETE" });
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
        await api(`/api/cart/${cartId}/items/${encodeURIComponent(wrongSku)}`, {
          method: "DELETE",
        });
      }
      await api(`/api/cart/${cartId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: rightSku, quantity: 1 }),
      });
      setSwapTarget(null);
      swapSearch.setQuery("");
      onChange?.();
    } finally {
      setSwapAdding(false);
    }
  };

  function openSwap(target: CartItem) {
    setExpandedSku(null);
    swapSearch.setQuery("");
    setSwapTarget(target);
  }

  const fmt = (cents: number | null) => cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      <div className="px-4 py-3 bg-white border-b border-aldi-border shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-aldi-text-muted uppercase tracking-wide">
              {itemCount} item{itemCount === 1 ? "" : "s"}
            </span>
            <div className="text-2xl font-black tabular-nums text-aldi-blue tracking-tight">
              {fmt(subtotal)}
            </div>
          </div>
          {items.length > 0 && (
            <div>
              {confirmingClear ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-aldi-danger font-medium">
                    Clear all {itemCount}?
                  </span>
                  <Button
                    ref={hapticRef}
                    size="sm"
                    variant="destructive"
                    className="rounded-full"
                    onClick={clearCart}
                  >
                    Confirm
                  </Button>
                  <Button
                    ref={hapticRef}
                    size="sm"
                    variant="outline"
                    className="rounded-full text-muted-foreground"
                    onClick={() => setConfirmingClear(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  ref={hapticRef}
                  size="sm"
                  variant="outline"
                  className="rounded-full text-muted-foreground hover:text-aldi-danger hover:border-aldi-danger/40"
                  onClick={() => setConfirmingClear(true)}
                >
                  <Trash2 />
                  Clear cart
                </Button>
              )}
            </div>
          )}
        </div>
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
            <ShoppingCart className="w-8 h-8 text-aldi-blue" strokeWidth={1.5} />
          </div>
          <h2 className="text-lg font-semibold text-aldi-text mb-1">Your cart is empty</h2>
          <p>Scan a barcode or search the catalogue to start.</p>
        </div>
      ) : (
        <ul className="flex-1 min-h-0 overflow-y-auto overscroll-contain divide-y divide-aldi-border bg-white">
          {items.map((it, idx) => {
            const open = expandedSku === it.aldi_sku;
            return (
              <li key={it.aldi_sku} className="row-enter px-3 pt-3 pb-1" style={{ animationDelay: `${Math.min(idx * 30, 150)}ms` }}>
                <div className="flex items-center gap-3">
                  <ProductThumb image={it.primary_image} className="w-14 h-14" />
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
                    <Button
                      ref={hapticRef}
                      variant="outline"
                      size="icon"
                      className="size-8 rounded-full active:scale-95"
                      onClick={() => setQty(it.aldi_sku, it.quantity - 1)}
                      aria-label="Decrease"
                    >
                      <Minus />
                    </Button>
                    <span className="w-6 text-center font-semibold tabular-nums">{it.quantity}</span>
                    <Button
                      ref={hapticRef}
                      variant="outline"
                      size="icon"
                      className="size-8 rounded-full active:scale-95"
                      onClick={() => setQty(it.aldi_sku, it.quantity + 1)}
                      aria-label="Increase"
                    >
                      <Plus />
                    </Button>
                    {/* Per-line actions disclosure. Tapping it expands an
                        inline strip below the row with Wrong scan? and
                        Remove. We keep the affordance small so the +/-
                        controls stay the dominant interaction. */}
                    <Button
                      ref={hapticRef}
                      variant="outline"
                      size="icon"
                      className={
                        "size-8 rounded-full active:scale-95 " +
                        (open
                          ? "border-aldi-blue bg-aldi-bg text-aldi-blue"
                          : "text-aldi-text-muted")
                      }
                      onClick={() => setExpandedSku(open ? null : it.aldi_sku)}
                      aria-label="More actions"
                      aria-expanded={open}
                    >
                      <Ellipsis className="size-4" />
                    </Button>
                  </div>
                </div>
                {open && (
                  <div className="flex items-center gap-2 mt-2 mb-2 pl-[68px]">
                    <Button
                      ref={hapticRef}
                      size="sm"
                      variant="outline"
                      className="rounded-full text-muted-foreground hover:border-aldi-danger hover:text-aldi-danger"
                      onClick={() => openSwap(it)}
                    >
                      Wrong scan? Replace…
                    </Button>
                    <Button
                      ref={hapticRef}
                      size="sm"
                      variant="outline"
                      className="rounded-full text-muted-foreground hover:border-aldi-danger hover:text-aldi-danger"
                      onClick={() => removeItem(it.aldi_sku)}
                    >
                      <Trash2 />
                      Remove
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Replace-this-line sheet. The header restates which item we're
          replacing; picking a result runs swapLine(). */}
      <ProductSearchSheet
        open={swapTarget != null}
        onOpenChange={(o) => {
          if (!o) {
            setSwapTarget(null);
            swapSearch.setQuery("");
          }
        }}
        title="Replace item"
        description={swapTarget ? swapTarget.name : undefined}
        query={swapSearch.query}
        onQueryChange={swapSearch.setQuery}
        results={swapSearch.results}
        searching={swapSearch.searching}
        onPick={(p) => swapTarget && swapLine(swapTarget.aldi_sku, p.sku)}
        busy={swapAdding}
        actionLabel="Use"
        disabledSkus={swapTarget ? [swapTarget.aldi_sku] : []}
        disabledLabel="Current"
        emptyHint="Type a product name to find the right item."
      />
    </div>
  );
}
