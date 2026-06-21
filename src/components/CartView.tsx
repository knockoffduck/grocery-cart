"use client";

import { useEffect, useState, useCallback } from "react";

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
}

export function CartView({ cartId, refreshKey, onChange }: CartViewProps) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [subtotal, setSubtotal] = useState(0);
  const [itemCount, setItemCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const fmt = (cents: number | null) => cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-4 py-3 bg-white border-b border-aldi-border">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-aldi-text-muted">
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </span>
          <span className="text-2xl font-bold tabular-nums text-aldi-blue">
            {fmt(subtotal)}
          </span>
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
          {items.map((it) => (
            <li key={it.aldi_sku} className="flex items-center gap-3 p-3">
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
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
