import { useEffect, useRef, useState, useCallback } from "react";
import { Camera, Flashlight, Search } from "lucide-react";
import { BarcodeScanner as ZBarScanner, type ScanResult as ZBarResult } from "web-wasm-barcode-reader";
import type { IScannerControls } from "@zxing/browser";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType, type Result, type Exception } from "@zxing/library";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProductSearchSheet, ProductThumb } from "@/components/ProductSearchSheet";
import { useProductSearch, type SearchProduct } from "@/lib/hooks/use-product-search";
import { lookupEanOffline, upsertCachedEanMapping } from "@/lib/catalogue";
import { api } from "@/lib/api";
import { useHaptic } from "@/lib/haptics";

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

const NATIVE_FORMATS = [
  "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39",
  "qr_code", "data_matrix", "itf", "codabar",
];

type Engine = "native" | "zbar" | "zxing";

// Torch and manual focus aren't in the TS lib's MediaTrackCapabilities.
// This shape captures everything the scanner needs from getCapabilities()
// and applyConstraints() without scattering `as any` casts.
type CamCaps = MediaTrackCapabilities & {
  torch?: boolean;
  focusMode?: string[];
  focusDistance?: { min?: number; max?: number; step?: number };
};

function pickEngine(): Engine {
  if (typeof window === "undefined") return "zxing";
  if ("BarcodeDetector" in window) return "native";
  return "zbar";
}

interface VideoDevice {
  deviceId: string;
  label: string;
}

// Best-effort label for a MediaDeviceInfo based on its position. iOS Safari
// often only exposes the deviceId until getUserMedia has been called at
// least once, so we fall back to "Camera 1/2/3" based on the order.
function labelDevice(d: MediaDeviceInfo, idx: number, total: number): string {
  if (d.label) return d.label.replace(/\s*\(.*?\)\s*/g, "").trim() || d.label;
  // Fall back to position heuristics. The order iOS reports devices in is
  // consistent per-session: back ultra-wide, back wide, front, back tele.
  // We can't know for sure without a label, so just call them Camera 1..N.
  return `Camera ${idx + 1} of ${total}`;
}

export function Scanner({ cartId, onScanned, onCancel }: ScannerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const zxingControlsRef = useRef<IScannerControls | null>(null);
  const zbarScannerRef = useRef<ZBarScanner | null>(null);
  const nativeStreamRef = useRef<MediaStream | null>(null);
  const nativeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Whichever engine "owns" the current stream. ZBar creates its own video
  // element and stream, so the torch and focus helpers need to know whether
  // to look at our <video> or at the one ZBar inserted.
  const streamOwnerRef = useRef<"native" | "zxing" | "zbar" | null>(null);
  const lastDecodedRef = useRef<string | null>(null);
  const lockUntilRef = useRef<number>(0);
  const focusResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const hapticRef = useHaptic<HTMLButtonElement>();

  const [match, setMatch] = useState<EanMatch | null>(null);
  const [status, setStatus] = useState<"starting" | "ready" | "error" | "retrying">("starting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [adding, setAdding] = useState(false);
  const [videoDevices, setVideoDevices] = useState<VideoDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  // The last tapped point on the video, shown briefly to confirm the focus
  // hit landed where the user expected. Normalized 0..1 across the video.
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number; key: number } | null>(null);

  useEffect(() => {
    return () => stopAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopAll = useCallback(() => {
    if (focusResetTimerRef.current) {
      clearTimeout(focusResetTimerRef.current);
      focusResetTimerRef.current = null;
    }
    if (nativeIntervalRef.current) {
      clearInterval(nativeIntervalRef.current);
      nativeIntervalRef.current = null;
    }
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
    streamOwnerRef.current = null;
  }, []);

  // Resolve a scanned barcode to a product and surface it for the user to
  // confirm. We deliberately do NOT add to the cart here — the user must tap
  // "Add to cart" on the match card (see addToCart). This avoids surprise
  // additions from mis-scans.
  const handleEan = useCallback(async (ean: string) => {
    try {
      const cached = await lookupEanOffline(ean);
      if (cached) {
        if (cached.matched && cached.best) {
          setMatch({ matched: true, ean, best: cached.best, canManualMatch: false });
          return;
        }
      }
    } catch {
      /* offline cache unavailable, just fall back to network */
    }

    try {
      const res = await api(`/api/ean/${encodeURIComponent(ean)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: EanMatch = await res.json();
      setMatch(data);
    } catch (e) {
      setMatch({
        matched: false,
        ean,
        reason: e instanceof Error ? e.message : "Lookup failed",
        canManualMatch: true,
      });
    }
  }, []);

  // Add the confirmed match to the cart. Called from the match card's
  // "Add to cart" button. Persists the EAN -> SKU mapping so future scans
  // resolve correctly, then hands off to the cart view.
  const addToCart = useCallback(async (m: EanMatch) => {
    if (!cartId || !m.best || adding) return;
    setAdding(true);
    try {
      const res = await api(`/api/cart/${cartId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: m.best.sku, quantity: 1 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Reinforce the mapping so approved scans take precedence over fuzzy
      // matches on future lookups. Fire-and-forget.
      void api("/api/manual-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ean: m.ean, aldi_sku: m.best.sku }),
      }).catch(() => {});
      void upsertCachedEanMapping(m.ean, m.best.sku).catch(() => {});
      onScanned?.();
    } finally {
      setAdding(false);
    }
  }, [cartId, adding, onScanned]);

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

  // Helper: find the active video element and its track. ZBar creates its
  // own <video>, so we may need to look inside the container rather than
  // at the ref. This is the single source of truth for "where is the feed".
  const getActiveTrack = useCallback((): { track: MediaStreamTrack | null; video: HTMLVideoElement | null } => {
    if (streamOwnerRef.current === "native" && nativeStreamRef.current) {
      return { track: nativeStreamRef.current.getVideoTracks()[0] ?? null, video: videoRef.current };
    }
    if (streamOwnerRef.current === "zbar") {
      const v = containerRef.current?.querySelector("video") as HTMLVideoElement | null;
      const stream = (v?.srcObject as MediaStream | null);
      return { track: stream?.getVideoTracks()[0] ?? null, video: v };
    }
    if (streamOwnerRef.current === "zxing" && videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      return { track: stream.getVideoTracks()[0] ?? null, video: videoRef.current };
    }
    return { track: null, video: null };
  }, []);

  // Enumerate video devices. Labels are only populated after the user has
  // granted camera permission at least once in the session. We call this
  // after start() so labels are available.
  const refreshDevices = useCallback(async () => {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const vids = devs
        .filter((d) => d.kind === "videoinput")
        .map((d, i, all) => ({ deviceId: d.deviceId, label: labelDevice(d, i, all.length) }));
      setVideoDevices(vids);
      // If we have no active selection yet, default to the first device.
      setActiveDeviceId((cur) => cur ?? vids[0]?.deviceId ?? null);
    } catch {
      /* noop */
    }
  }, []);

  // Engine startup. Runs once on mount. Camera swaps are handled by a
  // separate effect that re-applies the constraints of the active stream.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!containerRef.current || !videoRef.current) return;
    let cancelled = false;

    const want = pickEngine();
    setEngine(want);

    const startNative = async () => {
      try {
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
        nativeStreamRef.current = stream;
        streamOwnerRef.current = "native";
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;

        const track = stream.getVideoTracks()[0];
        if (track && track.getCapabilities) {
          const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
          setTorchSupported(!!caps.torch);
        }

        setStatus("ready");
        refreshDevices();
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
        nativeIntervalRef.current = setInterval(tick, 200);
      } catch (e) {
        if (cancelled) return;
        console.warn("[scanner] native failed, trying ZBar", e);
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
          wasmPath: "/",
        });
        zbarScannerRef.current = scanner;
        await scanner.start();
        if (cancelled) {
          scanner.stop();
          return;
        }
        streamOwnerRef.current = "zbar";
        setStatus("ready");
        refreshDevices();
        const v = containerRef.current!.querySelector("video") as HTMLVideoElement | null;
        if (v && v.srcObject) {
          const track = (v.srcObject as MediaStream).getVideoTracks()[0];
          if (track && track.getCapabilities) {
            const caps = track.getCapabilities() as CamCaps;
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

        if (video.srcObject && !streamOwnerRef.current) {
          streamOwnerRef.current = "zxing";
          const stream = video.srcObject as MediaStream;
          const track = stream.getVideoTracks()[0];
          if (track && track.getCapabilities) {
            const caps = track.getCapabilities() as CamCaps;
            setTorchSupported(!!caps.torch);
            if (caps.focusMode?.includes("continuous")) {
              track.applyConstraints({ focusMode: "continuous" } as any).catch(() => {});
            }
          }
          refreshDevices();
          setStatus("ready");
        }
      };
      try {
        const controls = await (reader as any).decodeFromVideoDevice(
          null,
          video,
          callback,
        ) as IScannerControls;
        zxingControlsRef.current = controls;
        if (!streamOwnerRef.current) setStatus("ready");
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
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accept]);

  // Camera switch. When the user picks a different deviceId we stop the
  // current video track, re-acquire a stream with the new device, and
  // attach it to the existing video element. The detection loop keeps
  // running (it's polling `video` regardless of which stream it carries).
  useEffect(() => {
    if (!activeDeviceId) return;
    if (streamOwnerRef.current === "zbar") {
      // ZBar owns the stream; rebind by stopping and restarting with the
      // explicit deviceId. Simpler: tell ZBar to use a different source by
      // restarting the engine. The cost is a ~1s black flash, which is
      // acceptable when the user explicitly asked to switch cameras.
      try { zbarScannerRef.current?.stop(); } catch {}
      zbarScannerRef.current = null;
      const v = containerRef.current?.querySelector("video");
      if (v) v.srcObject = null;
      // ZBar's typed ScannerOptions doesn't include `deviceId` even though
      // getUserMedia accepts it. Cast through `unknown` to satisfy strict
      // TS without scattering `as any` over the call site.
      const scanner = new ZBarScanner({
        container: containerRef.current!,
        onDetect: (result: ZBarResult) => accept(result.data),
        scanInterval: 150,
        deviceId: activeDeviceId,
        wasmPath: "/",
      } as unknown as ConstructorParameters<typeof ZBarScanner>[0]);
      zbarScannerRef.current = scanner;
      scanner.start().then(() => {
        const v2 = containerRef.current?.querySelector("video") as HTMLVideoElement | null;
        if (v2?.srcObject) {
          const track = (v2.srcObject as MediaStream).getVideoTracks()[0];
          if (track?.getCapabilities) {
            const caps = track.getCapabilities() as CamCaps;
            setTorchSupported(!!caps.torch);
            setTorchOn(false);
          }
        }
      });
      return;
    }

    if (streamOwnerRef.current === "native" && nativeStreamRef.current) {
      // Reuse the existing engine and interval; just swap the underlying track.
      const oldStream = nativeStreamRef.current;
      navigator.mediaDevices
        .getUserMedia({ video: { deviceId: { exact: activeDeviceId } }, audio: false })
        .then((newStream) => {
          if (nativeStreamRef.current !== oldStream) {
            // User already switched again; drop the result.
            newStream.getTracks().forEach((t) => t.stop());
            return;
          }
          oldStream.getTracks().forEach((t) => t.stop());
          nativeStreamRef.current = newStream;
          streamOwnerRef.current = "native";
          const video = videoRef.current!;
          video.srcObject = newStream;
          video.play();
          const track = newStream.getVideoTracks()[0];
          if (track?.getCapabilities) {
            const caps = track.getCapabilities() as CamCaps;
            setTorchSupported(!!caps.torch);
            setTorchOn(false);
          }
        })
        .catch((err) => {
          console.warn("[scanner] device switch failed", err);
        });
      return;
    }

    if (streamOwnerRef.current === "zxing") {
      // ZXing also re-acquires the camera when we change the video srcObject.
      const video = videoRef.current!;
      const oldStream = video.srcObject as MediaStream | null;
      navigator.mediaDevices
        .getUserMedia({ video: { deviceId: { exact: activeDeviceId } }, audio: false })
        .then((newStream) => {
          oldStream?.getTracks().forEach((t) => t.stop());
          video.srcObject = newStream;
          video.play();
          const track = newStream.getVideoTracks()[0];
          if (track?.getCapabilities) {
            const caps = track.getCapabilities() as CamCaps;
            setTorchSupported(!!caps.torch);
            setTorchOn(false);
            if (caps.focusMode?.includes("continuous")) {
              track.applyConstraints({ focusMode: "continuous" } as any).catch(() => {});
            }
          }
        })
        .catch((err) => {
          console.warn("[scanner] device switch failed", err);
        });
    }
  }, [activeDeviceId, accept]);

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
    const { track } = getActiveTrack();
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

  // Tap-to-focus. The browser expects a normalized (0..1) point relative to
  // the video track, and the device needs to advertise focusMode support
  // (typically "manual"). We focus at the tapped point, then drop back to
  // continuous autofocus after a short hold so the user doesn't have to
  // keep tapping to track moving items.
  async function focusAt(clientX: number, clientY: number) {
    const { track, video } = getActiveTrack();
    if (!track || !video) return;
    const rect = video.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;

    setFocusPoint({ x, y, key: Date.now() });
    setTimeout(() => setFocusPoint(null), 900);

    const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
      focusMode?: string[];
    };
    if (!caps.focusMode?.length) return;

    try {
      // Safari requires focusMode at the top level; Chrome accepts it under
      // advanced. We try the top-level form first, then fall back.
      try {
        await track.applyConstraints({
          focusMode: "manual",
          pointsOfInterest: [{ x, y }],
        } as any);
      } catch {
        await track.applyConstraints({
          advanced: [{ focusMode: "manual", pointsOfInterest: [{ x, y }] } as any],
        } as any);
      }
      if (focusResetTimerRef.current) clearTimeout(focusResetTimerRef.current);
      focusResetTimerRef.current = setTimeout(() => {
        track.applyConstraints({ focusMode: "continuous" } as any).catch(() => {});
      }, 1500);
    } catch (e) {
      console.warn("[scanner] tap-to-focus not supported", e);
    }
  }

  function onVideoClick(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    focusAt(e.clientX, e.clientY);
  }

  function onVideoTouch(e: React.TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 0) return;
    const t = e.touches[0];
    focusAt(t.clientX, t.clientY);
  }

  // Correct a wrong auto-match (or simply teach the app a new barcode).
  //
  // - wrongSku: the SKU that was wrongly added by the auto-match. Omitted
  //   (null) on the manual-match-of-unmatched-scan path, in which case we
  //   only add the right product and persist the mapping — no delete, no
  //   audit entry. wrongSku may also equal rightSku if user re-selects the
  //   same product; we still no-op the delete on equal SKUs.
  // - rightSku: the product the user picked.
  // - ean: the scanned barcode. Null if we don't know it (e.g. a swap
  //   started from the Cart view); in that case we skip the mapping +
  //   audit writes — we can only fix the cart line, not the model.
  async function swapItem(
    ean: string | null,
    wrongSku: string | null,
    rightSku: string,
  ) {
    if (!cartId || adding) return;
    setAdding(true);
    try {
      // 1. Drop the wrong line (if any and if different from the right one).
      if (wrongSku && wrongSku !== rightSku) {
        await api(`/api/cart/${cartId}/items/${encodeURIComponent(wrongSku)}`, {
          method: "DELETE",
        });
      }
      // 2. Add (or bump) the right line.
      const addRes = await api(`/api/cart/${cartId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: rightSku, quantity: 1 }),
      });
      if (!addRes.ok) throw new Error(`add failed: HTTP ${addRes.status}`);

      if (ean) {
        // 3. Persist the corrected EAN -> SKU mapping. Server upserts on
        //    conflict so a previously-wrong mapping gets overwritten too.
        //    Fire-and-forget — a failure here doesn't unwind the swap.
        void api("/api/manual-match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ean, aldi_sku: rightSku }),
        }).catch(() => {});
        // 4. Mirror into the offline cache so the next scan resolves
        //    correctly without a re-sync.
        void upsertCachedEanMapping(ean, rightSku).catch(() => {});
        // 5. Audit trail. Best-effort.
        if (wrongSku && wrongSku !== rightSku) {
          void api("/api/corrections", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ean,
              was_sku: wrongSku,
              now_sku: rightSku,
              cart_id: cartId,
            }),
          }).catch(() => {});
        }
      }
      onScanned?.();
    } finally {
      setAdding(false);
    }
  }

  // Unmatched-scan path: teach the app a new EAN -> SKU mapping and add the
  // product. This is `swapItem` with no wrongSku — kept as a thin wrapper so
  // the ScanResult call sites read clearly.
  function saveManualMatch(ean: string, sku: string) {
    return swapItem(ean, null, sku);
  }

  // Cycle to the next device, or wrap to the first. Keeps the button small.
  function cycleCamera() {
    if (videoDevices.length < 2) return;
    const idx = videoDevices.findIndex((d) => d.deviceId === activeDeviceId);
    const next = videoDevices[(idx + 1) % videoDevices.length];
    setActiveDeviceId(next.deviceId);
  }

  // Show a short label of the current camera in the badge so the user knows
  // what they'll get when they tap the switch button. Truncate to keep the
  // pill compact.
  const currentDeviceLabel = (() => {
    const d = videoDevices.find((v) => v.deviceId === activeDeviceId);
    if (!d) return null;
    return d.label.length > 18 ? d.label.slice(0, 17) + "…" : d.label;
  })();

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div
        ref={containerRef}
        onClick={onVideoClick}
        onTouchStart={onVideoTouch}
        className="relative bg-black aspect-[4/3] w-full max-w-xl mx-auto overflow-hidden"
        style={{ touchAction: "manipulation" }}
      >
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

        {/* Tap-to-focus reticle. A quick ring that fades out so the user
            sees the focus hit land where they tapped. */}
        {focusPoint && (
          <div
            key={focusPoint.key}
            className="absolute pointer-events-none z-10"
            style={{
              left: `${focusPoint.x * 100}%`,
              top: `${focusPoint.y * 100}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <div className="w-16 h-16 rounded-full border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)] focus-pulse" />
          </div>
        )}

        {/* Camera switch button. Top-right, only if there are 2+ cameras. */}
        {videoDevices.length > 1 && status === "ready" && (
          <Button
            ref={hapticRef}
            variant="secondary"
            size="icon"
            className="absolute top-2 right-2 z-20 size-10 rounded-full bg-black/60 text-white hover:bg-black/70"
            onClick={(e) => { e.stopPropagation(); cycleCamera(); }}
            aria-label="Switch camera"
            title="Switch camera"
          >
            <Camera className="size-5" />
          </Button>
        )}

        {/* Torch button. Bottom-right, only if the device supports it. */}
        {torchSupported && status === "ready" && (
          <Button
            ref={hapticRef}
            variant="secondary"
            size="icon"
            className={
              "absolute bottom-2 right-2 z-20 size-10 rounded-full " +
              (torchOn
                ? "bg-aldi-blue text-white hover:bg-aldi-blue"
                : "bg-black/60 text-white hover:bg-black/70")
            }
            onClick={(e) => { e.stopPropagation(); toggleTorch(); }}
            aria-label="Toggle torch"
            title="Toggle torch"
          >
            <Flashlight className="size-5" fill={torchOn ? "currentColor" : "none"} />
          </Button>
        )}

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
          <div className="absolute top-2 left-2 z-20 flex flex-col gap-1 items-start">
            <Badge className="rounded-full bg-black/60 font-mono text-[10px] uppercase tracking-wider text-white/80">
              {engine === "native" ? "Native" : engine === "zbar" ? "WASM" : "ZXing"}
            </Badge>
            {currentDeviceLabel && (
              <Badge className="max-w-[180px] rounded-full bg-black/60 text-[10px] font-medium text-white/80">
                <span className="truncate">{currentDeviceLabel}</span>
              </Badge>
            )}
          </div>
        )}
      </div>

      <div className="p-3 bg-white border-b border-aldi-border flex items-center justify-between gap-2">
        <p className="text-sm text-aldi-text-muted">Point your camera at the barcode. Tap to focus.</p>
        <Button
          ref={hapticRef}
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {match ? (
          <ScanResult
            match={match}
            cartId={cartId}
            onScanned={onScanned}
            addToCart={addToCart}
            saveManualMatch={saveManualMatch}
            swapItem={swapItem}
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
  addToCart: (m: EanMatch) => void;
  saveManualMatch: (ean: string, sku: string) => void;
  swapItem: (ean: string | null, wrongSku: string | null, rightSku: string) => void;
  adding: boolean;
}

function ScanResult({
  match,
  cartId,
  onScanned,
  addToCart,
  saveManualMatch,
  swapItem,
  adding,
}: ScanResultProps) {
  // Flips a successful match into the search-and-replace sheet. Carries
  // the wrong SKU through to swapItem so the cart line gets removed too.
  const [replaceOpen, setReplaceOpen] = useState(false);
  // Unmatched scans open the manual-match sheet immediately.
  const [manualOpen, setManualOpen] = useState(!match.matched);
  const search = useProductSearch(8);
  const hapticRef = useHaptic<HTMLButtonElement>();

  function openSheet() {
    search.setQuery("");
    if (match.matched) setReplaceOpen(true);
    else setManualOpen(true);
  }

  function closeSheet() {
    setReplaceOpen(false);
    setManualOpen(false);
    search.setQuery("");
  }

  function onPick(p: SearchProduct) {
    if (match.matched && match.best) {
      swapItem(match.ean, match.best.sku, p.sku);
    } else {
      saveManualMatch(match.ean, p.sku);
    }
  }

  if (match.matched && match.best) {
    return (
      <>
        <Card className="gap-0 overflow-hidden border-aldi-blue py-0">
          <CardHeader className="bg-aldi-blue/10 px-4 py-2">
            <CardTitle className="flex items-center gap-2 text-sm text-aldi-blue">
              <Search className="size-4" />
              Match found — confirm to add
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-3 px-4 py-3">
            <ProductThumb image={match.best.image} className="size-14" />
            <div className="min-w-0 flex-1">
              <div className="text-sm leading-snug font-semibold">{match.best.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {match.best.brand}
                {match.best.sellingSize ? ` · ${match.best.sellingSize}` : ""}
              </div>
              <div className="mt-1 text-sm font-semibold text-aldi-blue tabular-nums">
                {match.best.priceDisplay}
              </div>
            </div>
          </CardContent>
          <CardFooter className="grid grid-cols-2 gap-0 border-t px-0 py-0">
            <Button
              ref={hapticRef}
              variant="ghost"
              className="h-12 rounded-none text-muted-foreground"
              onClick={openSheet}
              disabled={adding}
            >
              Wrong item?
            </Button>
            <Button
              ref={hapticRef}
              className="h-12 rounded-none border-l"
              onClick={() => addToCart(match)}
              disabled={adding || !cartId}
            >
              {adding ? "Adding…" : "Add to cart"}
            </Button>
          </CardFooter>
        </Card>

        {/* Replace-mode: correct a wrong auto-match. Picking a product
            swaps the cart line and teaches the EAN mapping. */}
        <ProductSearchSheet
          open={replaceOpen}
          onOpenChange={(o) => { if (!o) closeSheet(); }}
          title="Find the right product"
          description={`Replacing: ${match.best.name} · scanned ${match.ean}`}
          query={search.query}
          onQueryChange={search.setQuery}
          results={search.results}
          searching={search.searching}
          onPick={onPick}
          busy={adding}
          actionLabel="Use"
          emptyHint="Start typing to search the catalogue."
        />
      </>
    );
  }

  return (
    <>
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          {match.off?.name ? (
            <>
              <CardDescription>Open Food Facts</CardDescription>
              <CardTitle className="mt-0.5 text-base">{match.off.name}</CardTitle>
              {match.off.brand && (
                <CardDescription>
                  {match.off.brand}
                  {match.off.quantity ? ` · ${match.off.quantity}` : ""}
                </CardDescription>
              )}
            </>
          ) : (
            <CardTitle className="text-base">No automatic match</CardTitle>
          )}
        </CardHeader>
        <CardContent className="space-y-2 px-4">
          <Badge variant="secondary" className="rounded bg-aldi-bg font-mono text-xs font-normal text-muted-foreground">
            Scanned: {match.ean}
          </Badge>
          <p className="text-sm text-muted-foreground">
            Search the Aldi catalogue to teach the app for next time.
          </p>
        </CardContent>
        <CardFooter className="px-4">
          <Button ref={hapticRef} onClick={openSheet} className="rounded-full">
            <Search />
            Search catalogue
          </Button>
        </CardFooter>
      </Card>

      {/* Manual-match: teach the app a new EAN -> SKU mapping and add the
          product in one step. */}
      <ProductSearchSheet
        open={manualOpen}
        onOpenChange={(o) => {
          if (!o) {
            closeSheet();
            onScanned?.();
          }
        }}
        title="Search the catalogue"
        description={`Teach the app what ${match.ean} is`}
        query={search.query}
        onQueryChange={search.setQuery}
        results={search.results}
        searching={search.searching}
        onPick={onPick}
        busy={adding}
        actionLabel="Use"
        emptyHint="Start typing to search the catalogue."
      />
    </>
  );
}
