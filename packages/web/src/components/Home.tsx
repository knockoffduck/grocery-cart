import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { CartView } from "@/components/CartView";
import { SearchView } from "@/components/SearchView";
import { NavBar } from "@/components/NavBar";
import { SyncBanner } from "@/components/SyncBanner";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { api } from "@/lib/api";

type Screen = "cart" | "scan" | "search";

type CurrentUser = { email: string; role: 'user' | 'admin' };

const STORAGE_KEY = "aldi_cart_id";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string | null | undefined): s is string =>
  !!s && UUID_RE.test(s);

const Scanner = lazy(() =>
  import("@/components/Scanner").then((m) => ({ default: m.Scanner })),
);

export function Home() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [screen, setScreen] = useState<Screen>("cart");
  const [cartId, setCartId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [cartCount, setCartCount] = useState(0);

  // Fetch current user on mount
  useEffect(() => {
    api("/api/auth/me")
      .then((res) => res.json())
      .then((data) => setCurrentUser(data.user ?? null))
      .catch(() => setCurrentUser(null));
  }, []);

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
          const res = await api(`/api/cart/${stored}`);
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
        const res = await api("/api/cart", { method: "POST" });
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
                  <Link to="/admin" className="font-semibold hover:underline">
                    Admin
                  </Link>
                )}
                <LogoutButton />
              </>
            ) : (
              <Link to="/login" className="opacity-90 hover:opacity-100 hover:underline">
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1 flex flex-col max-w-2xl w-full mx-auto pb-24">
        <SyncBanner />
        {screen === "cart" && (
          <div key="cart" className="screen-enter flex-1 flex flex-col">
            <CartView cartId={cartId} refreshKey={refreshKey} onChange={bump} onCountChange={setCartCount} />
          </div>
        )}
        {screen === "scan" && (
          <div key="scan" className="screen-enter flex-1 flex flex-col">
            <Suspense
              fallback={
                <div className="flex-1 flex items-center justify-center bg-black text-white/60 text-sm">
                  Loading camera…
                </div>
              }
            >
              <Scanner
                cartId={cartId}
                onScanned={() => {
                  bump();
                  setScreen("cart");
                }}
                onCancel={() => setScreen("cart")}
              />
            </Suspense>
          </div>
        )}
        {screen === "search" && (
          <div key="search" className="screen-enter flex-1 flex flex-col">
            <SearchView cartId={cartId} onAdded={() => { bump(); setScreen("cart"); }} />
          </div>
        )}
      </main>

      <NavBar current={screen} onChange={setScreen} cartCount={cartCount} />
    </>
  );
}
