"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { BarcodeScanner as ZBarScanner, type ScanResult as ZBarResult } from "web-wasm-barcode-reader";
import type { IScannerControls } from "@zxing/browser";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType, type Result, type Exception } from "@zxing/library";
import { lookupEanOffline } from "@/lib/client/catalogue";

interface EanMatch {
  matched: boolean;
  ean: string;
  best?: {
    sku: string;
    name: string;
    brand: string | null;
    sellingSize: string | null;
    priceDisplay: string | null;
    image: string | null;
  };
  off?: {
    name: string | null;
    brand: string | null;
    quantity: string | null;
  };
  reason?: string;
  canManualMatch?: boolean;
}

interface ScannerProps {
  cartId: string | null;
  onScanned?: () => void;
  onCancel?: () => void;
}

// Formats ZXing needs to try. ZBar covers most of these natively, but ZXing
// is the universal fallback so we ask for everything Aldi might use.
const ZXING_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
];

const ZXING_HINTS = new Map();
ZXING_HINTS.set(DecodeHintType.POSSIBLE_FORMATS, ZXING_FORMATS);
ZXING_HINTS.set(DecodeHintType.TRY_HARDER, true);
ZXING_HINTS.set(DecodeHintType.CHARACTER_SET, "UTF-8");

// Formats the native BarcodeDetector API supports. Android Chrome exposes
// DataMatrix here, which is why we prefer it on Android for produce stickers.
const NATIVE_FORMATS = [
  "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39",
  "qr_code", "data_matrix", "itf", "codabar",
];

type Engine = "native" | "zbar" | "zxing";

function pickEngine(): Engine {
  if (typeof window === "undefined") return "zxing";
  // BarcodeDetector is the best option (fast, all formats, native) — only
  // Android Chrome has it. iOS Safari does NOT.
  if ("BarcodeDetector" in window) return "native";
  // ZBar WASM is fast on iOS but doesn't support DataMatrix. Used as the
  // primary engine on iOS Safari.
  return "zbar";
}

export function Scanner({ cartId, onScanned, onCancel }: ScannerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const zxingControlsRef = useRef<IScannerControls | null>(null);
  const zbarScannerRef = useRef<ZBarScanner | null>(null);
  const nativeStreamRef = useRef<MediaStream | null>(null);
  const lastDecodedRef = useRef<string | null>(null);
  const lockUntilRef = useRef<number>(0);
  const [engine, setEngine] = useState<Engine | null>(null);

  const [match, setMatch] = useState<EanMatch | null>(null);
  const [status, setStatus] = useState<"starting" | "ready" | "error" | "retrying">("starting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [manualSearch, setManualSearch] = useState("");
  const [manualResults, setManualResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);

  // Cleanup on unmount. Idempotent — each engine cleans up its own resources.
  useEffect(() => {
    return () => stopAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopAll = useCallback(() => {
    if (nativeStreamRef.current) {
      nativeStreamRef.current.getTracks().forEach((t) => t.stop());
      nativeStreamRef.current = null;
    }
    if (zbarScannerRef.current) {
      try { zbarScannerRef.current.stop(); } catch {}
      zbarScannerRef.current = null;
    }
    if (zxingControlsRef.current) {
      try { zxingControlsRef.current.stop(); } catch {}
      zxingControlsRef.current = null;
    }
  }, []);

  const handleEan = useCallback(async (ean: string) => {
    // Try offline first if the user has synced the catalogue. The dump
    // endpoint is heavy, so we don't hit it on every scan — only on cold
    // start of the scan tab. The product details in the offline cache may
    // be slightly older than the server's, which is fine for the use case.
    try {
      const cached = await lookupEanOffline(ean);
      if (cached) {
        if (cached.matched && cached.best) {
          setMatch({ matched: true, ean, best: cached.best, canManualMatch: false });
          if (cartId) {
            await fetch(`/api/cart/${cartId}/items`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sku: cached.best.sku, quantity: 1 }),
            });
            setTimeout(() => onScanned?.(), 700);
          }
          return;
        }
        // Offline matched:false → fall through to network for the OFF info
        // and manual-match flow, since the offline cache doesn't store that.
      }
    } catch {
      /* offline cache unavailable, just fall back to network */
    }

    try {
      const res = await fetch(`/api/ean/${encodeURIComponent(ean)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: EanMatch = await res.json();
      setMatch(data);

      if (data.matched && data.best && cartId) {
        await fetch(`/api/cart/${cartId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sku: data.best.sku, quantity: 1 }),
        });
        setTimeout(() => onScanned?.(), 700);
      }
    } catch (e) {
      setMatch({
        matched: false,
        ean,
        reason: e instanceof Error ? e.message : "Lookup failed",
        canManualMatch: true,
      });
    }
  }, [cartId, onScanned]);

  // Dedup: same code re-firing is ignored; different code is allowed through
  // immediately. Lockout for 1.5s after a hit so we don't re-process.
  const accept = useCallback((text: string) => {
    const now = Date.now();
    if (now < lockUntilRef.current && text === lastDecodedRef.current) return false;
    lastDecodedRef.current = text;
    lockUntilRef.current = now + 1500;
    flashSuccess();
    if (navigator.vibrate) navigator.vibrate(50);
    handleEan(text);
    return true;
  }, [handleEan]);

  // Engine selection and startup.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!containerRef.current || !videoRef.current) return;
    let cancelled = false;
    let activeStream: MediaStream | null = null;

    const want = pickEngine();
    setEngine(want);

    const startNative = async () => {
      try {
        // BarcodeDetector path: we own the video, the stream, the loop.
        const detector = new (window as any).BarcodeDetector({ formats: NATIVE_FORMATS });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        activeStream = stream;
        nativeStreamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;

        // Capture the torch-capable track.
        const track = stream.getVideoTracks()[0];
        if (track && track.getCapabilities) {
          const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
          setTorchSupported(!!caps.torch);
        }

        setStatus("ready");
        const tick = async () => {
          if (cancelled) return;
          try {
            const results = await detector.detect(video);
            if (results && results.length > 0) {
              accept(results[0].rawValue);
            }
          } catch {
            /* a single failed frame is fine */
          }
        };
        const interval = setInterval(tick, 200);
        // Stash the interval id on the ref so cleanup can find it.
        (nativeStreamRef.current as any).__interval = interval;
      } catch (e) {
        if (cancelled) return;
        console.warn("[scanner] native failed, trying ZBar", e);
        // Fall through to ZBar.
        await startZbar();
      }
    };

    const startZbar = async () => {
      try {
        if (cancelled) return;
        setEngine("zbar");
        const scanner = new ZBarScanner({
          container: containerRef.current!,
          onDetect: (result: ZBarResult) => accept(result.data),
          scanInterval: 150,
          facingMode: "environment",
          // WASM assets are served from /public/ (copied from node_modules).
          wasmPath: "/",
        });
        zbarScannerRef.current = scanner;
        await scanner.start();
        if (cancelled) {
          scanner.stop();
          return;
        }
        // ZBar owns the camera; mirror its torch capability back to React.
        setStatus("ready");
        // Probe the video ZBar created to surface torch support.
        const v = containerRef.current!.querySelector("video") as HTMLVideoElement | null;
        if (v && v.srcObject) {
          const track = (v.srcObject as MediaStream).getVideoTracks()[0];
          if (track && track.getCapabilities) {
            const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
            setTorchSupported(!!caps.torch);
          }
        }
      } catch (e) {
        if (cancelled) return;
        console.warn("[scanner] ZBar failed, falling back to ZXing", e);
        await startZxing();
      }
    };

    const startZxing = async () => {
      if (cancelled) return;
      setEngine("zxing");
      const video = videoRef.current!;
      const reader = new BrowserMultiFormatReader(ZXING_HINTS, 60);
      const callback: (result: Result | undefined, error: Exception | undefined, controls: IScannerControls) => void = (result, _err, controls) => {
        if (cancelled) {
          controls.stop();
          return;
        }
        zxingControlsRef.current = controls;
        if (result) accept(result.getText());

        // After start, capture the track for torch.
        if (video.srcObject && !nativeStreamRef.current) {
          const stream = video.srcObject as MediaStream;
          const track = stream.getVideoTracks()[0];
          if (track && track.getCapabilities) {
            const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
            setTorchSupported(!!caps.torch);
            if (caps.focusMode?.includes("continuous")) {
              track.applyConstraints({ focusMode: "continuous" } as any).catch(() => {});
            }
          }
        }
      };
      try {
        // Cast: @zxing/browser 0.2.0's .d.ts appears to have an
        // overloaded-with-fewer-args type definition than the runtime API.
        const controls = await (reader as any).decodeFromVideoDevice(
          null,
          video,
          callback,
        ) as IScannerControls;
        zxingControlsRef.current = controls;
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        console.error("[scanner] all engines failed", e);
        setStatus("error");
        setErrorMsg(e instanceof Error ? e.message : String(e));
      }
    };

    if (want === "native") startNative();
    else if (want === "zbar") startZbar();
    else startZxing();

    return () => {
      cancelled = true;
      if (activeStream) activeStream.getTracks().forEach((t) => t.stop());
      if (nativeStreamRef.current) {
        const interval = (nativeStreamRef.current as any).__interval;
        if (interval) clearInterval(interval);
        nativeStreamRef.current.getTracks().forEach((t) => t.stop());
        nativeStreamRef.current = null;
      }
      if (zbarScannerRef.current) {
        try { zbarScannerRef.current.stop(); } catch {}
        zbarScannerRef.current = null;
      }
      if (zxingControlsRef.current) {
        try { zxingControlsRef.current.stop(); } catch {}
        zxingControlsRef.current = null;
      }
    };
  }, [accept]);

  function flashSuccess() {
    const flash = document.getElementById("scan-flash");
    const reticle = document.getElementById("scan-reticle");
    if (flash) {
      flash.classList.add("active");
      flash.offsetWidth; // force reflow
      setTimeout(() => flash.classList.remove("active"), 200);
    }
    if (reticle) {
      reticle.classList.add("success");
      setTimeout(() => reticle.classList.remove("success"), 400);
    }
  }

  async function toggleTorch() {
    // The torch track might be on either our own native stream or ZBar's.
    let track: MediaStreamTrack | null = null;
    if (nativeStreamRef.current) {
      track = nativeStreamRef.current.getVideoTracks()[0] ?? null;
    } else if (zbarScannerRef.current) {
      const v = containerRef.current?.querySelector("video") as HTMLVideoElement | null;
      if (v && v.srcObject) {
        track = (v.srcObject as MediaStream).getVideoTracks()[0] ?? null;
      }
    } else if (videoRef.current?.srcObject) {
      track = (videoRef.current.srcObject as MediaStream).getVideoTracks()[0] ?? null;
    }
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as any);
      setTorchOn(next);
    } catch {
      try {
        await track.applyConstraints({ torch: next } as any);
        setTorchOn(next);
      } catch {
        /* not supported */
      }
    }
  }

  async function runManualSearch() {
    const q = manualSearch.trim();
    if (q.length < 1) {
      setManualResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=8`);
      const data = await res.json();
      setManualResults(data.items ?? []);
    } finally {
      setSearching(false);
    }
  }

  async function saveManualMatch(ean: string, sku: string) {
    if (!cartId || adding) return;
    setAdding(true);
    try {
      await fetch("/api/manual-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ean, aldi_sku: sku }),
      });
      await fetch(`/api/cart/${cartId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, quantity: 1 }),
      });
      onScanned?.();
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <div
        ref={containerRef}
        className="relative bg-black aspect-[4/3] w-full max-w-xl mx-auto overflow-hidden"
      >
        {/* The native and ZXing engines use this video element. ZBar replaces
            it with its own. Either way the container is what we render into. */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div id="scan-reticle" className="scan-reticle">
          <span className="corner-tl" />
          <span className="corner-tr" />
          <span className="corner-bl" />
          <span className="corner-br" />
        </div>
        <div id="scan-flash" className="scan-flash" />

        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-white bg-black/80 z-20">
            <div>
              <p className="font-semibold mb-2">Camera unavailable</p>
              <p className="text-sm text-white/70 mb-4">{errorMsg}</p>
              <p className="text-xs text-white/50">Allow camera access or use search.</p>
            </div>
          </div>
        )}

        {status === "ready" && engine && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 text-white/80 text-[10px] font-mono uppercase tracking-wider z-10">
            {engine === "native" ? "Native" : engine === "zbar" ? "WASM" : "ZXing"}
          </div>
        )}
      </div>

      <div className="p-3 bg-white border-b border-aldi-border flex items-center justify-between gap-2">
        <p className="text-sm text-aldi-text-muted">Point your camera at the barcode.</p>
        <div className="flex gap-2">
          {torchSupported && (
            <button
              onClick={toggleTorch}
              className="px-3 py-1.5 rounded-full border border-aldi-border text-sm font-medium hover:bg-aldi-bg transition"
            >
              {torchOn ? "Torch off" : "Torch on"}
            </button>
          )}
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-full border border-aldi-border text-sm font-medium hover:bg-aldi-bg transition"
          >
            Cancel
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {match ? (
          <ScanResult
            match={match}
            cartId={cartId}
            onScanned={onScanned}
            manualSearch={manualSearch}
            setManualSearch={setManualSearch}
            manualResults={manualResults}
            searching={searching}
            runManualSearch={runManualSearch}
            saveManualMatch={saveManualMatch}
            adding={adding}
          />
        ) : (
          <div className="text-center text-aldi-text-muted py-8 text-sm">
            Waiting for a barcode…
          </div>
        )}
      </div>
    </div>
  );
}

interface ScanResultProps {
  match: EanMatch;
  cartId: string | null;
  onScanned?: () => void;
  manualSearch: string;
  setManualSearch: (s: string) => void;
  manualResults: any[];
  searching: boolean;
  runManualSearch: () => void;
  saveManualMatch: (ean: string, sku: string) => void;
  adding: boolean;
}

function ScanResult({
  match,
  cartId,
  onScanned,
  manualSearch,
  setManualSearch,
  manualResults,
  searching,
  runManualSearch,
  saveManualMatch,
  adding,
}: ScanResultProps) {
  const [added, setAdded] = useState(false);
  useEffect(() => {
    if (match.matched && match.best && cartId && !added) {
      setAdded(true);
    }
  }, [match, cartId, added]);

  if (match.matched && match.best) {
    return (
      <div className="bg-white rounded-xl border border-aldi-success overflow-hidden">
        <div className="bg-aldi-success/10 px-4 py-2 text-aldi-success text-sm font-semibold flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="w-4 h-4">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Added to cart
        </div>
        <div className="flex items-center gap-3 p-3">
          {match.best.image ? (
            <img
              src={match.best.image}
              alt=""
              className="w-14 h-14 object-contain rounded bg-aldi-bg shrink-0"
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
            />
          ) : (
            <div className="w-14 h-14 rounded bg-aldi-bg shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm leading-snug">{match.best.name}</div>
            <div className="text-xs text-aldi-text-muted mt-0.5">
              {match.best.brand}{match.best.sellingSize ? ` · ${match.best.sellingSize}` : ""}
            </div>
            <div className="text-sm font-semibold text-aldi-blue mt-1 tabular-nums">
              {match.best.priceDisplay}
            </div>
          </div>
        </div>
        <button
          onClick={onScanned}
          className="w-full py-3 text-sm font-semibold text-aldi-blue border-t border-aldi-border hover:bg-aldi-bg transition"
        >
          Back to cart
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-aldi-border p-3">
        {match.off?.name && (
          <div>
            <div className="text-xs text-aldi-text-muted">Open Food Facts</div>
            <div className="font-semibold mt-0.5">{match.off.name}</div>
            {match.off.brand && (
              <div className="text-xs text-aldi-text-muted mt-0.5">
                {match.off.brand}{match.off.quantity ? ` · ${match.off.quantity}` : ""}
              </div>
            )}
          </div>
        )}
        <div className="mt-2 px-2 py-1 rounded bg-aldi-bg text-xs text-aldi-text-muted inline-block">
          Scanned: <span className="font-mono">{match.ean}</span>
        </div>
        <div className="mt-2 text-sm text-aldi-text-muted">
          No automatic match. Search the Aldi catalogue to teach the app for next time.
        </div>
      </div>

      <div className="bg-white rounded-xl border border-aldi-border p-3">
        <input
          type="search"
          value={manualSearch}
          onChange={(e) => {
            setManualSearch(e.target.value);
            runManualSearch();
          }}
          placeholder="Search Aldi products…"
          className="w-full px-3 py-2 rounded-lg bg-aldi-bg border border-aldi-border focus:border-aldi-blue focus:ring-2 focus:ring-aldi-blue/20 outline-none transition"
        />
        {searching ? (
          <div className="text-sm text-aldi-text-muted py-3 text-center">Searching…</div>
        ) : manualResults.length > 0 ? (
          <ul className="mt-2 divide-y divide-aldi-border">
            {manualResults.map((p) => (
              <li key={p.sku} className="flex items-center gap-3 py-2">
                {p.image ? (
                  <img
                    src={p.image}
                    alt=""
                    className="w-10 h-10 object-contain rounded bg-aldi-bg shrink-0"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
                  />
                ) : (
                  <div className="w-10 h-10 rounded bg-aldi-bg shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium line-clamp-2">{p.name}</div>
                  <div className="text-xs text-aldi-text-muted mt-0.5">
                    {p.brand}{p.sellingSize ? ` · ${p.sellingSize}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => saveManualMatch(match.ean, p.sku)}
                  disabled={adding}
                  className="px-3 py-1.5 rounded-full bg-aldi-blue text-white text-xs font-semibold hover:bg-aldi-blue-dark active:scale-95 transition disabled:opacity-50"
                >
                  {adding ? "…" : "Use"}
                </button>
              </li>
            ))}
          </ul>
        ) : manualSearch.trim().length > 0 ? (
          <div className="text-sm text-aldi-text-muted py-3 text-center">No matches.</div>
        ) : null}
      </div>
    </div>
  );
}
