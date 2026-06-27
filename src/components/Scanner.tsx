"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { BarcodeScanner as ZBarScanner, type ScanResult as ZBarResult } from "web-wasm-barcode-reader";
import type { IScannerControls } from "@zxing/browser";
import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType, type Result, type Exception } from "@zxing/library";
import { lookupEanOffline, upsertCachedEanMapping } from "@/lib/client/catalogue";

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

  const [match, setMatch] = useState<EanMatch | null>(null);
  const [status, setStatus] = useState<"starting" | "ready" | "error" | "retrying">("starting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [manualSearch, setManualSearch] = useState("");
  const [manualResults, setManualResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
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

  const handleEan = useCallback(async (ean: string) => {
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
        await fetch(`/api/cart/${cartId}/items/${encodeURIComponent(wrongSku)}`, {
          method: "DELETE",
        });
      }
      // 2. Add (or bump) the right line.
      const addRes = await fetch(`/api/cart/${cartId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: rightSku, quantity: 1 }),
      });
      if (!addRes.ok) throw new Error(`add failed: HTTP ${addRes.status}`);

      if (ean) {
        // 3. Persist the corrected EAN -> SKU mapping. Server upserts on
        //    conflict so a previously-wrong mapping gets overwritten too.
        //    Fire-and-forget — a failure here doesn't unwind the swap.
        void fetch("/api/manual-match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ean, aldi_sku: rightSku }),
        }).catch(() => {});
        // 4. Mirror into the offline cache so the next scan resolves
        //    correctly without a re-sync.
        void upsertCachedEanMapping(ean, rightSku).catch(() => {});
        // 5. Audit trail. Best-effort.
        if (wrongSku && wrongSku !== rightSku) {
          void fetch("/api/corrections", {
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
    <div className="flex-1 flex flex-col">
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
          <button
            onClick={(e) => { e.stopPropagation(); cycleCamera(); }}
            className="absolute top-2 right-2 z-20 w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center active:scale-95 transition"
            aria-label="Switch camera"
            title="Switch camera"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
              <path d="M3 7h3l2-2h8l2 2h3v12H3z" />
              <path d="M16 11l-4-3v8z" fill="currentColor" />
              <path d="M21 4l-2 2M21 4l-2-2M21 4h-4M21 4v4" strokeLinecap="round" />
            </svg>
          </button>
        )}

        {/* Torch button. Bottom-right, only if the device supports it. */}
        {torchSupported && status === "ready" && (
          <button
            onClick={(e) => { e.stopPropagation(); toggleTorch(); }}
            className={`absolute bottom-2 right-2 z-20 w-10 h-10 rounded-full flex items-center justify-center active:scale-95 transition ${
              torchOn ? "bg-aldi-blue text-white" : "bg-black/60 text-white"
            }`}
            aria-label="Toggle torch"
            title="Toggle torch"
          >
            {torchOn ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M9 2h6l-1 5h-4zM8 9h8v3l-3 2v6h-2v-6l-3-2z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
                <path d="M9 2h6l-1 5h-4zM8 9h8v3l-3 2v6h-2v-6l-3-2z" />
              </svg>
            )}
          </button>
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
            <span className="px-2 py-0.5 rounded-full bg-black/60 text-white/80 text-[10px] font-mono uppercase tracking-wider">
              {engine === "native" ? "Native" : engine === "zbar" ? "WASM" : "ZXing"}
            </span>
            {currentDeviceLabel && (
              <span className="px-2 py-0.5 rounded-full bg-black/60 text-white/80 text-[10px] font-medium max-w-[180px] truncate">
                {currentDeviceLabel}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="p-3 bg-white border-b border-aldi-border flex items-center justify-between gap-2">
        <p className="text-sm text-aldi-text-muted">Point your camera at the barcode. Tap to focus.</p>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-full border border-aldi-border text-sm font-medium hover:bg-aldi-bg transition"
        >
          Cancel
        </button>
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
  manualSearch: string;
  setManualSearch: (s: string) => void;
  manualResults: any[];
  searching: boolean;
  runManualSearch: () => void;
  saveManualMatch: (ean: string, sku: string) => void;
  swapItem: (ean: string | null, wrongSku: string | null, rightSku: string) => void;
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
  swapItem,
  adding,
}: ScanResultProps) {
  const [added, setAdded] = useState(false);
  // Flips a successful match into the search-and-replace panel. Carries
  // the wrong SKU through to swapItem so the cart line gets removed too.
  const [replaceMode, setReplaceMode] = useState(false);
  useEffect(() => {
    if (match.matched && match.best && cartId && !added) {
      setAdded(true);
    }
  }, [match, cartId, added]);

  function enterReplaceMode() {
    setReplaceMode(true);
    setManualSearch("");
  }

  if (match.matched && match.best && !replaceMode) {
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
        <div className="grid grid-cols-2 border-t border-aldi-border">
          <button
            onClick={enterReplaceMode}
            disabled={adding}
            className="py-3 text-sm font-medium text-aldi-text-muted hover:bg-aldi-bg transition disabled:opacity-50"
          >
            Wrong item?
          </button>
          <button
            onClick={onScanned}
            className="py-3 text-sm font-semibold text-aldi-blue border-l border-aldi-border hover:bg-aldi-bg transition"
          >
            Back to cart
          </button>
        </div>
      </div>
    );
  }

  // Replace-mode (correction of a wrong auto-match) reuses the unmatched
  // search panel below. We render a top banner showing which product is
  // being replaced, then the standard search interface with the Use
  // button now calling swapItem(ean, wrongSku, pickedSku).
  if (match.matched && match.best && replaceMode) {
    return (
      <div className="space-y-3">
        <div className="bg-white rounded-xl border border-aldi-danger p-3">
          <div className="text-xs font-semibold text-aldi-danger uppercase tracking-wider">
            Replacing this item
          </div>
          <div className="flex items-center gap-3 mt-2">
            {match.best.image ? (
              <img
                src={match.best.image}
                alt=""
                className="w-12 h-12 object-contain rounded bg-aldi-bg shrink-0"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.visibility = "hidden"; }}
              />
            ) : (
              <div className="w-12 h-12 rounded bg-aldi-bg shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm line-clamp-2 line-through decoration-aldi-danger/60">
                {match.best.name}
              </div>
              <div className="text-xs text-aldi-text-muted mt-0.5">
                {match.best.brand}{match.best.sellingSize ? ` · ${match.best.sellingSize}` : ""}
              </div>
            </div>
            <button
              onClick={() => { setReplaceMode(false); setManualSearch(""); }}
              className="px-3 py-1.5 rounded-full border border-aldi-border text-xs font-medium text-aldi-text-muted hover:bg-aldi-bg transition"
            >
              Keep
            </button>
          </div>
          <div className="mt-2 px-2 py-1 rounded bg-aldi-bg text-xs text-aldi-text-muted inline-block">
            Scanned: <span className="font-mono">{match.ean}</span>
          </div>
          <p className="text-sm text-aldi-text-muted mt-2">
            Find the right product below. We&apos;ll swap the cart line and remember this barcode next time.
          </p>
        </div>

        <ProductSearchPanel
          manualSearch={manualSearch}
          setManualSearch={setManualSearch}
          manualResults={manualResults}
          searching={searching}
          runManualSearch={runManualSearch}
          adding={adding}
          onPick={(p) => swapItem(match.ean, match.best!.sku, p.sku)}
          emptyHint="No matches."
        />
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

      <ProductSearchPanel
        manualSearch={manualSearch}
        setManualSearch={setManualSearch}
        manualResults={manualResults}
        searching={searching}
        runManualSearch={runManualSearch}
        adding={adding}
        onPick={(p) => saveManualMatch(match.ean, p.sku)}
        emptyHint="No matches."
      />
    </div>
  );
}

// Shared search-and-pick panel used by both the unmatched-scan path and
// the replace-mode path. The only difference is which `onPick` handler is
// plugged in — saveManualMatch (teaches a new mapping) vs swapItem (also
// removes a wrong cart line and audits the correction).
interface ProductSearchPanelProps {
  manualSearch: string;
  setManualSearch: (s: string) => void;
  manualResults: any[];
  searching: boolean;
  runManualSearch: () => void;
  adding: boolean;
  onPick: (p: { sku: string; name: string; brand: string | null; sellingSize: string | null; image: string | null }) => void;
  emptyHint: string;
}

function ProductSearchPanel({
  manualSearch,
  setManualSearch,
  manualResults,
  searching,
  runManualSearch,
  adding,
  onPick,
  emptyHint,
}: ProductSearchPanelProps) {
  return (
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
                onClick={() => onPick(p)}
                disabled={adding}
                className="px-3 py-1.5 rounded-full bg-aldi-blue text-white text-xs font-semibold hover:bg-aldi-blue-dark active:scale-95 transition disabled:opacity-50"
              >
                {adding ? "…" : "Use"}
              </button>
            </li>
          ))}
        </ul>
      ) : manualSearch.trim().length > 0 ? (
        <div className="text-sm text-aldi-text-muted py-3 text-center">{emptyHint}</div>
      ) : null}
    </div>
  );
}
