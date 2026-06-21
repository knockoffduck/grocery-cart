"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { CartView } from "@/components/CartView";
import { SearchView } from "@/components/SearchView";
import { NavBar } from "@/components/NavBar";
import { SyncBanner } from "@/components/SyncBanner";

type Screen = "cart" | "scan" | "search";

const STORAGE_KEY = "aldi_cart_id";

// Lazy-load the scanner only when the user actually opens the Scan tab.
// SSR is disabled because the scanner uses browser-only APIs (getUserMedia,
// MediaStreamTrack.applyConstraints) that don't exist on the server.
const Scanner = dynamic(
  () => import("@/components/Scanner").then((m) => m.Scanner),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center bg-black text-white/60 text-sm">
        Loading camera…
      </div>
    ),
  },
);

export default function Home() {
  const [screen, setScreen] = useState<Screen>("cart");
  const [cartId, setCartId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Adopt a shared cart from the URL on first load (?cart=<id>).
  // Lets the user share a cart across devices via QR code or link.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shared = params.get("cart");
    if (shared) {
      setCartId(shared);
      localStorage.setItem(STORAGE_KEY, shared);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  // Ensure we have a cartId (create one if not). Runs on mount and on
  // failure (if the saved cart is gone, we get a new one).
  useEffect(() => {
    let cancelled = false;
    async function ensure() {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        // Verify the stored cart still exists server-side.
        try {
          const res = await fetch(`/api/cart/${stored}`);
          if (res.ok) {
            if (!cancelled) setCartId(stored);
            return;
          }
        } catch {
          /* network error — keep the id and try again next time */
        }
        if (!cancelled) setCartId(stored);
        return;
      }
      try {
        const res = await fetch("/api/cart", { method: "POST" });
        if (!res.ok) return;
        const { cartId: id } = await res.json();
        localStorage.setItem(STORAGE_KEY, id);
        if (!cancelled) setCartId(id);
      } catch {
        /* offline — try again later */
      }
    }
    ensure();
    return () => { cancelled = true; };
  }, []);

  // Pass refreshKey to child views so they re-fetch when the cart changes.
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <>
      <header className="bg-aldi-blue text-white safe-top shadow-md">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-baseline justify-between">
          <div className="flex items-baseline gap-2">
            <span className="font-black text-2xl tracking-tight">ALDI</span>
            <span className="text-sm font-medium opacity-90">Shopping Cart</span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col max-w-2xl w-full mx-auto pb-20">
        <SyncBanner />
        {screen === "cart" && (
          <CartView cartId={cartId} refreshKey={refreshKey} onChange={bump} />
        )}
        {screen === "scan" && (
          <Scanner
            cartId={cartId}
            onScanned={() => {
              bump();
              setScreen("cart");
            }}
            onCancel={() => setScreen("cart")}
          />
        )}
        {screen === "search" && (
          <SearchView cartId={cartId} onAdded={() => { bump(); setScreen("cart"); }} />
        )}
      </main>

      <NavBar current={screen} onChange={setScreen} />
    </>
  );
}
