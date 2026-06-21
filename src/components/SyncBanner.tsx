"use client";

import { useEffect, useState, useCallback } from "react";
import { isCacheStale, syncFromServer, getCachedStatus, type CatalogueStatus } from "@/lib/client/catalogue";

type State = "checking" | "missing" | "stale" | "syncing" | "fresh" | "error" | "offline";

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
  return new Date(iso).toLocaleDateString();
}

export function SyncBanner() {
  const [state, setState] = useState<State>("checking");
  const [status, setStatus] = useState<CatalogueStatus | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const refresh = useCallback(async () => {
    setState("checking");
    setError(null);
    try {
      const cached = await getCachedStatus();
      setStatus(cached);
      const check = await isCacheStale();
      if (check.reason === "offline") {
        setState(cached ? "fresh" : "offline");
      } else if (!cached) {
        setState("missing");
      } else if (check.stale) {
        setState("stale");
      } else {
        setState("fresh");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runSync = useCallback(async () => {
    setState("syncing");
    setProgress("Starting…");
    setError(null);
    try {
      const next = await syncFromServer((msg) => setProgress(msg));
      setStatus(next);
      setState("fresh");
      setProgress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }, []);

  if (state === "checking") {
    return (
      <div className="bg-white border-b border-aldi-border px-4 py-2 text-xs text-aldi-text-muted">
        Checking catalogue…
      </div>
    );
  }

  if (state === "fresh" && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full bg-aldi-success/5 border-b border-aldi-border px-4 py-1.5 text-xs text-aldi-success text-left"
      >
        Offline ready · {status?.productCount.toLocaleString() ?? "0"} products · synced {relativeTime(status?.lastSync ?? null)}
      </button>
    );
  }

  if (state === "syncing") {
    return (
      <div className="bg-aldi-blue/5 border-b border-aldi-blue/20 px-4 py-2 text-xs text-aldi-blue">
        {progress || "Syncing…"}
      </div>
    );
  }

  if (state === "offline") {
    return (
      <div className="bg-aldi-yellow/30 border-b border-aldi-border px-4 py-2 text-xs text-aldi-text">
        Offline · showing cached catalogue from {relativeTime(status?.lastSync ?? null)}
      </div>
    );
  }

  // missing / stale / error / expanded-fresh: show the Sync button.
  const message =
    state === "missing"
      ? "Catalogue not cached. Sync to scan barcodes offline."
      : state === "stale"
      ? `Catalogue may be out of date. Last synced ${relativeTime(status?.lastSync ?? null)}.`
      : state === "error"
      ? `Sync failed: ${error ?? "unknown error"}`
      : expanded
      ? "Tap to refresh the offline cache."
      : "Tap to sync.";

  return (
    <div className="bg-aldi-orange/10 border-b border-aldi-orange/30 px-4 py-2 flex items-center justify-between gap-2">
      <p className="text-xs text-aldi-text flex-1">{message}</p>
      <button
        onClick={runSync}
        className="px-3 py-1 rounded-full bg-aldi-blue text-white text-xs font-semibold hover:bg-aldi-blue-dark active:scale-95 transition"
      >
        Sync now
      </button>
    </div>
  );
}
