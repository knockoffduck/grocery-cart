"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { CartView } from "@/components/CartView";
import { SearchView } from "@/components/SearchView";
import { NavBar } from "@/components/NavBar";
import { SyncBanner } from "@/components/SyncBanner";
import { LogoutButton } from "@/components/auth/LogoutButton";

type Screen = "cart" | "scan" | "search";

type CurrentUser = { email: string; role: 'user' | 'admin' };

const STORAGE_KEY = "aldi_cart_id";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string | null | undefined): s is string =>
  !!s && UUID_RE.test(s);

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

interface HomeProps {
  currentUser: CurrentUser | null;
}

export function Home({ currentUser }: HomeProps) {
  const [screen, setScreen] = useState<Screen>("cart");
  const [cartId, setCartId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shared = params.get("cart");
    if (isUuid(shared)) {
      setCartId(shared);
      localStorage.setItem(STORAGE_KEY, shared);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function ensure() {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isUuid(stored)) {
        try {
          const res = await fetch(`/api/cart/${stored}`);
          if (res.ok) {
            if (!cancelled) setCartId(stored);
            return;
          }
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          if (!cancelled) setCartId(stored);
          return;
        }
      }
      try {
        const res = await fetch("/api/cart", { method: "POST" });
        if (!res.ok) return;
        const { cartId: id } = await res.json();
        if (isUuid(id)) {
          localStorage.setItem(STORAGE_KEY, id);
          if (!cancelled) setCartId(id);
        }
      } catch {}
    }
    ensure();
    return () => { cancelled = true; };
  }, []);

  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <>
      <header className="bg-aldi-blue text-white safe-top shadow-md">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-black text-2xl tracking-tight">ALDI</span>
            <span className="text-sm font-medium opacity-90 truncate">Shopping Cart</span>
          </div>
          <nav className="flex items-center gap-3 text-sm shrink-0">
            {currentUser ? (
              <>
                {currentUser.role === 'admin' && (
                  <Link href="/admin" className="font-semibold hover:underline">
                    Admin
                  </Link>
                )}
                <LogoutButton />
              </>
            ) : (
              <Link href="/login" className="opacity-90 hover:opacity-100 hover:underline">
                Sign in
              </Link>
            )}
          </nav>
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
